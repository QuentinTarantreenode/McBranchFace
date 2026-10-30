//! Locks per repository, so git never races itself. The refs of a repository are shared by all its
//! working copies: a commit in a linked worktree and a delete or fetch in the main one write the same
//! refs and `packed-refs`, so they share one lock, keyed by the common git directory. The index is
//! per working copy: staging in one worktree never waits for a fetch, which can take minutes.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use tokio::sync::{Mutex as AsyncMutex, OwnedMutexGuard, OwnedRwLockReadGuard, OwnedRwLockWriteGuard, RwLock};

use crate::git::runner::Git;
use crate::paths::path_key;

/// A repository as its locks know it: the `path_key` of the git directory its working copies share.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct RepoKey(String);

/// What an operation locks. Refs come before the index, and repositories in key order, so two
/// operations never wait for each other.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord)]
pub enum LockScope {
    /// Writes refs (branches, remote-tracking refs, the stash, worktree registrations).
    Refs(RepoKey),
    /// Reads refs and must not see them change midway; any number of these at once.
    RefsShared(RepoKey),
    /// Writes the index and files of one working copy, by its `path_key`.
    Index(String),
}

/// The guards are only held, never read: dropping them releases the locks.
#[allow(dead_code)]
enum Held {
    Write(OwnedRwLockWriteGuard<()>),
    Read(OwnedRwLockReadGuard<()>),
    Index(OwnedMutexGuard<()>),
}

/// Holds its locks until dropped.
pub struct RepoGuard {
    _held: Vec<Held>,
}

#[derive(Default)]
pub struct RepoLocks {
    /// Working copy → its repository, resolved once per path.
    keys: Mutex<HashMap<String, RepoKey>>,
    refs: Mutex<HashMap<RepoKey, Arc<RwLock<()>>>>,
    index: Mutex<HashMap<String, Arc<AsyncMutex<()>>>>,
}

fn lock<T>(m: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|p| p.into_inner())
}

impl RepoLocks {
    /// What discovery and the watcher found already, so no git call is needed for it.
    pub fn note(&self, path: &str, common_dir: &str) {
        lock(&self.keys).insert(path_key(path), RepoKey(path_key(common_dir)));
    }

    /// The repository of a working copy. A folder git cannot answer for (gone, not a repository) is
    /// its own key and is asked again next time.
    pub async fn key(&self, path: &str) -> RepoKey {
        if let Some(k) = lock(&self.keys).get(&path_key(path)) {
            return k.clone();
        }
        match Git::new(path).out(&["rev-parse", "--path-format=absolute", "--git-common-dir"]).await {
            Ok(common) => {
                let key = RepoKey(path_key(common.trim()));
                lock(&self.keys).insert(path_key(path), key.clone());
                key
            }
            Err(_) => RepoKey(path_key(path)),
        }
    }

    /// The refs lock itself, for work that holds it only for a part (the fetch inside a scan).
    pub fn refs_lock(&self, key: &RepoKey) -> Arc<RwLock<()>> {
        lock(&self.refs).entry(key.clone()).or_default().clone()
    }

    fn index_lock(&self, worktree: &str) -> Arc<AsyncMutex<()>> {
        lock(&self.index).entry(worktree.to_string()).or_default().clone()
    }

    /// Takes the scopes in their order; duplicates count once.
    pub async fn acquire(&self, mut scopes: Vec<LockScope>) -> RepoGuard {
        scopes.sort();
        scopes.dedup();
        let mut held = Vec::with_capacity(scopes.len());
        for scope in scopes {
            held.push(match scope {
                LockScope::Refs(k) => Held::Write(self.refs_lock(&k).write_owned().await),
                LockScope::RefsShared(k) => Held::Read(self.refs_lock(&k).read_owned().await),
                LockScope::Index(w) => Held::Index(self.index_lock(&w).lock_owned().await),
            });
        }
        RepoGuard { _held: held }
    }

    /// For what writes refs only: a fetch, a push, deleting a branch.
    pub async fn refs(&self, path: &str) -> RepoGuard {
        let key = self.key(path).await;
        self.acquire(vec![LockScope::Refs(key)]).await
    }

    /// `refs` if nobody holds them right now.
    pub async fn try_refs(&self, path: &str) -> Option<RepoGuard> {
        let key = self.key(path).await;
        let guard = self.refs_lock(&key).try_write_owned().ok()?;
        Some(RepoGuard { _held: vec![Held::Write(guard)] })
    }

    /// The refs lock and a process slot for a fetch, never one held while waiting for the other: a
    /// slot held while a push in the repo runs for minutes would slow every other repo, and the lock
    /// held while waiting for a slot would hold up the user's work in this one.
    pub async fn refs_with_slot(&self, path: &str, budget: &crate::state::budget::Budget) -> (RepoGuard, tokio::sync::OwnedSemaphorePermit) {
        loop {
            let slot = budget.acquire().await;
            if let Some(guard) = self.try_refs(path).await {
                return (guard, slot);
            }
            drop(slot);
            drop(self.refs(path).await);
        }
    }

    /// For what writes refs and the working copy's index and files: commit, switch, pull.
    pub async fn working_copy(&self, path: &str) -> RepoGuard {
        let key = self.key(path).await;
        self.acquire(vec![LockScope::Refs(key), LockScope::Index(path_key(path))]).await
    }

    /// For what writes only the working copy's index and files: stage, unstage, discard.
    pub async fn index(&self, path: &str) -> RepoGuard {
        self.acquire(vec![LockScope::Index(path_key(path))]).await
    }

