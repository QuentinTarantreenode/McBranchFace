//! Deletion under failure conditions: nothing may be half done, and nothing may be hidden.
mod common;

use common::*;
use mcbranchface_lib::actions::Env;
use mcbranchface_lib::delete;
use mcbranchface_lib::model::*;

struct Case {
    f: Fixture,
    r: RepoResult,
}

async fn case(branches: &[&str], prepare: impl FnOnce(&Fixture)) -> Case {
    let f = Fixture::new();
    for b in branches {
        f.pushed_branch(b, 1);
    }
    prepare(&f);
    for b in branches {
        f.delete_remote(b);
    }
    let r = f.scan(true).await;
    Case { f, r }
}

impl Case {
    fn request(&self, name: &str) -> DeleteRequest {
        let b = find(&self.r, name);
        DeleteRequest {
            repo_path: self.f.work.to_string_lossy().into(),
            branch: name.into(),
            expected_sha: b.sha.clone(),
            force: true,
            drop_stashes: b.stashes.iter().map(|s| s.sha.clone()).collect(),
            remove_worktree: true,
        }
    }

    async fn delete(&self, req: &DeleteRequest) -> Result<DeleteOutcome, DeleteFailure> {
        let (config, store, journal) = (self.f.config(), self.f.store(), self.f.journal());
        let env = Env { config: &config, snapshots: &store, journal: &journal, cached_prs: None };
        delete::delete(&env, req).await
    }

    /// Nothing was touched: branch still there, no backup refs left behind, no journal entry.
    fn assert_untouched(&self, name: &str) {
        assert_eq!(git(&self.f.work, &["branch", "--list", name, "--format=%(refname:short)"]), name);
        assert!(git(&self.f.work, &["for-each-ref", "refs/mcbranchface"]).is_empty(), "orphaned backup refs");
        assert!(self.f.journal().load().unwrap().is_empty(), "journal entry for a failed delete");
    }

    fn lock(&self, rel: &str) -> std::path::PathBuf {
        let p = self.f.work.join(".git").join(rel);
        std::fs::create_dir_all(p.parent().unwrap()).unwrap();
        std::fs::write(&p, "").unwrap();
        p
    }
}

#[tokio::test]
async fn ref_lock_of_another_git_process_stops_before_any_change_and_retry_works() {
    let c = case(&["feat/a"], |_| {}).await;
    let lock = c.lock("refs/heads/feat/a.lock");

    let e = c.delete(&c.request("feat/a")).await.unwrap_err();
    assert_eq!((e.kind, e.step, e.changed), (FailureKind::Lock, DeleteStep::Preflight, false));
    assert!(e.path.as_deref().unwrap().ends_with("feat/a.lock"), "{:?}", e.path);
    c.assert_untouched("feat/a");

    std::fs::remove_file(lock).unwrap();
    c.delete(&c.request("feat/a")).await.unwrap();
}

#[tokio::test]
async fn packed_refs_lock_is_detected() {
    let c = case(&["feat/a"], |_| {}).await;
    c.lock("packed-refs.lock");
    let e = c.delete(&c.request("feat/a")).await.unwrap_err();
    assert_eq!(e.kind, FailureKind::Lock);
    c.assert_untouched("feat/a");
}

#[tokio::test]
async fn stash_lock_stops_before_the_branch_is_deleted() {
    let c = case(&["feat/s"], |f| {
        git(&f.work, &["switch", "-q", "feat/s"]);
        std::fs::write(f.work.join("feat_s-0.txt"), "wip\n").unwrap();
        git(&f.work, &["stash", "push", "-q"]);
        git(&f.work, &["switch", "-q", "main"]);
    })
    .await;
    c.lock("refs/stash.lock");

    let req = c.request("feat/s");
    assert_eq!(req.drop_stashes.len(), 1);
    let e = c.delete(&req).await.unwrap_err();
    assert_eq!((e.kind, e.step), (FailureKind::Lock, DeleteStep::Preflight));
    c.assert_untouched("feat/s");
    assert!(!git(&c.f.work, &["stash", "list"]).is_empty());
}

#[tokio::test]
async fn missing_repository_is_reported_as_such() {
    let c = case(&["feat/a"], |_| {}).await;
    let mut req = c.request("feat/a");
    req.repo_path = c.f.work.join("gone").to_string_lossy().into();
    assert_eq!(c.delete(&req).await.unwrap_err().kind, FailureKind::RepoMissing);
}

#[cfg(windows)]
#[tokio::test]
async fn file_held_open_in_linked_worktree_leaves_worktree_intact() {
    use std::os::windows::fs::OpenOptionsExt;

    let wt = std::cell::RefCell::new(None);
    let c = case(&["feat/wt"], |f| {
        let dir = f.work.parent().unwrap().join("linked");
        git(&f.work, &["worktree", "add", "-q", dir.to_str().unwrap(), "feat/wt"]);
        std::fs::write(dir.join("untracked.txt"), "local work\n").unwrap();
        *wt.borrow_mut() = Some(dir);
    })
    .await;
    let dir = wt.into_inner().unwrap();
    let before: Vec<_> = std::fs::read_dir(&dir).unwrap().flatten().map(|e| e.file_name()).collect();

    // Another program (IDE, running build) keeps one file open without delete sharing.
    let handle = std::fs::OpenOptions::new().read(true).share_mode(0).open(dir.join("feat_wt-0.txt")).unwrap();
    let e = c.delete(&c.request("feat/wt")).await.unwrap_err();
    assert_eq!((e.kind, e.step, e.changed), (FailureKind::FileInUse, DeleteStep::Preflight, false));
    let after: Vec<_> = std::fs::read_dir(&dir).unwrap().flatten().map(|e| e.file_name()).collect();
    assert_eq!(before, after, "worktree files were deleted");
    c.assert_untouched("feat/wt");

    drop(handle);
    let out = c.delete(&c.request("feat/wt")).await.unwrap();
    assert!(out.entry.removed_worktree.is_some());
    assert!(!dir.exists());
}
