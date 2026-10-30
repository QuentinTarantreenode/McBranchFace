//! The rarer refusals of both delete paths: each one leaves nothing half done and says why.
mod common;

use common::*;
use mcbranchface_lib::actions::Env;
use mcbranchface_lib::config::Config;
use mcbranchface_lib::journal::Journal;
use mcbranchface_lib::model::*;
use mcbranchface_lib::{delete, delete_online};

fn local(f: &Fixture, name: &str, sha: &str) -> DeleteRequest {
    DeleteRequest {
        repo_path: f.work.to_string_lossy().into(),
        branch: name.into(),
        expected_sha: sha.into(),
        force: true,
        drop_stashes: vec![],
        remove_worktree: true,
    }
}

fn remote_req(f: &Fixture, name: &str, sha: &str, force: bool) -> RemoteDeleteRequest {
    RemoteDeleteRequest { repo_path: f.work.to_string_lossy().into(), remote: "origin".into(), branch: name.into(), expected_sha: sha.into(), force }
}

async fn gone(f: &Fixture, name: &str) -> RepoResult {
    f.pushed_branch(name, 1);
    f.delete_remote(name);
    f.scan(true).await
}

#[tokio::test]
async fn local_delete_refuses_a_vanished_branch() {
    let f = Fixture::new();
    let (config, store, journal) = (f.config(), f.store(), f.journal());
    let env = Env { config: &config, snapshots: &store, journal: &journal, cached_prs: None };
    let e = delete::delete(&env, &local(&f, "never-existed", "0")).await.unwrap_err();
    assert_eq!(e.kind, FailureKind::NoLongerCandidate);
}

#[tokio::test]
async fn a_blocked_stash_backup_undoes_the_branch_backup() {
    let f = Fixture::new();
    let r = gone(&f, "feature/s").await;
    git(&f.work, &["switch", "-q", "feature/s"]);
    std::fs::write(f.work.join("wip.txt"), "wip").unwrap();
    git(&f.work, &["add", "wip.txt"]);
    git(&f.work, &["stash", "-q"]);
    git(&f.work, &["switch", "-q", "main"]);
    let r = if find(&r, "feature/s").stashes.is_empty() { f.scan(false).await } else { r };
    // A plain ref where the stash backups would go: git cannot create refs below it.
    git(&f.work, &["update-ref", "refs/mcbranchface/stash", "HEAD"]);
    let b = find(&r, "feature/s");
    let mut req = local(&f, "feature/s", &b.sha);
    req.drop_stashes = b.stashes.iter().map(|s| s.sha.clone()).collect();
    let (config, store, journal) = (f.config(), f.store(), f.journal());
    let env = Env { config: &config, snapshots: &store, journal: &journal, cached_prs: None };
    let e = delete::delete(&env, &req).await.unwrap_err();
    assert_eq!(e.step, DeleteStep::Backup);
    assert!(git(&f.work, &["for-each-ref", "refs/mcbranchface/backup"]).is_empty(), "branch backup removed again");
    assert_eq!(git(&f.work, &["branch", "--list", "feature/s", "--format=%(refname:short)"]), "feature/s");
}

#[tokio::test]
async fn a_locked_worktree_stops_before_the_branch_is_touched() {
    let f = Fixture::new();
    f.pushed_branch("feature/w", 1);
    let wt = f.work.with_file_name("wt");
    git(&f.work, &["worktree", "add", "-q", wt.to_str().unwrap(), "feature/w"]);
    git(&f.work, &["worktree", "lock", wt.to_str().unwrap()]);
    f.delete_remote("feature/w");
    let r = f.scan(true).await;
    let (config, store, journal) = (f.config(), f.store(), f.journal());
    let env = Env { config: &config, snapshots: &store, journal: &journal, cached_prs: None };
    let e = delete::delete(&env, &local(&f, "feature/w", &find(&r, "feature/w").sha)).await.unwrap_err();
    assert_eq!(e.step, DeleteStep::Worktree);
    assert!(!e.changed, "the worktree is still intact");
    assert!(wt.join(".git").exists());
    assert!(git(&f.work, &["for-each-ref", "refs/mcbranchface"]).is_empty());
}

