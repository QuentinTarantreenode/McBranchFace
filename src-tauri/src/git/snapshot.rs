use std::collections::{BTreeMap, HashMap};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};

use super::runner::{fields, Git};

const RETENTION_SECS: i64 = 365 * 24 * 3600;
/// `last_seen` only feeds the retention: refreshing it once a day is exact enough and keeps a rescan
/// from rewriting every file.
const LAST_SEEN_STEP: i64 = 24 * 3600;
const PREFIX_LEN: usize = 40;

/// Last known SHA of every remote-tracking ref. Kept after the remote branch is pruned, because
/// that is the only local record of what was pushed once the remote branch is gone.
#[derive(Debug, Default, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub refs: BTreeMap<String, SnapshotEntry>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotEntry {
    pub sha: String,
    pub first_seen: i64,
    pub last_seen: i64,
}

pub fn now() -> i64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs() as i64).unwrap_or(0)
}

/// FNV-1a: the file name must stay the same across runs and versions, which std's hasher does not promise.
fn fnv1a(text: &str) -> u64 {
    text.bytes().fold(0xcbf2_9ce4_8422_2325, |h, b| (h ^ u64::from(b)).wrapping_mul(0x0000_0100_0000_01b3))
}

fn normalized(repo: &Path) -> String {
    crate::paths::path_key(&repo.to_string_lossy())
}

enum Read {
    Missing,
    Corrupt,
    /// The file is there but cannot be read now (locked, no access): not a reason to start over.
    Unreadable(std::io::Error),
    Found(Snapshot),
}

/// The snapshots of every repository: read from disk once, then kept in memory; each repository has
/// a lock of its own for the read-merge-write, and the files are read and written off the async
/// threads. A scan records each repo twice per fetch, and one lock for all of them made every repo
/// wait for the disk of every other.
pub struct SnapshotStore {
    dir: PathBuf,
    repos: Mutex<HashMap<String, Arc<tokio::sync::Mutex<Option<Snapshot>>>>>,
}

/// Readable for a person looking into the folder, unique by the hash: `a-b`, `a_b` and `ä`
/// would share the readable part.
fn file_for(dir: &Path, repo: &Path) -> PathBuf {
    let key = normalized(repo);
    let readable: String = key.chars().rev().take(PREFIX_LEN).collect::<Vec<_>>().into_iter().rev().map(|c| if c.is_ascii_alphanumeric() { c } else { '_' }).collect();
    dir.join(format!("{readable}-{:016x}.json", fnv1a(&key)))
}

/// The name before the hash; read while no file of the new name exists.
fn legacy_file_for(dir: &Path, repo: &Path) -> PathBuf {
    let key: String = repo.to_string_lossy().to_lowercase().chars().map(|c| if c.is_ascii_alphanumeric() { c } else { '_' }).collect();
    dir.join(format!("{key}.json"))
}

fn read(dir: &Path, repo: &Path) -> Read {
    let current = file_for(dir, repo);
    let path = if current.exists() { current } else { legacy_file_for(dir, repo) };
    match std::fs::read_to_string(&path) {
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Read::Missing,
        Err(e) if e.kind() == std::io::ErrorKind::InvalidData => Read::Corrupt,
        Err(e) => Read::Unreadable(e),
        Ok(text) => match serde_json::from_str(&text) {
            Ok(s) => Read::Found(s),
            Err(_) => Read::Corrupt,
        },
    }
}

/// The record on disk the first time a repo is recorded in this run. A corrupt one is moved aside, the
/// only record of past pushes kept for the user; one that cannot be read now (locked, no access) is an
/// error, or it would be written over for a moment's lock.
fn read_for_record(dir: &Path, repo: &Path) -> Result<Option<Snapshot>> {
    let file = file_for(dir, repo);
    match read(dir, repo) {
        Read::Found(s) => Ok(Some(s)),
        Read::Missing => Ok(None),
        Read::Unreadable(e) => Err(anyhow::Error::new(e).context(format!("cannot read {}", file.display()))),
        Read::Corrupt => {
            let aside = file.with_extension(format!("corrupt-{}.json", now()));
            if file.exists() {
                std::fs::rename(&file, &aside).with_context(|| format!("cannot move {} aside", file.display()))?;
            }
            Ok(None)
        }
    }
}

