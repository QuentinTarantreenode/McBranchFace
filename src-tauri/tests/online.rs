//! Branches on the server: assessment, deletion with its safeguards, and restore.
mod common;

use std::process::Command;

use common::*;
use mcbranchface_lib::actions::{self, Env};
use mcbranchface_lib::config::{Config, Lock};
use mcbranchface_lib::delete_online;
use mcbranchface_lib::git::identity;
use mcbranchface_lib::git::runner::Git;
use mcbranchface_lib::model::*;
use mcbranchface_lib::online;

fn old_commit(dir: &std::path::Path, file: &str, msg: &str) {
    std::fs::write(dir.join(file), msg).unwrap();
    git(dir, &["add", file]);
    let out = Command::new("git")
        .args(["commit", "-q", "-m", msg])
        .current_dir(dir)
        .env("GIT_AUTHOR_DATE", "2020-01-01T00:00:00")
        .env("GIT_COMMITTER_DATE", "2020-01-01T00:00:00")
        .output()
        .unwrap();
    assert!(out.status.success());
}

async fn identity_of(f: &Fixture) -> String {
    let g = Git::new(&f.work);
    identity::repo_identity(&g, identity::origin_url(&g).await.as_deref()).await
}

async fn assess(f: &Fixture, config: &Config) -> Vec<RemoteBranchReport> {
    git(&f.work, &["fetch", "-q", "--prune"]);
    online::scan(&f.work, config, &identity_of(f).await, online::PrView::NotApplicable).await.unwrap().branches
}

fn by<'a>(list: &'a [RemoteBranchReport], name: &str) -> &'a RemoteBranchReport {
    list.iter().find(|b| b.name == name).unwrap_or_else(|| panic!("{name} missing"))
}

/// merged (fast-forward), squashed, fresh and old unmerged branches on the server.
fn server_with_branches() -> Fixture {
    let f = Fixture::new();
    f.pushed_branch("done/ff", 1);
    // Two commits: squashing a single commit would be patch-equivalent, not a squash.
    f.pushed_branch("done/squash", 2);
    f.pushed_branch("wip/fresh", 1);
    git(&f.work, &["switch", "-q", "-c", "wip/old", "main"]);
    old_commit(&f.work, "old.txt", "old work");
    git(&f.work, &["push", "-q", "-u", "origin", "wip/old"]);
    git(&f.work, &["switch", "-q", "main"]);
    f.on_server(|s| {
        git(s, &["merge", "-q", "--ff-only", "origin/done/ff"]);
        git(s, &["merge", "-q", "--squash", "origin/done/squash"]);
        git(s, &["commit", "-q", "-m", "squash"]);
    });
    f
}

#[tokio::test]
async fn server_branches_are_assessed() {
    let f = server_with_branches();
    let list = assess(&f, &f.config()).await;
    assert!(list.iter().all(|b| b.name != "main" && b.name != "HEAD"), "default branch is not offered");
    assert_eq!(by(&list, "done/ff").verdict, OnlineVerdict::Merged);
    assert_eq!(by(&list, "done/ff").merge_evidence.as_ref().unwrap().kind, MergeKind::Ancestor);
    assert_eq!(by(&list, "done/squash").verdict, OnlineVerdict::Merged);
    assert_eq!(by(&list, "done/squash").merge_evidence.as_ref().unwrap().kind, MergeKind::Squash);
    assert_eq!(by(&list, "wip/fresh").verdict, OnlineVerdict::Active);
    assert_eq!(by(&list, "wip/old").verdict, OnlineVerdict::Inactive);
    assert!(by(&list, "wip/old").is_mine);
    assert_eq!(by(&list, "wip/old").own_commit_count, 1);
}

#[tokio::test]
async fn without_the_pull_request_list_an_old_branch_is_never_inactive() {
    let f = server_with_branches();
    git(&f.work, &["fetch", "-q", "--prune"]);
    let id = identity_of(&f).await;
    // The provider exists, but its query failed: the old branch may have an open PR.
    let list = online::scan(&f.work, &f.config(), &id, online::PrView::Unknown).await.unwrap().branches;
    let old = by(&list, "wip/old");
    assert_eq!((old.verdict, old.open_pr), (OnlineVerdict::Active, None));
    assert_eq!(by(&list, "done/ff").verdict, OnlineVerdict::Merged, "evidence still counts");

    let known = online::scan(&f.work, &f.config(), &id, online::PrView::Known(&[])).await.unwrap().branches;
    assert_eq!((by(&known, "wip/old").verdict, by(&known, "wip/old").open_pr), (OnlineVerdict::Inactive, Some(false)));
}