#[tokio::test]
async fn an_unwritable_journal_is_a_warning_the_backup_ref_still_restores_from() {
    let f = Fixture::new();
    let r = gone(&f, "feature/j").await;
    let dir_as_journal = f.data.join("journal-is-a-folder");
    std::fs::create_dir_all(&dir_as_journal).unwrap();
    let journal = Journal::new(dir_as_journal);
    let (config, store) = (f.config(), f.store());
    let env = Env { config: &config, snapshots: &store, journal: &journal, cached_prs: None };
    let out = delete::delete(&env, &local(&f, "feature/j", &find(&r, "feature/j").sha)).await.unwrap();
    assert_eq!(out.warnings.len(), 1);
    assert_eq!(out.warnings[0].step, DeleteStep::Journal);
    assert_eq!(out.warnings[0].path.as_deref(), Some(out.entry.backup_ref.as_str()));

    // The same on the server.
    f.pushed_branch("feature/r", 1);
    let sha = git(&f.work, &["rev-parse", "feature/r"]);
    let res = delete_online::delete(&env, &remote_req(&f, "feature/r", &sha, true)).await.unwrap();
    assert_eq!(res.warnings[0].step, DeleteStep::Journal);
}

#[tokio::test]
async fn server_delete_refusals() {
    let f = Fixture::new();
    let (config, store, journal) = (f.config(), f.store(), f.journal());
    let env = Env { config: &config, snapshots: &store, journal: &journal, cached_prs: None };

    // Folder gone.
    let mut missing = remote_req(&f, "x", "0", true);
    missing.repo_path = f.work.join("nowhere").to_string_lossy().into();
    assert_eq!(delete_online::delete(&env, &missing).await.unwrap_err().kind, FailureKind::RepoMissing);

    // Not on the server (any more).
    assert_eq!(delete_online::delete(&env, &remote_req(&f, "x", "0", true)).await.unwrap_err().kind, FailureKind::NoLongerCandidate);

    // A remote that is not one of the repo's remotes never reaches git: "--upload-pack=…" would run a program.
    for bad in ["--upload-pack=touch pwned", "nosuchremote"] {
        let mut r = remote_req(&f, "x", "0", true);
        r.remote = bad.into();
        assert_eq!(delete_online::delete(&env, &r).await.unwrap_err().kind, FailureKind::InvalidName, "{bad}");
    }
    assert!(!f.work.join("pwned").exists());

    // On the server, but never fetched: the backup would have nothing to point to.
    f.on_server(|s| {
        git(s, &["switch", "-q", "-c", "unfetched"]);
        commit(s, "u.txt", "u", "unfetched work");
        git(s, &["push", "-q", "origin", "unfetched"]);
        git(s, &["switch", "-q", "main"]);
    });
    let sha = git(&f.server, &["rev-parse", "unfetched"]);
    let e = delete_online::delete(&env, &remote_req(&f, "unfetched", &sha, true)).await.unwrap_err();
    assert_eq!(e.kind, FailureKind::Changed);

    // A plain ref where the server backups would go.
    f.pushed_branch("feature/b", 1);
    let sha = git(&f.work, &["rev-parse", "feature/b"]);
    git(&f.work, &["update-ref", "refs/mcbranchface/remote-backup", "HEAD"]);
    assert_eq!(delete_online::delete(&env, &remote_req(&f, "feature/b", &sha, true)).await.unwrap_err().step, DeleteStep::Backup);
    git(&f.work, &["update-ref", "-d", "refs/mcbranchface/remote-backup"]);

    // The server cannot be asked at all.
    let url = git(&f.work, &["remote", "get-url", "origin"]);
    git(&f.work, &["remote", "set-url", "origin", f.work.join("no-server").to_str().unwrap()]);
    assert_eq!(delete_online::delete(&env, &remote_req(&f, "feature/b", &sha, true)).await.unwrap_err().step, DeleteStep::Verify);
    git(&f.work, &["remote", "set-url", "origin", &url]);

    // Asking works, deleting does not: the push goes elsewhere and fails as a whole.
    git(&f.work, &["remote", "set-url", "--push", "origin", f.work.join("no-server").to_str().unwrap()]);
    let e = delete_online::delete(&env, &remote_req(&f, "feature/b", &sha, true)).await.unwrap_err();
    assert_eq!(e.step, DeleteStep::Branch);
    assert!(git(&f.work, &["for-each-ref", "refs/mcbranchface"]).is_empty(), "backup removed again");
    git(&f.work, &["config", "--unset", "remote.origin.pushurl"]);

    // The server declines through a hook: reported as rejected, backup removed.
    let origin = f.work.with_file_name("origin.git");
    let hook = origin.join("hooks").join("pre-receive");
    std::fs::write(&hook, "#!/bin/sh\necho declined >&2\nexit 1\n").unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&hook, std::fs::Permissions::from_mode(0o755)).unwrap();
    }
    let e = delete_online::delete(&env, &remote_req(&f, "feature/b", &sha, true)).await.unwrap_err();
    assert_eq!(e.kind, FailureKind::Rejected);
    assert!(git(&f.work, &["for-each-ref", "refs/mcbranchface"]).is_empty());
    std::fs::remove_file(&hook).unwrap();
}

