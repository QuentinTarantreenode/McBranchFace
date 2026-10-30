//! Local assessment beyond the common cases: pull requests, other remotes, missing pieces.
mod common;

use common::*;
use mcbranchface_lib::analysis::{self, ScanOptions};
use mcbranchface_lib::config::Config;
use mcbranchface_lib::git::discovery::FoundRepo;
use mcbranchface_lib::model::*;

fn pr(id: u32, branch: &str, target: &str, state: PrState, sha: Option<String>) -> PullRequestInfo {
    PullRequestInfo {
        id,
        title: format!("PR {id}"),
        state,
        url: "u".into(),
        author: "a".into(),
        author_name: None,
        source_ref: format!("refs/heads/{branch}"),
        target_ref: format!("refs/heads/{target}"),
        source_sha: sha,
        created_at: None,
        closed_at: None,
        target_sha: None,
        reviewers: Vec::new(),
        is_draft: false,
        has_conflicts: false,
    }
}

async fn scan_with(f: &Fixture, config: &Config, opts: ScanOptions) -> RepoResult {
    let found = FoundRepo { path: f.work.clone(), root: String::new() };
    analysis::scan_repo(&found, config, &f.store(), opts).await.result
}

/// A fork or mirror that is gone must not make every scan say "not fetched": the server is origin.
#[tokio::test]
async fn a_dead_second_remote_is_a_warning_and_origin_decides_whether_it_was_fetched() {
    let f = Fixture::new();
    let gone = f.work.parent().unwrap().join("no-such-mirror.git");
    git(&f.work, &["remote", "add", "mirror", gone.to_str().unwrap()]);
    let r = f.scan(true).await;
    assert!(r.fetched, "origin answered: {:?}", r.fetch_error);
    assert!(r.fetch_error.is_none());
    assert!(
        r.warnings.iter().any(|w| matches!(w, RepoWarning::OtherRemotesFailed { remotes, .. } if remotes == &["mirror".to_string()])),
        "{:?}",
        r.warnings
    );

    // Without origin the other remotes are all there is.
    git(&f.work, &["remote", "rename", "origin", "upstream"]);
    let r = f.scan(true).await;
    assert!(!r.fetched, "mirror is gone and nothing else answers");
}

#[tokio::test]
async fn pull_requests_give_evidence_and_the_best_one_is_shown() {
    let f = Fixture::new();
    f.pushed_branch("feature/pr", 1);
    f.pushed_branch("feature/rel", 1);
    let tip = git(&f.work, &["rev-parse", "feature/pr"]);
    // A release branch the second PR went into, which contains that branch.
    git(&f.work, &["branch", "release/1", "feature/rel"]);
    git(&f.work, &["push", "-q", "origin", "release/1"]);
    f.delete_remote("feature/pr");
    f.delete_remote("feature/rel");
    let prs = vec![
        pr(1, "feature/pr", "main", PrState::Closed, None),
        pr(2, "feature/pr", "main", PrState::Merged, Some("0000000000000000000000000000000000000000".into())),
        pr(3, "feature/pr", "main", PrState::Merged, Some(tip.clone())),
        pr(4, "feature/rel", "release/1", PrState::Merged, None),
    ];
    let opts = ScanOptions { fetch: true, providers: false, cached_prs: Some(prs), ..Default::default() };
    let r = scan_with(&f, &f.config(), opts).await;
    let b = find(&r, "feature/pr");
    assert_eq!(b.pull_request.as_ref().unwrap().id, 3, "the merged PR of exactly this tip");
    assert_eq!(b.merge_evidence.as_ref().unwrap().kind, MergeKind::PullRequest);
    assert_eq!(b.verdict, Verdict::Safe);
    let rel = find(&r, "feature/rel");
    assert!(rel.merge_evidence.as_ref().unwrap().target.ends_with("release/1"), "{:?}", rel.merge_evidence);
}

