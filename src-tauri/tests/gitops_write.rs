//! Writing git operations against temporary repositories, including the failure cases users hit.
mod common;

use std::sync::Arc;

use common::*;
use mcbranchface_lib::git::runner::Git;
use mcbranchface_lib::gitops::{diff, ops, status};
use mcbranchface_lib::model::*;
use tokio::sync::Notify;

/// git may check files out with CRLF (core.autocrlf); content checks compare lines, not bytes.
fn read(p: std::path::PathBuf) -> String {
    std::fs::read_to_string(p).unwrap().replace("\r\n", "\n")
}

async fn remote(g: &Git, op: GitOp) -> Result<OpResult, OpFailure> {
    ops::remote(g, op, None, Arc::new(Notify::new()), |_, _| {}).await
}

#[tokio::test]
async fn stage_unstage_commit_amend() {
    let f = Fixture::new();
    let g = Git::new(&f.work);
    std::fs::write(f.work.join("readme.txt"), "base\nmore\n").unwrap();

    ops::stage(&g, &["readme.txt".into()]).await.unwrap();
    let st = status::repo_status(&g).await.unwrap();
    assert_eq!(st.entries[0].staged, Some(ChangeType::Modified));
    ops::unstage(&g, &["readme.txt".into()]).await.unwrap();
    let st = status::repo_status(&g).await.unwrap();
    assert_eq!((st.entries[0].staged, st.entries[0].unstaged), (None, Some(ChangeType::Modified)));

    ops::stage(&g, &["readme.txt".into()]).await.unwrap();
    let c = ops::commit(&g, "Add more\n\nBody line", false, false).await.unwrap();
    assert_eq!(git(&f.work, &["log", "-1", "--format=%s"]), "Add more");
    assert_eq!(c.sha.as_deref(), Some(git(&f.work, &["rev-parse", "HEAD"]).as_str()));

    // Not pushed yet: amend is allowed without asking.
    ops::commit(&g, "Add more text", true, false).await.unwrap();
    assert_eq!(git(&f.work, &["log", "-1", "--format=%s"]), "Add more text");

    // Pushed: amending rewrites shared history and needs explicit consent.
    remote(&g, GitOp::Push).await.unwrap();
    let e = ops::commit(&g, "rewrite", true, false).await.unwrap_err();
    assert_eq!(e.kind, FailureKind::AlreadyPushed);
    ops::commit(&g, "rewrite", true, true).await.unwrap();

    let e = ops::commit(&g, "nothing staged", false, false).await.unwrap_err();
    assert_eq!(e.kind, FailureKind::NothingToCommit, "{}", e.detail);
}

#[tokio::test]
async fn create_and_switch_branches_with_local_changes() {
    let f = Fixture::new();
    let g = Git::new(&f.work);

    assert_eq!(ops::create_branch(&g, "a..b", None, false).await.unwrap_err().kind, FailureKind::InvalidName);
    assert_eq!(ops::create_branch(&g, "main", None, false).await.unwrap_err().kind, FailureKind::AlreadyExists);

    ops::create_branch(&g, "feat/new", None, true).await.unwrap();
    assert_eq!(status::repo_status(&g).await.unwrap().head.branch.as_deref(), Some("feat/new"));
    commit(&f.work, "readme.txt", "feature version\n", "change on feature");
    git(&f.work, &["switch", "-q", "main"]);

    // A local edit to a file that differs on the target branch blocks a plain switch.
    std::fs::write(f.work.join("readme.txt"), "local edit\n").unwrap();
    let e = ops::switch(&g, "feat/new", false, CarryMode::Keep).await.unwrap_err();
    assert_eq!((e.kind, e.changed), (FailureKind::LocalChanges, false), "{}", e.detail);
    assert_eq!(read(f.work.join("readme.txt")), "local edit\n", "nothing moved");

    // Stash: switch succeeds, the edit waits in the stash.
    let r = ops::switch(&g, "feat/new", false, CarryMode::Stash).await.unwrap();
    assert!(r.stashed);
    assert_eq!(read(f.work.join("readme.txt")), "feature version\n");
    assert!(git(&f.work, &["stash", "list"]).contains("McBranchFace"));

    // Bring without conflict: an untracked note travels along.
    git(&f.work, &["stash", "drop", "-q"]);
    std::fs::write(f.work.join("note.txt"), "carry me\n").unwrap();
    let r = ops::switch(&g, "main", false, CarryMode::Bring).await.unwrap();
    assert!(r.stashed && r.warning.is_none());
    assert!(f.work.join("note.txt").exists());
    assert!(git(&f.work, &["stash", "list"]).is_empty(), "stash was re-applied and dropped");

    // Remote-only branch: switching creates the tracking branch.
    f.pushed_branch("feat/remote", 1);
    git(&f.work, &["branch", "-D", "feat/remote"]);
    ops::switch(&g, "origin/feat/remote", true, CarryMode::Bring).await.unwrap();
    assert_eq!(git(&f.work, &["rev-parse", "--abbrev-ref", "@{u}"]), "origin/feat/remote");
}