#[tokio::test]
async fn a_merged_pull_request_is_evidence_for_the_server_branch() {
    let f = Fixture::new();
    f.pushed_branch("feature/pr", 2);
    let tip = git(&f.work, &["rev-parse", "feature/pr"]);
    let first = git(&f.work, &["rev-parse", "feature/pr~1"]);
    let pr = |source_sha: &str| PullRequestInfo {
        id: 1,
        title: "t".into(),
        state: PrState::Merged,
        url: "u".into(),
        author: "a".into(),
        author_name: None,
        source_ref: "refs/heads/feature/pr".into(),
        target_ref: "refs/heads/main".into(),
        source_sha: Some(source_sha.into()),
        created_at: None,
        closed_at: None,
        target_sha: None,
        reviewers: Vec::new(),
        is_draft: false,
        has_conflicts: false,
    };
    let (config, store, journal) = (f.config(), f.store(), f.journal());

    // Without evidence a normal delete is refused.
    let env = Env { config: &config, snapshots: &store, journal: &journal, cached_prs: Some(vec![]) };
    assert_eq!(delete_online::delete(&env, &remote_req(&f, "feature/pr", &tip, false)).await.unwrap_err().kind, FailureKind::NoLongerSafe);

    // The PR merged an older state only: the newer commit is not covered.
    let env = Env { config: &config, snapshots: &store, journal: &journal, cached_prs: Some(vec![pr(&first)]) };
    assert_eq!(delete_online::delete(&env, &remote_req(&f, "feature/pr", &tip, false)).await.unwrap_err().kind, FailureKind::NoLongerSafe);

    // Several repos at once: each request is checked against its own repository's pull requests.
    let env = Env { config: &config, snapshots: &store, journal: &journal, cached_prs: None };
    let req = remote_req(&f, "feature/pr", &tip, false);
    let elsewhere = std::collections::HashMap::from([("C:/another/repo".to_string(), vec![pr(&tip)])]);
    let r = delete_online::delete_many(&env, std::slice::from_ref(&req), &elsewhere).await;
    assert_eq!(r[0].failure.as_ref().map(|f| f.kind), Some(FailureKind::NoLongerSafe), "another repo's PR is no evidence here");

    // The PR contains the tip.
    let own = std::collections::HashMap::from([(req.repo_path.clone(), vec![pr(&tip)])]);
    let r = delete_online::delete_many(&env, std::slice::from_ref(&req), &own).await;
    assert_eq!(r[0].outcome.as_ref().map(|o| o.entry.verdict), Some(Verdict::Safe));
}

async fn with_stash(f: &Fixture, name: &str) -> (RepoResult, DeleteRequest) {
    f.pushed_branch(name, 1);
    git(&f.work, &["switch", "-q", name]);
    std::fs::write(f.work.join("wip.txt"), "wip").unwrap();
    git(&f.work, &["add", "wip.txt"]);
    git(&f.work, &["stash", "-q"]);
    git(&f.work, &["switch", "-q", "main"]);
    f.delete_remote(name);
    let r = f.scan(true).await;
    let b = find(&r, name);
    assert_eq!(b.stashes.len(), 1, "fixture: one stash on the branch");
    let mut req = local(f, name, &b.sha);
    req.drop_stashes = b.stashes.iter().map(|s| s.sha.clone()).collect();
    (r, req)
}