#[tokio::test]
async fn another_server_branch_that_holds_the_tip_counts_as_evidence_a_mirror_does_not() {
    let f = Fixture::new();
    f.pushed_branch("feature/fork", 1);
    let mirror = f.work.with_file_name("mirror.git");
    git(f.work.parent().unwrap(), &["init", "-q", "--bare", mirror.to_str().unwrap()]);
    git(&f.work, &["remote", "add", "mirror", mirror.to_str().unwrap()]);
    git(&f.work, &["push", "-q", "mirror", "feature/fork"]);
    f.delete_remote("feature/fork");
    let r = f.scan(true).await;
    assert!(find(&r, "feature/fork").merge_evidence.is_none(), "a mirror or fork took nothing in");

    // A release branch on the server that took the work in.
    git(&f.work, &["push", "-q", "origin", "feature/fork:refs/heads/release/9"]);
    let r = f.scan(true).await;
    let e = find(&r, "feature/fork").merge_evidence.clone().unwrap();
    assert_eq!(e.kind, MergeKind::ContainedInRemote);
    assert_eq!(e.target, "refs/remotes/origin/release/9");
    // Without a fetch of its own, shortly after one: the refs still stand for the server.
    assert!(find(&f.scan(false).await, "feature/fork").merge_evidence.is_some());
}

#[tokio::test]
async fn a_stale_remote_tracking_ref_is_no_merge_evidence() {
    let f = Fixture::new();
    f.pushed_branch("feature/stale", 1);
    let tip = git(&f.work, &["rev-parse", "feature/stale"]);
    // A server branch deleted long ago and never pruned here: the ref exists, the branch does not.
    git(&f.work, &["update-ref", "refs/remotes/origin/old-release", &tip]);
    let fetch_head = std::path::PathBuf::from(git(&f.work, &["rev-parse", "--path-format=absolute", "--git-path", "FETCH_HEAD"]));
    assert!(!fetch_head.exists(), "no fetch since the clone");
    let r = f.scan(false).await;
    let b = find(&r, "feature/stale");
    assert!(b.merge_evidence.is_none(), "{:?}", b.merge_evidence);
    assert_eq!(b.verdict, Verdict::Review);

    // A fetch long ago does not make the refs current either.
    std::fs::write(&fetch_head, "").unwrap();
    let f_old = std::fs::File::options().write(true).open(&fetch_head).unwrap();
    f_old.set_modified(std::time::SystemTime::now() - std::time::Duration::from_secs(3 * 24 * 3600)).unwrap();
    drop(f_old);
    assert!(find(&f.scan(false).await, "feature/stale").merge_evidence.is_none());
}

/// `count` commits on a new branch from main, written by one `git fast-import`: one process, not hundreds.
fn many_commits(dir: &std::path::Path, branch: &str, count: usize) {
    use std::io::Write;
    let base = git(dir, &["rev-parse", "main"]);
    let mut stream = String::new();
    for i in 0..count {
        let msg = format!("bulk {i}");
        stream.push_str(&format!("commit refs/heads/{branch}\ncommitter Dev <{EMAIL}> 1700000000 +0000\ndata {}\n{msg}\n", msg.len()));
        if i == 0 {
            stream.push_str(&format!("from {base}\n"));
        }
        let content = format!("{i}\n");
        stream.push_str(&format!("M 100644 inline bulk.txt\ndata {}\n{content}\n", content.len()));
    }
    let mut child = std::process::Command::new("git").args(["fast-import", "--quiet"]).current_dir(dir).stdin(std::process::Stdio::piped()).spawn().unwrap();
    child.stdin.take().unwrap().write_all(stream.as_bytes()).unwrap();
    assert!(child.wait().unwrap().success());
}