struct Ctx {
    config: Config,
    store: mcbranchface_lib::git::snapshot::SnapshotStore,
    journal: mcbranchface_lib::journal::Journal,
}

impl Ctx {
    fn new(f: &Fixture, config: Config) -> Self {
        Self { config, store: f.store(), journal: f.journal() }
    }

    async fn delete(&self, f: &Fixture, b: &RemoteBranchReport, force: bool) -> Result<DeleteOutcome, DeleteFailure> {
        let env = Env { config: &self.config, snapshots: &self.store, journal: &self.journal, cached_prs: None };
        let req = RemoteDeleteRequest {
            repo_path: f.work.to_string_lossy().into(),
            remote: b.remote.clone(),
            branch: b.name.clone(),
            expected_sha: b.sha.clone(),
            force,
        };
        delete_online::delete(&env, &req).await
    }
}

fn on_origin(f: &Fixture, name: &str) -> String {
    git(&f.work, &["ls-remote", "--heads", "origin", &format!("refs/heads/{name}")])
}

#[tokio::test]
async fn merged_branch_is_deleted_on_the_server_and_restored() {
    let f = server_with_branches();
    let c = Ctx::new(&f, f.config());
    let list = assess(&f, &c.config).await;
    let b = by(&list, "done/squash");

    let out = c.delete(&f, b, false).await.expect("delete");
    assert!(on_origin(&f, "done/squash").is_empty(), "gone on the server");
    assert_eq!(out.entry.remote.as_deref(), Some("origin"));
    assert_eq!(out.entry.sha, b.sha);
    assert_eq!(c.journal.load().unwrap().len(), 1, "journaled");

    actions::restore(&c.journal, &out.entry.id).await.expect("restore");
    assert!(on_origin(&f, "done/squash").starts_with(&b.sha), "pushed back at the same commit");
    assert!(c.journal.load().unwrap()[0].restored_at.is_some());
    let again = actions::restore(&c.journal, &out.entry.id).await.unwrap_err();
    assert_eq!(again.downcast_ref::<AppError>().map(|e| e.code), Some(ErrorCode::AlreadyRestored));
}

/// The push of a restore can take minutes on a slow server. Another repo's delete appends to the
/// journal meanwhile, and the restore's write afterwards must not drop that line.
#[tokio::test]
async fn a_delete_journaled_while_a_restore_pushes_keeps_its_entry() {
    let f = server_with_branches();
    let c = Ctx::new(&f, f.config());
    let list = assess(&f, &c.config).await;
    let out = c.delete(&f, by(&list, "done/squash"), false).await.expect("delete");
    let hook = f.work.parent().unwrap().join("origin.git").join("hooks").join("pre-receive");
    std::fs::write(&hook, "#!/bin/sh\nsleep 2\n").unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&hook, std::fs::Permissions::from_mode(0o755)).unwrap();
    }
    let other = DeletedEntry::new("C:/elsewhere/repo", "feature/x", "feature/x", "abc", "refs/mcbranchface/backup/1/feature/x", 1);
    let (restored, appended) = tokio::join!(actions::restore(&c.journal, &out.entry.id), async {
        tokio::time::sleep(std::time::Duration::from_millis(500)).await;
        let started = std::time::Instant::now();
        c.journal.append(&other).unwrap();
        started.elapsed()
    });
    restored.expect("restore");
    assert!(appended < std::time::Duration::from_millis(500), "the append waited {appended:?} for the push");
    let entries = c.journal.load().unwrap();
    assert!(entries.iter().any(|e| e.id == other.id), "the entry written during the push is still there");
    assert!(entries.iter().find(|e| e.id == out.entry.id).is_some_and(|e| e.restored_at.is_some()));
}