#[tokio::test]
async fn new_branch_from_another_start_carries_or_stashes_local_changes() {
    let f = Fixture::new();
    let g = Git::new(&f.work);
    // The working copy stands on a feature branch whose readme differs from the default branch.
    ops::create_branch(&g, "feat/old", None, true).await.unwrap();
    commit(&f.work, "readme.txt", "feature version\n", "change on feature");

    // Stash: the new branch starts clean from the default branch, the edit waits in the stash.
    std::fs::write(f.work.join("readme.txt"), "local edit\n").unwrap();
    let r = ops::switch_to_new(&g, "feat/fresh", "origin/main", CarryMode::Stash).await.unwrap();
    assert!(r.stashed);
    assert_eq!(git(&f.work, &["rev-parse", "--abbrev-ref", "HEAD"]), "feat/fresh");
    assert_eq!(read(f.work.join("readme.txt")), "base\n");
    git(&f.work, &["stash", "drop", "-q"]);

    // Bring: an untracked note comes along to the new branch.
    std::fs::write(f.work.join("note.txt"), "carry me\n").unwrap();
    let r = ops::switch_to_new(&g, "feat/second", "origin/main", CarryMode::Bring).await.unwrap();
    assert!(r.stashed && r.warning.is_none());
    assert!(f.work.join("note.txt").exists());

    // From the current state, like `git switch -c`; names are checked as for create_branch.
    let before = git(&f.work, &["rev-parse", "HEAD"]);
    ops::switch_to_new(&g, "feat/here", "HEAD", CarryMode::Bring).await.unwrap();
    assert_eq!(git(&f.work, &["rev-parse", "HEAD"]), before);
    let e = ops::switch_to_new(&g, "feat/here", "HEAD", CarryMode::Keep).await.unwrap_err();
    assert_eq!(e.kind, FailureKind::AlreadyExists);
    let e = ops::switch_to_new(&g, "a..b", "HEAD", CarryMode::Keep).await.unwrap_err();
    assert_eq!(e.kind, FailureKind::InvalidName);
}

#[tokio::test]
async fn copied_worktree_registrations_are_marked_foreign_and_detached_commits_counted() {
    let f = Fixture::new();
    let g = Git::new(&f.work);
    let wt = f.work.parent().unwrap().join("wt-detached");
    git(&f.work, &["worktree", "add", "-q", "--detach", wt.to_str().unwrap()]);
    commit(&wt, "readme.txt", "only here\n", "commit on no branch");

    let st = status::repo_status(&g).await.unwrap();
    let w = st.worktrees.iter().find(|w| !w.is_main).unwrap();
    assert!(w.detached && !w.foreign);
    assert_eq!(w.unreferenced, 1, "the commit made while detached is on no branch");

    // A copy of the whole folder takes the registrations along, but the worktree points back to
    // the original: in the copy the entry is foreign.
    let copy = f.work.parent().unwrap().join("work-copy");
    copy_dir(&f.work, &copy);
    let st = status::repo_status(&Git::new(&copy)).await.unwrap();
    let w = st.worktrees.iter().find(|w| !w.is_main).unwrap();
    assert!(w.foreign, "{:?}", st.worktrees);

    // Forgetting it moves only the copy's registration aside; the worktree and the original stay.
    let backups = f.data.join("backups");
    ops::forget_foreign_worktree(&Git::new(&copy), &w.path, &backups).await.unwrap();
    assert!(status::repo_status(&Git::new(&copy)).await.unwrap().worktrees.iter().all(|w| w.is_main));
    assert!(status::repo_status(&g).await.unwrap().worktrees.iter().any(|w| !w.is_main && !w.foreign));
    assert!(wt.join("readme.txt").exists());
    // Refused for a worktree that belongs to the repository.
    assert!(ops::forget_foreign_worktree(&g, &wt.to_string_lossy(), &backups).await.is_err());
}

fn copy_dir(from: &std::path::Path, to: &std::path::Path) {
    std::fs::create_dir_all(to).unwrap();
    for e in std::fs::read_dir(from).unwrap() {
        let e = e.unwrap();
        let target = to.join(e.file_name());
        if e.file_type().unwrap().is_dir() {
            copy_dir(&e.path(), &target);
        } else {
            std::fs::copy(e.path(), target).unwrap();
        }
    }
}