/// Writes the record under its current name and drops a readable legacy file, which from now on is
/// dead weight. A broken legacy file stays, as any broken record does, for the user.
fn write(dir: &Path, repo: &Path, snap: &Snapshot) -> Result<()> {
    let file = file_for(dir, repo);
    std::fs::create_dir_all(dir)?;
    // Through a temporary file: a crash mid-write must not leave a torn record.
    crate::config::write_atomic(&file, serde_json::to_string(snap)?.as_bytes()).with_context(|| format!("cannot write {}", file.display()))?;
    let legacy = legacy_file_for(dir, repo);
    if std::fs::read_to_string(&legacy).is_ok_and(|t| serde_json::from_str::<Snapshot>(&t).is_ok()) {
        let _ = std::fs::remove_file(&legacy);
    }
    Ok(())
}

/// Blocking file work off the async threads.
async fn blocking<T: Send + 'static>(f: impl FnOnce() -> Result<T> + Send + 'static) -> Result<T> {
    tokio::task::spawn_blocking(f).await.map_err(|e| anyhow::anyhow!("snapshot file task: {e}"))?
}

impl SnapshotStore {
    pub fn new(dir: PathBuf) -> Self {
        Self { dir, repos: Mutex::new(HashMap::new()) }
    }

    fn slot(&self, repo: &Path) -> Arc<tokio::sync::Mutex<Option<Snapshot>>> {
        self.repos.lock().unwrap_or_else(|p| p.into_inner()).entry(normalized(repo)).or_default().clone()
    }

    #[cfg(test)]
    fn file_for(&self, repo: &Path) -> PathBuf {
        file_for(&self.dir, repo)
    }

    /// Empty when there is no record or it cannot be read; the assessment then falls back to Review.
    pub fn load(&self, repo: &Path) -> Snapshot {
        if let Ok(held) = self.slot(repo).try_lock() {
            if let Some(s) = held.as_ref() {
                return s.clone();
            }
        }
        match read(&self.dir, repo) {
            Read::Found(s) => s,
            Read::Missing | Read::Corrupt | Read::Unreadable(_) => Snapshot::default(),
        }
    }

    /// `load` for the async threads: from memory, else read from disk off them.
    pub async fn snapshot_of(&self, repo: &Path) -> Snapshot {
        let slot = self.slot(repo);
        let held = slot.lock().await;
        if let Some(s) = held.as_ref() {
            return s.clone();
        }
        drop(held);
        let (dir, repo) = (self.dir.clone(), repo.to_path_buf());
        blocking(move || {
            Ok(match read(&dir, &repo) {
                Read::Found(s) => s,
                Read::Missing | Read::Corrupt | Read::Unreadable(_) => Snapshot::default(),
            })
        })
        .await
        .unwrap_or_default()
    }

    /// The refs of several working copies of one repository in one map: for a ref more than one knows,
    /// the entry seen last. A scan makes it once per repository, not once per copy and sibling.
    pub async fn merged(&self, copies: &[PathBuf]) -> BTreeMap<String, SnapshotEntry> {
        let mut all: BTreeMap<String, SnapshotEntry> = BTreeMap::new();
        for copy in copies {
            for (k, v) in self.snapshot_of(copy).await.refs {
                match all.get(&k) {
                    Some(kept) if kept.last_seen >= v.last_seen => {}
                    _ => {
                        all.insert(k, v);
                    }
                }
            }
        }
        all
    }

    /// Merges the current remote-tracking refs into the stored snapshot and returns it.
    pub async fn record(&self, git: &Git) -> Result<Snapshot> {
        let (snap, _) = self.record_listing(git, &["for-each-ref", "refs/remotes", "--format=%(refname)%00%(objectname)"]).await?;
        Ok(snap)
    }