#[tokio::test]
async fn the_stashes_are_on_record_before_they_are_dropped() {
    let f = Fixture::new();
    let (_, req) = with_stash(&f, "feature/u").await;
    let journal = f.journal();
    // The rewrite goes through a temporary file; a folder in its place makes it fail. The first
    // record names the stash already, so no rewrite is needed.
    std::fs::create_dir_all(f.data.join("deleted.jsonl.tmp")).unwrap();
    let (config, store) = (f.config(), f.store());
    let env = Env { config: &config, snapshots: &store, journal: &journal, cached_prs: None };
    let out = delete::delete(&env, &req).await.unwrap();
    assert_eq!(out.entry.dropped_stashes.len(), 1);
    assert!(out.warnings.is_empty(), "{:?}", out.warnings);
    let entries = journal.load().unwrap();
    assert_eq!(entries.len(), 1);
    assert_eq!(entries[0].dropped_stashes.len(), 1, "the stash is named in the first record");
}

#[tokio::test]
async fn without_a_journal_the_stashes_stay() {
    let f = Fixture::new();
    let (_, req) = with_stash(&f, "feature/n").await;
    let dir_as_journal = f.data.join("journal-is-a-folder");
    std::fs::create_dir_all(&dir_as_journal).unwrap();
    let journal = Journal::new(dir_as_journal);
    let (config, store) = (f.config(), f.store());
    let env = Env { config: &config, snapshots: &store, journal: &journal, cached_prs: None };
    let out = delete::delete(&env, &req).await.unwrap();
    assert!(out.entry.dropped_stashes.is_empty());
    assert!(out.warnings.iter().any(|w| w.step == DeleteStep::Stash), "{:?}", out.warnings);
    assert_eq!(git(&f.work, &["stash", "list", "--format=%H"]), req.drop_stashes[0], "the stash is still there");
    assert!(git(&f.work, &["for-each-ref", "refs/mcbranchface/stash"]).is_empty(), "its backup ref is gone again");
}

#[tokio::test]
async fn a_merge_undone_on_the_target_since_the_scan_stops_the_delete() {
    let f = Fixture::new();
    f.pushed_branch("feature/m", 1);
    let before = git(&f.work, &["rev-parse", "origin/main"]);
    git(&f.work, &["merge", "-q", "--no-ff", "--no-edit", "feature/m"]);
    git(&f.work, &["push", "-q", "origin", "main"]);
    f.delete_remote("feature/m");
    let r = f.scan(true).await;
    let b = find(&r, "feature/m");
    assert_eq!(b.verdict, Verdict::Safe);
    // The server's main was reset to before the merge, and a fetch brought that here.
    git(&f.work, &["update-ref", "refs/remotes/origin/main", &before]);
    let mut req = local(&f, "feature/m", &b.sha);
    req.force = false;
    let (config, store, journal) = (f.config(), f.store(), f.journal());
    let env = Env { config: &config, snapshots: &store, journal: &journal, cached_prs: None };
    let e = delete::delete(&env, &req).await.unwrap_err();
    assert_eq!(e.kind, FailureKind::NoLongerSafe, "a remembered merge must not stand in for the current one");
}

#[tokio::test]
async fn a_server_delete_refuses_protected_branches_and_the_default_branch_even_when_forced() {
    let f = Fixture::new();
    f.pushed_branch("release/7", 1);
    let mut config = f.config();
    // A pattern added after the scan that listed the branch.
    config.protected_patterns = vec!["release/*".into()];
    let (store, journal) = (f.store(), f.journal());
    let env = Env { config: &config, snapshots: &store, journal: &journal, cached_prs: None };
    let sha = git(&f.work, &["rev-parse", "release/7"]);
    assert_eq!(delete_online::delete(&env, &remote_req(&f, "release/7", &sha, true)).await.unwrap_err().kind, FailureKind::NoLongerCandidate);
    let main = git(&f.work, &["rev-parse", "origin/main"]);
    let open = Config { protected_patterns: vec![], ..f.config() };
    let env = Env { config: &open, snapshots: &store, journal: &journal, cached_prs: None };
    assert_eq!(delete_online::delete(&env, &remote_req(&f, "main", &main, true)).await.unwrap_err().kind, FailureKind::NoLongerCandidate);
    assert!(!git(&f.work, &["ls-remote", "--heads", "origin", "release/7"]).is_empty());
    assert!(!git(&f.work, &["ls-remote", "--heads", "origin", "main"]).is_empty());
}

