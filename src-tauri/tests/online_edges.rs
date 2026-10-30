//! Server-branch assessment beyond the common cases: pull requests, no default branch, shared work.
mod common;

use common::*;
use mcbranchface_lib::config::Config;
use mcbranchface_lib::git::runner::Git;
use mcbranchface_lib::model::*;
use mcbranchface_lib::online::{self, Ctx, PrView};

fn pr(id: u32, branch: &str, state: PrState, sha: Option<String>) -> PullRequestInfo {
    PullRequestInfo {
        id,
        title: format!("PR {id}"),
        state,
        url: "u".into(),
        author: "a".into(),
        author_name: None,
        source_ref: format!("refs/heads/{branch}"),
        target_ref: "refs/heads/main".into(),
        source_sha: sha,
        created_at: None,
        closed_at: None,
        target_sha: None,
        reviewers: Vec::new(),
        is_draft: false,
        has_conflicts: false,
    }
}

fn by<'a>(list: &'a [RemoteBranchReport], name: &str) -> &'a RemoteBranchReport {
    list.iter().find(|b| b.name == name).unwrap_or_else(|| panic!("{name} missing"))
}

#[tokio::test]
async fn pull_requests_decide_merged_and_active() {
    let f = Fixture::new();
    f.pushed_branch("feature/done", 2);
    f.pushed_branch("feature/open", 1);
    f.pushed_branch("feature/partly", 2);
    git(&f.work, &["fetch", "-q"]);
    let done = git(&f.work, &["rev-parse", "origin/feature/done"]);
    let partly_old = git(&f.work, &["rev-parse", "origin/feature/partly~1"]);
    let prs = vec![
        pr(1, "feature/done", PrState::Merged, Some(done.clone())),
        pr(2, "feature/open", PrState::Closed, None),
        pr(3, "feature/open", PrState::Open, None),
        pr(4, "feature/partly", PrState::Merged, Some(partly_old)),
        pr(5, "feature/partly", PrState::Merged, Some("0000000000000000000000000000000000000000".into())),
    ];
    let list = online::scan(&f.work, &f.config(), "id", PrView::Known(&prs)).await.unwrap().branches;
    assert_eq!(by(&list, "feature/done").verdict, OnlineVerdict::Merged);
    assert_eq!(by(&list, "feature/done").merge_evidence.as_ref().unwrap().kind, MergeKind::PullRequest);
    let open = by(&list, "feature/open");
    assert_eq!(open.open_pr, Some(true));
    assert_eq!(open.pull_request.as_ref().unwrap().id, 3, "the open PR wins over a newer closed one");
    assert_ne!(by(&list, "feature/partly").verdict, OnlineVerdict::Merged, "an older PR state is no evidence");
}

#[tokio::test]
async fn without_a_default_branch_nothing_counts_as_merged() {
    let f = Fixture::new();
    f.pushed_branch("feature/x", 1);
    git(&f.work, &["fetch", "-q"]);
    let config = Config { default_branch_candidates: vec![], ..f.config() };
    let ctx = Ctx { git: Git::new(&f.work), config: &config, identity: "id", default: None, prs: PrView::NotApplicable, now: 0 };
    let list = online::assess(&ctx).await.unwrap().branches;
    let x = by(&list, "feature/x");
    assert!(!x.merged);
    assert_eq!(x.own_commit_count, 0);
}

#[tokio::test]
async fn a_branch_is_mine_when_i_committed_to_it_even_if_someone_else_did_last() {
    let f = Fixture::new();
    f.pushed_branch("feature/shared", 1);
    f.on_server(|_| {});
    git(&f.server, &["fetch", "-q"]);
    git(&f.server, &["switch", "-q", "-c", "feature/shared", "origin/feature/shared"]);
    commit(&f.server, "c.txt", "colleague", "colleague on top");
    git(&f.server, &["push", "-q", "origin", "feature/shared"]);
    git(&f.work, &["fetch", "-q"]);
    let config = f.config();
    let default = "refs/remotes/origin/main";
    let ctx = Ctx { git: Git::new(&f.work), config: &config, identity: "id", default: Some(default), prs: PrView::NotApplicable, now: 0 };
    let first = online::assess(&ctx).await.unwrap().branches;
    assert!(by(&first, "feature/shared").is_mine);
    // The answer per tip is cached and stays the same.
    let again = online::assess(&ctx).await.unwrap().branches;
    assert!(by(&again, "feature/shared").is_mine);
    let other = Config { my_emails: vec!["nobody@example.com".into()], ..f.config() };
    let ctx = Ctx { git: Git::new(&f.work), config: &other, identity: "id", default: Some(default), prs: PrView::NotApplicable, now: 0 };
    assert!(!by(&online::assess(&ctx).await.unwrap().branches, "feature/shared").is_mine);
}