#[tokio::test]
async fn unmerged_branch_needs_force() {
    let f = server_with_branches();
    let c = Ctx::new(&f, f.config());
    let list = assess(&f, &c.config).await;
    let b = by(&list, "wip/old");
    let e = c.delete(&f, b, false).await.unwrap_err();
    assert_eq!(e.kind, FailureKind::NoLongerSafe);
    assert!(!on_origin(&f, "wip/old").is_empty(), "untouched");
    assert!(git(&f.work, &["for-each-ref", "refs/mcbranchface"]).is_empty(), "no backup ref left behind");
    c.delete(&f, b, true).await.expect("forced");
    assert!(on_origin(&f, "wip/old").is_empty());
}

#[tokio::test]
async fn server_branch_that_moved_since_the_scan_is_refused() {
    let f = server_with_branches();
    let c = Ctx::new(&f, f.config());
    let list = assess(&f, &c.config).await;
    // Someone pushes to the branch after the scan.
    git(&f.server, &["fetch", "-q"]);
    git(&f.server, &["switch", "-q", "-c", "ff-local", "origin/done/ff"]);
    commit(&f.server, "late.txt", "late\n", "late commit");
    git(&f.server, &["push", "-q", "origin", "HEAD:done/ff"]);

    let e = c.delete(&f, by(&list, "done/ff"), true).await.unwrap_err();
    assert_eq!(e.kind, FailureKind::Changed);
    assert!(!on_origin(&f, "done/ff").is_empty());
}

#[tokio::test]
async fn a_commit_pushed_between_the_check_and_the_delete_survives() {
    let f = server_with_branches();
    let c = Ctx::new(&f, f.config());
    let list = assess(&f, &c.config).await;
    git(&f.server, &["fetch", "-q"]);
    git(&f.server, &["switch", "-q", "-c", "late-local", "origin/done/ff"]);
    commit(&f.server, "late.txt", "late\n", "late commit");
    git(&f.server, &["push", "-q", "origin", "HEAD:refs/tmp/late"]);
    let late = git(&f.server, &["rev-parse", "HEAD"]);
    // The colleague's push lands after `ls-remote`, right when the delete connects: the server
    // moves the branch just before it answers the push.
    let origin = f.work.parent().unwrap().join("origin.git").to_string_lossy().replace('\\', "/");
    let receive = format!("git --git-dir='{origin}' update-ref refs/heads/done/ff {late} && git-receive-pack");
    git(&f.work, &["config", "remote.origin.receivepack", &receive]);

    let e = c.delete(&f, by(&list, "done/ff"), false).await.unwrap_err();
    assert_eq!(e.kind, FailureKind::Changed, "{}", e.detail);
    assert!(on_origin(&f, "done/ff").starts_with(&late), "the late commit is still on the server");
    assert!(git(&f.work, &["for-each-ref", "refs/mcbranchface"]).is_empty(), "backup ref removed again");
    assert!(c.journal.load().unwrap().is_empty());
}

#[tokio::test]
async fn locked_branch_is_refused_even_with_force() {
    let f = server_with_branches();
    let mut config = f.config();
    config.locks.push(Lock { identity: identity_of(&f).await, branch: Some("done/ff".into()) });
    let c = Ctx::new(&f, config);
    let list = assess(&f, &c.config).await;
    let b = by(&list, "done/ff");
    assert!(b.locked, "the assessment marks it");
    assert_eq!(c.delete(&f, b, true).await.unwrap_err().kind, FailureKind::Locked);
    assert!(!on_origin(&f, "done/ff").is_empty());
}

#[tokio::test]
async fn server_that_refuses_the_delete_is_reported_as_rejected() {
    let f = server_with_branches();
    let origin = f.work.parent().unwrap().join("origin.git");
    std::fs::write(origin.join("hooks").join("pre-receive"), "#!/bin/sh\necho protected >&2\nexit 1\n").unwrap();
    let c = Ctx::new(&f, f.config());
    let list = assess(&f, &c.config).await;
    let e = c.delete(&f, by(&list, "done/ff"), false).await.unwrap_err();
    assert_eq!(e.kind, FailureKind::Rejected, "{}", e.detail);
    assert!(git(&f.work, &["for-each-ref", "refs/mcbranchface"]).is_empty(), "backup ref removed again");
    assert!(c.journal.load().unwrap().is_empty());
}