#[tokio::test]
async fn deleting_a_branch_with_a_dirty_worktree_keeps_its_changed_files() {
    let f = Fixture::new();
    f.pushed_branch("feature/w", 1);
    let wt = f.work.parent().unwrap().join("wt-w");
    git(&f.work, &["worktree", "add", "-q", &wt.to_string_lossy(), "feature/w"]);
    std::fs::write(wt.join("notes.txt"), "keep me").unwrap();
    let r = f.scan(false).await;
    let b = find(&r, "feature/w");
    let (config, store, journal) = (f.config(), f.store(), f.journal());
    let env = Env { config: &config, snapshots: &store, journal: &journal, cached_prs: None };
    let out = delete::delete(&env, &local(&f, "feature/w", &b.sha)).await.unwrap();
    let dir = out.files_backup.expect("the changed files are kept");
    assert_eq!(std::fs::read_to_string(std::path::Path::new(&dir).join("notes.txt")).unwrap(), "keep me");
    assert!(!wt.exists());
}

#[tokio::test]
async fn deleting_a_branch_leaves_other_missing_worktrees_registered() {
    let f = Fixture::new();
    f.pushed_branch("feature/offline", 1);
    // A worktree on a drive that is not connected right now looks like one deleted by hand.
    let offline = f.work.parent().unwrap().join("wt-offline");
    git(&f.work, &["worktree", "add", "-q", &offline.to_string_lossy(), "feature/offline"]);
    std::fs::remove_dir_all(&offline).unwrap();
    let r = gone(&f, "feature/a").await;
    let (config, store, journal) = (f.config(), f.store(), f.journal());
    let env = Env { config: &config, snapshots: &store, journal: &journal, cached_prs: None };
    delete::delete(&env, &local(&f, "feature/a", &find(&r, "feature/a").sha)).await.unwrap();
    assert!(git(&f.work, &["branch", "--list", "feature/a"]).is_empty());
    assert!(git(&f.work, &["worktree", "list", "--porcelain"]).contains("wt-offline"), "the other registration is kept");
}

#[tokio::test]
async fn a_second_delete_of_the_same_branch_within_a_second_gets_its_own_backup() {
    let f = Fixture::new();
    let r = gone(&f, "feature/twice").await;
    let now = mcbranchface_lib::git::snapshot::now();
    // Backups of earlier deletes of this branch in the same seconds (deleted, restored, deleted again).
    for s in now..now + 3 {
        git(&f.work, &["update-ref", &mcbranchface_lib::backup_refs::local(s, "feature/twice"), "HEAD"]);
    }
    let (config, store, journal) = (f.config(), f.store(), f.journal());
    let env = Env { config: &config, snapshots: &store, journal: &journal, cached_prs: None };
    let out = delete::delete(&env, &local(&f, "feature/twice", &find(&r, "feature/twice").sha)).await.unwrap();
    assert!(git(&f.work, &["branch", "--list", "feature/twice"]).is_empty());
    assert_eq!(git(&f.work, &["rev-parse", &out.entry.backup_ref]), find(&r, "feature/twice").sha, "its own backup");
    assert_eq!(git(&f.work, &["for-each-ref", "refs/mcbranchface/backup"]).lines().count(), 4, "the earlier ones untouched");
}

fn env_for<'a>(config: &'a Config, store: &'a mcbranchface_lib::git::snapshot::SnapshotStore, journal: &'a Journal) -> Env<'a> {
    Env { config, snapshots: store, journal, cached_prs: None }
}