#[tokio::test]
async fn discard_keeps_a_backup() {
    let f = Fixture::new();
    let g = Git::new(&f.work);
    std::fs::write(f.work.join("readme.txt"), "precious edit\n").unwrap();
    std::fs::create_dir_all(f.work.join("sub")).unwrap();
    std::fs::write(f.work.join("sub/new.txt"), "untracked work\n").unwrap();

    let backups = f.data.join("backups");
    let r = ops::discard(&g, &["readme.txt".into()], &["sub/new.txt".into()], &backups).await.unwrap();
    let dir = std::path::PathBuf::from(r.backup_dir.unwrap());
    assert_eq!(read(dir.join("readme.txt")), "precious edit\n");
    assert_eq!(read(dir.join("sub/new.txt")), "untracked work\n");
    assert_eq!(read(f.work.join("readme.txt")), "base\n");
    assert!(!f.work.join("sub/new.txt").exists());
    assert!(status::repo_status(&g).await.unwrap().entries.is_empty());
}

#[tokio::test]
async fn discarding_an_untracked_folder_keeps_its_files_and_removes_it() {
    let f = Fixture::new();
    let g = Git::new(&f.work);
    std::fs::write(f.work.join("readme.txt"), "precious edit\n").unwrap();
    std::fs::create_dir_all(f.work.join("newdir/deep")).unwrap();
    std::fs::write(f.work.join("newdir/a.txt"), "a\n").unwrap();
    std::fs::write(f.work.join("newdir/deep/b.txt"), "b\n").unwrap();

    let backups = f.data.join("backups");
    // git lists the folder as one entry, "newdir/".
    let r = ops::discard(&g, &["readme.txt".into()], &["newdir/".into()], &backups).await.unwrap();
    let dir = std::path::PathBuf::from(r.backup_dir.unwrap());
    assert_eq!(read(dir.join("newdir/a.txt")), "a\n");
    assert_eq!(read(dir.join("newdir/deep/b.txt")), "b\n");
    assert!(!f.work.join("newdir").exists());
    assert!(status::repo_status(&g).await.unwrap().entries.is_empty());
}

#[tokio::test]
async fn discard_backs_up_files_whose_backup_path_exceeds_260_characters() {
    let f = Fixture::new();
    let g = Git::new(&f.work);
    // Below 260 in the worktree, above it once the deeper backup folder is prepended.
    // The worktree path ends up at 255 characters, the backup path well above 260. Rust adds the
    // extended-length prefix itself; this guards against a regression to a copy that does not.
    let budget = 255 - f.work.to_string_lossy().len() - 1;
    let mut rel = String::new();
    while budget - rel.len() > 60 {
        rel.push_str(&"d".repeat(40));
        rel.push('/');
    }
    let name_len = budget - rel.len() - 4;
    rel.push_str(&format!("{}.txt", "f".repeat(name_len)));
    std::fs::create_dir_all(f.work.join(&rel).parent().unwrap()).unwrap();
    std::fs::write(f.work.join(&rel), "deep work\n").unwrap();

    let backups = f.data.join("backups");
    let r = ops::discard(&g, &[], &[rel.clone()], &backups).await.expect("discard with a long backup path");
    let backup = std::path::PathBuf::from(r.backup_dir.unwrap()).join(&rel);
    assert!(backup.to_string_lossy().len() > 260, "the scenario must cross the limit: {}", backup.display());
    assert_eq!(std::fs::read_to_string(&backup).unwrap(), "deep work\n");
    assert!(!f.work.join(&rel).exists());
}

#[tokio::test]
async fn push_pull_and_their_failure_modes() {
    let f = Fixture::new();
    let g = Git::new(&f.work);

    // First push of a new branch publishes it with upstream.
    ops::create_branch(&g, "feat/p", None, true).await.unwrap();
    commit(&f.work, "p.txt", "p\n", "p");
    remote(&g, GitOp::Push).await.unwrap();
    assert_eq!(git(&f.work, &["rev-parse", "--abbrev-ref", "@{u}"]), "origin/feat/p");

    // Someone else pushes: fast-forward pull brings it in.
    git(&f.server, &["fetch", "-q"]);
    git(&f.server, &["switch", "-q", "-c", "feat/p", "origin/feat/p"]);
    commit(&f.server, "s.txt", "s\n", "server change");
    git(&f.server, &["push", "-q", "origin", "feat/p"]);
    let r = remote(&g, GitOp::Pull).await.unwrap();
    assert_eq!(r.sha.as_deref(), Some(git(&f.server, &["rev-parse", "HEAD"]).as_str()));

    // Both sides moved: pull refuses to guess, push is rejected.
    commit(&f.server, "s2.txt", "s2\n", "server again");
    git(&f.server, &["push", "-q", "origin", "feat/p"]);
    commit(&f.work, "l.txt", "l\n", "local change");
    assert_eq!(remote(&g, GitOp::Push).await.unwrap_err().kind, FailureKind::Rejected);
    assert_eq!(remote(&g, GitOp::Pull).await.unwrap_err().kind, FailureKind::Diverged);

    remote(&g, GitOp::Fetch).await.unwrap();
}

