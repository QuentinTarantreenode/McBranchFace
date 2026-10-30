//! Branches on the server: which ones are merged or abandoned and could be deleted there.

use std::collections::{HashMap, HashSet};
use std::sync::{LazyLock, Mutex};

use anyhow::Result;
use futures::stream::{self, StreamExt};

use crate::config::Config;
use crate::git::runner::{fields, Git};
use crate::git::snapshot::now;
use crate::git::{merged, refs};
use crate::model::*;

const CONCURRENCY: usize = 4;
/// The overview may be a few hours behind for unmerged branches; the squash probe over hundreds of
/// server branches is the expensive part and the default branch moves many times a day.
const RECHECK_NEGATIVE: std::time::Duration = std::time::Duration::from_secs(6 * 3600);
pub const REMOTE: &str = "origin";

pub struct Ctx<'a> {
    pub git: Git,
    pub config: &'a Config,
    pub identity: &'a str,
    pub default: Option<&'a str>,
    pub prs: PrView<'a>,
    pub now: i64,
}

/// What is known of a repository's pull requests.
#[derive(Debug, Clone, Copy)]
pub enum PrView<'a> {
    /// No provider to ask (another host, or providers switched off): no pull request keeps a branch.
    NotApplicable,
    /// A provider exists, but its list is not here: the query failed or was not made yet.
    Unknown,
    Known(&'a [PullRequestInfo]),
}

impl<'a> PrView<'a> {
    pub fn of(provider: ProviderKind, use_providers: bool, list: Option<&'a [PullRequestInfo]>) -> Self {
        match list {
            Some(list) => PrView::Known(list),
            None if provider == ProviderKind::None || !use_providers => PrView::NotApplicable,
            None => PrView::Unknown,
        }
    }

    fn list(self) -> Option<&'a [PullRequestInfo]> {
        match self {
            PrView::Known(list) => Some(list),
            _ => None,
        }
    }
}

struct RawRemote {
    name: String,
    full: String,
    sha: String,
    committed_at: i64,
    author: String,
    subject: String,
}

/// Pure rule, so every case is unit-tested: an open PR keeps a branch alive (deleting it would close
/// the PR), then evidence, then age decides. Missing evidence never yields Merged, and pull requests
/// that are not known (`open_pr` None) never let age alone make a branch inactive: it may have an open one.
pub fn classify(merged: bool, open_pr: Option<bool>, age_secs: i64, stale_days: u32) -> OnlineVerdict {
    match (open_pr, merged) {
        (Some(true), _) => OnlineVerdict::Active,
        (_, true) => OnlineVerdict::Merged,
        (None, false) => OnlineVerdict::Active,
        (Some(false), false) if age_secs > i64::from(stale_days) * 86_400 => OnlineVerdict::Inactive,
        (Some(false), false) => OnlineVerdict::Active,
    }
}

/// The server branches of one repository; a branch that could not be assessed is a warning, like
/// in the local scan, and the others stand.
#[derive(Debug, Default)]
pub struct OnlineScan {
    pub branches: Vec<RemoteBranchReport>,
    pub warnings: Vec<RepoWarning>,
}

/// Entry point per repository: assesses its server branches in one working copy.
pub async fn scan(path: &std::path::Path, config: &Config, identity: &str, prs: PrView<'_>) -> Result<OnlineScan> {
    let git = Git::new(path);
    let key = path.to_string_lossy().to_string();
    let default = refs::default_branch(&git, config, &key).await?;
    scan_with_default(path, config, identity, prs, default.as_deref()).await
}

/// `scan` with the default branch the local scan of the same copy just found.
pub async fn scan_with_default(path: &std::path::Path, config: &Config, identity: &str, prs: PrView<'_>, default: Option<&str>) -> Result<OnlineScan> {
    let ctx = Ctx { git: Git::new(path), config, identity, default, prs, now: now() };
    assess(&ctx).await
}

