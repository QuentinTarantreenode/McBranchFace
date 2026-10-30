mod common;

use common::*;
use mcbranchface_lib::actions;
use mcbranchface_lib::actions::Env;
use mcbranchface_lib::delete;
use mcbranchface_lib::model::*;


/// One repository with every scenario; the scan runs once like it does in the app.
async fn full_fixture() -> (Fixture, RepoResult) {
    let f = Fixture::new();

    f.pushed_branch("feat/merge", 1);
    f.pushed_branch("feat/squash", 2);
    f.pushed_branch("feat/rebase", 2);
    f.pushed_branch("feat/abandoned", 1);
    f.pushed_branch("feat/unpushed", 1);
    f.pushed_branch("feat/current", 1);
    f.pushed_branch("feat/wt", 1);
    f.pushed_branch("feat/stash", 1);
    f.pushed_branch("release/1", 1);
    f.pushed_branch("feat/alive", 1);
    f.pushed_branch("feat/ahead", 1);

    f.on_server(|s| {
        git(s, &["merge", "-q", "--no-ff", "origin/feat/merge", "-m", "Merge PR merge"]);
        git(s, &["merge", "-q", "--squash", "origin/feat/squash"]);
        git(s, &["commit", "-q", "-m", "Squashed PR squash"]);
        commit(s, "other.txt", "moves main forward\n", "unrelated");
        let range = "main..origin/feat/rebase";
        let revs = git(s, &["rev-list", "--reverse", range]);
        for r in revs.lines() {
            git(s, &["cherry-pick", r]);
        }
        for b in ["feat/current", "feat/wt", "feat/stash"] {
            git(s, &["merge", "-q", "--no-ff", &format!("origin/{b}"), "-m", &format!("Merge PR {b}")]);
        }
    });
    for b in [
        "feat/merge", "feat/squash", "feat/rebase", "feat/abandoned", "feat/unpushed",
        "feat/current", "feat/wt", "feat/stash", "release/1",
    ] {
        f.delete_remote(b);
    }

    // Local state that must keep branches from being "safe".
    git(&f.work, &["switch", "-q", "feat/unpushed"]);
    commit(&f.work, "late.txt", "never pushed\n", "local only");

    // Branches the server still has, or never had.
    git(&f.work, &["switch", "-q", "feat/ahead"]);
    commit(&f.work, "ahead.txt", "not pushed yet\n", "ahead of the server");
    git(&f.work, &["switch", "-q", "--no-track", "-c", "local/never", "origin/main"]);
    commit(&f.work, "never.txt", "only here\n", "never pushed");
    git(&f.work, &["branch", "-q", "--track", "local/from-main", "origin/main"]);

    git(&f.work, &["switch", "-q", "feat/stash"]);
    std::fs::write(f.work.join("feat_stash-0.txt"), "wip\n").unwrap();
    git(&f.work, &["stash", "push", "-q"]);

    let wt = f.work.parent().unwrap().join("linked-wt");
    git(&f.work, &["worktree", "add", "-q", wt.to_str().unwrap(), "feat/wt"]);

    git(&f.work, &["switch", "-q", "feat/current"]);
    std::fs::write(f.work.join("feat_current-0.txt"), "dirty\n").unwrap();

    let r = f.scan(true).await;
    (f, r)
}