#[tokio::test]
async fn working_copies_of_one_repository_share_the_identity() {
    let f = Fixture::new();
    let second = f.work.parent().unwrap().join("work2");
    let origin = f.work.parent().unwrap().join("origin.git");
    git(f.work.parent().unwrap(), &["clone", "-q", origin.to_str().unwrap(), "work2"]);
    let a = identity_of(&f).await;
    let g = Git::new(&second);
    let b = identity::repo_identity(&g, identity::origin_url(&g).await.as_deref()).await;
    assert_eq!(a, b);
    let r = f.scan(false).await;
    assert_eq!(r.repo.identity, a);
}

#[tokio::test]
async fn locked_local_branch_is_marked_and_not_deleted() {
    let f = Fixture::new();
    f.pushed_branch("feature/keep", 1);
    f.on_server(|s| {
        git(s, &["merge", "-q", "--ff-only", "origin/feature/keep"]);
    });
    f.delete_remote("feature/keep");
    let id = identity_of(&f).await;
    let mut config = f.config();
    config.locks.push(Lock { identity: id, branch: None });
    let found = mcbranchface_lib::git::discovery::FoundRepo { path: f.work.clone(), root: String::new() };
    let opts = mcbranchface_lib::analysis::ScanOptions { fetch: true, ..Default::default() };
    let r = mcbranchface_lib::analysis::scan_repo(&found, &config, &f.store(), opts).await.result;
    let b = find(&r, "feature/keep");
    assert!(b.locked, "a repository lock covers every branch");
    assert_eq!(b.verdict, Verdict::Safe, "the verdict stays; the lock only prevents deletion");

    let journal = f.journal();
    let store = f.store();
    let env = Env { config: &config, snapshots: &store, journal: &journal, cached_prs: None };
    let req = DeleteRequest {
        repo_path: f.work.to_string_lossy().into(),
        branch: b.name.clone(),
        expected_sha: b.sha.clone(),
        force: true,
        drop_stashes: vec![],
        remove_worktree: false,
    };
    let e = mcbranchface_lib::delete::delete(&env, &req).await.unwrap_err();
    assert_eq!(e.kind, FailureKind::Locked);
    assert_eq!(git(&f.work, &["branch", "--list", "feature/keep", "--format=%(refname:short)"]), "feature/keep");
}

#[tokio::test]
async fn bulk_delete_goes_to_the_server_once_and_reports_each_branch() {
    let f = server_with_branches();
    // The update hook runs per ref: exactly one branch is refused, the others go.
    let origin = f.work.parent().unwrap().join("origin.git");
    std::fs::write(
        origin.join("hooks").join("update"),
        "#!/bin/sh\nif [ \"$1\" = \"refs/heads/done/ff\" ]; then echo protected >&2; exit 1; fi\nexit 0\n",
    )
    .unwrap();
    let c = Ctx::new(&f, f.config());
    let list = assess(&f, &c.config).await;
    let reqs: Vec<RemoteDeleteRequest> = ["done/ff", "done/squash", "wip/old"]
        .iter()
        .map(|n| {
            let b = by(&list, n);
            RemoteDeleteRequest {
                repo_path: f.work.to_string_lossy().into(),
                remote: b.remote.clone(),
                branch: b.name.clone(),
                expected_sha: b.sha.clone(),
                force: false,
            }
        })
        .collect();
    let env = Env { config: &c.config, snapshots: &c.store, journal: &c.journal, cached_prs: None };
    let results = delete_online::delete_many(&env, &reqs, &Default::default()).await;

    assert_eq!(results.iter().map(|r| r.branch.as_str()).collect::<Vec<_>>(), ["done/ff", "done/squash", "wip/old"], "request order");
    assert_eq!(results[0].failure.as_ref().map(|f| f.kind), Some(FailureKind::Rejected), "hook refused it");
    assert!(results[1].outcome.is_some(), "merged branch deleted");
    assert_eq!(results[2].failure.as_ref().map(|f| f.kind), Some(FailureKind::NoLongerSafe), "unmerged without force");
    assert!(!on_origin(&f, "done/ff").is_empty());
    assert!(on_origin(&f, "done/squash").is_empty());
    assert!(!on_origin(&f, "wip/old").is_empty());
    let backups = git(&f.work, &["for-each-ref", "--format=%(refname)", "refs/mcbranchface"]);
    assert_eq!(backups.lines().count(), 1, "only the deleted branch keeps a backup ref: {backups}");
    assert_eq!(c.journal.load().unwrap().len(), 1);
}

