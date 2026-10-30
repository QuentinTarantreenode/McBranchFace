mod common;

use common::*;
use mcbranchface_lib::git::runner::Git;
use mcbranchface_lib::gitops::{diff, history, status};
use mcbranchface_lib::model::*;

#[tokio::test]
async fn log_of_a_range_stays_in_the_range_and_refuses_options_as_revisions() {
    let f = Fixture::new();
    f.pushed_branch("feat/r", 2);
    let g = Git::new(&f.work);
    let range = history::log(&g, "main..feat/r", 0, 50, None).await.unwrap();
    assert_eq!(range.iter().map(|e| e.subject.as_str()).collect::<Vec<_>>(), ["feat/r commit 1", "feat/r commit 0"]);
    // A SHA outside the range is not a hit inside it.
    let base = git(&f.work, &["rev-parse", "main"]);
    assert!(history::log(&g, "main..feat/r", 0, 50, Some(&base[..8])).await.unwrap().is_empty());
    assert_eq!(history::log(&g, "feat/r", 0, 50, Some(&base[..8])).await.unwrap().len(), 1, "on a single ref it is found");
    // Something that git would read as an option is never a revision.
    for bad in ["--output=x.txt", "-p", ""] {
        assert!(history::log(&g, bad, 0, 50, None).await.is_err(), "{bad:?}");
    }
    assert!(!f.work.join("x.txt").exists());
}

#[tokio::test]
async fn pr_commits_come_from_the_local_repository_when_both_ends_are_here() {
    let f = Fixture::new();
    f.pushed_branch("feat/pr", 3);
    let g = Git::new(&f.work);
    let pr = |target: Option<String>, source: Option<String>| PullRequestInfo {
        id: 1,
        title: "t".into(),
        state: PrState::Merged,
        url: String::new(),
        author: String::new(),
        author_name: None,
        source_ref: "refs/heads/feat/pr".into(),
        target_ref: "refs/heads/main".into(),
        source_sha: source,
        created_at: None,
        closed_at: None,
        target_sha: target,
        reviewers: Vec::new(),
        is_draft: false,
        has_conflicts: false,
    };
    let (main, tip) = (git(&f.work, &["rev-parse", "main"]), git(&f.work, &["rev-parse", "feat/pr"]));
    let local = history::pr_commits_local(&g, &pr(Some(main.clone()), Some(tip))).await.unwrap().unwrap();
    assert_eq!(local.iter().map(|c| c.subject.as_str()).collect::<Vec<_>>(), ["feat/pr commit 2", "feat/pr commit 1", "feat/pr commit 0"]);
    // A missing end means: ask the provider.
    assert!(history::pr_commits_local(&g, &pr(Some(main), Some("f".repeat(40)))).await.unwrap().is_none());
    assert!(history::pr_commits_local(&g, &pr(None, None)).await.unwrap().is_none());
}