#[tokio::test]
async fn own_commits_are_listed_up_to_the_cap_and_counted_in_full() {
    let f = Fixture::new();
    many_commits(&f.work, "feature/long", 205);
    many_commits(&f.work, "feature/short", 3);
    let r = f.scan(false).await;
    let git_dir = mcbranchface_lib::git::runner::Git::new(&f.work);
    let (config, key) = (f.config(), f.work.to_string_lossy().to_string());
    let lists = |b| analysis::branch_commits(&git_dir, &config, &key, b);
    let long = find(&r, "feature/long");
    assert_eq!((long.own_commit_count, long.unpushed_commit_count), (205, 205), "never pushed: all on no remote");
    let listed = lists(long).await.unwrap();
    assert_eq!((listed.own.len(), listed.unpushed.len()), (200, 200));
    let short = find(&r, "feature/short");
    assert_eq!(short.own_commit_count, 3);
    assert_eq!(lists(short).await.unwrap().own.len(), 3);
}

#[tokio::test]
async fn a_last_pushed_commit_that_is_not_here_leaves_the_push_state_open() {
    let f = Fixture::new();
    f.pushed_branch("feature/here", 1);
    git(&f.work, &["switch", "-q", "-c", "feature/elsewhere", "main"]);
    commit(&f.work, "e.txt", "e\n", "elsewhere");
    git(&f.work, &["switch", "-q", "main"]);
    // Its PR names a source commit this clone never saw.
    let missing = "1111111111111111111111111111111111111111";
    let opts = ScanOptions { cached_prs: Some(vec![pr(3, "feature/elsewhere", "main", PrState::Open, Some(missing.into()))]), ..Default::default() };
    let r = scan_with(&f, &f.config(), opts).await;
    let b = find(&r, "feature/elsewhere");
    assert!(b.checks.iter().any(|c| matches!(&c.code, CheckCode::PushStateMissing { sha, .. } if sha == missing)), "{:?}", b.checks);
    let here = find(&r, "feature/here");
    assert!(here.checks.iter().any(|c| matches!(c.code, CheckCode::AllPushed { .. })), "{:?}", here.checks);
}

#[tokio::test]
async fn a_server_branch_of_its_own_name_is_no_merge_evidence_without_an_upstream() {
    let f = Fixture::new();
    git(&f.work, &["switch", "-q", "-c", "feature/solo", "main"]);
    commit(&f.work, "solo.txt", "solo\n", "solo work");
    // Pushed, but without `-u`: the branch has no upstream, the server holds a copy of the same name.
    git(&f.work, &["push", "-q", "origin", "feature/solo"]);
    git(&f.work, &["switch", "-q", "main"]);
    let r = f.scan(true).await;
    let b = find(&r, "feature/solo");
    assert!(b.upstream.is_empty());
    assert!(b.merge_evidence.is_none(), "pushed is not merged: {:?}", b.merge_evidence);
    assert_eq!(b.verdict, Verdict::Review);
    assert!(b.checks.iter().any(|c| matches!(c.code, CheckCode::NeverPushed { count: 0, .. })), "its commits are on the server: {:?}", b.checks);
}

#[tokio::test]
async fn a_branch_that_failed_allows_no_takeover() {
    let f = Fixture::new();
    f.pushed_branch("feature/ok", 1);
    f.pushed_branch("feature/broken-wt", 1);
    let wt = f._tmp.path().join("wt-broken");
    git(&f.work, &["worktree", "add", "-q", wt.to_str().unwrap(), "feature/broken-wt"]);
    // The worktree folder is there, but git cannot read it: its branch fails, the others stand.
    std::fs::write(wt.join(".git"), format!("gitdir: {}", f._tmp.path().join("nowhere").display())).unwrap();
    let found = FoundRepo { path: f.work.clone(), root: String::new() };
    let scan = analysis::scan_repo(&found, &f.config(), &f.store(), ScanOptions::default()).await;
    assert!(scan.result.warnings.iter().any(|w| matches!(w, RepoWarning::BranchFailed { branch, .. } if branch == "feature/broken-wt")), "{:?}", scan.result.warnings);
    assert!(scan.result.branches.iter().any(|b| b.name == "feature/ok"));
    assert_eq!(scan.fingerprint, None, "a failure under load must not hide the branch until the inputs change");
}