#[tokio::test]
async fn backup_refs_without_journal_entry_are_listed_again() {
    let f = server_with_branches();
    let c = Ctx::new(&f, f.config());
    let list = assess(&f, &c.config).await;
    let out = c.delete(&f, by(&list, "done/squash"), false).await.expect("delete");
    // Simulate a journal write that failed after the push.
    std::fs::remove_file(f.data.join("deleted.jsonl")).unwrap();
    let repo = f.work.to_string_lossy().to_string();
    assert_eq!(actions::adopt_orphans(&c.journal, std::slice::from_ref(&repo)).await.unwrap(), 1);
    let entries = c.journal.load().unwrap();
    assert_eq!(entries.len(), 1);
    assert_eq!(entries[0].branch, "done/squash");
    assert_eq!(entries[0].remote.as_deref(), Some("origin"));
    assert_eq!(entries[0].backup_ref, out.entry.backup_ref);
    assert_eq!(actions::adopt_orphans(&c.journal, &[repo]).await.unwrap(), 0, "adopted only once");
    actions::restore(&c.journal, &entries[0].id).await.expect("restorable again");
    assert!(!on_origin(&f, "done/squash").is_empty());
}

#[tokio::test]
async fn repositories_without_remote_never_share_an_identity() {
    let f = Fixture::new();
    let base = f.work.parent().unwrap();
    // A copied folder has the same root commit, but it is not the same repository.
    let a = base.join("plain-a");
    let b = base.join("plain-b");
    for d in [&a, &b] {
        std::fs::create_dir_all(d).unwrap();
    }
    git(&a, &["init", "-q", "-b", "main"]);
    commit(&a, "x.txt", "x\n", "root");
    git(base, &["clone", "-q", "--no-hardlinks", a.to_str().unwrap(), "plain-b"]).to_string();
    git(&b, &["remote", "remove", "origin"]);
    let id = |p: &std::path::Path| {
        let g = Git::new(p);
        async move { identity::repo_identity(&g, identity::origin_url(&g).await.as_deref()).await }
    };
    let (ia, ib) = (id(&a).await, id(&b).await);
    assert!(ia.starts_with("root:"), "{ia}");
    assert_ne!(ia, ib);
}

#[tokio::test]
async fn server_check_sees_changes_without_fetching() {
    let f = Fixture::new();
    f.pushed_branch("feature/a", 1);
    git(&f.work, &["fetch", "-q", "--prune"]);
    let path = f.work.to_string_lossy().to_string();
    let r = mcbranchface_lib::server_check::check(&path).await;
    assert!(!r.changed && r.error_kind.is_none(), "{r:?}");

    // A colleague pushes a new branch: the check notices, and fetched nothing itself.
    git(&f.server, &["fetch", "-q"]);
    git(&f.server, &["switch", "-q", "-c", "feature/b", "origin/main"]);
    commit(&f.server, "b.txt", "b\n", "b");
    git(&f.server, &["push", "-q", "origin", "feature/b"]);
    assert!(mcbranchface_lib::server_check::check(&path).await.changed);
    assert!(git(&f.work, &["branch", "-r", "--list", "origin/feature/b"]).is_empty(), "no fetch happened");

    git(&f.work, &["fetch", "-q", "--prune"]);
    assert!(!mcbranchface_lib::server_check::check(&path).await.changed, "after the fetch it is in sync again");
    f.delete_remote("feature/a");
    assert!(mcbranchface_lib::server_check::check(&path).await.changed, "a deletion is a change");

    git(&f.work, &["remote", "set-url", "origin", "C:/does-not-exist/x.git"]);
    let broken = mcbranchface_lib::server_check::check(&path).await;
    assert!(!broken.changed);
    assert!(broken.error_kind.is_some());
}
