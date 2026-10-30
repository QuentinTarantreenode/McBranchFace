//! More working copies of one repository: worktrees and local clones, including the refusals.
mod common;

use common::*;
use mcbranchface_lib::git::runner::Git;
use mcbranchface_lib::gitops::copies::{self, CopyKind, CopyTarget};
use mcbranchface_lib::model::*;

fn target(path: &std::path::Path, branch: &str, create: bool) -> CopyTarget {
    CopyTarget { path: path.to_string_lossy().into_owned(), branch: branch.into(), create }
}

fn base(f: &Fixture) -> std::path::PathBuf {
    f.work.parent().unwrap().to_path_buf()
}

#[tokio::test]
async fn worktrees_new_and_existing_branch_and_the_refusals() {
    let f = Fixture::new();
    f.pushed_branch("feature/a", 1);
    let g = Git::new(&f.work);
    let one = base(&f).join("work-agent-1");
    let two = base(&f).join("work-agent-2");

    let checks = copies::check(&g, CopyKind::Worktree, &[target(&one, "agent/1", true), target(&two, "main", false)]).await;
    assert!(!checks[0].path_taken && !checks[0].branch_exists && !checks[0].name_invalid);
    // main is checked out in the original: a second worktree on it is refused.
    assert!(checks[1].checked_out_at.is_some());

    let r = copies::add_worktree(&g, &target(&one, "agent/1", true), "origin/main").await.unwrap();
    assert!(r.path.ends_with("work-agent-1"));
    assert_eq!(git(&one, &["rev-parse", "--abbrev-ref", "HEAD"]), "agent/1");
    assert_eq!(git(&one, &["rev-parse", "HEAD"]), git(&f.work, &["rev-parse", "origin/main"]));

    copies::add_worktree(&g, &target(&two, "feature/a", false), "").await.unwrap();
    assert_eq!(git(&two, &["rev-parse", "--abbrev-ref", "HEAD"]), "feature/a");

    let three = base(&f).join("work-agent-3");
    let e = copies::add_worktree(&g, &target(&three, "feature/a", false), "").await.unwrap_err();
    assert_eq!(e.kind, FailureKind::CheckedOut);
    let e = copies::add_worktree(&g, &target(&three, "agent/1", true), "main").await.unwrap_err();
    assert_eq!(e.kind, FailureKind::AlreadyExists);
    let e = copies::add_worktree(&g, &target(&one, "agent/9", true), "main").await.unwrap_err();
    assert_eq!(e.kind, FailureKind::AlreadyExists, "target folder is not empty");
    let e = copies::add_worktree(&g, &target(&three, "bad..name", true), "main").await.unwrap_err();
    assert_eq!(e.kind, FailureKind::InvalidName);
    let e = copies::add_worktree(&g, &target(&three, "agent/3", true), "no-such-start").await.unwrap_err();
    assert_eq!(e.kind, FailureKind::InvalidName);
    assert!(!three.exists());
}

#[tokio::test]
async fn removing_a_worktree_refuses_changes_unless_forced_and_backs_them_up() {
    let f = Fixture::new();
    let g = Git::new(&f.work);
    let one = base(&f).join("work-agent-1");
    copies::add_worktree(&g, &target(&one, "agent/1", true), "main").await.unwrap();
    std::fs::write(one.join("readme.txt"), "changed\n").unwrap();
    std::fs::write(one.join("new.txt"), "untracked\n").unwrap();
    let wt = one.to_string_lossy().into_owned();
    let journal = f.journal();

    let e = copies::remove_worktree(&g, &wt, false, &journal).await.unwrap_err();
    assert_eq!(e.kind, FailureKind::LocalChanges);
    assert!(one.exists());

    let r = copies::remove_worktree(&g, &wt, true, &journal).await.unwrap();
    assert!(!one.exists());
    let dir = std::path::PathBuf::from(r.backup_dir.unwrap());
    assert_eq!(std::fs::read_to_string(dir.join("new.txt")).unwrap().trim(), "untracked");
    assert_eq!(read(dir.join("readme.txt")), "changed\n");
    // The branch stays; only the folder goes.
    assert!(!git(&f.work, &["branch", "--list", "agent/1"]).is_empty());

    let e = copies::remove_worktree(&g, &f.work.to_string_lossy(), false, &journal).await.unwrap_err();
    assert_eq!(e.kind, FailureKind::NoLongerCandidate, "the main worktree is not removable");
}