#[tokio::test]
async fn a_takeover_shows_the_pull_requests_as_they_are_now() {
    let f = Fixture::new();
    f.pushed_branch("feature/titled", 1);
    let found = FoundRepo { path: f.work.clone(), root: String::new() };
    // Both scans on one clock: the day is part of the fingerprint.
    let now = clock();
    let with = |title: &str, draft: bool| {
        let mut p = pr(5, "feature/titled", "main", PrState::Open, None);
        p.title = title.into();
        p.is_draft = draft;
        ScanOptions { cached_prs: Some(vec![p]), ..at(now) }
    };
    let first = analysis::scan_repo(&found, &f.config(), &f.store(), with("Old title", true)).await;
    let opts = ScanOptions { previous: Some((first.fingerprint.unwrap(), first.result.clone())), ..with("New title", false) };
    let second = analysis::scan_repo(&found, &f.config(), &f.store(), opts).await;
    assert_eq!(second.fingerprint, first.fingerprint, "title and draft are display only: taken over");
    let b = find(&second.result, "feature/titled");
    let p = b.pull_request.as_ref().unwrap();
    assert_eq!((p.title.as_str(), p.is_draft), ("New title", false));
    assert!(b.checks.iter().any(|c| matches!(&c.code, CheckCode::Pr { title, .. } if title == "New title")), "{:?}", b.checks);
}

#[tokio::test]
async fn missing_repo_non_repo_folder_and_failing_fetch_are_reported() {
    let f = Fixture::new();
    let gone = FoundRepo { path: f.work.join("nowhere"), root: String::new() };
    let r = analysis::scan_repo(&gone, &f.config(), &f.store(), ScanOptions::default()).await.result;
    assert_eq!(r.error_kind, Some(FailureKind::RepoMissing));

    let plain = f.work.with_file_name("plain");
    std::fs::create_dir_all(&plain).unwrap();
    let r = analysis::scan_repo(&FoundRepo { path: plain, root: String::new() }, &f.config(), &f.store(), ScanOptions::default()).await.result;
    assert!(r.error.is_some());

    git(&f.work, &["remote", "set-url", "origin", f.work.join("no-server").to_str().unwrap()]);
    let r = scan_with(&f, &f.config(), ScanOptions { fetch: true, ..Default::default() }).await;
    assert!(!r.fetched);
    assert!(r.fetch_error.is_some() && r.fetch_error_kind.is_some());
}

#[tokio::test]
async fn without_a_default_branch_own_commits_are_those_on_no_remote() {
    let f = Fixture::new();
    f.pushed_branch("feature/n", 1);
    f.delete_remote("feature/n");
    // Newer git recreates origin/HEAD on fetch, so fetch first and remove it afterwards.
    git(&f.work, &["fetch", "-q", "--prune"]);
    git(&f.work, &["remote", "set-head", "origin", "-d"]);
    let key = f.work.to_string_lossy().to_string();
    let mut config = Config { default_branch_candidates: vec![], ..f.config() };
    // An override that points nowhere is ignored like a missing one.
    config.default_branch_overrides.insert(key.clone(), "origin/nope".into());
    let r = scan_with(&f, &config, ScanOptions::default()).await;
    assert!(r.warnings.iter().any(|w| matches!(w, RepoWarning::NoDefaultBranch)));
    assert!(r.repo.default_branch.is_none());
    assert_ne!(find(&r, "feature/n").verdict, Verdict::Safe);

    // An override that exists wins.
    config.default_branch_overrides.insert(key, "origin/main".into());
    let r = scan_with(&f, &config, ScanOptions::default()).await;
    assert_eq!(r.repo.default_branch.as_deref(), Some("origin/main"));
}