#[tokio::test]
async fn delete_with_dirty_worktree_stops_when_the_backup_fails() {
    let f = Fixture::new();
    f.pushed_branch("feature/w", 1);
    let wt = f.work.parent().unwrap().join("wt-w");
    git(&f.work, &["worktree", "add", "-q", &wt.to_string_lossy(), "feature/w"]);
    std::fs::write(wt.join("notes.txt"), "keep me").unwrap();
    let r = f.scan(false).await;
    let b = find(&r, "feature/w");
    // The backups folder cannot be created: a file stands in its place.
    let dir = f.data.join("blocked");
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(dir.join("backups"), "not a folder").unwrap();
    let journal = Journal::new(dir.join("deleted.jsonl"));
    let (config, store) = (f.config(), f.store());
    let e = delete::delete(&env_for(&config, &store, &journal), &local(&f, "feature/w", &b.sha)).await.unwrap_err();
    assert!(!e.changed, "{e:?}");
    assert_eq!(std::fs::read_to_string(wt.join("notes.txt")).unwrap(), "keep me");
    assert_eq!(git(&f.work, &["rev-parse", "feature/w"]), b.sha);
    assert!(git(&f.work, &["for-each-ref", "refs/mcbranchface"]).is_empty(), "backup refs removed again");
}

/// Two stashes on a branch whose server branch is gone.
async fn with_two_stashes(f: &Fixture, name: &str) -> (RepoResult, DeleteRequest) {
    f.pushed_branch(name, 1);
    git(&f.work, &["switch", "-q", name]);
    for (file, msg) in [("first.txt", "first"), ("second.txt", "second")] {
        std::fs::write(f.work.join(file), msg).unwrap();
        git(&f.work, &["add", file]);
        git(&f.work, &["stash", "push", "-q", "-m", msg]);
    }
    git(&f.work, &["switch", "-q", "main"]);
    f.delete_remote(name);
    let r = f.scan(true).await;
    assert_eq!(find(&r, name).stashes.len(), 2, "fixture: two stashes on the branch");
    let req = local(f, name, &find(&r, name).sha);
    (r, req)
}

fn stash_shas(f: &Fixture) -> Vec<String> {
    git(&f.work, &["stash", "list", "--format=%H"]).lines().map(String::from).collect()
}

#[tokio::test]
async fn force_delete_keeps_stashes_that_were_not_ticked() {
    let f = Fixture::new();
    let (r, mut req) = with_two_stashes(&f, "feature/two").await;
    let b = find(&r, "feature/two");
    let (keep, drop) = (b.stashes[0].sha.clone(), b.stashes[1].sha.clone());
    req.drop_stashes = vec![drop.clone()];
    let (config, store, journal) = (f.config(), f.store(), f.journal());
    let out = delete::delete(&env_for(&config, &store, &journal), &req).await.unwrap();
    assert_eq!(out.entry.dropped_stashes.iter().map(|s| s.sha.clone()).collect::<Vec<_>>(), vec![drop.clone()]);
    let left = stash_shas(&f);
    assert!(left.contains(&keep), "the stash that was not ticked stays");
    assert!(!left.contains(&drop));
}

#[tokio::test]
async fn a_stash_of_another_branch_named_in_the_request_is_not_dropped() {
    let f = Fixture::new();
    f.pushed_branch("feature/other", 1);
    git(&f.work, &["switch", "-q", "feature/other"]);
    std::fs::write(f.work.join("other.txt"), "other").unwrap();
    git(&f.work, &["add", "other.txt"]);
    git(&f.work, &["stash", "push", "-q", "-m", "other work"]);
    git(&f.work, &["switch", "-q", "main"]);
    let other = stash_shas(&f)[0].clone();
    let r = gone(&f, "feature/x").await;
    let mut req = local(&f, "feature/x", &find(&r, "feature/x").sha);
    req.drop_stashes = vec![other.clone()];
    let (config, store, journal) = (f.config(), f.store(), f.journal());
    let out = delete::delete(&env_for(&config, &store, &journal), &req).await.unwrap();
    assert!(out.entry.dropped_stashes.is_empty());
    assert_eq!(stash_shas(&f), vec![other], "a stash of another branch is not this delete's to drop");
}

/// A hook that runs `body` once, the moment the delete's backup ref is written: the window between
/// the check and the act, made deterministic. `$d` is the repository's git directory.
fn on_backup(repo: &std::path::Path, body: &str) {
    let hooks = repo.join(".git").join("hooks");
    std::fs::create_dir_all(&hooks).unwrap();
    let script = format!(
        "#!/bin/sh\n\
         [ \"$1\" = committed ] || exit 0\n\
         grep -q 'refs/mcbranchface/backup/' || exit 0\n\
         d=$(git rev-parse --git-common-dir)\n\
         [ -e \"$d/hook-done\" ] && exit 0\n\
         : > \"$d/hook-done\"\n\
         {body}\n"
    );
    let hook = hooks.join("reference-transaction");
    std::fs::write(&hook, script).unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&hook, std::fs::Permissions::from_mode(0o755)).unwrap();
    }
    git(repo, &["config", "core.hooksPath", &hooks.to_string_lossy()]);
}