pub async fn assess(ctx: &Ctx<'_>) -> Result<OnlineScan> {
    let prefix = format!("refs/remotes/{REMOTE}/");
    let out = ctx
        .git
        .out(&[
            "for-each-ref",
            &prefix,
            "--format=%(refname)%00%(objectname)%00%(committerdate:unix)%00%(authoremail:trim)%00%(contents:subject)",
        ])
        .await?;
    let raws: Vec<RawRemote> = out
        .lines()
        .filter_map(|l| {
            let f = fields(l);
            (f.len() >= 5).then(|| RawRemote {
                name: f[0].trim_start_matches(&prefix).to_string(),
                full: f[0].to_string(),
                sha: f[1].to_string(),
                committed_at: f[2].parse().unwrap_or(0),
                author: f[3].to_string(),
                subject: f[4..].join(" "),
            })
        })
        .filter(|r| r.name != "HEAD" && Some(r.full.as_str()) != ctx.default && !ctx.config.is_protected(&r.name))
        .collect();
    // The default branch's commit is in the same listing when it is a branch of origin: no git call for it.
    let default_sha: Option<String> = ctx.default.and_then(|d| {
        out.lines().find_map(|l| {
            let f = fields(l);
            (f.first() == Some(&d)).then(|| f.get(1).map(|s| s.to_string())).flatten()
        })
    });

    // One call answers "merged by ancestry" for all branches; only the rest need the probes.
    let ancestors: HashSet<String> = match ctx.default {
        Some(d) => ctx
            .git
            .out(&["for-each-ref", "--merged", d, "--format=%(refname)", &prefix])
            .await?
            .lines()
            .map(|l| l.trim().to_string())
            .collect(),
        None => HashSet::new(),
    };

    let ahead = match ctx.default {
        Some(d) => ahead_counts(&ctx.git, d, &prefix).await,
        None => None,
    };
    let index = ctx.prs.list().map(crate::providers::PrIndex::new);
    let index = index.as_ref();
    let futures: Vec<_> = raws
        .iter()
        .map(|r| {
            let one = assess_one(ctx, index, r, ancestors.contains(&r.full), ahead.as_ref().and_then(|a| a.get(&r.full).copied()), default_sha.as_deref());
            async move { (r, one.await) }
        })
        .collect();
    let results: Vec<(&RawRemote, Result<RemoteBranchReport>)> = stream::iter(futures).buffer_unordered(CONCURRENCY).collect().await;
    let mut out = OnlineScan::default();
    for (raw, r) in results {
        match r {
            Ok(report) => out.branches.push(report),
            Err(e) => out.warnings.push(RepoWarning::BranchFailed { branch: format!("{REMOTE}/{}", raw.name), detail: format!("{e:#}") }),
        }
    }
    out.branches.sort_by(|a, b| a.name.cmp(&b.name));
    out.warnings.sort_by_key(|w| format!("{w:?}"));
    Ok(out)
}

/// Commits not on the default branch, for every server branch in one call (git 2.41+).
/// None on older git: the caller then counts per branch.
async fn ahead_counts(git: &Git, default: &str, prefix: &str) -> Option<HashMap<String, u32>> {
    let format = format!("--format=%(refname)%00%(ahead-behind:{default})");
    let out = git.out(&["for-each-ref", &format, prefix]).await.ok()?;
    Some(
        out.lines()
            .filter_map(|l| {
                let (name, counts) = l.split_once('\0')?;
                Some((name.to_string(), counts.split_whitespace().next()?.parse().ok()?))
            })
            .collect(),
    )
}

/// Whether one of my addresses authored a commit of the branch, by tip: the commits below a tip
/// never change, so the answer holds for the life of the process.
static MINE: LazyLock<Mutex<HashMap<String, bool>>> = LazyLock::new(Default::default);
/// Every push makes a new tip, so the answers pile up; past this many they are asked again.
const MINE_CAP: usize = 20_000;