#[tokio::test]
async fn push_and_pull_ignore_user_config_that_would_change_what_they_do() {
    let f = Fixture::new();
    let g = Git::new(&f.work);
    git(&f.work, &["config", "push.default", "matching"]);
    git(&f.work, &["config", "pull.rebase", "true"]);

    // main is ahead too: a bare `git push` with push.default=matching would push it as well.
    let main_on_server = git(&f.work, &["rev-parse", "origin/main"]);
    commit(&f.work, "m.txt", "m\n", "local main");
    ops::create_branch(&g, "feat/q", None, true).await.unwrap();
    commit(&f.work, "q.txt", "q\n", "q");
    remote(&g, GitOp::Push).await.unwrap();
    commit(&f.work, "q2.txt", "q2\n", "q2");
    remote(&g, GitOp::Push).await.unwrap();
    git(&f.work, &["fetch", "-q"]);
    assert_eq!(git(&f.work, &["rev-parse", "origin/main"]), main_on_server);
    assert_eq!(git(&f.work, &["rev-parse", "origin/feat/q"]), git(&f.work, &["rev-parse", "HEAD"]));

    // Diverged with pull.rebase=true: still a refusal, never a rebase.
    git(&f.server, &["fetch", "-q"]);
    git(&f.server, &["switch", "-q", "-c", "feat/q", "origin/feat/q"]);
    commit(&f.server, "s.txt", "s\n", "server change");
    git(&f.server, &["push", "-q", "origin", "feat/q"]);
    commit(&f.work, "l.txt", "l\n", "local change");
    let before = git(&f.work, &["rev-parse", "HEAD"]);
    assert_eq!(remote(&g, GitOp::Pull).await.unwrap_err().kind, FailureKind::Diverged);
    assert_eq!(git(&f.work, &["rev-parse", "HEAD"]), before);
}

#[tokio::test]
async fn index_lock_stops_before_anything_happens() {
    let f = Fixture::new();
    let g = Git::new(&f.work);
    std::fs::write(f.work.join("readme.txt"), "x\n").unwrap();
    std::fs::write(f.work.join(".git/index.lock"), "").unwrap();
    let e = ops::stage(&g, &["readme.txt".into()]).await.unwrap_err();
    assert_eq!(e.kind, FailureKind::Lock);
    assert!(e.path.unwrap().ends_with("index.lock"));
    std::fs::remove_file(f.work.join(".git/index.lock")).unwrap();
    ops::stage(&g, &["readme.txt".into()]).await.unwrap();
}

#[tokio::test]
async fn switch_and_create_refuse_options_as_targets_before_touching_anything() {
    let f = Fixture::new();
    let g = Git::new(&f.work);
    ops::create_branch(&g, "feat/other", None, false).await.unwrap();
    std::fs::write(f.work.join("readme.txt"), "changed\n").unwrap();
    let head = git(&f.work, &["rev-parse", "--abbrev-ref", "HEAD"]);
    // "-" would switch to the previous branch; "--detach" and "--orphan" are options, not refs.
    for bad in ["-", "--detach", "--orphan"] {
        assert_eq!(ops::switch(&g, bad, false, CarryMode::Bring).await.unwrap_err().kind, FailureKind::InvalidName, "{bad:?}");
        assert_eq!(ops::create_branch(&g, "feat/n", Some(bad), true).await.unwrap_err().kind, FailureKind::InvalidName, "{bad:?}");
        assert_eq!(ops::switch_to_new(&g, "feat/m", bad, CarryMode::Bring).await.unwrap_err().kind, FailureKind::InvalidName, "{bad:?}");
    }
    assert_eq!(git(&f.work, &["rev-parse", "--abbrev-ref", "HEAD"]), head);
    assert_eq!(git(&f.work, &["stash", "list"]), "", "nothing was stashed");
    assert_eq!(read(f.work.join("readme.txt")), "changed\n");
}

