use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};
use std::sync::{Arc, LazyLock};
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use anyhow::Result;
use futures::stream::{self, StreamExt};

use crate::assess;
use crate::config::Config;
use crate::git::discovery::FoundRepo;
use crate::git::refs::{self, short_ref, LocalBranch};
use crate::git::runner::{fields, Git, Prompts, FETCH_TIMEOUT};
use crate::git::snapshot::{Snapshot, SnapshotStore};
use crate::git::status::{self, RawStash};
use crate::failure;
use crate::git::identity;
use crate::git::merged;
use crate::model::*;
use crate::providers::{self, remote_url, PrIndex, PrPick};

const BRANCH_CONCURRENCY: usize = 4;
/// Commits a list holds and the authors of a branch are read from; the counts go beyond it.
pub const COMMIT_LIST_LIMIT: usize = 200;
/// Only the server's branches take work in: other remotes (a fork, a mirror) say nothing about it.
const EVIDENCE_REMOTES: &str = "refs/remotes/origin/";
/// How long after a fetch the remote-tracking refs still stand for the server's branches. Older,
/// they may name branches deleted there long ago, which then would count as merge evidence.
const REMOTES_FRESH: Duration = Duration::from_secs(12 * 3600);

#[derive(Default, Clone)]
pub struct ScanOptions {
    pub fetch: bool,
    pub providers: bool,
    pub only_branch: Option<String>,
    /// Pull requests from an earlier scan, so a re-check does not hit the provider again.
    pub cached_prs: Option<Vec<PullRequestInfo>>,
    /// The last list the provider gave and when it was read: it stands in when asking fails. A failed
    /// query never counts as "no pull requests".
    pub fallback_prs: Option<(Vec<PullRequestInfo>, i64)>,
    /// The cached or stand-in list was as long as the provider is asked for: older ones are missing.
    pub prs_capped: bool,
    /// The time the assessment counts with (Unix seconds); None: the clock. Ignores that run out and the
    /// freshness of the remote-tracking refs follow it.
    pub now: Option<i64>,
    /// The online phase follows for this working copy, so pull requests are needed even without gone branches.
    pub wants_prs: bool,
    /// Other working copies of the same repository; their snapshots fill gaps in this one.
    pub siblings: Vec<std::path::PathBuf>,
    /// The snapshots of all working copies of the repository, merged once per scan (see
    /// `SnapshotStore::merged`); used instead of reading `siblings` one by one.
    pub sibling_refs: Option<Arc<BTreeMap<String, crate::git::snapshot::SnapshotEntry>>>,
    /// Origin and identity when the caller found them already (a full scan needs them first).
    pub origin: Option<identity::RepoOrigin>,
    /// The fetch the caller ran before, under the repository's refs lock (see `fetch`); `fetch` is
    /// then false.
    pub fetched: Option<Fetched>,
    /// Merge evidence of this moment only: a delete must not rely on what an earlier scan remembered.
    pub fresh: bool,
    /// An earlier assessment and the fingerprint of its inputs: with the same inputs it is taken over
    /// instead of assessing every branch again (the second stage of the start, after the fetch).
    pub previous: Option<(u64, RepoResult)>,
    /// The earlier assessment comes from before a restart: no watcher saw the worktrees since, so their
    /// files are read again before it is taken over.
    pub verify_files: bool,
    /// Pull requests asked once per repository and scan, shared by its working copies.
    pub shared_prs: Option<SharedPrs>,
    /// The provider's command line; None: az and gh of the system.
    pub cli: Option<Arc<dyn providers::Cli>>,
}

/// One pull request list per repository and scan. Working copies of one repository asked the provider
/// each for the same list; for a large repository that is seconds per copy. See `providers::Session`.
#[derive(Clone, Default)]
pub struct SharedPrs(Arc<providers::Session>);

impl SharedPrs {
    async fn get(&self, cli: &dyn providers::Cli, identity: &str, remote: &remote_url::Remote) -> Result<providers::PrList, providers::PrError> {
        self.0.pull_requests(cli, identity, remote).await
    }
}

/// What the fetch before an assessment did.
#[derive(Debug, Clone, Default)]
pub struct Fetched {
    /// The server answered: `origin`, or every remote where the repo has no `origin`.
    pub reached: bool,
    pub error: Option<String>,
    pub kind: Option<FailureKind>,
    /// Other remotes that could not be fetched; their failure says nothing about the server.
    pub warnings: Vec<RepoWarning>,
}

impl Fetched {
    fn failed(error: String) -> Self {
        Self { reached: false, kind: Some(failure::classify(&error)), error: Some(error), warnings: Vec::new() }
    }

    /// Not fetched: the server refused the sign-in of another repository earlier in the same scan.
    pub fn refused(server: &str, repo: &str) -> Self {
        let error = format!("not fetched: {server} refused the sign-in for {repo} earlier in this scan");
        Self { reached: false, kind: Some(FailureKind::AuthRequired), error: Some(error), warnings: Vec::new() }
    }

    /// Not fetched: the light check before it did not reach the server. Said as a failed fetch would
    /// be, or an offline start would look like one where nothing changed.
    pub fn unreached(u: crate::server_check::Unreached) -> Self {
        let error = format!("not fetched: the server could not be asked whether anything changed: {}", u.detail);
        Self { reached: false, kind: Some(u.kind), error: Some(error), warnings: Vec::new() }
    }
}