#[tokio::test]
async fn a_sibling_working_copy_fills_gaps_in_the_push_history() {
    let f = Fixture::new();
    f.pushed_branch("feature/sib", 1);
    // The sibling saw the server state; this copy never recorded one.
    let sibling = f.work.with_file_name("sibling");
    git(f.work.parent().unwrap(), &["clone", "-q", f.work.with_file_name("origin.git").to_str().unwrap(), sibling.to_str().unwrap()]);
    f.store().record(&mcbranchface_lib::git::runner::Git::new(&sibling)).await.unwrap();
    f.delete_remote("feature/sib");
    git(&f.work, &["fetch", "-q", "--prune"]);
    let r = scan_with(&f, &f.config(), ScanOptions { fetch: false, siblings: vec![sibling], ..Default::default() }).await;
    assert!(r.branches.iter().any(|b| b.name == "feature/sib"));
}

#[tokio::test]
async fn a_branch_whose_worktree_folder_was_deleted_stays_listed() {
    let f = Fixture::new();
    f.pushed_branch("feature/lost-wt", 1);
    let wt = f.work.parent().unwrap().join("wt-lost");
    git(&f.work, &["worktree", "add", "-q", &wt.to_string_lossy(), "feature/lost-wt"]);
    // Removed by hand or by an agent tool, without `git worktree remove`: git still lists it, prunable.
    std::fs::remove_dir_all(&wt).unwrap();
    let r = f.scan(false).await;
    let b = r.branches.iter().find(|b| b.name == "feature/lost-wt");
    let b = b.unwrap_or_else(|| panic!("missing: {:?}", r.warnings));
    // Nothing is left in a folder that is gone: the branch is no longer held by it.
    assert!(b.worktree.is_none());
    let (config, store, journal) = (f.config(), f.store(), f.journal());
    let env = mcbranchface_lib::actions::Env { config: &config, snapshots: &store, journal: &journal, cached_prs: None };
    let req = DeleteRequest {
        repo_path: f.work.to_string_lossy().into(),
        branch: b.name.clone(),
        expected_sha: b.sha.clone(),
        force: true,
        drop_stashes: vec![],
        remove_worktree: false,
    };
    mcbranchface_lib::delete::delete(&env, &req).await.unwrap();
    assert!(git(&f.work, &["branch", "--list", "feature/lost-wt"]).is_empty());
}

#[tokio::test]
async fn a_default_branch_override_applies_however_the_folder_is_spelled() {
    let f = Fixture::new();
    f.pushed_branch("release/x", 1);
    let mut config = f.config();
    let spelled = f.work.to_string_lossy().replace('\\', "/").to_uppercase() + "/";
    config.default_branch_overrides.insert(spelled, "origin/release/x".into());
    let git = mcbranchface_lib::git::runner::Git::new(&f.work);
    let key = f.work.to_string_lossy().to_string();
    let d = mcbranchface_lib::git::refs::default_branch(&git, &config, &key).await.unwrap();
    assert_eq!(d.as_deref(), Some("refs/remotes/origin/release/x"));
}

/// The clock the assessment counts with: fixed, so no result depends on when the test runs.
fn at(now: i64) -> ScanOptions {
    ScanOptions { now: Some(now), ..Default::default() }
}

fn clock() -> i64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_secs() as i64
}