/// A commit lands on `branch` right after the delete's checks.
fn commit_after_the_backup(repo: &std::path::Path, branch: &str) {
    on_backup(
        repo,
        &format!(
            "tree=$(git rev-parse 'refs/heads/{branch}^{{tree}}')\n\
             new=$(git commit-tree -p 'refs/heads/{branch}' -m late \"$tree\")\n\
             git update-ref 'refs/heads/{branch}' \"$new\""
        ),
    );
}

#[tokio::test]
async fn a_commit_made_after_verification_survives_a_forced_delete() {
    let f = Fixture::new();
    let r = gone(&f, "feature/late").await;
    let sha = find(&r, "feature/late").sha.clone();
    commit_after_the_backup(&f.work, "feature/late");
    let (config, store, journal) = (f.config(), f.store(), f.journal());
    let e = delete::delete(&env_for(&config, &store, &journal), &local(&f, "feature/late", &sha)).await.unwrap_err();
    let now = git(&f.work, &["rev-parse", "refs/heads/feature/late"]);
    assert_ne!(now, sha, "fixture: the hook moved the branch");
    assert_eq!(git(&f.work, &["rev-parse", "refs/heads/feature/late~1"]), sha);
    assert_eq!(e.kind, FailureKind::Changed, "{e:?}");
}

#[tokio::test]
async fn a_branch_that_stays_after_its_worktree_left_is_journalled_as_the_worktree() {
    let f = Fixture::new();
    f.pushed_branch("feature/p", 1);
    let wt = f.work.parent().unwrap().join("wt-p");
    git(&f.work, &["worktree", "add", "-q", &wt.to_string_lossy(), "feature/p"]);
    std::fs::write(wt.join("notes.txt"), "keep me").unwrap();
    f.delete_remote("feature/p");
    let r = f.scan(true).await;
    let sha = find(&r, "feature/p").sha.clone();
    // Another git process takes the branch's lock after the checks: the worktree is gone by the time
    // the branch delete fails.
    on_backup(&f.work, ": > \"$d/refs/heads/feature/p.lock\"");
    let (config, store, journal) = (f.config(), f.store(), f.journal());
    let env = env_for(&config, &store, &journal);
    let e = delete::delete(&env, &local(&f, "feature/p", &sha)).await.unwrap_err();
    assert_eq!((e.kind, e.step, e.changed), (FailureKind::Lock, DeleteStep::Branch, true), "{e:?}");
    assert!(!wt.exists());
    let kept = std::path::PathBuf::from(e.files_backup.clone().expect("where the worktree is now"));
    assert_eq!(std::fs::read_to_string(kept.join("notes.txt")).unwrap(), "keep me");
    assert_eq!(git(&f.work, &["rev-parse", "feature/p"]), sha, "the branch stays");
    assert!(git(&f.work, &["for-each-ref", "refs/mcbranchface"]).is_empty(), "no backup of a branch that is still there");

    let entries = journal.load().unwrap();
    assert_eq!(entries.len(), 1);
    let entry = &entries[0];
    assert!(entry.is_worktree_only(), "{entry:?}");
    assert_eq!(entry.worktree_branch.as_deref(), Some("feature/p"));
    assert_eq!(entry.worktree_backup.as_deref(), e.files_backup.as_deref());

    std::fs::remove_file(f.work.join(".git").join("refs").join("heads").join("feature").join("p.lock")).unwrap();
    mcbranchface_lib::actions::restore(&journal, &entry.id).await.expect("the worktree comes back");
    assert_eq!(git(&wt, &["rev-parse", "--abbrev-ref", "HEAD"]), "feature/p");
    assert_eq!(std::fs::read_to_string(wt.join("notes.txt")).unwrap(), "keep me");
}