#[tokio::test]
async fn classifies_every_scenario() {
    let (f, r) = full_fixture().await;
    assert!(r.fetched, "fetch: {:?}", r.fetch_error);
    assert_eq!(r.repo.default_branch.as_deref(), Some("origin/main"));

    let merge = find(&r, "feat/merge");
    assert_eq!(merge.verdict, Verdict::Safe);
    assert_eq!(merge.merge_evidence.as_ref().unwrap().kind, MergeKind::Ancestor);
    assert!(merge.is_mine);

    let squash = find(&r, "feat/squash");
    assert_eq!(squash.verdict, Verdict::Safe, "{:#?}", squash.checks);
    assert_eq!(squash.merge_evidence.as_ref().unwrap().kind, MergeKind::Squash);

    let rebase = find(&r, "feat/rebase");
    assert_eq!(rebase.verdict, Verdict::Safe, "{:#?}", rebase.checks);
    assert_eq!(rebase.merge_evidence.as_ref().unwrap().kind, MergeKind::PatchEquivalent);

    let abandoned = find(&r, "feat/abandoned");
    assert_eq!(abandoned.verdict, Verdict::Review);
    assert_eq!(abandoned.unpushed_commit_count, 0);
    assert_eq!(abandoned.push_state.as_ref().unwrap().source, PushSource::Snapshot);

    let unpushed = find(&r, "feat/unpushed");
    assert_eq!(unpushed.verdict, Verdict::Unsafe);
    assert_eq!(unpushed.unpushed_commit_count, 1);
    let git = mcbranchface_lib::git::runner::Git::new(&f.work);
    let lists = mcbranchface_lib::analysis::branch_commits(&git, &f.config(), &f.work.to_string_lossy(), unpushed).await.unwrap();
    assert_eq!(lists.unpushed.iter().map(|c| c.subject.as_str()).collect::<Vec<_>>(), ["local only"]);

    let current = find(&r, "feat/current");
    assert_eq!(current.verdict, Verdict::Unsafe);
    let w = current.worktree.as_ref().unwrap();
    assert!(w.is_main);
    assert_eq!(w.files.len(), 1);
    assert_eq!(w.files[0].kind, FileChangeKind::Unstaged);

    let wt = find(&r, "feat/wt");
    assert_eq!(wt.verdict, Verdict::Blocked);
    assert!(!wt.worktree.as_ref().unwrap().is_main);

    let stash = find(&r, "feat/stash");
    assert_eq!(stash.verdict, Verdict::Unsafe);
    assert_eq!(stash.stashes.len(), 1);

    assert!(r.branches.iter().all(|b| b.name != "release/1"), "protected branch listed");
    assert!(r.branches.iter().all(|b| b.name != "main"), "the default branch is the measure, not a candidate");
    assert_eq!(merge.upstream_state, UpstreamState::Gone);

    // Pushed is not merged: its own branch on the server is no proof the work is done, so it is
    // Review – deleting the local copy loses nothing, but it is not offered as stale.
    let alive = find(&r, "feat/alive");
    assert_eq!(alive.upstream_state, UpstreamState::Live);
    assert_eq!(alive.verdict, Verdict::Review, "{:#?}", alive.checks);
    assert!(alive.merge_evidence.is_none(), "{:?}", alive.merge_evidence);

    let ahead = find(&r, "feat/ahead");
    assert_eq!(ahead.upstream_state, UpstreamState::Live);
    assert_eq!(ahead.verdict, Verdict::Unsafe);
    assert_eq!(ahead.unpushed_commit_count, 1);

    let never = find(&r, "local/never");
    assert_eq!(never.upstream_state, UpstreamState::None);
    assert_eq!(never.verdict, Verdict::Unsafe, "{:#?}", never.checks);
    assert!(never.checks.iter().any(|c| matches!(c.code, CheckCode::NeverPushed { count: 1, merged: false })));

    // Tracking the integration line is no upstream of its own, and nothing of it exists only here.
    let from_main = find(&r, "local/from-main");
    assert_eq!(from_main.upstream_state, UpstreamState::None);
    assert_eq!(from_main.verdict, Verdict::Safe, "{:#?}", from_main.checks);
    assert!(from_main.pull_request.is_none());
}

#[tokio::test]
async fn prune_by_foreign_tool_leaves_push_state_unknown() {
    let f = Fixture::new();
    f.pushed_branch("feat/foreign", 1);
    f.delete_remote("feat/foreign");
    git(&f.work, &["fetch", "-q", "--prune"]);

    let r = f.scan(false).await;
    let b = find(&r, "feat/foreign");
    assert_eq!(b.verdict, Verdict::Review);
    assert!(b.push_state.is_none());
    let pushed = b.checks.iter().find(|c| c.kind == CheckKind::Pushed).unwrap();
    assert_eq!(pushed.outcome, CheckOutcome::Warn);
}

#[tokio::test]
async fn stash_on_base_branch_is_not_attributed_to_feature() {
    let f = Fixture::new();
    f.pushed_branch("rel/1", 1);
    git(&f.work, &["switch", "-q", "rel/1"]);
    std::fs::write(f.work.join("rel_1-0.txt"), "wip on release\n").unwrap();
    git(&f.work, &["stash", "push", "-q"]);
    git(&f.work, &["switch", "-q", "-c", "feat/on-rel", "rel/1"]);
    commit(&f.work, "on-rel.txt", "x\n", "feature on release");
    git(&f.work, &["push", "-q", "-u", "origin", "feat/on-rel"]);
    git(&f.work, &["switch", "-q", "main"]);
    f.delete_remote("feat/on-rel");

    let r = f.scan(true).await;
    let b = find(&r, "feat/on-rel");
    assert!(b.stashes.is_empty(), "stash of rel/1 attributed: {:?}", b.stashes);
}

