//! Pure assessment of a branch: facts in, verdict and checks out. No IO, so every rule is unit-tested.

use crate::model::*;

pub struct Facts<'a> {
    pub evidence: Option<&'a MergeEvidence>,
    pub default_branch: Option<&'a str>,
    pub own_commit_count: u32,
    pub upstream: &'a str,
    pub remote_ref: &'a str,
    pub push_state: Option<&'a PushState>,
    /// The last pushed commit exists locally, so `unpushed_count` is meaningful.
    pub push_commits_known: bool,
    /// No upstream of its own: `unpushed_count` then counts the commits that are on no remote at all.
    pub never_pushed: bool,
    /// The commits after the push.
    pub unpushed_count: u32,
    pub worktree: Option<&'a WorktreeState>,
    pub stashes: &'a [StashInfo],
    pub pull_request: Option<&'a PullRequestInfo>,
    pub prs_queried: bool,
}

/// Missing knowledge never leads to Safe: without merge evidence the best outcome is Review.
pub fn classify(f: &Facts) -> Verdict {
    let dirty = f.worktree.is_some_and(|w| !w.files.is_empty());
    let unpushed_unmerged = f.unpushed_count > 0 && f.evidence.is_none();
    if dirty || unpushed_unmerged || !f.stashes.is_empty() {
        Verdict::Unsafe
    } else if f.worktree.is_some() {
        Verdict::Blocked
    } else if f.evidence.is_some() {
        Verdict::Safe
    } else {
        Verdict::Review
    }
}