#[tokio::test]
async fn a_clean_worktree_goes_without_force() {
    let f = Fixture::new();
    let g = Git::new(&f.work);
    let one = base(&f).join("work-agent-1");
    copies::add_worktree(&g, &target(&one, "agent/1", true), "main").await.unwrap();
    let r = copies::remove_worktree(&g, &one.to_string_lossy(), false, &f.journal()).await.unwrap();
    assert!(!one.exists());
    // Moved, not deleted: "Recently deleted" lists it.
    let entries = f.journal().load().unwrap();
    assert_eq!(entries.len(), 1);
    assert_eq!(entries[0].worktree_backup, r.backup_dir);
    assert!(std::path::Path::new(r.backup_dir.as_deref().unwrap()).join("readme.txt").exists());
}

#[tokio::test]
async fn clone_points_origin_at_the_server_and_knows_what_the_original_knows() {
    let f = Fixture::new();
    f.pushed_branch("feature/a", 1);
    // Local only in the original, and a branch that is gone on the server.
    git(&f.work, &["branch", "local-only", "main"]);
    f.pushed_branch("feature/gone", 1);
    f.on_server(|s| {
        git(s, &["push", "-q", "origin", "--delete", "feature/gone"]);
    });
    git(&f.work, &["fetch", "-q", "--prune"]);
    // The original sits on a branch of its own; the clone must not keep a copy of it.
    git(&f.work, &["switch", "-q", "local-only"]);
    let g = Git::new(&f.work);
    let one = base(&f).join("work-agent-1");

    let r = copies::clone(&g, &target(&one, "agent/1", true), "origin/main").await.unwrap();
    assert!(r.warning.is_none());
    assert_eq!(git(&one, &["remote", "get-url", "origin"]), git(&f.work, &["remote", "get-url", "origin"]));
    assert_eq!(git(&one, &["rev-parse", "--abbrev-ref", "HEAD"]), "agent/1");
    assert!(git(&one, &["status", "--porcelain"]).is_empty(), "a clean working tree");
    let remotes = git(&one, &["branch", "-r", "--format=%(refname:short)"]);
    assert!(remotes.contains("origin/feature/a"));
    assert!(!remotes.contains("origin/local-only"), "local branches of the original are no server branches");
    assert!(!remotes.contains("origin/feature/gone"));
    assert_eq!(git(&one, &["branch", "--format=%(refname:short)"]), "agent/1");
    // The upstream of new work is set on the first push, not now.
    assert!(!git(&one, &["config", "--list"]).contains("branch.agent/1.merge"));
}

#[tokio::test]
async fn clone_on_an_existing_branch_tracks_it_and_a_failed_clone_leaves_nothing() {
    let f = Fixture::new();
    f.pushed_branch("feature/a", 2);
    let g = Git::new(&f.work);
    let one = base(&f).join("work-agent-1");
    copies::clone(&g, &target(&one, "feature/a", false), "").await.unwrap();
    assert_eq!(git(&one, &["rev-parse", "--abbrev-ref", "HEAD"]), "feature/a");
    assert_eq!(git(&one, &["rev-parse", "--abbrev-ref", "feature/a@{upstream}"]), "origin/feature/a");
    assert_eq!(git(&one, &["rev-parse", "HEAD"]), git(&f.work, &["rev-parse", "feature/a"]));

    let two = base(&f).join("work-agent-2");
    let e = copies::clone(&g, &target(&two, "nowhere", false), "").await.unwrap_err();
    assert_eq!(e.kind, FailureKind::NoLongerCandidate);
    assert!(!two.exists());
    let e = copies::clone(&g, &target(&one, "x", true), "main").await.unwrap_err();
    assert_eq!(e.kind, FailureKind::AlreadyExists);
    assert!(one.join(".git").exists(), "an existing folder is never removed");
}

#[tokio::test]
async fn free_folders_skip_taken_ones() {
    let f = Fixture::new();
    std::fs::create_dir_all(base(&f).join("work-agent-1").join("x")).unwrap();
    std::fs::create_dir_all(base(&f).join("work-agent-2")).unwrap();
    let free = copies::free_folders(&f.work, "agent", 2);
    assert!(free[0].ends_with("work-agent-2"), "an empty folder is free: {free:?}");
    assert!(free[1].ends_with("work-agent-3"));
}

#[tokio::test]
async fn copy_targets_must_be_absolute_and_start_points_real_commits() {
    let f = Fixture::new();
    let g = Git::new(&f.work);
    let rel = CopyTarget { path: "relative-copy".into(), branch: "agent/r".into(), create: true };
    assert_eq!(copies::add_worktree(&g, &rel, "origin/main").await.unwrap_err().kind, FailureKind::InvalidName);
    assert_eq!(copies::clone(&g, &rel, "origin/main").await.unwrap_err().kind, FailureKind::InvalidName);
    let abs = target(&base(&f).join("work-opt"), "agent/o", true);
    assert_eq!(copies::add_worktree(&g, &abs, "--orphan").await.unwrap_err().kind, FailureKind::InvalidName);
    assert!(!base(&f).join("work-opt").exists());
}