#[tokio::test]
async fn push_never_writes_to_an_upstream_of_another_name() {
    let f = Fixture::new();
    let g = Git::new(&f.work);
    // Created from origin/main with tracking, as `git checkout -b fix origin/main` does by default.
    git(&f.work, &["switch", "-q", "-c", "fix", "--track", "origin/main"]);
    commit(&f.work, "fix.txt", "fix\n", "fix");
    let main_before = git(&f.server, &["ls-remote", "origin", "refs/heads/main"]);
    assert_eq!(remote(&g, GitOp::Push).await.unwrap_err().kind, FailureKind::UpstreamMismatch);
    assert_eq!(git(&f.server, &["ls-remote", "origin", "refs/heads/main"]), main_before);
}

#[tokio::test]
async fn push_goes_to_the_push_remote_under_the_same_name() {
    let f = Fixture::new();
    let g = Git::new(&f.work);
    let fork = f.work.parent().unwrap().join("fork.git");
    std::fs::create_dir_all(&fork).unwrap();
    git(&fork, &["init", "-q", "--bare", "-b", "main"]);
    git(&f.work, &["remote", "add", "fork", fork.to_str().unwrap()]);
    ops::create_branch(&g, "feat/f", None, true).await.unwrap();
    commit(&f.work, "f.txt", "f\n", "f");
    remote(&g, GitOp::Push).await.unwrap();
    commit(&f.work, "f2.txt", "f2\n", "f2");
    git(&f.work, &["config", "remote.pushDefault", "fork"]);
    remote(&g, GitOp::Push).await.unwrap();
    let head = git(&f.work, &["rev-parse", "HEAD"]);
    assert!(git(&fork, &["rev-parse", "refs/heads/feat/f"]).starts_with(&head));
    assert_ne!(git(&f.work, &["ls-remote", "origin", "refs/heads/feat/f"]).split_whitespace().next(), Some(head.as_str()));
}

#[tokio::test]
async fn discard_and_stage_stay_inside_the_repo_and_read_paths_literally() {
    let f = Fixture::new();
    let g = Git::new(&f.work);
    let outside = f.work.parent().unwrap().join("outside.txt");
    std::fs::write(&outside, "keep\n").unwrap();
    let backups = f.data.join("backups");
    for bad in ["../outside.txt", outside.to_str().unwrap()] {
        assert_eq!(ops::discard(&g, &[], &[bad.to_string()], &backups).await.unwrap_err().kind, FailureKind::InvalidName, "{bad}");
        assert_eq!(ops::stage(&g, &[bad.to_string()]).await.unwrap_err().kind, FailureKind::InvalidName, "{bad}");
    }
    assert_eq!(std::fs::read_to_string(&outside).unwrap(), "keep\n");

    // "[id]" is a glob to git unless paths are literal: discarding it must not also reset "i" and "d".
    for d in ["[id]", "i", "d"] {
        std::fs::create_dir_all(f.work.join("r").join(d)).unwrap();
        std::fs::write(f.work.join("r").join(d).join("p.txt"), "v1\n").unwrap();
    }
    git(&f.work, &["add", "."]);
    git(&f.work, &["commit", "-q", "-m", "routes"]);
    for d in ["[id]", "i", "d"] {
        std::fs::write(f.work.join("r").join(d).join("p.txt"), "v2\n").unwrap();
    }
    ops::discard(&g, &["r/[id]/p.txt".to_string()], &[], &backups).await.unwrap();
    assert_eq!(read(f.work.join("r/[id]/p.txt")), "v1\n");
    assert_eq!(read(f.work.join("r/i/p.txt")), "v2\n");
    assert_eq!(read(f.work.join("r/d/p.txt")), "v2\n");
}

/// Twelve committed lines, then two edits far apart: two hunks.
fn two_hunks(f: &Fixture) -> Git {
    let body: String = (1..=12).map(|i| format!("line {i}\n")).collect();
    commit(&f.work, "list.txt", &body, "twelve lines");
    let edited = body.replace("line 2\n", "line two\n").replace("line 11\n", "line eleven\nline 11b\n");
    std::fs::write(f.work.join("list.txt"), edited).unwrap();
    Git::new(&f.work)
}

async fn file_diff(g: &Git, source: DiffSource) -> FileDiff {
    diff::working_diff(g, "list.txt", source, &DiffOptions::default(), None).await.unwrap()
}

fn pick(d: &FileDiff, hunk: usize, lines: Option<Vec<u32>>) -> HunkPick {
    HunkPick { hunk: hunk as u32, header: d.hunks[hunk].header.clone(), lines }
}

fn line_of(d: &FileDiff, hunk: usize, text: &str) -> u32 {
    d.hunks[hunk].lines.iter().position(|l| l.text == text).unwrap() as u32
}

/// The staged version of the file, lines as text.
fn index_text(f: &Fixture) -> String {
    git(&f.work, &["show", ":list.txt"]).replace("\r\n", "\n")
}