/// `prs`: the pull requests of `ctx` by source branch, made once for all server branches.
async fn assess_one(ctx: &Ctx<'_>, prs: Option<&crate::providers::PrIndex<'_>>, r: &RawRemote, ancestor: bool, ahead: Option<u32>, default_sha: Option<&str>) -> Result<RemoteBranchReport> {
    let git = &ctx.git;
    let source_ref = format!("refs/heads/{}", r.name);
    let pr = prs.and_then(|prs| prs.pick(&source_ref, crate::providers::PrPick::OpenFirst)).cloned();

    let mut evidence = match (ancestor, ctx.default) {
        (true, Some(d)) => Some(MergeEvidence { kind: MergeKind::Ancestor, target: d.to_string() }),
        (false, Some(d)) => merged::merged_into(git, &r.sha, d, Some(RECHECK_NEGATIVE), default_sha).await?,
        _ => None,
    };
    if evidence.is_none() {
        if let Some(p) = &pr {
            evidence = merged::pr_evidence(git, p, &r.sha).await?;
        }
    }

    let own_commit_count = match (ctx.default, ahead) {
        _ if ancestor => 0,
        (Some(_), Some(n)) => n,
        (Some(d), None) => git.out(&["rev-list", "--count", &format!("{d}..{}", r.sha)]).await?.trim().parse().unwrap_or(0),
        (None, _) => 0,
    };
    let mut is_mine = ctx.config.is_my_email(&r.author);
    if !is_mine && own_commit_count > 0 {
        if let Some(d) = ctx.default {
            let key = format!("{}|{}", r.sha, ctx.config.my_emails.join(","));
            let cached = MINE.lock().unwrap_or_else(|p| p.into_inner()).get(&key).copied();
            is_mine = match cached {
                Some(v) => v,
                None => {
                    let authors = git.out(&["log", "--format=%ae", "-n", "200", &format!("{d}..{}", r.sha)]).await?;
                    let v = authors.lines().any(|a| ctx.config.is_my_email(a));
                    let mut mine = MINE.lock().unwrap_or_else(|p| p.into_inner());
                    if mine.len() >= MINE_CAP {
                        mine.clear();
                    }
                    mine.insert(key, v);
                    v
                }
            };
        }
    }

    let open_pr = match ctx.prs {
        PrView::Known(_) => Some(pr.as_ref().is_some_and(|p| p.state == PrState::Open)),
        PrView::NotApplicable => Some(false),
        PrView::Unknown => None,
    };
    let verdict = classify(evidence.is_some(), open_pr, ctx.now - r.committed_at, ctx.config.stale_days);
    Ok(RemoteBranchReport {
        repo_path: git.dir().to_string_lossy().to_string(),
        remote: REMOTE.to_string(),
        name: r.name.clone(),
        sha: r.sha.clone(),
        last_commit_at: r.committed_at,
        last_commit_subject: r.subject.clone(),
        last_commit_author: r.author.clone(),
        is_mine,
        verdict,
        merged: evidence.is_some(),
        open_pr,
        merge_evidence: evidence,
        pull_request: pr,
        own_commit_count,
        locked: ctx.config.is_locked(ctx.identity, &r.name),
        ignored: ctx.config.is_ignored(ctx.identity, &r.name, true, ctx.now),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    const DAY: i64 = 86_400;

    /// The same table drives the frontend test (src/lib/online.test.ts), so both sides apply one rule.
    #[test]
    fn online_rules_from_the_shared_table() {
        #[derive(serde::Deserialize)]
        #[serde(rename_all = "camelCase")]
        struct Case {
            merged: bool,
            open_pr: Option<bool>,
            age_days: i64,
            stale_days: u32,
            verdict: OnlineVerdict,
            why: String,
        }
        let cases: Vec<Case> = serde_json::from_str(include_str!("../tests/fixtures/online-rules.json")).unwrap();
        for c in cases {
            assert_eq!(classify(c.merged, c.open_pr, c.age_days * DAY, c.stale_days), c.verdict, "{}", c.why);
        }
    }

    #[test]
    fn pull_requests_are_unknown_only_where_a_provider_could_have_answered() {
        let none: &[PullRequestInfo] = &[];
        assert!(matches!(PrView::of(ProviderKind::Azure, true, None), PrView::Unknown));
        assert!(matches!(PrView::of(ProviderKind::Azure, true, Some(none)), PrView::Known(_)));
        assert!(matches!(PrView::of(ProviderKind::None, true, None), PrView::NotApplicable), "a host without pull requests");
        assert!(matches!(PrView::of(ProviderKind::GitHub, false, None), PrView::NotApplicable), "providers switched off");
    }
}