/// Fetches with the prune: the one rule of the scan, the server check's fetch and the refresh of the
/// server branches. Fetched means `origin` answered. Other remotes (a fork, a mirror) are fetched as
/// well, and one that is gone is a warning: it must not make every scan say "not fetched".
///
/// The snapshot is recorded before, because the prune removes exactly the refs we need to remember,
/// and after. An error when it could not be recorded: then nothing is fetched.
pub async fn fetch(git: &Git, store: &SnapshotStore, prompts: Prompts) -> Result<Fetched> {
    store.record(git).await?;
    let remotes = git.out(&["remote"]).await.unwrap_or_default();
    let has_origin = remotes.lines().any(|r| r.trim() == crate::online::REMOTE);
    let others: Vec<&str> = remotes.lines().map(str::trim).filter(|r| !r.is_empty() && *r != crate::online::REMOTE).collect();
    let main = match has_origin {
        true => fetch_failure(git, &["fetch", "--prune", "--quiet", crate::online::REMOTE], prompts).await,
        false => None,
    };
    let rest = match others.is_empty() {
        true => None,
        false => {
            let args: Vec<&str> = ["fetch", "--prune", "--quiet", "--multiple"].into_iter().chain(others.iter().copied()).collect();
            fetch_failure(git, &args, prompts).await
        }
    };
    let fetched = match (main, rest) {
        (Some(e), _) => Fetched::failed(e),
        // Without origin the other remotes are all the repo has: they decide.
        (None, Some(e)) if !has_origin => Fetched::failed(e),
        (None, Some(detail)) => {
            let warning = RepoWarning::OtherRemotesFailed { remotes: others.iter().map(|r| r.to_string()).collect(), detail };
            Fetched { reached: true, warnings: vec![warning], ..Default::default() }
        }
        (None, None) => Fetched { reached: true, ..Default::default() },
    };
    let _ = store.record(git).await;
    Ok(fetched)
}

/// git's text when the fetch failed; None when it went through.
async fn fetch_failure(git: &Git, args: &[&str], prompts: Prompts) -> Option<String> {
    match git.network(args, prompts, FETCH_TIMEOUT).await {
        Ok(o) if o.success() => None,
        Ok(o) => Some(o.error_text()),
        Err(e) => Some(format!("{e:#}")),
    }
}

/// After a restart the watcher has not seen the worktrees: an earlier assessment is only taken over
/// while every worktree a branch is checked out in still has the files it saw.
async fn worktree_files_unchanged(earlier: &RepoResult) -> bool {
    for w in earlier.branches.iter().filter_map(|b| b.worktree.as_ref()) {
        match status::worktree_changes(&Git::new(Path::new(&w.path))).await {
            Ok(files) if files == w.files => {}
            _ => return false,
        }
    }
    true
}

pub struct RepoScan {
    pub result: RepoResult,
    pub prs: Option<Vec<PullRequestInfo>>,
    /// When the provider gave `prs` in this scan; None when they came from a cache or a fallback.
    pub prs_asked_at: Option<i64>,
    /// The list asked in this scan was capped (see `providers::PrList::capped`).
    pub prs_capped: bool,
    /// Of the inputs the assessment read. None when the scan failed, when an input could not be read,
    /// and for a scan whose result is never taken over (one branch, or fresh for a delete).
    pub fingerprint: Option<u64>,
    /// The default branch as a full ref, for the online assessment that follows.
    pub default_ref: Option<String>,
}

/// What `scan_inner` found besides the result itself.
#[derive(Default)]
struct Found {
    prs: Option<Vec<PullRequestInfo>>,
    prs_asked_at: Option<i64>,
    prs_capped: bool,
    fingerprint: Option<u64>,
    default_ref: Option<String>,
}

struct Ctx<'a> {
    git: Git,
    config: &'a Config,
    default: Option<String>,
    snapshot: Snapshot,
    stashes: Vec<StashLink>,
    /// The pull requests by source branch; None when none were asked or the query failed.
    prs: Option<PrIndex<'a>>,
    main_worktree: Option<String>,
    /// Every remote-tracking ref there is and its commit, so a PR's target and the commit of a merge
    /// target are looked up without a git call.
    remotes: HashMap<String, String>,
    identity: String,
    fresh: bool,
    /// The remote-tracking refs stand for the server's branches (see `remotes_fresh`).
    remotes_fresh: bool,
    /// The last pushed commits that exist here, asked for all branches at once; None when that call
    /// failed, and each branch asks on its own.
    present: Option<HashSet<String>>,
    now: i64,
}

/// Whether the remote-tracking refs still stand for the server's branches: this scan's fetch reached
/// the server, the last fetch did within the window, or a light check found them equal since. Older,
/// they may name branches deleted there long ago, which then would count as merge evidence.
fn remotes_fresh(fetched: bool, fetch_head_at: Option<i64>, verified_at: Option<i64>, now: i64) -> bool {
    let window = REMOTES_FRESH.as_secs() as i64;
    let within = |at: Option<i64>| at.is_some_and(|at| now - at < window);
    fetched || within(fetch_head_at) || within(verified_at)
}

/// When a light check last found a working copy's remote-tracking refs equal to the server's
/// branches, by folder. Without a fetch FETCH_HEAD ages while the refs still match the server.
/// Process-wide, so every assessment of the copy sees it, the re-check before a delete included.
static REMOTES_VERIFIED: LazyLock<std::sync::Mutex<HashMap<String, i64>>> = LazyLock::new(Default::default);

pub fn note_remotes_verified(path: &str, at: i64) {
    REMOTES_VERIFIED.lock().unwrap_or_else(|p| p.into_inner()).insert(crate::paths::path_key(path), at);
}

fn remotes_verified_at(path: &str) -> Option<i64> {
    REMOTES_VERIFIED.lock().unwrap_or_else(|p| p.into_inner()).get(&crate::paths::path_key(path)).copied()
}

/// git writes FETCH_HEAD in a fetch that got the server's answer, so its time is that of the last
/// fetch that reached the server, by this app or any other tool.
fn modified_at(path: &Path) -> Option<i64> {
    let t = std::fs::metadata(path).and_then(|m| m.modified()).ok()?;
    Some(t.duration_since(std::time::UNIX_EPOCH).ok()?.as_secs() as i64)
}