    /// For what writes the index and files from refs that must not move meanwhile (applying a stash).
    pub async fn index_reading_refs(&self, path: &str) -> RepoGuard {
        let key = self.key(path).await;
        self.acquire(vec![LockScope::RefsShared(key), LockScope::Index(path_key(path))]).await
    }

    /// The refs of several repos at once, always in the same order.
    /// The paths are read before the first await: a borrowing iterator kept across it would make the
    /// future of a Tauri command lose its `Send`.
    pub fn refs_all<'a>(&self, paths: impl IntoIterator<Item = &'a str>) -> impl std::future::Future<Output = RepoGuard> + Send + '_ {
        let paths: Vec<String> = paths.into_iter().map(String::from).collect();
        async move {
            let mut scopes = Vec::new();
            for p in &paths {
                scopes.push(LockScope::Refs(self.key(p).await));
            }
            self.acquire(scopes).await
        }
    }
}

#[cfg(test)]
mod tests {
    use std::path::Path;
    use std::time::Duration;

    use super::*;

    fn git(dir: &Path, args: &[&str]) {
        let o = std::process::Command::new("git").args(args).current_dir(dir).output().unwrap();
        assert!(o.status.success(), "{args:?}: {}", String::from_utf8_lossy(&o.stderr));
    }

    /// A repository with a linked worktree beside it.
    fn repo_with_worktree() -> (tempfile::TempDir, String, String) {
        let dir = tempfile::tempdir().unwrap();
        let main = dir.path().join("main");
        std::fs::create_dir(&main).unwrap();
        git(&main, &["init", "-q"]);
        git(&main, &["-c", "user.name=T", "-c", "user.email=t@x", "commit", "-q", "--allow-empty", "--no-gpg-sign", "-m", "a"]);
        git(&main, &["worktree", "add", "-q", "-b", "wt", "../linked"]);
        let s = |p: &Path| p.to_string_lossy().to_string();
        let (main, linked) = (s(&main), s(&dir.path().join("linked")));
        (dir, main, linked)
    }

    /// Whether `f` finishes within a short time, i.e. did not wait for a lock.
    async fn quick<F: std::future::Future>(f: F) -> bool {
        tokio::time::timeout(Duration::from_millis(300), f).await.is_ok()
    }

    #[tokio::test]
    async fn a_commit_in_a_linked_worktree_waits_for_a_delete_in_the_main_repo() {
        let (_dir, main, linked) = repo_with_worktree();
        let locks = Arc::new(RepoLocks::default());
        assert_eq!(locks.key(&main).await, locks.key(&linked).await, "one repository, one key");
        let delete = locks.refs(&main).await;
        assert!(!quick(locks.working_copy(&linked)).await, "the commit must wait while the delete writes the refs");
        let waiting = tokio::spawn({
            let locks = locks.clone();
            async move {
                locks.working_copy(&linked).await;
            }
        });
        drop(delete);
        assert!(tokio::time::timeout(Duration::from_secs(5), waiting).await.is_ok(), "and goes on once it is done");
    }

    #[tokio::test]
    async fn staging_in_a_worktree_does_not_wait_for_a_fetch() {
        let (_dir, main, linked) = repo_with_worktree();
        let locks = RepoLocks::default();
        let _fetch = locks.refs(&main).await;
        assert!(quick(locks.index(&linked)).await, "staging in the linked worktree");
        assert!(quick(locks.index(&main)).await, "staging in the main worktree");
        assert!(!quick(locks.index_reading_refs(&linked)).await, "applying a stash reads refs the fetch writes");
        let _stage = locks.index(&linked).await;
        assert!(!quick(locks.index(&linked)).await, "two writers of one index wait for each other");
    }

    #[tokio::test]
    async fn one_lock_per_repo_however_the_path_is_spelled() {
        let locks = RepoLocks::default();
        locks.note("C:\\ws\\a", "C:/ws/a/.git");
        locks.note("C:/ws/b", "C:/ws/b/.git");
        let held = locks.refs("C:\\ws\\a").await;
        assert!(!quick(locks.refs("C:/ws/a/")).await, "same repo, other spelling: still locked");
        assert!(quick(locks.refs("C:/ws/b")).await, "another repo is not blocked");
        drop(held);
        assert!(quick(locks.refs("C:/ws/a")).await);
        let all = locks.refs_all(["C:/ws/b", "C:\\ws\\a", "C:/ws/b/"]).await;
        assert_eq!(all._held.len(), 2, "each repo once");
    }

    #[tokio::test]
    async fn a_folder_git_cannot_answer_for_is_its_own_key() {
        let locks = RepoLocks::default();
        let dir = tempfile::tempdir().unwrap();
        let gone = dir.path().join("gone").to_string_lossy().to_string();
        assert_eq!(locks.key(&gone).await, RepoKey(path_key(&gone)));
        assert!(lock(&locks.keys).is_empty(), "not remembered: asked again next time");
    }

    #[tokio::test]
    async fn a_fetch_waiting_for_its_repo_holds_no_process_slot() {
        let locks = Arc::new(RepoLocks::default());
        let budget = Arc::new(crate::state::budget::Budget::new(1));
        locks.note("C:/ws/busy", "C:/ws/busy/.git");
        let push = locks.refs("C:/ws/busy").await;
        let fetch = tokio::spawn({
            let (locks, budget) = (locks.clone(), budget.clone());
            async move {
                let _held = locks.refs_with_slot("C:/ws/busy", &budget).await;
            }
        });
        tokio::time::sleep(Duration::from_millis(100)).await;
        assert!(quick(budget.acquire()).await, "the only slot is free for other repos while the fetch waits");
        drop(push);
        assert!(tokio::time::timeout(Duration::from_secs(5), fetch).await.is_ok(), "the fetch runs once the repo is free");
    }
}