    /// `record` from a `for-each-ref` listing the caller needs anyway, so the refs are read once: `args`
    /// lists lines that start with `<ref>\0<sha>`, of which the remote-tracking refs are merged in.
    /// Returns the snapshot and the listing.
    pub async fn record_listing(&self, git: &Git, args: &[&str]) -> Result<(Snapshot, String)> {
        // A rescan and a running scan may record the same repo; reading the refs and the read-merge-write
        // must not interleave, or a listing read before a fetch is written over the one read after it.
        let slot = self.slot(git.dir());
        let mut held = slot.lock().await;
        let out = git.out(args).await?;
        let (stored, first) = match held.take() {
            Some(s) => (Some(s), false),
            None => {
                let (dir, repo) = (self.dir.clone(), git.dir().to_path_buf());
                (blocking(move || read_for_record(&dir, &repo)).await?, true)
            }
        };
        let snap = merge(stored.as_ref(), &out, now());
        // Also written the first time in a run: only the legacy file may have had it, and from now on the
        // new name is the record.
        if first || stored.as_ref() != Some(&snap) {
            let (dir, repo, copy) = (self.dir.clone(), git.dir().to_path_buf(), snap.clone());
            if let Err(e) = blocking(move || write(&dir, &repo, &copy)).await {
                // Not in memory either: the next record reads the disk again and tries once more.
                *held = stored;
                return Err(e);
            }
        }
        *held = Some(snap.clone());
        Ok((snap, out))
    }
}