pub async fn scan_repo(found: &FoundRepo, config: &Config, store: &SnapshotStore, mut opts: ScanOptions) -> RepoScan {
    let started = Instant::now();
    let git = Git::new(&found.path);
    let path_str = found.path.to_string_lossy().to_string();
    let identity::RepoOrigin { remote_url, identity } = match &opts.origin {
        Some(o) => o.clone(),
        None => identity::origin_of(&git).await,
    };
    let remote = remote_url.as_deref().map(remote_url::parse).unwrap_or(remote_url::Remote::Other);

    let mut result = RepoResult {
        repo: RepoInfo {
            path: path_str.clone(),
            name: found.path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_else(|| path_str.clone()),
            root: found.root.clone(),
            provider: providers::kind_of(&remote),
            links: remote_url::links(&remote),
            remote_url,
            default_branch: None,
            identity,
        },
        fetched: false,
        fetch_error: None,
        fetch_error_kind: None,
        local_branch_count: 0,
        branches: Vec::new(),
        tracking: Vec::new(),
        online: None,
        online_at: None,
        online_fetched: false,
        warnings: Vec::new(),
        error: None,
        error_kind: None,
        duration_ms: 0,
    };

    let done = match scan_inner(&git, &path_str, &remote, config, store, &mut opts, &mut result).await {
        Ok(done) => done,
        Err(e) => {
            let text = if found.path.is_dir() { format!("{e:#}") } else { format!("{} not found", found.path.display()) };
            result.error_kind = Some(if found.path.is_dir() { failure::classify_local(&text) } else { FailureKind::RepoMissing });
            result.error = Some(text);
            Found::default()
        }
    };
    result.duration_ms = started.elapsed().as_millis() as u32;
    RepoScan { result, prs: done.prs, prs_asked_at: done.prs_asked_at, prs_capped: done.prs_capped, fingerprint: done.fingerprint, default_ref: done.default_ref }
}

async fn scan_inner(
    git: &Git,
    repo_key: &str,
    remote: &remote_url::Remote,
    config: &Config,
    store: &SnapshotStore,
    opts: &mut ScanOptions,
    result: &mut RepoResult,
) -> Result<Found> {
    let fetched = match (&opts.fetched, opts.fetch) {
        (Some(f), _) => Some(f.clone()),
        (None, true) => fetch(git, store, Prompts::Never).await.ok(),
        (None, false) => None,
    };
    if let Some(f) = fetched {
        result.fetched = f.reached;
        result.fetch_error = f.error;
        result.fetch_error_kind = f.kind;
        result.warnings.extend(f.warnings);
    }
    let (facts, mut snapshot) = RepoFacts::read(git, store).await?;
    match &opts.sibling_refs {
        Some(all) => {
            for (k, v) in all.iter() {
                snapshot.refs.entry(k.clone()).or_insert_with(|| v.clone());
            }
        }
        None => {
            for sibling in &opts.siblings {
                for (k, v) in store.snapshot_of(sibling).await.refs {
                    snapshot.refs.entry(k).or_insert(v);
                }
            }
        }
    }

    if let Some(common) = &facts.common_dir {
        merged::note_repo(git, common);
    }
    let default = refs::default_branch_in(git, config, repo_key, Some(&facts.refs)).await?;
    result.repo.default_branch = default.as_deref().map(|d| short_ref(d).to_string());
    if default.is_none() {
        result.warnings.push(RepoWarning::NoDefaultBranch);
    }

    let branches = refs::parse_branches(&facts.refs);
    result.local_branch_count = branches.len() as u32;
    let local_names: HashSet<String> = branches.iter().map(|b| b.name.clone()).collect();
    result.tracking = branches
        .iter()
        .filter(|b| !b.upstream.is_empty())
        .map(|b| TrackingRef {
            branch: b.name.clone(),
            remote: b.remote_name.clone(),
            remote_branch: b.remote_ref.trim_start_matches("refs/heads/").to_string(),
            gone: b.gone,
            ahead: b.ahead,
            behind: b.behind,
            checked_out: b.worktree_path.as_ref().is_some_and(|p| Path::new(p.as_str()).exists()),
        })
        .collect();
    // Every local branch is assessed; which of them show (only the orphaned ones, say) is the UI's
    // filter. The local twin of the default branch is the measure, never a candidate.
    let default_name = default.as_deref().and_then(default_local_name);
    let candidates: Vec<LocalBranch> = branches
        .into_iter()
        .filter(|b| !config.is_protected(&b.name) && Some(b.name.as_str()) != default_name)
        .filter(|b| opts.only_branch.as_ref().is_none_or(|n| n == &b.name))
        .collect();

    let now = opts.now.unwrap_or_else(crate::git::snapshot::now);
    // Taken, not copied: a list of a thousand pull requests per working copy and scan.
    let mut prs = opts.cached_prs.take();
    let mut prs_asked_at = None;
    let mut prs_capped = false;
    // A list read earlier is as incomplete as it was then.
    let mut capped = prs.is_some() && opts.prs_capped;
    if prs.is_none() && opts.providers && (!candidates.is_empty() || opts.wants_prs) && *remote != remote_url::Remote::Other {
        let cli: &dyn providers::Cli = opts.cli.as_deref().unwrap_or(&providers::SystemCli);
        let asked = match (&opts.shared_prs, &opts.origin) {
            (Some(shared), Some(origin)) => shared.get(cli, &origin.identity, remote).await,
            _ => providers::pull_requests_with(cli, remote).await,
        };
        match asked {
            Ok(list) => {
                (capped, prs_capped) = (list.capped, list.capped);
                result.warnings.extend(list.unreadable.into_iter().map(|u| RepoWarning::PrUnreadable { id: u.id, detail: u.detail }));
                prs = Some(list.prs);
                prs_asked_at = Some(now);
            }
            // The last list stands in: one refused call must not turn merged branches into unmerged
            // ones, and an old branch's open PR must not vanish.
            Err(e) => {
                let fallback_at = opts.fallback_prs.as_ref().map(|(_, at)| *at);
                result.warnings.push(RepoWarning::PrQueryFailed { kind: e.kind, detail: e.detail, fallback_at });
                prs = opts.fallback_prs.take().map(|(list, _)| list);
                capped = prs.is_some() && opts.prs_capped;
            }
        }
    }
    if capped {
        result.warnings.push(RepoWarning::PrListCapped { limit: providers::PR_LIMIT as u32 });
    }

    let remotes_fresh = remotes_fresh(result.fetched, facts.fetch_head.as_deref().and_then(modified_at), remotes_verified_at(repo_key), now);
    // Only a scan whose result may be taken over later needs it; a delete or one branch never is.
    let fingerprint = if opts.only_branch.is_none() && !opts.fresh {
        let inputs = FingerprintInputs { facts: &facts, config, candidates: &candidates, default: default.as_deref(), snapshot: &snapshot, prs: prs.as_deref(), remotes_fresh, now };
        fingerprint(&inputs)
    } else {
        None
    };
    if let (Some(current), Some((before, earlier))) = (fingerprint, &opts.previous) {
        // An earlier failure is never taken over: under load a branch timed out, and it would stay
        // hidden until its inputs change.
        let failed_before = earlier.warnings.iter().any(|w| matches!(w, RepoWarning::BranchFailed { .. }));
        if *before == current && !failed_before && (!opts.verify_files || worktree_files_unchanged(earlier).await) {
            result.branches = earlier.branches.clone();
            show_current_pull_requests(&mut result.branches, prs.as_deref().map(PrIndex::new).as_ref());
            return Ok(Found { prs, prs_asked_at, prs_capped, fingerprint, default_ref: default });
        }
    }

    let stashes = stash_links(git, facts.stashes.as_deref().unwrap_or_default(), &local_names, default.as_deref()).await;
    let index = prs.as_deref().map(PrIndex::new);
    let pushed = candidates.iter().filter_map(|b| {
        let pr = pr_of(index.as_ref(), &source_ref_of(b, default.as_deref()), &b.sha);
        push_state_of(b, upstream_state(b, default.as_deref()), &snapshot, pr.as_ref()).map(|ps| ps.sha)
    });
    let present = present_commits(git, pushed).await;
    let ctx = Ctx {
        git: git.clone(),
        config,
        default: default.clone(),
        snapshot,
        stashes,
        prs: index,
        main_worktree: facts.main_worktree(),
        remotes: facts.remote_refs(),
        identity: result.repo.identity.clone(),
        fresh: opts.fresh,
        remotes_fresh,
        present,
        now,
    };

    // Futures are collected first; mapping inside the stream trips the Send check of Tauri commands.
    // Results arrive in completion order, so each carries its branch name.
    let ctx = &ctx;
    let futures: Vec<_> = candidates.iter().map(|b| async move { (b.name.clone(), analyze_branch(ctx, b).await) }).collect();
    let reports: Vec<(String, Result<BranchReport>)> =
        stream::iter(futures).buffer_unordered(BRANCH_CONCURRENCY).collect().await;
    let mut failed = false;
    for (branch, r) in reports {
        match r {
            Ok(rep) => result.branches.push(rep),
            Err(e) => {
                failed = true;
                result.warnings.push(RepoWarning::BranchFailed { branch, detail: format!("{e:#}") });
            }
        }
    }
    result.branches.sort_by(|a, b| a.name.cmp(&b.name));
    // A result with a failed branch is assessed again by the next scan, never taken over.
    let fingerprint = fingerprint.filter(|_| !failed);
    Ok(Found { prs, prs_asked_at, prs_capped, fingerprint, default_ref: default })
}