#[tokio::test]
async fn stages_one_hunk_and_leaves_the_other_unstaged() {
    let f = Fixture::new();
    let g = two_hunks(&f);
    let d = file_diff(&g, DiffSource::Unstaged).await;
    assert_eq!(d.hunks.len(), 2);
    let backups = f.data.join("backups");
    ops::apply_selection(&g, "list.txt", DiffSource::Unstaged, 3, &[pick(&d, 0, None)], ApplyAction::Stage, &backups).await.unwrap();
    let staged = index_text(&f);
    assert!(staged.contains("line two") && !staged.contains("line eleven"), "{staged}");
    assert_eq!(file_diff(&g, DiffSource::Unstaged).await.hunks.len(), 1, "the second hunk is still unstaged");
}

#[tokio::test]
async fn stages_a_single_line_of_a_hunk() {
    let f = Fixture::new();
    let g = two_hunks(&f);
    let d = file_diff(&g, DiffSource::Unstaged).await;
    let only = line_of(&d, 1, "line 11b");
    let backups = f.data.join("backups");
    ops::apply_selection(&g, "list.txt", DiffSource::Unstaged, 3, &[pick(&d, 1, Some(vec![only]))], ApplyAction::Stage, &backups).await.unwrap();
    let staged = index_text(&f);
    // The unchosen replacement of line 11 stays out: the index keeps the old line 11.
    assert!(staged.contains("line 11\nline 11b\nline 12"), "{staged}");
    assert!(!staged.contains("line eleven") && !staged.contains("line two"), "{staged}");
}

#[tokio::test]
async fn stages_a_line_after_the_other_hunk_is_staged() {
    let f = Fixture::new();
    let g = two_hunks(&f);
    let backups = f.data.join("backups");
    let d = file_diff(&g, DiffSource::Unstaged).await;
    ops::apply_selection(&g, "list.txt", DiffSource::Unstaged, 3, &[pick(&d, 0, None)], ApplyAction::Stage, &backups).await.unwrap();
    let rest = file_diff(&g, DiffSource::Unstaged).await;
    let only = line_of(&rest, 0, "line 11b");
    ops::apply_selection(&g, "list.txt", DiffSource::Unstaged, 3, &[pick(&rest, 0, Some(vec![only]))], ApplyAction::Stage, &backups).await.unwrap();
    let staged = index_text(&f);
    assert!(staged.contains("line two") && staged.contains("line 11\nline 11b\nline 12"), "{staged}");
    assert!(!staged.contains("line eleven"), "{staged}");
}

#[tokio::test]
async fn unstages_part_of_the_staged_changes() {
    let f = Fixture::new();
    let g = two_hunks(&f);
    git(&f.work, &["add", "list.txt"]);
    let d = file_diff(&g, DiffSource::Staged).await;
    let backups = f.data.join("backups");
    ops::apply_selection(&g, "list.txt", DiffSource::Staged, 3, &[pick(&d, 0, None)], ApplyAction::Unstage, &backups).await.unwrap();
    let staged = index_text(&f);
    assert!(staged.contains("line 2\n") && staged.contains("line eleven"), "{staged}");
    assert!(read(f.work.join("list.txt")).contains("line two"), "the working tree is untouched");
}

#[tokio::test]
async fn discards_part_of_a_file_after_a_backup_of_it() {
    let f = Fixture::new();
    let g = two_hunks(&f);
    let d = file_diff(&g, DiffSource::Unstaged).await;
    let backups = f.data.join("backups");
    let r = ops::apply_selection(&g, "list.txt", DiffSource::Unstaged, 3, &[pick(&d, 0, None)], ApplyAction::Discard, &backups).await.unwrap();
    let work = read(f.work.join("list.txt"));
    assert!(work.contains("line 2\n") && work.contains("line eleven"), "{work}");
    let dir = std::path::PathBuf::from(r.backup_dir.unwrap());
    assert!(read(dir.join("list.txt")).contains("line two"), "the backup has the file as it was");
}

#[tokio::test]
async fn refuses_to_patch_a_file_that_changed_since_it_was_shown() {
    let f = Fixture::new();
    let g = two_hunks(&f);
    let d = file_diff(&g, DiffSource::Unstaged).await;
    let now = read(f.work.join("list.txt"));
    std::fs::write(f.work.join("list.txt"), format!("new first line\n{now}")).unwrap();
    let backups = f.data.join("backups");
    let e = ops::apply_selection(&g, "list.txt", DiffSource::Unstaged, 3, &[pick(&d, 0, None)], ApplyAction::Stage, &backups).await.unwrap_err();
    assert_eq!(e.kind, FailureKind::Changed);
    assert!(!index_text(&f).contains("line two"), "nothing was staged");
    let wrong = ops::apply_selection(&g, "list.txt", DiffSource::Staged, 3, &[pick(&d, 0, None)], ApplyAction::Stage, &backups).await.unwrap_err();
    assert_eq!(wrong.kind, FailureKind::Other, "staging is from the unstaged diff only");
}