#[tokio::test]
async fn unchanged_inputs_take_the_earlier_assessment_over_and_a_new_commit_does_not() {
    let f = Fixture::new();
    f.pushed_branch("feature/same", 1);
    // Fetched before: the remote-tracking refs stand for the server in every scan below.
    git(&f.work, &["fetch", "-q"]);
    let now = clock();
    let config = f.config();
    let found = FoundRepo { path: f.work.clone(), root: String::new() };
    let first = analysis::scan_repo(&found, &config, &f.store(), at(now)).await;
    assert!(first.fingerprint.is_some());

    // A marked earlier result: when it comes back, the branches were taken over, not assessed again.
    let mut earlier = first.result.clone();
    earlier.branches[0].name = "taken-over".into();
    let opts = ScanOptions { fetch: true, previous: Some((first.fingerprint.unwrap(), earlier.clone())), ..at(now) };
    let second = analysis::scan_repo(&found, &config, &f.store(), opts).await;
    assert_eq!(second.fingerprint, first.fingerprint, "a fetch that brings nothing changes nothing");
    assert_eq!(second.result.branches[0].name, "taken-over");
    assert!(second.result.fetched, "the fetch fields are the fresh ones");

    // Later the same day nothing the assessment reads has changed: the clock alone is no new input.
    let opts = ScanOptions { previous: Some((first.fingerprint.unwrap(), earlier.clone())), ..at(now + 3600) };
    assert_eq!(analysis::scan_repo(&found, &config, &f.store(), opts).await.result.branches[0].name, "taken-over");

    // An ignore that ran out is: taken over, the branch would stay ignored.
    let mut ignoring = config.clone();
    let identity = first.result.repo.identity.clone();
    ignoring.ignores.push(mcbranchface_lib::config::Ignore { identity, branch: "feature/same".into(), scope: Default::default(), until: Some(now + 60) });
    let before = analysis::scan_repo(&found, &ignoring, &f.store(), at(now)).await;
    assert!(before.result.branches[0].ignored);
    let opts = ScanOptions { previous: Some((before.fingerprint.unwrap(), before.result.clone())), ..at(now + 120) };
    assert!(!analysis::scan_repo(&found, &ignoring, &f.store(), opts).await.result.branches[0].ignored);

    // A commit on the branch is a new input: every branch is assessed again.
    git(&f.work, &["checkout", "-q", "feature/same"]);
    commit(&f.work, "more.txt", "x", "more");
    git(&f.work, &["checkout", "-q", "main"]);
    let opts = ScanOptions { previous: Some((first.fingerprint.unwrap(), earlier.clone())), ..at(now) };
    let third = analysis::scan_repo(&found, &config, &f.store(), opts).await;
    assert_ne!(third.fingerprint, first.fingerprint);
    assert!(third.result.branches.iter().all(|b| b.name != "taken-over"));

    // So is a changed setting, and a delete never takes anything over.
    let mut other = config.clone();
    other.protected_patterns.push("nothing/*".into());
    let opts = ScanOptions { previous: Some((third.fingerprint.unwrap(), earlier.clone())), ..at(now) };
    assert!(analysis::scan_repo(&found, &other, &f.store(), opts).await.result.branches.iter().all(|b| b.name != "taken-over"));
    let opts = ScanOptions { fresh: true, previous: Some((third.fingerprint.unwrap(), earlier)), ..at(now) };
    assert!(analysis::scan_repo(&found, &config, &f.store(), opts).await.result.branches.iter().all(|b| b.name != "taken-over"));
}