#[tokio::test]
async fn a_forced_delete_takes_the_branch_section_along_and_the_restore_brings_it_back_whole() {
    let f = Fixture::new();
    f.pushed_branch("feature/cfg", 1);
    git(&f.work, &["config", "branch.feature/cfg.rebase", "true"]);
    git(&f.work, &["config", "branch.feature/cfg.pushRemote", "origin"]);
    git(&f.work, &["config", "branch.feature/cfg.description", "why it exists"]);
    f.delete_remote("feature/cfg");
    let r = f.scan(true).await;
    let (config, store, journal) = (f.config(), f.store(), f.journal());
    let out = delete::delete(&env_for(&config, &store, &journal), &local(&f, "feature/cfg", &find(&r, "feature/cfg").sha)).await.unwrap();
    assert!(out.used_force_flag, "not merged: the forced path");
    assert!(git(&f.work, &["config", "--list", "--local"]).lines().all(|l| !l.starts_with("branch.feature/cfg.")), "the section went with the branch");
    assert!(out.entry.branch_config.len() >= 5, "{:?}", out.entry.branch_config);

    mcbranchface_lib::actions::restore(&journal, &out.entry.id).await.unwrap();
    assert_eq!(git(&f.work, &["config", "branch.feature/cfg.rebase"]), "true");
    assert_eq!(git(&f.work, &["config", "branch.feature/cfg.pushRemote"]), "origin");
    assert_eq!(git(&f.work, &["config", "branch.feature/cfg.description"]), "why it exists");
    assert_eq!(git(&f.work, &["config", "branch.feature/cfg.remote"]), "origin");
    assert_eq!(git(&f.work, &["config", "branch.feature/cfg.merge"]), "refs/heads/feature/cfg");
}

#[tokio::test]
async fn a_repository_whose_config_cannot_be_read_is_not_deleted_from() {
    let f = Fixture::new();
    let r = gone(&f, "feature/c").await;
    let config_file = f.work.join(".git").join("config");
    let text = std::fs::read_to_string(&config_file).unwrap();
    std::fs::write(&config_file, format!("{text}\n[broken\n")).unwrap();
    let (config, store, journal) = (f.config(), f.store(), f.journal());
    let e = delete::delete(&env_for(&config, &store, &journal), &local(&f, "feature/c", &find(&r, "feature/c").sha)).await.unwrap_err();
    assert_eq!((e.kind, e.step), (FailureKind::ConfigUnreadable, DeleteStep::Verify), "a lock on the repository could not be checked");
    std::fs::write(&config_file, text).unwrap();
    assert_eq!(git(&f.work, &["branch", "--list", "feature/c", "--format=%(refname:short)"]), "feature/c");
}

fn open_pr(branch: &str) -> PullRequestInfo {
    PullRequestInfo {
        id: 7,
        title: "t".into(),
        state: PrState::Open,
        url: "u".into(),
        author: "a".into(),
        author_name: None,
        source_ref: format!("refs/heads/{branch}"),
        target_ref: "refs/heads/main".into(),
        source_sha: None,
        created_at: None,
        closed_at: None,
        target_sha: None,
        reviewers: Vec::new(),
        is_draft: false,
        has_conflicts: false,
    }
}

#[tokio::test]
async fn an_open_pull_request_keeps_the_server_branch_unless_forced() {
    let f = Fixture::new();
    f.pushed_branch("feature/open", 1);
    git(&f.work, &["merge", "-q", "--no-ff", "--no-edit", "feature/open"]);
    git(&f.work, &["push", "-q", "origin", "main"]);
    let sha = git(&f.work, &["rev-parse", "feature/open"]);
    let (config, store, journal) = (f.config(), f.store(), f.journal());
    let env = Env { config: &config, snapshots: &store, journal: &journal, cached_prs: Some(vec![open_pr("feature/open")]) };
    let e = delete_online::delete(&env, &remote_req(&f, "feature/open", &sha, false)).await.unwrap_err();
    assert_eq!(e.kind, FailureKind::NoLongerSafe, "merged, but still the source of an open pull request");
    assert!(!git(&f.work, &["ls-remote", "--heads", "origin", "feature/open"]).is_empty());
    assert!(git(&f.work, &["for-each-ref", "refs/mcbranchface"]).is_empty());
    delete_online::delete(&env, &remote_req(&f, "feature/open", &sha, true)).await.expect("forced, the user decided");
    assert!(git(&f.work, &["ls-remote", "--heads", "origin", "feature/open"]).is_empty());
}