/// The server moves `name` one commit ahead; the work clone fetches it but its branch stays behind.
fn server_moves_ahead(f: &Fixture, name: &str) {
    git(&f.server, &["fetch", "-q"]);
    git(&f.server, &["switch", "-q", "-c", name, &format!("origin/{name}")]);
    commit(&f.server, "server.txt", "from the server\n", "server commit");
    git(&f.server, &["push", "-q", "origin", name]);
    git(&f.server, &["switch", "-q", "main"]);
    git(&f.work, &["fetch", "-q"]);
}

#[tokio::test]
async fn fast_forward_moves_a_branch_to_its_upstream_checked_out_or_not() {
    let f = Fixture::new();
    let g = Git::new(&f.work);
    f.pushed_branch("feat/behind", 1);
    server_moves_ahead(&f, "feat/behind");
    let r = ops::fast_forward(&g, "feat/behind").await.unwrap();
    assert_eq!(r.sha.as_deref(), Some(git(&f.work, &["rev-parse", "origin/feat/behind"]).as_str()));

    // Checked out: the working tree follows.
    f.pushed_branch("feat/here", 1);
    server_moves_ahead(&f, "feat/here");
    git(&f.work, &["switch", "-q", "feat/here"]);
    ops::fast_forward(&g, "feat/here").await.unwrap();
    assert_eq!(git(&f.work, &["rev-parse", "HEAD"]), git(&f.work, &["rev-parse", "origin/feat/here"]));
    assert!(f.work.join("server.txt").exists());
}

#[tokio::test]
async fn fast_forward_refuses_a_branch_with_commits_of_its_own() {
    let f = Fixture::new();
    let g = Git::new(&f.work);
    f.pushed_branch("feat/both", 1);
    server_moves_ahead(&f, "feat/both");
    git(&f.work, &["switch", "-q", "feat/both"]);
    commit(&f.work, "mine.txt", "local\n", "local commit");
    let before = git(&f.work, &["rev-parse", "feat/both"]);
    let e = ops::fast_forward(&g, "feat/both").await.unwrap_err();
    assert_eq!(e.kind, FailureKind::Diverged);
    assert_eq!(git(&f.work, &["rev-parse", "feat/both"]), before, "nothing moved");
    assert_eq!(ops::fast_forward(&g, "--force").await.unwrap_err().kind, FailureKind::InvalidName);
}

#[tokio::test]
async fn a_push_can_name_a_branch_that_is_not_checked_out() {
    let f = Fixture::new();
    let g = Git::new(&f.work);
    git(&f.work, &["branch", "feat/elsewhere", "main"]);
    git(&f.work, &["switch", "-q", "feat/elsewhere"]);
    commit(&f.work, "e.txt", "e\n", "on the side");
    git(&f.work, &["switch", "-q", "main"]);
    ops::remote(&g, GitOp::Push, Some("feat/elsewhere"), Arc::new(Notify::new()), |_, _| {}).await.unwrap();
    assert_eq!(git(&f.work, &["rev-parse", "--abbrev-ref", "feat/elsewhere@{upstream}"]), "origin/feat/elsewhere", "first push sets the upstream");
    assert_eq!(git(&f.work, &["rev-parse", "--abbrev-ref", "HEAD"]), "main", "nothing was checked out");
    let e = ops::remote(&g, GitOp::Push, Some("--all"), Arc::new(Notify::new()), |_, _| {}).await.unwrap_err();
    assert_eq!(e.kind, FailureKind::InvalidName);
}

#[tokio::test]
async fn a_branch_created_from_the_default_commit_tracks_nothing_until_its_first_push() {
    let f = Fixture::new();
    let g = Git::new(&f.work);
    ops::create_branch(&g, "feat/new", Some("origin/main^{commit}"), false).await.unwrap();
    assert_eq!(git(&f.work, &["rev-parse", "feat/new"]), git(&f.work, &["rev-parse", "origin/main"]));
    assert!(!git(&f.work, &["config", "--list"]).contains("branch.feat/new."), "no upstream: a push must not target main");
    ops::remote(&g, GitOp::Push, Some("feat/new"), Arc::new(Notify::new()), |_, _| {}).await.unwrap();
    assert_eq!(git(&f.work, &["rev-parse", "--abbrev-ref", "feat/new@{upstream}"]), "origin/feat/new");
}