fn files_in(dir: &std::path::Path) -> Vec<std::ffi::OsString> {
    let mut names: Vec<_> = std::fs::read_dir(dir).unwrap().flatten().map(|e| e.file_name()).collect();
    names.sort();
    names
}

#[tokio::test]
async fn a_worktree_whose_changes_cannot_be_listed_is_not_force_removed() {
    let f = Fixture::new();
    let g = Git::new(&f.work);
    let one = base(&f).join("work-agent-1");
    copies::add_worktree(&g, &target(&one, "agent/1", true), "main").await.unwrap();
    std::fs::write(one.join("new.txt"), "untracked\n").unwrap();
    // A broken index: git cannot say what changed, so nothing can be backed up.
    let admin = git(&one, &["rev-parse", "--path-format=absolute", "--git-dir"]);
    std::fs::write(std::path::Path::new(&admin).join("index"), "garbage").unwrap();

    let e = copies::remove_worktree(&g, &one.to_string_lossy(), true, &f.journal()).await.unwrap_err();
    assert_eq!(e.op, GitOp::RemoveWorktree);
    assert_eq!(std::fs::read_to_string(one.join("new.txt")).unwrap(), "untracked\n", "nothing removed without a backup");
}

#[tokio::test]
async fn an_index_lock_in_the_worktree_stops_the_removal() {
    let f = Fixture::new();
    let g = Git::new(&f.work);
    let one = base(&f).join("work-agent-1");
    copies::add_worktree(&g, &target(&one, "agent/1", true), "main").await.unwrap();
    let admin = git(&one, &["rev-parse", "--path-format=absolute", "--git-dir"]);
    let lock = std::path::Path::new(&admin).join("index.lock");
    std::fs::write(&lock, "").unwrap();
    let e = copies::remove_worktree(&g, &one.to_string_lossy(), false, &f.journal()).await.unwrap_err();
    assert_eq!(e.kind, FailureKind::Lock);
    assert!(e.path.as_deref().is_some_and(|p| p.ends_with("index.lock")), "{:?}", e.path);
    assert!(one.join("readme.txt").exists());
    std::fs::remove_file(lock).unwrap();
    copies::remove_worktree(&g, &one.to_string_lossy(), false, &f.journal()).await.unwrap();
    assert!(!one.exists());
}

fn read(p: std::path::PathBuf) -> String {
    std::fs::read_to_string(p).unwrap().replace("\r\n", "\n")
}

/// A linked worktree on a new branch next to the fixture's repo.
async fn worktree(f: &Fixture, name: &str) -> std::path::PathBuf {
    let dir = base(f).join(name);
    copies::add_worktree(&Git::new(&f.work), &target(&dir, &format!("agent/{name}"), true), "main").await.unwrap();
    dir
}

async fn remove(f: &Fixture, wt: &std::path::Path, force: bool) -> Result<OpResult, OpFailure> {
    remove_with(f, &f.journal(), wt, force).await
}

async fn remove_with(f: &Fixture, journal: &mcbranchface_lib::journal::Journal, wt: &std::path::Path, force: bool) -> Result<OpResult, OpFailure> {
    copies::remove_worktree(&Git::new(&f.work), &wt.to_string_lossy(), force, journal).await
}

/// A journal whose backups folder cannot be created: a file stands in its place.
fn blocked_journal(f: &Fixture) -> mcbranchface_lib::journal::Journal {
    let dir = f.data.join("blocked");
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(dir.join("backups"), "not a folder").unwrap();
    mcbranchface_lib::journal::Journal::new(dir.join("deleted.jsonl"))
}

fn registered(f: &Fixture, wt: &std::path::Path) -> bool {
    let name = wt.file_name().unwrap().to_string_lossy().to_string();
    git(&f.work, &["worktree", "list", "--porcelain"]).lines().any(|l| l.starts_with("worktree ") && l.ends_with(&name))
}

#[tokio::test]
async fn forced_worktree_removal_stops_when_a_changed_file_cannot_be_copied() {
    let f = Fixture::new();
    let one = worktree(&f, "one").await;
    std::fs::write(one.join("readme.txt"), "changed\n").unwrap();
    std::fs::write(one.join("new.txt"), "untracked\n").unwrap();
    let e = remove_with(&f, &blocked_journal(&f), &one, true).await.unwrap_err();
    assert!(!e.changed, "{e:?}");
    assert_eq!(read(one.join("readme.txt")), "changed\n");
    assert_eq!(read(one.join("new.txt")), "untracked\n");
    assert!(registered(&f, &one));
}