/// A taken-over assessment with the pull requests as they are now. Which PR a branch has and what
/// decides its verdict are in the fingerprint; title, reviewers, draft and conflicts are not.
fn show_current_pull_requests(branches: &mut [BranchReport], prs: Option<&PrIndex>) {
    for b in branches {
        let pr = pr_of(prs, &b.remote_ref, &b.sha);
        if let Some(p) = &pr {
            for c in &mut b.checks {
                if let CheckCode::Pr { id, title, .. } = &mut c.code {
                    if *id == p.id {
                        title.clone_from(&p.title);
                    }
                }
            }
        }
        b.pull_request = pr;
    }
}

/// What the assessment of a repository reads once and derives everything from: the branches, the
/// main worktree, the remote-tracking refs and the fingerprint.
struct RepoFacts {
    /// `for-each-ref` over local and remote branches and the stash, in `refs::FORMAT`.
    refs: String,
    /// `worktree list --porcelain`; None when git could not list them.
    worktrees: Option<String>,
    /// None when git could not list them; the assessment then goes on without.
    stashes: Option<Vec<RawStash>>,
    /// Where git keeps FETCH_HEAD for this working copy; None when git could not say.
    fetch_head: Option<PathBuf>,
    /// The git directory all working copies of this repository share.
    common_dir: Option<String>,
}

impl RepoFacts {
    /// With the snapshot recorded from the same listing of the refs: one `for-each-ref` for both.
    async fn read(git: &Git, store: &SnapshotStore) -> Result<(Self, Snapshot)> {
        let (recorded, worktrees, stashes, paths) = tokio::join!(
            store.record_listing(git, &["for-each-ref", refs::FORMAT, "refs/heads", "refs/remotes", "refs/stash"]),
            git.out(&["worktree", "list", "--porcelain"]),
            git.raw(&["stash", "list", status::STASH_FORMAT]),
            git.out(&["rev-parse", "--path-format=absolute", "--git-path", "FETCH_HEAD", "--git-common-dir"]),
        );
        let (snapshot, refs) = recorded?;
        let stashes = match stashes {
            Ok(o) if o.success() => Some(status::parse_stashes(&o.stdout)),
            _ => None,
        };
        let paths = paths.unwrap_or_default();
        let mut paths = paths.lines().map(str::trim).filter(|l| !l.is_empty());
        let (fetch_head, common_dir) = (paths.next().map(PathBuf::from), paths.next().map(String::from));
        Ok((Self { refs, worktrees: worktrees.ok(), stashes, fetch_head, common_dir }, snapshot))
    }

    fn main_worktree(&self) -> Option<String> {
        self.worktrees.as_deref()?.lines().find_map(|l| l.strip_prefix("worktree ")).map(crate::paths::path_key)
    }

    /// Every remote-tracking ref and its commit.
    fn remote_refs(&self) -> HashMap<String, String> {
        self.refs
            .lines()
            .filter_map(|l| {
                let f = fields(l);
                let name = f.first().filter(|r| r.starts_with("refs/remotes/"))?;
                Some((name.to_string(), f.get(1)?.to_string()))
            })
            .collect()
    }
}

struct FingerprintInputs<'a> {
    facts: &'a RepoFacts,
    config: &'a Config,
    candidates: &'a [LocalBranch],
    default: Option<&'a str>,
    snapshot: &'a Snapshot,
    prs: Option<&'a [PullRequestInfo]>,
    remotes_fresh: bool,
    now: i64,
}