#[tokio::test]
async fn stash_apply_keeps_the_stash_and_drop_leaves_a_backup_ref() {
    let f = Fixture::new();
    let g = Git::new(&f.work);
    std::fs::write(f.work.join("a.txt"), "first\n").unwrap();
    git(&f.work, &["stash", "push", "-q", "--include-untracked", "-m", "first"]);
    std::fs::write(f.work.join("b.txt"), "second\n").unwrap();
    git(&f.work, &["stash", "push", "-q", "--include-untracked", "-m", "second"]);
    let first = git(&f.work, &["rev-parse", "stash@{1}"]);

    // By its commit, not its number: "first" is stash@{1} here.
    ops::stash_apply(&g, &first).await.unwrap();
    assert!(f.work.join("a.txt").exists());
    assert_eq!(git(&f.work, &["stash", "list"]).lines().count(), 2, "apply keeps the stash");
    std::fs::remove_file(f.work.join("a.txt")).unwrap();

    let r = ops::stash_drop(&g, &first).await.unwrap();
    let backup = r.summary.unwrap();
    assert!(backup.starts_with("refs/mcbranchface/stash/"));
    assert_eq!(git(&f.work, &["rev-parse", &backup]), first);
    assert_eq!(git(&f.work, &["stash", "list", "--format=%gs"]).trim(), "On main: second");

    // Gone meanwhile: said, not guessed at.
    assert_eq!(ops::stash_drop(&g, &first).await.unwrap_err().kind, FailureKind::Changed);
}

#[tokio::test]
async fn two_discards_of_one_file_within_a_second_keep_both_backups() {
    let f = Fixture::new();
    let g = Git::new(&f.work);
    let backups = f.data.join("backups");
    std::fs::write(f.work.join("readme.txt"), "first\n").unwrap();
    let a = ops::discard(&g, &["readme.txt".into()], &[], &backups).await.unwrap().backup_dir.unwrap();
    std::fs::write(f.work.join("readme.txt"), "second\n").unwrap();
    let b = ops::discard(&g, &["readme.txt".into()], &[], &backups).await.unwrap().backup_dir.unwrap();
    // A folder per second alone let the second backup overwrite the first.
    assert_ne!(a, b);
    assert_eq!(read(std::path::Path::new(&a).join("readme.txt")), "first\n");
    assert_eq!(read(std::path::Path::new(&b).join("readme.txt")), "second\n");
}

#[tokio::test]
async fn discard_keeps_the_file_when_the_backup_cannot_be_written() {
    let f = Fixture::new();
    let g = Git::new(&f.work);
    std::fs::write(f.work.join("readme.txt"), "precious edit\n").unwrap();
    std::fs::write(f.work.join("new.txt"), "untracked work\n").unwrap();
    // The backups folder cannot be created: a file stands in its place.
    std::fs::create_dir_all(&f.data).unwrap();
    let blocked = f.data.join("backups");
    std::fs::write(&blocked, "not a folder").unwrap();
    assert!(ops::discard(&g, &["readme.txt".into()], &["new.txt".into()], &blocked).await.is_err());
    assert_eq!(read(f.work.join("readme.txt")), "precious edit\n");
    assert_eq!(read(f.work.join("new.txt")), "untracked work\n");

    // The same for chosen lines.
    let g = two_hunks(&f);
    let before = read(f.work.join("list.txt"));
    let d = file_diff(&g, DiffSource::Unstaged).await;
    let e = ops::apply_selection(&g, "list.txt", DiffSource::Unstaged, 3, &[pick(&d, 0, None)], ApplyAction::Discard, &blocked).await;
    assert!(e.is_err());
    assert_eq!(read(f.work.join("list.txt")), before);
}

#[tokio::test]
async fn discard_removes_a_read_only_untracked_file_after_its_backup() {
    let f = Fixture::new();
    let g = Git::new(&f.work);
    std::fs::write(f.work.join("a.txt"), "a\n").unwrap();
    let locked = f.work.join("locked.txt");
    std::fs::write(&locked, "keep\n").unwrap();
    let mut perm = std::fs::metadata(&locked).unwrap().permissions();
    perm.set_readonly(true);
    std::fs::set_permissions(&locked, perm).unwrap();
    let backups = f.data.join("backups");
    let r = ops::discard(&g, &[], &["a.txt".into(), "locked.txt".into()], &backups).await.expect("not stopped half way");
    assert!(!f.work.join("a.txt").exists() && !locked.exists());
    let dir = std::path::PathBuf::from(r.backup_dir.unwrap());
    assert_eq!(read(dir.join("locked.txt")), "keep\n");
}