#[tokio::test]
async fn fetch_head_ages_over_12_hours_and_a_light_check_renews_the_refs() {
    let f = Fixture::new();
    f.pushed_branch("feature/taken", 1);
    // A release branch on the server took the work in; the feature branch itself is gone there.
    git(&f.work, &["push", "-q", "origin", "feature/taken:refs/heads/release/7"]);
    f.delete_remote("feature/taken");
    git(&f.work, &["fetch", "-q", "--prune"]);
    let now = clock();
    let hour = 3600;
    let found = FoundRepo { path: f.work.clone(), root: String::new() };
    let (config, store) = (f.config(), f.store());
    let scan = |opts: ScanOptions| analysis::scan_repo(&found, &config, &store, opts);
    let evidence = |r: &RepoResult| find(r, "feature/taken").merge_evidence.as_ref().map(|e| e.kind);

    let fresh = scan(at(now + 11 * hour)).await;
    assert_eq!(evidence(&fresh.result), Some(MergeKind::ContainedInRemote));
    assert_eq!(find(&fresh.result, "feature/taken").verdict, Verdict::Safe);

    // Half a day later, offline, the same refs may name branches deleted on the server long ago.
    let stale = scan(at(now + 13 * hour)).await;
    assert_eq!(evidence(&stale.result), None);
    assert_eq!(find(&stale.result, "feature/taken").verdict, Verdict::Review);

    // An earlier Safe from fresh refs is not taken over once they aged.
    let opts = ScanOptions { previous: Some((fresh.fingerprint.unwrap(), fresh.result.clone())), ..at(now + 13 * hour) };
    assert_eq!(evidence(&scan(opts).await.result), None);

    // A light check just found the server as the refs say: they are as good as a fetch, also for the
    // re-check before a delete, which knows nothing of the scan.
    analysis::note_remotes_verified(&f.work.to_string_lossy(), now + 13 * hour - 60);
    let checked = scan(at(now + 13 * hour)).await;
    assert_eq!(evidence(&checked.result), Some(MergeKind::ContainedInRemote));
    assert_ne!(checked.fingerprint, stale.fingerprint, "same refs, same day, but the refs no longer stand for the server");
    let recheck = ScanOptions { only_branch: Some("feature/taken".into()), fresh: true, ..at(now + 13 * hour) };
    assert_eq!(evidence(&scan(recheck).await.result), Some(MergeKind::ContainedInRemote));
}

/// A provider that always answers with the same failure.
struct Refusing(&'static str);

impl mcbranchface_lib::providers::Cli for Refusing {
    fn run<'a>(&'a self, _: mcbranchface_lib::providers::Tool, _: &'a [&'a str], _: std::time::Duration) -> mcbranchface_lib::providers::CliFuture<'a> {
        let out = mcbranchface_lib::process::ProcOutput { code: Some(1), stdout: String::new(), stderr: self.0.to_string() };
        Box::pin(async move { Ok(out) })
    }
}

#[tokio::test]
async fn a_failed_pull_request_query_falls_back_to_the_last_list_and_says_how_old_it_is() {
    let f = Fixture::new();
    f.pushed_branch("feature/via-pr", 1);
    let tip = git(&f.work, &["rev-parse", "feature/via-pr"]);
    f.delete_remote("feature/via-pr");
    let origin = mcbranchface_lib::git::identity::RepoOrigin { remote_url: Some("https://github.com/o/r".into()), identity: "github.com/o/r".into() };
    let opts = |fallback: Option<(Vec<PullRequestInfo>, i64)>| ScanOptions {
        fetch: true,
        providers: true,
        origin: Some(origin.clone()),
        cli: Some(std::sync::Arc::new(Refusing("HTTP 429: Too Many Requests"))),
        fallback_prs: fallback,
        ..Default::default()
    };
    let last = vec![pr(4, "feature/via-pr", "main", PrState::Merged, Some(tip))];
    let r = scan_with(&f, &f.config(), opts(Some((last, 1_700_000_000)))).await;
    let failed = r.warnings.iter().find_map(|w| match w {
        RepoWarning::PrQueryFailed { kind, fallback_at, .. } => Some((*kind, *fallback_at)),
        _ => None,
    });
    assert_eq!(failed, Some((ProviderFailure::RateLimited, Some(1_700_000_000))));
    let b = find(&r, "feature/via-pr");
    assert_eq!(b.merge_evidence.as_ref().map(|e| e.kind), Some(MergeKind::PullRequest), "the last list still holds the merged PR");
    assert_eq!(b.verdict, Verdict::Safe);

    // Without any earlier list the failure is said as well, and nothing pretends there are no PRs.
    let r = scan_with(&f, &f.config(), opts(None)).await;
    assert!(r.warnings.iter().any(|w| matches!(w, RepoWarning::PrQueryFailed { fallback_at: None, .. })));
    let b = find(&r, "feature/via-pr");
    assert!(b.checks.iter().all(|c| !matches!(c.code, CheckCode::NoPr { .. })), "no \"No PR found\" from a failed query: {:?}", b.checks);
}