/// Everything the assessment reads that a scan can find changed: the refs (local, remote, stash, with
/// ahead and behind), the stash list (dropping an older stash leaves `refs/stash` as it is), the
/// worktrees, the last pushed state of each upstream (also from the siblings' snapshots), the pull
/// requests of the candidates, the configuration, whether the remote-tracking refs still stand for the
/// server (they decide evidence, and they age without any ref changing) and when the next ignore runs
/// out, the only part of a local assessment the clock changes. Changed files in a worktree are not in
/// it; the watcher reports those. None when an input could not be read: an empty answer would make two
/// different states look the same.
fn fingerprint(i: &FingerprintInputs) -> Option<u64> {
    let mut h = Fnv::new();
    h.part(&i.facts.refs);
    h.part(i.facts.worktrees.as_deref()?);
    for s in i.facts.stashes.as_ref()? {
        h.part(&s.sha);
    }
    for b in i.candidates.iter().filter(|b| upstream_state(b, i.default) != UpstreamState::None) {
        h.part(&b.upstream);
        h.part(i.snapshot.refs.get(&b.upstream).map_or("", |e| e.sha.as_str()));
    }
    match i.prs {
        // Not asked or failed: the checks differ from "asked, none found".
        None => h.part("no pull requests"),
        Some(prs) => {
            let sources: HashSet<String> = i.candidates.iter().map(|b| source_ref_of(b, i.default)).collect();
            let mut relevant: Vec<&PullRequestInfo> = prs.iter().filter(|p| sources.contains(&p.source_ref)).collect();
            relevant.sort_by_key(|p| p.id);
            h.part("pull requests");
            for p in relevant {
                h.part(&p.id.to_string());
                h.part(&format!("{:?}", p.state));
                h.part(p.source_sha.as_deref().unwrap_or(""));
                h.part(&p.target_ref);
            }
        }
    }
    // Only what the assessment reads: a wider sidebar or another theme must not make every repo look
    // changed, and the fingerprint outlives a restart.
    let c = i.config;
    let read = (
        &c.protected_patterns,
        &c.protected_defaults_known,
        &c.default_branch_overrides,
        &c.default_branch_candidates,
        &c.my_emails,
        c.use_providers,
        &c.locks,
        c.stale_days,
        &c.ignores,
        &c.online_excluded,
    );
    h.part(&serde_json::to_string(&read).ok()?);
    h.part(i.default.unwrap_or(""));
    h.part(if i.remotes_fresh { "remotes fresh" } else { "remotes stale" });
    let next_expiry = c.ignores.iter().filter_map(|x| x.until).filter(|&u| u > i.now).min();
    h.part(&next_expiry.map_or_else(|| "no ignore runs out".to_string(), |u| u.to_string()));
    Some(h.finish())
}

/// FNV-1a, 64 bit. Fingerprints are persisted, so the hash must be the same in every build and run,
/// which `DefaultHasher` does not promise.
struct Fnv(u64);

impl Fnv {
    fn new() -> Self {
        Fnv(0xcbf2_9ce4_8422_2325)
    }

    fn bytes(&mut self, bytes: &[u8]) {
        for &b in bytes {
            self.0 ^= u64::from(b);
            self.0 = self.0.wrapping_mul(0x0100_0000_01b3);
        }
    }

    /// One input and a separator no UTF-8 text contains, so ("ab", "c") and ("a", "bc") differ.
    fn part(&mut self, s: &str) {
        self.bytes(s.as_bytes());
        self.bytes(&[0xFF]);
    }

    fn finish(&self) -> u64 {
        self.0
    }
}

/// `refs/remotes/origin/team/main` → `team/main`: the local branch name the default branch goes by.
fn default_local_name(default: &str) -> Option<&str> {
    default.strip_prefix("refs/remotes/")?.split_once('/').map(|(_, name)| name)
}

/// A local upstream (`refs/heads/…`) or the integration line a branch was cut from is not an
/// upstream of its own: nothing of the branch is on the server through it.
fn upstream_state(b: &LocalBranch, default: Option<&str>) -> UpstreamState {
    if b.upstream.is_empty() || b.upstream.starts_with("refs/heads/") || Some(b.upstream.as_str()) == default {
        UpstreamState::None
    } else if b.gone {
        UpstreamState::Gone
    } else {
        UpstreamState::Live
    }
}

/// The branch name on the server a PR of this branch came from. Without an upstream of its own, a PR
/// can only have come from a branch of the same name.
fn source_ref_of(b: &LocalBranch, default: Option<&str>) -> String {
    if upstream_state(b, default) == UpstreamState::None { format!("refs/heads/{}", b.name) } else { b.remote_ref.clone() }
}

/// A stash and the local branches it belongs to, decided once per stash rather than per branch.
struct StashLink {
    info: StashInfo,
    owner: StashOwner,
}

enum StashOwner {
    /// The message names an existing branch: it belongs to that one, even when that branch is the
    /// base of others (feature branches cut from a release branch).
    Named(String),
    /// Otherwise: the branches containing the commit it was taken on, unless that commit is on the
    /// default branch, which every branch contains.
    Containing(HashSet<String>),
}

impl StashLink {
    fn belongs_to(&self, branch: &str) -> bool {
        match &self.owner {
            StashOwner::Named(n) => n == branch,
            StashOwner::Containing(set) => set.contains(branch),
        }
    }
}

async fn stash_links(git: &Git, stashes: &[RawStash], local_names: &HashSet<String>, default: Option<&str>) -> Vec<StashLink> {
    let mut links = Vec::with_capacity(stashes.len());
    for s in stashes {
        let owner = match s.branch_hint().filter(|h| local_names.contains(*h)) {
            Some(h) => StashOwner::Named(h.to_string()),
            None => StashOwner::Containing(branches_containing(git, &s.base, default).await),
        };
        links.push(StashLink { info: StashInfo { sha: s.sha.clone(), selector: s.selector.clone(), message: s.message.clone() }, owner });
    }
    links
}

async fn branches_containing(git: &Git, base: &str, default: Option<&str>) -> HashSet<String> {
    if base.is_empty() {
        return HashSet::new();
    }
    if let Some(d) = default {
        if git.is_ancestor(base, d).await.unwrap_or(true) {
            return HashSet::new();
        }
    }
    git.out(&["for-each-ref", "--contains", base, "--format=%(refname)", "refs/heads"])
        .await
        .unwrap_or_default()
        .lines()
        .filter_map(|l| l.trim().strip_prefix("refs/heads/"))
        .map(String::from)
        .collect()
}