#[tokio::test]
async fn status_log_detail_branches_and_diffs() {
    let f = Fixture::new();
    f.pushed_branch("feat/r", 2);
    git(&f.work, &["switch", "-q", "feat/r"]);
    std::fs::write(f.work.join("readme.txt"), "base\nchanged line\n").unwrap();
    std::fs::write(f.work.join("new file.txt"), "hello\nworld\n").unwrap();
    std::fs::write(f.work.join("staged.txt"), "s\n").unwrap();
    git(&f.work, &["add", "staged.txt"]);
    let g = Git::new(&f.work);

    let st = status::repo_status(&g).await.unwrap();
    assert_eq!(st.head.branch.as_deref(), Some("feat/r"));
    assert_eq!(st.head.upstream.as_deref(), Some("origin/feat/r"));
    let by = |p: &str| st.entries.iter().find(|e| e.path == p).unwrap();
    assert_eq!(by("readme.txt").unstaged, Some(ChangeType::Modified));
    assert_eq!(by("staged.txt").staged, Some(ChangeType::Added));
    assert!(by("new file.txt").untracked);
    assert_eq!(st.worktrees.len(), 1);
    assert_eq!(st.stashes, 0);
    std::fs::write(f.work.join("stash me.txt"), "wip\n").unwrap();
    git(&f.work, &["stash", "push", "-q", "--include-untracked", "-m", "wip"]);
    assert_eq!(status::repo_status(&g).await.unwrap().stashes, 1, "the stash entry counts");
    git(&f.work, &["stash", "pop", "-q"]);
    std::fs::remove_file(f.work.join("stash me.txt")).unwrap();

    let log = history::log(&g, "HEAD", 0, 50, None).await.unwrap();
    assert_eq!(log.len(), 3);
    assert_eq!(log[0].subject, "feat/r commit 1");
    assert!(log[0].refs.iter().any(|r| r == "feat/r"));
    let page2 = history::log(&g, "HEAD", 2, 50, None).await.unwrap();
    assert_eq!(page2.len(), 1, "paging skips");
    let found = history::log(&g, "HEAD", 0, 50, Some("COMMIT 1")).await.unwrap();
    assert_eq!(found.iter().map(|e| e.subject.as_str()).collect::<Vec<_>>(), ["feat/r commit 1"], "subject, case-insensitive");
    let by_sha = history::log(&g, "HEAD", 0, 50, Some(&log[2].sha[..7])).await.unwrap();
    assert_eq!(by_sha.len(), 1, "SHA prefix");
    assert_eq!(history::log(&g, "HEAD", 0, 50, Some("dev@example")).await.unwrap().len(), 3, "author e-mail");
    // No depth limit: the oldest commit is found, and paging applies to the hits.
    let oldest = history::log(&g, "HEAD", 0, 1, Some("initial")).await.unwrap();
    assert_eq!(oldest.iter().map(|e| e.subject.as_str()).collect::<Vec<_>>(), ["initial"]);
    let second = history::log(&g, "HEAD", 1, 1, Some("commit")).await.unwrap();
    assert_eq!(second.len(), 1, "second hit on its own page");
    assert_eq!(history::log(&g, "HEAD", 0, 50, Some("a.b*")).await.unwrap().len(), 0, "the text is literal, not a pattern");

    let detail = history::commit_detail(&g, &log[0].sha).await.unwrap();
    assert_eq!(detail.files.len(), 1);
    assert_eq!(detail.files[0].change, ChangeType::Added);
    let root = history::commit_detail(&g, &log[2].sha).await.unwrap();
    assert_eq!(root.files[0].path, "readme.txt", "root commit lists its files");

    let branches = history::branches(&g, |e| e == EMAIL).await.unwrap();
    assert!(branches.local.iter().any(|b| b.name == "feat/r" && b.is_head && b.is_mine));
    assert!(branches.remote.iter().any(|b| b.name == "origin/feat/r"));

    let unstaged = diff::working_diff(&g, "readme.txt", DiffSource::Unstaged, &DiffOptions::default(), None).await.unwrap();
    assert_eq!((unstaged.added, unstaged.removed), (1, 0));
    let staged = diff::working_diff(&g, "staged.txt", DiffSource::Staged, &DiffOptions::default(), None).await.unwrap();
    assert_eq!(staged.added, 1);
    let untracked = diff::working_diff(&g, "new file.txt", DiffSource::Untracked, &DiffOptions::default(), None).await.unwrap();
    assert_eq!(untracked.added, 2, "untracked diff via --no-index /dev/null: {untracked:?}");
    let in_commit = diff::commit_diff(&g, &log[0].sha, "feat_r-1.txt", &DiffOptions::default(), None).await.unwrap();
    assert_eq!(in_commit.added, 1);
}

#[tokio::test]
async fn branch_list_marks_own_branches_by_the_tip_author_email() {
    let f = Fixture::new();
    f.pushed_branch("feat/mine", 1);
    git(&f.work, &["switch", "-q", "-c", "feat/theirs", "main"]);
    std::fs::write(f.work.join("t.txt"), "t\n").unwrap();
    git(&f.work, &["add", "t.txt"]);
    git(&f.work, &["commit", "-q", "-m", "theirs", "--author", "Other <other@example.com>"]);
    git(&f.work, &["switch", "-q", "main"]);
    let list = history::branches(&Git::new(&f.work), |e| e.eq_ignore_ascii_case(EMAIL)).await.unwrap();
    let mine = |name: &str| list.local.iter().chain(&list.remote).find(|b| b.name == name).unwrap().is_mine;
    assert!(mine("feat/mine") && mine("origin/feat/mine"));
    assert!(!mine("feat/theirs"), "the tip author decides, not who created the branch");
    let theirs = list.local.iter().find(|b| b.name == "feat/theirs").unwrap();
    assert_eq!((theirs.author.as_str(), theirs.subject.as_str()), ("Other", "theirs"), "fields after the e-mail stay in place");
}

#[tokio::test]
async fn commit_detail_and_diff_refuse_options_in_place_of_a_sha() {
    let f = Fixture::new();
    let g = Git::new(&f.work);
    let head = git(&f.work, &["rev-parse", "HEAD"]);
    assert!(history::commit_detail(&g, &head).await.is_ok());
    for bad in ["--output=detail.txt", "-p", ""] {
        assert!(history::commit_detail(&g, bad).await.is_err(), "{bad:?}");
        assert!(diff::commit_diff(&g, bad, "readme.txt", &DiffOptions::default(), None).await.is_err(), "{bad:?}");
    }
    assert!(!f.work.join("detail.txt").exists());
}

#[tokio::test]
async fn merge_evidence_of_one_clone_is_not_taken_for_another() {
    use mcbranchface_lib::git::merged;
    let f = Fixture::new();
    // The same commit in two clones: merged into main in the work clone only.
    git(&f.work, &["switch", "-q", "-c", "feat/shared"]);
    commit(&f.work, "shared.txt", "s\n", "shared");
    git(&f.work, &["push", "-q", "origin", "feat/shared"]);
    let sha = git(&f.work, &["rev-parse", "HEAD"]);
    git(&f.work, &["switch", "-q", "main"]);
    git(&f.work, &["merge", "-q", "--ff-only", "feat/shared"]);
    git(&f.server, &["fetch", "-q"]);

    let work = Git::new(&f.work);
    let server = Git::new(&f.server);
    assert!(merged::merged_into(&work, &sha, "main", None, None).await.unwrap().is_some());
    assert!(merged::merged_into(&server, &sha, "main", None, None).await.unwrap().is_none(), "the other clone's main does not have it");
}