/// The stored snapshot with the remote-tracking refs of `for_each_ref` (`<ref>\0<sha>…` lines) merged
/// in at `ts`; other refs in the listing are skipped.
fn merge(stored: Option<&Snapshot>, for_each_ref: &str, ts: i64) -> Snapshot {
    let mut snap = Snapshot { refs: stored.map(|s| s.refs.clone()).unwrap_or_default() };
    for line in for_each_ref.lines() {
        let f = fields(line);
        if f.len() < 2 || !f[0].starts_with("refs/remotes/") || f[0].ends_with("/HEAD") {
            continue;
        }
        let entry = snap.refs.entry(f[0].to_string()).or_insert_with(|| SnapshotEntry { sha: f[1].to_string(), first_seen: ts, last_seen: ts });
        if entry.sha != f[1] {
            entry.sha = f[1].to_string();
            entry.last_seen = ts;
        } else if ts - entry.last_seen >= LAST_SEEN_STEP {
            entry.last_seen = ts;
        }
    }
    snap.refs.retain(|_, e| ts - e.last_seen < RETENTION_SECS);
    snap
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn folders_that_look_alike_get_their_own_file_and_the_name_is_stable() {
        let store = SnapshotStore::new(PathBuf::from("/data"));
        let names: Vec<PathBuf> = ["C:/ws/a-b", "C:/ws/a_b", "C:/ws/ä", "C:/ws/ö"].iter().map(|p| store.file_for(Path::new(p))).collect();
        for (i, a) in names.iter().enumerate() {
            assert!(names[i + 1..].iter().all(|b| a != b), "{a:?} shared");
        }
        assert_eq!(fnv1a(""), 0xcbf2_9ce4_8422_2325, "the FNV-1a offset basis, as specified");
        assert_eq!(fnv1a("a"), 0xaf63_dc4c_8601_ec8c, "FNV-1a of \"a\", as specified");
        if cfg!(windows) {
            assert_eq!(store.file_for(Path::new(r"C:\WS\a-b\")), names[0], "however the folder is spelled");
        }
    }

    #[tokio::test]
    async fn a_record_that_cannot_be_read_is_neither_missing_nor_overwritten() {
        let dir = tempfile::tempdir().unwrap();
        let repo = dir.path().join("repo");
        std::fs::create_dir_all(&repo).unwrap();
        assert!(std::process::Command::new("git").args(["init", "-q"]).current_dir(&repo).status().unwrap().success());
        let store = SnapshotStore::new(dir.path().join("snapshots"));
        assert!(matches!(read(&store.dir, &repo), Read::Missing));
        // Present, but not readable as a file.
        std::fs::create_dir_all(store.file_for(&repo)).unwrap();
        assert!(matches!(read(&store.dir, &repo), Read::Unreadable(_)));
        assert!(store.record(&Git::new(&repo)).await.is_err());
        assert!(store.file_for(&repo).is_dir(), "left as it was");
    }

    #[test]
    fn an_unchanged_ref_refreshes_last_seen_only_once_a_day() {
        let a = merge(None, "refs/remotes/origin/x\0aaa\n", 1000);
        assert_eq!(merge(Some(&a), "refs/remotes/origin/x\0aaa\n", 1000 + 60), a, "nothing to write");
        let b = merge(Some(&a), "refs/remotes/origin/x\0bbb\n", 1060);
        assert_eq!((b.refs["refs/remotes/origin/x"].sha.as_str(), b.refs["refs/remotes/origin/x"].first_seen), ("bbb", 1000));
        let later = merge(Some(&a), "refs/remotes/origin/x\0aaa\n", 1000 + LAST_SEEN_STEP);
        assert_eq!(later.refs["refs/remotes/origin/x"].last_seen, 1000 + LAST_SEEN_STEP);
        // Gone from the remote: kept, until the retention ends.
        assert_eq!(merge(Some(&a), "", 2000).refs.len(), 1);
        assert!(merge(Some(&a), "", 1000 + RETENTION_SECS).refs.is_empty());
    }

    #[tokio::test]
    async fn a_recorded_snapshot_stays_in_memory_and_the_disk_is_read_once() {
        let dir = tempfile::tempdir().unwrap();
        let repo = dir.path().join("repo");
        std::fs::create_dir_all(&repo).unwrap();
        let git = |args: &[&str]| assert!(std::process::Command::new("git").args(args).current_dir(&repo).status().unwrap().success());
        git(&["init", "-q"]);
        git(&["-c", "user.name=T", "-c", "user.email=t@x", "commit", "-q", "--allow-empty", "--no-gpg-sign", "-m", "a"]);
        git(&["update-ref", "refs/remotes/origin/x", "HEAD"]);
        let store = SnapshotStore::new(dir.path().join("snapshots"));
        store.record(&Git::new(&repo)).await.unwrap();
        std::fs::remove_file(store.file_for(&repo)).unwrap();
        // Pruned since: only the record in memory still knows it.
        git(&["update-ref", "-d", "refs/remotes/origin/x"]);
        assert!(store.snapshot_of(&repo).await.refs.contains_key("refs/remotes/origin/x"));
        let again = store.record(&Git::new(&repo)).await.unwrap();
        assert!(again.refs.contains_key("refs/remotes/origin/x"), "merged with what memory holds, not with the missing file");
    }

    #[tokio::test]
    async fn the_copies_of_a_repository_merge_into_one_map_with_the_entry_seen_last() {
        let dir = tempfile::tempdir().unwrap();
        let store = SnapshotStore::new(dir.path().join("snapshots"));
        let (a, b) = (dir.path().join("a"), dir.path().join("b"));
        let entry = |sha: &str, last_seen: i64| SnapshotEntry { sha: sha.into(), first_seen: 1, last_seen };
        let snap = |refs: Vec<(&str, SnapshotEntry)>| Snapshot { refs: refs.into_iter().map(|(k, v)| (k.to_string(), v)).collect() };
        write(&store.dir, &a, &snap(vec![("refs/remotes/origin/x", entry("old", 10)), ("refs/remotes/origin/y", entry("y", 5))])).unwrap();
        write(&store.dir, &b, &snap(vec![("refs/remotes/origin/x", entry("new", 20))])).unwrap();
        let all = store.merged(&[a, b]).await;
        assert_eq!(all["refs/remotes/origin/x"].sha, "new");
        assert_eq!(all["refs/remotes/origin/y"].sha, "y");
    }
}