#[tokio::test]
async fn removing_a_worktree_keeps_its_ignored_files() {
    let f = Fixture::new();
    let one = worktree(&f, "one").await;
    commit(&one, ".gitignore", ".env\n", "ignore the environment");
    std::fs::write(one.join(".env"), "SECRET=1\n").unwrap();
    assert!(git(&one, &["status", "--porcelain"]).is_empty(), "fixture: a clean worktree");
    let r = remove(&f, &one, false).await.unwrap();
    assert!(!one.exists());
    let kept = std::path::PathBuf::from(r.backup_dir.expect("the folder is kept"));
    assert_eq!(read(kept.join(".env")), "SECRET=1\n");
}

#[tokio::test]
async fn a_nested_repo_in_a_worktree_survives_removal() {
    let f = Fixture::new();
    let one = worktree(&f, "one").await;
    let nested = one.join("nested");
    std::fs::create_dir_all(&nested).unwrap();
    git(&nested, &["init", "-q"]);
    std::fs::write(nested.join("work.txt"), "nested work\n").unwrap();
    let r = remove(&f, &one, true).await.unwrap();
    assert!(!one.exists());
    let kept = std::path::PathBuf::from(r.backup_dir.expect("the folder is kept"));
    assert_eq!(read(kept.join("nested").join("work.txt")), "nested work\n");
    assert!(kept.join("nested").join(".git").is_dir(), "the nested repository with its history");
}

#[tokio::test]
async fn a_detached_worktree_with_own_commits_keeps_them() {
    let f = Fixture::new();
    let wt = base(&f).join("wt-detached");
    git(&f.work, &["worktree", "add", "-q", "--detach", wt.to_str().unwrap()]);
    commit(&wt, "readme.txt", "only here\n", "commit on no branch");
    let sha = git(&wt, &["rev-parse", "HEAD"]);
    remove(&f, &wt, false).await.unwrap();
    assert!(!wt.exists());
    let holders = git(&f.work, &["for-each-ref", "--contains", &sha, "--format=%(refname)"]);
    assert!(!holders.is_empty(), "the commit made while detached is kept by a ref");
}

#[tokio::test]
async fn removal_is_refused_during_a_rebase() {
    let f = Fixture::new();
    let one = worktree(&f, "one").await;
    commit(&one, "readme.txt", "agent\n", "agent change");
    commit(&f.work, "readme.txt", "main\n", "main change");
    let o = std::process::Command::new("git").args(["rebase", "main"]).current_dir(&one).env("LC_ALL", "C").output().unwrap();
    assert!(!o.status.success(), "fixture: the rebase stops at a conflict");
    let admin = std::path::PathBuf::from(git(&one, &["rev-parse", "--path-format=absolute", "--git-dir"]));
    assert!(admin.join("rebase-merge").exists());
    let e = remove(&f, &one, true).await.unwrap_err();
    assert_eq!((e.kind, e.changed), (FailureKind::OperationInProgress, false));
    assert!(one.join("readme.txt").exists());
    assert!(admin.join("rebase-merge").exists(), "the rebase can still be finished");
}

#[cfg(windows)]
#[tokio::test]
async fn a_file_held_open_leaves_the_worktree_intact() {
    use std::os::windows::fs::OpenOptionsExt;
    let f = Fixture::new();
    let g = Git::new(&f.work);
    let one = base(&f).join("work-agent-1");
    copies::add_worktree(&g, &target(&one, "agent/1", true), "main").await.unwrap();
    std::fs::write(one.join("new.txt"), "untracked\n").unwrap();
    let before = files_in(&one);
    let held = std::fs::OpenOptions::new().read(true).share_mode(0).open(one.join("readme.txt")).unwrap();

    let e = copies::remove_worktree(&g, &one.to_string_lossy(), true, &f.journal()).await.unwrap_err();
    assert_eq!((e.kind, e.changed), (FailureKind::FileInUse, false));
    assert_eq!(files_in(&one), before, "worktree files were deleted");
    assert!(f.journal().load().unwrap().is_empty());
    assert_eq!(std::fs::read_dir(f.journal().backups_dir()).map(|d| d.count()).unwrap_or(0), 0, "no backup folder left behind");
    drop(held);
    copies::remove_worktree(&g, &one.to_string_lossy(), true, &f.journal()).await.unwrap();
    assert!(!one.exists());
}