#[tokio::test]
async fn after_a_restart_an_earlier_assessment_counts_only_while_the_worktree_files_are_unchanged() {
    let f = Fixture::new();
    f.pushed_branch("feature/wt", 1);
    let wt = f._tmp.path().join("wt");
    git(&f.work, &["worktree", "add", "-q", wt.to_str().unwrap(), "feature/wt"]);
    let config = f.config();
    let found = FoundRepo { path: f.work.clone(), root: String::new() };
    let now = clock();
    let first = analysis::scan_repo(&found, &config, &f.store(), at(now)).await;
    let mut earlier = first.result.clone();
    let i = earlier.branches.iter().position(|b| b.name == "feature/wt").expect("the branch is assessed");
    assert!(earlier.branches[i].worktree.is_some(), "it is checked out in the worktree");
    earlier.branches[i].last_commit_subject = "taken-over".into();
    let taken = |r: &mcbranchface_lib::model::RepoResult| r.branches.iter().any(|b| b.last_commit_subject == "taken-over");

    // How the app looks is not an input: another theme keeps the fingerprint.
    let mut themed = config.clone();
    themed.theme = mcbranchface_lib::config::Theme::Dark;
    let again = analysis::scan_repo(&found, &themed, &f.store(), at(now)).await;
    assert_eq!(again.fingerprint, first.fingerprint);

    // From before a restart, with the worktree as it was: taken over after its files were read again.
    let opts = ScanOptions { previous: Some((first.fingerprint.unwrap(), earlier.clone())), verify_files: true, ..at(now) };
    assert!(taken(&analysis::scan_repo(&found, &config, &f.store(), opts).await.result));

    // A file changed while no watcher looked: the refs are the same, the branch is assessed again.
    std::fs::write(wt.join("edited.txt"), "while the app was closed").unwrap();
    let opts = ScanOptions { previous: Some((first.fingerprint.unwrap(), earlier.clone())), verify_files: true, ..at(now) };
    assert!(!taken(&analysis::scan_repo(&found, &config, &f.store(), opts).await.result));
}

/// The lists the window asks for later hold the commits the assessment counted: after the push, of
/// its own, and on no remote for a branch never pushed.
#[tokio::test]
async fn the_commit_lists_asked_later_are_the_commits_the_assessment_counted() {
    let f = Fixture::new();
    f.pushed_branch("feature/ahead", 2);
    git(&f.work, &["switch", "-q", "feature/ahead"]);
    commit(&f.work, "after.txt", "after\n", "after the push");
    git(&f.work, &["switch", "-q", "-c", "local/only", "main"]);
    commit(&f.work, "only.txt", "only\n", "never pushed");
    git(&f.work, &["switch", "-q", "main"]);
    let r = f.scan(false).await;
    let git_dir = mcbranchface_lib::git::runner::Git::new(&f.work);
    let key = f.work.to_string_lossy().to_string();
    for (name, own, unpushed) in [("feature/ahead", 3, 1), ("local/only", 1, 1)] {
        let b = find(&r, name);
        assert_eq!((b.own_commit_count, b.unpushed_commit_count), (own, unpushed), "{name}: counted");
        let lists = analysis::branch_commits(&git_dir, &f.config(), &key, b).await.unwrap();
        assert_eq!(lists.sha, b.sha);
        assert_eq!((lists.own.len() as u32, lists.unpushed.len() as u32), (own, unpushed), "{name}: listed");
    }
    let ahead = analysis::branch_commits(&git_dir, &f.config(), &key, find(&r, "feature/ahead")).await.unwrap();
    assert_eq!(ahead.unpushed[0].subject, "after the push");
    assert_eq!(ahead.own.iter().map(|c| c.subject.as_str()).collect::<Vec<_>>(), ["after the push", "feature/ahead commit 1", "feature/ahead commit 0"], "newest first");
}