/// The commits of a branch the assessment counts and the window lists, as `git log` arguments: one
/// rule for both, so a list never shows other commits than its count says.
#[derive(Debug, PartialEq)]
struct CommitRanges {
    /// Not on the default branch; without one, on no remote.
    own: Vec<String>,
    /// After the last push: None where that push is not here; empty when the tip is the pushed commit.
    unpushed: Option<Vec<String>>,
}

/// `pushed_here`: the last pushed commit, when it exists in this repository.
fn commit_ranges(default: Option<&str>, tip: &str, never_pushed: bool, pushed_here: Option<&str>) -> CommitRanges {
    let on_no_remote = || vec![tip.to_string(), "--not".to_string(), "--remotes".to_string()];
    let own = match default {
        Some(d) => vec![format!("{d}..{tip}")],
        None => on_no_remote(),
    };
    let unpushed = match (never_pushed, pushed_here) {
        (true, _) => Some(on_no_remote()),
        // Pushed as it is (the common case): the range is empty, no git call needed to say so.
        (false, Some(ps)) if ps == tip => Some(Vec::new()),
        (false, Some(ps)) => Some(vec![format!("{ps}..{tip}")]),
        (false, None) => None,
    };
    CommitRanges { own, unpushed }
}

fn args_of(range: &[String]) -> Vec<&str> {
    range.iter().map(String::as_str).collect()
}

/// The authors of a range (of its newest commits up to the list limit) and how many commits it has.
async fn authors_and_count(git: &Git, range: &[String]) -> Result<(BTreeSet<String>, u32)> {
    let limit = COMMIT_LIST_LIMIT.to_string();
    let mut args = vec!["log", "--format=%ae", "-n", &limit];
    args.extend(args_of(range));
    let out = git.out(&args).await?;
    let lines = out.lines().filter(|l| !l.trim().is_empty()).count();
    let authors = out.lines().map(|l| l.trim().to_lowercase()).filter(|l| !l.is_empty()).collect();
    // Shorter than its cap, the output has every commit of the range: counting again would cost a
    // process per branch.
    let count = if lines < COMMIT_LIST_LIMIT { lines as u32 } else { count(git, range).await? };
    Ok((authors, count))
}

async fn count(git: &Git, range: &[String]) -> Result<u32> {
    if range.is_empty() {
        return Ok(0);
    }
    let mut args = vec!["rev-list", "--count"];
    args.extend(args_of(range));
    Ok(git.out(&args).await?.trim().parse().unwrap_or(0))
}

/// The newest commits of a range, at most the list limit.
async fn commit_list(git: &Git, range: &[String]) -> Result<Vec<CommitInfo>> {
    if range.is_empty() {
        return Ok(Vec::new());
    }
    let limit = COMMIT_LIST_LIMIT.to_string();
    let mut args = vec!["log", "--format=%H%x00%ae%x00%at%x00%s", "-n", &limit];
    args.extend(args_of(range));
    Ok(git
        .out(&args)
        .await?
        .lines()
        .filter_map(|l| {
            let f = fields(l);
            (f.len() >= 4).then(|| CommitInfo {
                sha: f[0].to_string(),
                author_email: f[1].to_string(),
                authored_at: f[2].parse().unwrap_or(0),
                subject: f[3..].join(" "),
            })
        })
        .collect())
}

/// The commit lists of a branch as its last assessment counted them: the tip, the push state and the
/// upstream come from `b`, the default branch is read again by the assessment's rule.
pub async fn branch_commits(git: &Git, config: &Config, repo_key: &str, b: &BranchReport) -> Result<BranchCommits> {
    let default = refs::default_branch(git, config, repo_key).await?;
    let never_pushed = b.upstream_state == UpstreamState::None && b.push_state.is_none();
    let pushed_here = match &b.push_state {
        Some(ps) if !never_pushed && git.commit_exists(&ps.sha).await? => Some(ps.sha.as_str()),
        _ => None,
    };
    let ranges = commit_ranges(default.as_deref(), &b.sha, never_pushed, pushed_here);
    let own = commit_list(git, &ranges.own).await?;
    let unpushed = match &ranges.unpushed {
        Some(r) if *r == ranges.own => own.clone(),
        Some(r) => commit_list(git, r).await?,
        None => Vec::new(),
    };
    Ok(BranchCommits { sha: b.sha.clone(), own, unpushed })
}

/// The pull request of a local branch: the merged one of exactly its tip first (see `PrPick`).
fn pr_of(prs: Option<&PrIndex>, source_ref: &str, tip: &str) -> Option<PullRequestInfo> {
    prs.and_then(|p| p.pick(source_ref, PrPick::MergedTip(tip))).cloned()
}

/// The commit a branch was last seen at on the server: the snapshot of its upstream, else the source
/// commit of its pull request.
fn push_state_of(b: &LocalBranch, state: UpstreamState, snapshot: &Snapshot, pr: Option<&PullRequestInfo>) -> Option<PushState> {
    let upstream_snapshot = (state != UpstreamState::None).then(|| snapshot.refs.get(&b.upstream)).flatten();
    upstream_snapshot
        .map(|e| PushState { sha: e.sha.clone(), source: PushSource::Snapshot })
        .or_else(|| pr.and_then(|p| p.source_sha.clone()).map(|sha| PushState { sha, source: PushSource::PullRequest }))
}

/// A full object id: only such a value goes to the batch below, so nothing a provider sends can act
/// as an option there.
fn is_full_id(s: &str) -> bool {
    matches!(s.len(), 40 | 64) && s.bytes().all(|b| b.is_ascii_hexdigit())
}

/// Of these commits, the ones that exist here: one git call instead of one per branch. None when the
/// call failed; each branch then asks on its own.
async fn present_commits(git: &Git, ids: impl Iterator<Item = String>) -> Option<HashSet<String>> {
    // In chunks: a Windows command line ends at 32 KB.
    const PER_CALL: usize = 200;
    let ids: Vec<String> = ids.filter(|s| is_full_id(s)).map(|s| s.to_ascii_lowercase()).collect::<BTreeSet<_>>().into_iter().collect();
    let mut present = HashSet::new();
    for chunk in ids.chunks(PER_CALL) {
        let mut args = vec!["rev-list", "--no-walk", "--ignore-missing"];
        args.extend(chunk.iter().map(String::as_str));
        present.extend(git.out(&args).await.ok()?.lines().map(|l| l.trim().to_string()));
    }
    Some(present)
}