pub fn checks(f: &Facts) -> Vec<Check> {
    use CheckCode as C;
    use CheckKind as K;
    use CheckOutcome as O;
    let check = |kind, outcome, code| Check { kind, outcome, code };
    let merged = f.evidence.is_some();
    let soft = if merged { O::Info } else { O::Warn };
    let mut out = Vec::new();

    out.push(match (f.evidence, f.default_branch) {
        (Some(e), _) => check(K::Merged, O::Pass, C::Merged { kind: e.kind, target: e.target.clone() }),
        (None, None) => check(K::Merged, O::Warn, C::NoDefaultBranch),
        (None, Some(d)) => check(K::Merged, O::Warn, C::NoMergeEvidence { own: f.own_commit_count, base: d.to_string() }),
    });

    out.push(match f.push_state {
        _ if f.never_pushed => check(
            K::Pushed,
            if f.unpushed_count == 0 { O::Pass } else if merged { O::Info } else { O::Fail },
            C::NeverPushed { count: f.unpushed_count, merged },
        ),
        None => check(K::Pushed, soft, C::PushUnknown),
        Some(ps) if !f.push_commits_known => check(K::Pushed, soft, C::PushStateMissing { sha: ps.sha.clone(), source: ps.source }),
        Some(ps) if f.unpushed_count == 0 => {
            check(K::Pushed, O::Pass, C::AllPushed { upstream: f.upstream.to_string(), sha: ps.sha.clone(), source: ps.source })
        }
        Some(_) => check(
            K::Pushed,
            if merged { O::Info } else { O::Fail },
            C::CommitsAfterPush { count: f.unpushed_count, upstream: f.upstream.to_string(), merged },
        ),
    });

    out.push(match f.worktree {
        None => check(K::Worktree, O::Pass, C::NotCheckedOut),
        Some(w) if !w.files.is_empty() => check(K::Worktree, O::Fail, C::Dirty { count: w.files.len() as u32, path: w.path.clone() }),
        Some(w) if w.is_main => check(K::Worktree, O::Warn, C::CurrentBranch { path: w.path.clone() }),
        Some(w) => check(K::Worktree, O::Warn, C::LinkedWorktree { path: w.path.clone() }),
    });

    out.push(if f.stashes.is_empty() {
        check(K::Stashes, O::Pass, C::NoStashes)
    } else {
        check(K::Stashes, O::Fail, C::Stashes { count: f.stashes.len() as u32 })
    });

    if let Some(p) = f.pull_request {
        let outcome = if p.state == PrState::Merged { O::Pass } else { O::Warn };
        out.push(check(
            K::PullRequest,
            outcome,
            C::Pr { id: p.id, state: p.state, title: p.title.clone(), target: p.target_ref.clone() },
        ));
    } else if f.prs_queried {
        out.push(check(K::PullRequest, O::Info, C::NoPr { remote: f.remote_ref.to_string() }));
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn facts<'a>() -> Facts<'a> {
        Facts {
            evidence: None,
            default_branch: Some("refs/remotes/origin/main"),
            own_commit_count: 2,
            upstream: "refs/remotes/origin/feat",
            remote_ref: "refs/heads/feat",
            push_state: None,
            push_commits_known: false,
            never_pushed: false,
            unpushed_count: 0,
            worktree: None,
            stashes: &[],
            pull_request: None,
            prs_queried: false,
        }
    }

    #[test]
    fn commits_after_push_counts_all_of_them() {
        let ps = PushState { sha: "p".into(), source: PushSource::Snapshot };
        let f = Facts { push_state: Some(&ps), push_commits_known: true, unpushed_count: 250, ..facts() };
        let counted = checks(&f).into_iter().find_map(|c| match c.code {
            CheckCode::CommitsAfterPush { count, .. } => Some(count),
            _ => None,
        });
        assert_eq!(counted, Some(250));
    }

    #[test]
    fn verdict_rules() {
        let ev = MergeEvidence { kind: MergeKind::Squash, target: "refs/remotes/origin/main".into() };
        let dirty = WorktreeState {
            path: "/w".into(),
            is_main: true,
            files: vec![FileChange { path: "a".into(), kind: FileChangeKind::Unstaged }],
        };
        let clean_main = WorktreeState { path: "/w".into(), is_main: true, files: vec![] };
        let stash = [StashInfo { sha: "s".into(), selector: "stash@{0}".into(), message: "m".into() }];

        assert_eq!(classify(&facts()), Verdict::Review, "no evidence must not be safe");
        assert_eq!(classify(&Facts { evidence: Some(&ev), ..facts() }), Verdict::Safe);
        assert_eq!(classify(&Facts { unpushed_count: 1, ..facts() }), Verdict::Unsafe);
        assert_eq!(classify(&Facts { evidence: Some(&ev), unpushed_count: 1, ..facts() }), Verdict::Safe, "content already merged");
        assert_eq!(classify(&Facts { evidence: Some(&ev), worktree: Some(&dirty), ..facts() }), Verdict::Unsafe);
        assert_eq!(classify(&Facts { evidence: Some(&ev), worktree: Some(&clean_main), ..facts() }), Verdict::Blocked);
        assert_eq!(classify(&Facts { evidence: Some(&ev), stashes: &stash, ..facts() }), Verdict::Unsafe);
    }

    #[test]
    fn checks_carry_codes_and_outcomes() {
        let c = checks(&facts());
        assert!(matches!(c[0].code, CheckCode::NoMergeEvidence { own: 2, .. }));
        assert_eq!(c[1].outcome, CheckOutcome::Warn);
        assert!(matches!(c[1].code, CheckCode::PushUnknown));
        assert!(c.iter().all(|c| c.kind != CheckKind::PullRequest), "no PR check without a provider query");

        let with_query = checks(&Facts { prs_queried: true, ..facts() });
        assert!(matches!(with_query.last().unwrap().code, CheckCode::NoPr { .. }));

        let none = checks(&Facts { default_branch: None, ..facts() });
        assert!(matches!(none[0].code, CheckCode::NoDefaultBranch));
    }

    #[test]
    fn a_branch_never_pushed_is_unsafe_while_its_commits_are_on_no_remote() {
        let never = Facts { never_pushed: true, unpushed_count: 1, ..facts() };
        assert_eq!(classify(&never), Verdict::Unsafe);
        let c = checks(&never);
        assert!(matches!(c[1].code, CheckCode::NeverPushed { count: 1, merged: false }));
        assert_eq!(c[1].outcome, CheckOutcome::Fail);

        let ev = MergeEvidence { kind: MergeKind::Ancestor, target: "refs/remotes/origin/main".into() };
        let merged = Facts { evidence: Some(&ev), ..never };
        assert_eq!(classify(&merged), Verdict::Safe, "merged content is not lost");
        assert_eq!(checks(&merged)[1].outcome, CheckOutcome::Info);

        // Cut from the integration line without own commits: nothing exists only here.
        let empty = Facts { never_pushed: true, ..facts() };
        assert_eq!(checks(&empty)[1].outcome, CheckOutcome::Pass);
    }
}