#[tokio::test]
async fn a_sha_search_in_a_symmetric_range_finds_both_sides_but_not_the_shared_base() {
    let f = Fixture::new();
    let base = git(&f.work, &["rev-parse", "HEAD"]);
    git(&f.work, &["switch", "-q", "-c", "side"]);
    commit(&f.work, "side.txt", "s\n", "on side");
    let side = git(&f.work, &["rev-parse", "HEAD"]);
    git(&f.work, &["switch", "-q", "main"]);
    commit(&f.work, "main.txt", "m\n", "on main");
    let main = git(&f.work, &["rev-parse", "HEAD"]);
    let g = Git::new(&f.work);
    let found = |sha: String| {
        let g = &g;
        async move { history::log(g, "main...side", 0, 50, Some(&sha[..10])).await.unwrap().len() }
    };
    assert_eq!(found(main).await, 1, "left side of main...side");
    assert_eq!(found(side).await, 1, "right side");
    assert_eq!(found(base).await, 0, "reachable from both: not in the range");
}

#[tokio::test]
async fn a_renamed_file_diffs_against_its_old_path_not_as_a_new_file() {
    let f = Fixture::new();
    let body: String = (1..=20).map(|i| format!("line {i}\n")).collect();
    commit(&f.work, "old.txt", &body, "twenty lines");
    git(&f.work, &["mv", "old.txt", "new.txt"]);
    std::fs::write(f.work.join("new.txt"), body.replace("line 7\n", "line seven\n")).unwrap();
    git(&f.work, &["add", "new.txt"]);
    let g = Git::new(&f.work);
    let staged = diff::working_diff(&g, "new.txt", DiffSource::Staged, &DiffOptions::default(), Some("old.txt")).await.unwrap();
    assert_eq!((staged.added, staged.removed), (1, 1), "one changed line, not twenty new ones");
    assert_eq!(staged.old_path.as_deref(), Some("old.txt"), "the header names where it came from");
    assert!(staged.similarity.is_some_and(|s| s > 80));
    let without = diff::working_diff(&g, "new.txt", DiffSource::Staged, &DiffOptions::default(), None).await.unwrap();
    assert_eq!(without.added, 20, "limited to the new path, git sees an added file");
    git(&f.work, &["commit", "-q", "-m", "rename"]);
    let head = git(&f.work, &["rev-parse", "HEAD"]);
    let shown = diff::commit_diff(&g, &head, "new.txt", &DiffOptions::default(), Some("old.txt")).await.unwrap();
    assert_eq!((shown.added, shown.removed), (1, 1));
}

#[tokio::test]
async fn a_fix_is_found_on_every_branch_that_has_it_its_cherry_pick_included() {
    let f = Fixture::new();
    f.pushed_branch("feat/fix", 1);
    git(&f.work, &["switch", "-q", "feat/fix"]);
    commit(&f.work, "report.txt", "fixed\n", "Fix the report totals");
    let fix = git(&f.work, &["rev-parse", "HEAD"]);
    git(&f.work, &["switch", "-q", "main"]);
    git(&f.work, &["cherry-pick", fix.as_str()]);
    let picked = git(&f.work, &["rev-parse", "HEAD"]);
    let g = Git::new(&f.work);

    let (hits, capped) = history::find_everywhere(&g, "fix the REPORT", 30).await.unwrap();
    assert!(!capped);
    let on = |sha: &str| hits.iter().find(|h| h.commit.sha == sha).map(|h| (h.local.clone(), h.remote.clone())).unwrap();
    assert_eq!(hits.len(), 2, "the fix and its cherry-pick");
    assert_eq!(on(&fix), (vec!["feat/fix".to_string()], vec![]), "not pushed yet: only local");
    assert_eq!(on(&picked).0, vec!["main".to_string()]);

    let (by_sha, _) = history::find_everywhere(&g, &fix[..10], 30).await.unwrap();
    assert_eq!(by_sha.iter().map(|h| h.commit.sha.as_str()).collect::<Vec<_>>(), [fix.as_str()]);
    // A pushed commit is on the server too, and the remote HEAD alias is not listed.
    let (pushed, _) = history::find_everywhere(&g, "feat/fix commit 0", 30).await.unwrap();
    assert_eq!(pushed[0].remote, vec!["origin/feat/fix".to_string()]);
    assert!(history::find_everywhere(&g, "  ", 30).await.unwrap().0.is_empty());
    // Text that looks like an option is searched for, never passed on as one.
    assert!(history::find_everywhere(&g, "--output=x.txt", 30).await.unwrap().0.is_empty());
    assert!(!f.work.join("x.txt").exists());
}