async fn analyze_branch(ctx: &Ctx<'_>, b: &LocalBranch) -> Result<BranchReport> {
    let git = &ctx.git;
    let tip = b.sha.as_str();
    let state = upstream_state(b, ctx.default.as_deref());
    let source_ref = source_ref_of(b, ctx.default.as_deref());
    let pr = pr_of(ctx.prs.as_ref(), &source_ref, tip);

    // --- merge evidence, the cheap kinds first
    let mut targets: Vec<String> = ctx.default.iter().cloned().collect();
    if let Some(pr) = &pr {
        let remote = if b.remote_name.is_empty() { "origin" } else { &b.remote_name };
        let t = format!("refs/remotes/{remote}/{}", pr.target_ref.trim_start_matches("refs/heads/"));
        if !targets.contains(&t) && ctx.remotes.contains_key(&t) {
            targets.push(t);
        }
    }
    let mut evidence = None;
    for t in &targets {
        let found = if ctx.fresh {
            merged::merged_into_fresh(git, tip, t).await?
        } else {
            merged::merged_into(git, tip, t, None, ctx.remotes.get(t).map(String::as_str)).await?
        };
        if let Some(e) = found {
            evidence = Some(e);
            break;
        }
    }
    if evidence.is_none() {
        if let Some(pr) = &pr {
            evidence = merged::pr_evidence(git, pr, tip).await?;
        }
    }
    if evidence.is_none() && ctx.remotes_fresh {
        // Another server branch holding the tip took the work in. The branch's own upstream does not,
        // nor the server branch of its own name (pushed without an upstream): pushed is not merged, and
        // active work on the server would otherwise count as done.
        let own_name = format!("{EVIDENCE_REMOTES}{}", b.name).to_lowercase();
        let other = |r: &String| *r != b.upstream && r.to_lowercase() != own_name;
        if let Some(r) = merged::containing_remotes(git, tip, EVIDENCE_REMOTES).await?.into_iter().find(other) {
            evidence = Some(MergeEvidence { kind: MergeKind::ContainedInRemote, target: r });
        }
    }

    // --- push state
    let push_state = push_state_of(b, state, &ctx.snapshot, pr.as_ref());
    let never_pushed = state == UpstreamState::None && push_state.is_none();
    let pushed_here = match &push_state {
        Some(ps) if !never_pushed => {
            let exists = match &ctx.present {
                Some(present) if is_full_id(&ps.sha) => present.contains(&ps.sha.to_ascii_lowercase()),
                _ => git.commit_exists(&ps.sha).await?,
            };
            exists.then_some(ps.sha.as_str())
        }
        _ => None,
    };
    let ranges = commit_ranges(ctx.default.as_deref(), tip, never_pushed, pushed_here);

    // --- own commits and authors
    let (mut authors, own_commit_count) = authors_and_count(git, &ranges.own).await?;
    if authors.is_empty() {
        authors.insert(b.author_email.to_lowercase());
    }
    let is_mine = authors.iter().any(|a| ctx.config.is_my_email(a));

    // --- commits after the push
    let push_commits_known = ranges.unpushed.is_some();
    let unpushed_commit_count = match &ranges.unpushed {
        // Without a default branch the own commits are already those on no remote.
        Some(r) if *r == ranges.own => own_commit_count,
        Some(r) => count(git, r).await?,
        None => 0,
    };

    // --- worktree
    // A worktree whose folder is gone holds nothing any more; git lists it until pruned.
    let worktree = match b.worktree_path.as_ref().filter(|p| Path::new(p.as_str()).exists()) {
        Some(p) => {
            let files = status::worktree_changes(&Git::new(Path::new(p))).await?;
            let is_main = ctx.main_worktree.as_deref() == Some(crate::paths::path_key(p).as_str());
            Some(WorktreeState { path: p.clone(), is_main, files })
        }
        None => None,
    };

    let stashes: Vec<StashInfo> = ctx.stashes.iter().filter(|s| s.belongs_to(&b.name)).map(|s| s.info.clone()).collect();

    let facts = assess::Facts {
        evidence: evidence.as_ref(),
        default_branch: ctx.default.as_deref(),
        own_commit_count,
        upstream: &b.upstream,
        remote_ref: &source_ref,
        push_state: push_state.as_ref(),
        push_commits_known,
        never_pushed,
        unpushed_count: unpushed_commit_count,
        worktree: worktree.as_ref(),
        stashes: &stashes,
        pull_request: pr.as_ref(),
        prs_queried: ctx.prs.is_some(),
    };
    let checks = assess::checks(&facts);
    let verdict = assess::classify(&facts);

    Ok(BranchReport {
        repo_path: git.dir().to_string_lossy().to_string(),
        name: b.name.clone(),
        sha: b.sha.clone(),
        upstream: b.upstream.clone(),
        upstream_state: state,
        remote_ref: source_ref,
        last_commit_at: b.committed_at,
        last_commit_subject: b.subject.clone(),
        last_commit_author: b.author_email.clone(),
        authors: authors.into_iter().collect(),
        is_mine,
        verdict,
        checks,
        merge_evidence: evidence,
        own_commit_count,
        unpushed_commit_count,
        behind: if state == UpstreamState::Live { b.behind } else { 0 },
        push_state,
        worktree,
        stashes,
        pull_request: pr,
        locked: ctx.config.is_locked(&ctx.identity, &b.name),
        ignored: ctx.config.is_ignored(&ctx.identity, &b.name, false, ctx.now),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_fingerprint_hash_is_fnv1a_and_separates_its_parts() {
        let hash = |s: &str| {
            let mut h = Fnv::new();
            h.bytes(s.as_bytes());
            h.finish()
        };
        // Reference values of FNV-1a 64: the persisted fingerprints depend on them.
        assert_eq!(hash(""), 0xcbf2_9ce4_8422_2325);
        assert_eq!(hash("a"), 0xaf63_dc4c_8601_ec8c);
        assert_eq!(hash("foobar"), 0x8594_4171_f739_67e8);
        let parts = |a: &str, b: &str| {
            let mut h = Fnv::new();
            h.part(a);
            h.part(b);
            h.finish()
        };
        assert_ne!(parts("ab", "c"), parts("a", "bc"));
    }

    fn branch(name: &str, upstream: &str) -> LocalBranch {
        LocalBranch {
            name: name.into(),
            sha: "t".into(),
            upstream: upstream.into(),
            remote_name: "origin".into(),
            remote_ref: format!("refs/heads/{name}"),
            gone: false,
            ahead: 0,
            behind: 0,
            committed_at: 0,
            subject: String::new(),
            author_email: String::new(),
            worktree_path: None,
        }
    }

    fn pr(id: u32, source: &str) -> PullRequestInfo {
        PullRequestInfo {
            id,
            title: String::new(),
            state: PrState::Open,
            url: String::new(),
            author: String::new(),
            author_name: None,
            source_ref: format!("refs/heads/{source}"),
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

    #[test]
    fn the_fingerprint_sees_the_stash_list_and_the_candidates_pull_requests_only() {
        let stash = |sha: &str| RawStash { selector: "stash@{0}".into(), sha: sha.into(), base: String::new(), message: "m".into() };
        let facts = |stashes: Vec<RawStash>| RepoFacts { refs: "refs/heads/a\0t".into(), worktrees: Some("worktree /r".into()), stashes: Some(stashes), fetch_head: None, common_dir: None };
        let config = Config::default();
        let candidates = [branch("a", "refs/remotes/origin/a")];
        let snapshot = Snapshot::default();
        let print_at = |facts: &RepoFacts, prs: Option<&[PullRequestInfo]>, remotes_fresh: bool| {
            fingerprint(&FingerprintInputs { facts, config: &config, candidates: &candidates, default: None, snapshot: &snapshot, prs, remotes_fresh, now: 1 })
        };
        let print = |facts: &RepoFacts, prs: Option<&[PullRequestInfo]>| print_at(facts, prs, true);
        let two = facts(vec![stash("s0"), stash("s1")]);
        // Dropping stash@{1} leaves refs/stash pointing at stash@{0}: only the list shows it.
        assert_ne!(print(&two, None), print(&facts(vec![stash("s0")]), None));

        let mine = [pr(1, "a")];
        let with_other = [pr(1, "a"), pr(2, "elsewhere")];
        assert_eq!(print(&two, Some(&mine)), print(&two, Some(&with_other)), "a PR of another branch changes nothing here");
        assert_ne!(print(&two, Some(&mine)), print(&two, Some(&[])), "this branch's PR does");
        assert_ne!(print(&two, None), print(&two, Some(&[])), "not asked is not the same as none found");

        let unreadable = RepoFacts { stashes: None, ..facts(vec![]) };
        assert_eq!(print(&unreadable, None), None, "an input git could not read allows no takeover");

        // The same refs, read when they no longer stand for the server: ContainedInRemote may be gone.
        assert_ne!(print_at(&two, None, true), print_at(&two, None, false));
    }

    #[test]
    fn an_ignore_that_runs_out_changes_the_fingerprint_and_nothing_else_does_with_time() {
        let facts = RepoFacts { refs: "refs/heads/a\0t".into(), worktrees: Some("worktree /r".into()), stashes: Some(Vec::new()), fetch_head: None, common_dir: None };
        let ignore = crate::config::Ignore { identity: "id".into(), branch: "a".into(), scope: crate::config::IgnoreScope::Both, until: Some(10_000) };
        let config = Config { ignores: vec![ignore], ..Config::default() };
        let candidates = [branch("a", "refs/remotes/origin/a")];
        let snapshot = Snapshot::default();
        let at = |now: i64| fingerprint(&FingerprintInputs { facts: &facts, config: &config, candidates: &candidates, default: None, snapshot: &snapshot, prs: None, remotes_fresh: true, now });
        // Within one UTC day: the ignore ran out in between, and the branch counts again.
        assert_ne!(at(9_000), at(11_000), "an ignore that ran out");
        assert_eq!(at(11_000), at(11_000 + 3 * 86_400), "no ignore left to run out: the clock changes nothing");
        assert_eq!(at(1_000), at(9_000), "the same ignores in force");
    }

    #[test]
    fn the_commits_counted_and_listed_come_from_one_rule() {
        let ranges = |default, never_pushed, pushed_here| commit_ranges(default, "tip", never_pushed, pushed_here);
        let on_no_remote = vec!["tip".to_string(), "--not".into(), "--remotes".into()];
        let r = ranges(Some("refs/remotes/origin/main"), false, Some("p"));
        assert_eq!((r.own, r.unpushed), (vec!["refs/remotes/origin/main..tip".to_string()], Some(vec!["p..tip".to_string()])));
        assert_eq!(ranges(Some("d"), false, Some("tip")).unpushed, Some(Vec::new()), "pushed as it is: nothing to ask");
        assert_eq!(ranges(Some("d"), false, None).unpushed, None, "the pushed commit is not here: unknown, not none");
        assert_eq!(ranges(Some("d"), true, None).unpushed, Some(on_no_remote.clone()), "never pushed: on no remote");
        let r = ranges(None, true, None);
        assert_eq!(r.own, on_no_remote, "no default branch: the own commits are those on no remote");
        assert_eq!(r.unpushed.as_ref(), Some(&r.own), "and the same range is read once");
    }

    #[test]
    fn remote_refs_stand_for_the_server_after_a_fetch_or_a_light_check_within_the_window() {
        let (now, hour) = (1_000_000, 3600);
        assert!(remotes_fresh(true, None, None, now), "this scan's fetch");
        assert!(remotes_fresh(false, Some(now - 11 * hour), None, now));
        assert!(!remotes_fresh(false, Some(now - 13 * hour), None, now), "FETCH_HEAD aged over 12 h");
        assert!(remotes_fresh(false, Some(now - 13 * hour), Some(now - hour), now), "a light check found them equal since");
        assert!(!remotes_fresh(false, None, Some(now - 13 * hour), now));
        assert!(!remotes_fresh(false, None, None, now), "never fetched");
    }
}