#[tokio::test]
async fn delete_restore_and_guards() {
    let (f, r) = full_fixture().await;
    let (config, store, journal) = (f.config(), f.store(), f.journal());
    let env = Env { config: &config, snapshots: &store, journal: &journal, cached_prs: None };
    let repo = f.work.to_string_lossy().to_string();
    let req = |name: &str, force: bool| DeleteRequest {
        repo_path: repo.clone(),
        branch: name.into(),
        expected_sha: find(&r, name).sha.clone(),
        force,
        drop_stashes: vec![],
        remove_worktree: false,
    };

    // Squash-merged: git's own -d refuses, the verified path falls back to -D.
    let out = delete::delete(&env, &req("feat/squash", false)).await.unwrap();
    assert!(out.used_force_flag, "squash merge must need -D");
    assert!(out.warnings.is_empty());
    assert!(git(&f.work, &["branch", "--list", "feat/squash"]).is_empty());
    assert!(!git(&f.work, &["for-each-ref", &out.entry.backup_ref]).is_empty());

    let restored = actions::restore(&journal, &out.entry.id).await.unwrap();
    assert!(restored.restored_at.is_some());
    assert_eq!(git(&f.work, &["rev-parse", "feat/squash"]), out.entry.sha);
    assert_eq!(git(&f.work, &["config", "branch.feat/squash.merge"]), "refs/heads/feat/squash");

    // Still on the server but not merged: Review, so only a forced delete takes the local copy. The
    // server branch stays, and restore links it again.
    assert_eq!(delete::delete(&env, &req("feat/alive", false)).await.unwrap_err().kind, FailureKind::NoLongerSafe);
    let out = delete::delete(&env, &req("feat/alive", true)).await.unwrap();
    assert!(git(&f.work, &["branch", "--list", "feat/alive"]).is_empty());
    assert!(!git(&f.work, &["ls-remote", "--heads", "origin", "feat/alive"]).is_empty(), "the server branch is untouched");
    actions::restore(&journal, &out.entry.id).await.unwrap();
    assert_eq!(git(&f.work, &["rev-parse", "--abbrev-ref", "feat/alive@{upstream}"]), "origin/feat/alive");

    // A branch that was never pushed is not Safe: deleting it without force is refused.
    let e = delete::delete(&env, &req("local/never", false)).await.unwrap_err();
    assert_eq!(e.kind, FailureKind::NoLongerSafe);

    // Non-safe branches need force.
    let e = delete::delete(&env, &req("feat/abandoned", false)).await.unwrap_err();
    assert_eq!(e.kind, FailureKind::NoLongerSafe);

    // Moved since the scan.
    let mut moved = req("feat/merge", false);
    moved.expected_sha = "0000000000000000000000000000000000000000".into();
    assert_eq!(delete::delete(&env, &moved).await.unwrap_err().kind, FailureKind::Changed);

    // Current branch of the main worktree is never deleted, not even forced.
    assert_eq!(delete::delete(&env, &req("feat/current", true)).await.unwrap_err().kind, FailureKind::CurrentBranch);

    // Linked worktree requires explicit removal.
    assert_eq!(delete::delete(&env, &req("feat/wt", true)).await.unwrap_err().kind, FailureKind::WorktreeNotConfirmed);
    let mut with_wt = req("feat/wt", true);
    with_wt.remove_worktree = true;
    let out = delete::delete(&env, &with_wt).await.unwrap();
    assert!(out.entry.removed_worktree.is_some());

    // Force delete with stash drop, then restore brings both back.
    let stash_sha = find(&r, "feat/stash").stashes[0].sha.clone();
    let mut with_stash = req("feat/stash", true);
    with_stash.drop_stashes = vec![stash_sha.clone()];
    let out = delete::delete(&env, &with_stash).await.unwrap();
    assert!(git(&f.work, &["stash", "list"]).is_empty());
    actions::restore(&journal, &out.entry.id).await.unwrap();
    assert!(git(&f.work, &["stash", "list", "--format=%H"]).contains(&stash_sha));

    // Purge removes the backup ref.
    let out = delete::delete(&env, &req("feat/merge", false)).await.unwrap();
    assert_eq!(actions::purge(&journal, std::slice::from_ref(&out.entry.id)).await.unwrap(), 1);
    assert!(git(&f.work, &["for-each-ref", &out.entry.backup_ref]).is_empty());
}
