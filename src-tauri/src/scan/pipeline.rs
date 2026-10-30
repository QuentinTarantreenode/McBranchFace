//! A full scan of every repository below the configured folders, independent of Tauri: the app hands
//! in a sink that emits events, the headless scan one that prints.
//!
//! Each repository runs its own pipeline: the light check (once per repository identity), the fetch,
//! the local assessment and the server branches. No step waits for the same step of all others; the
//! app's process budget bounds how many run at once.

use std::collections::{BTreeMap, HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Instant;

use futures::stream::{FuturesUnordered, StreamExt};
use tokio::sync::OnceCell;

use crate::analysis::{self, Fetched, ScanOptions, SharedPrs};
use crate::config::Config;
use crate::git::discovery::{self, FoundRepo};
use crate::git::identity::{self, RepoOrigin};
use crate::git::runner::{Git, Prompts};
use crate::git::snapshot::SnapshotEntry;
use crate::model::*;
use crate::online;
use crate::providers;
use crate::server_check::{self, Heads, ServerHeads, Unreached};
use crate::state::caches::{Cache, CachedPrs};
use crate::state::{lock, AppState};

use super::cancel::Cancel;
use super::sign_in::{Entry, SignIns};

/// What a scan works with besides the repositories.
pub struct ScanDeps<'a> {
    pub state: &'a AppState,
    /// The providers' command line; None: az and gh of the system.
    pub cli: Option<Arc<dyn providers::Cli>>,
    /// Stops the scan: running git and provider processes end, what landed stays.
    pub cancel: Arc<Cancel>,
}

impl<'a> ScanDeps<'a> {
    pub fn new(state: &'a AppState) -> Self {
        Self { state, cli: None, cancel: Arc::default() }
    }
}

/// Where a scan's results go as they come in.
pub trait ScanSink: Sync {
    /// Every repository found, before the first is assessed.
    fn started(&self, e: &ScanStarted);
    /// One repository's local assessment, as soon as it landed.
    fn repo(&self, r: &RepoResult);
    /// One repository's server branches, after its local result.
    fn online(&self, e: &OnlineScanned);
}

#[derive(Debug, Clone, Copy, Default)]
pub struct ScanRequest {
    pub fetch: bool,
    /// The light check (ls-remote) asks every repository first; only working copies whose
    /// remote-tracking refs differ from the server are fetched and asked for pull requests.
    pub changed_only: bool,
    /// The user started it: a sign-in may ask, once per server (see `sign_in`). A scan the app
    /// started itself never asks anything.
    pub interactive: bool,
}

impl ScanRequest {
    fn prompts(&self) -> Prompts {
        if self.interactive { Prompts::Allowed } else { Prompts::Never }
    }
}

/// What a scan gets of the pull requests.
pub(crate) struct PrInputs {
    /// Ask the provider.
    pub ask: bool,
    /// The list to use without asking.
    pub cached: Option<Vec<PullRequestInfo>>,
    /// The list that stands in when asking fails, and when it was read.
    pub fallback: Option<(Vec<PullRequestInfo>, i64)>,
    /// The cached list, used or standing in, was capped when the provider gave it.
    pub capped: bool,
}

/// Where a scan's pull requests come from: a fetch asks the provider anew, and the last list stands
/// in should that fail; without a fetch the last list stands, and where there is none (first start, a
/// new cache version) the provider is asked, or the repo would have no pull request evidence at all.
pub(crate) fn pr_inputs(use_providers: bool, fetch: bool, cached: impl FnOnce() -> Option<CachedPrs>) -> PrInputs {
    match cached() {
        Some(last) if !fetch => PrInputs { ask: false, cached: Some(last.list), fallback: None, capped: last.capped },
        last => PrInputs { ask: use_providers, cached: None, capped: last.as_ref().is_some_and(|l| l.capped), fallback: last.map(|l| (l.list, l.at)) },
    }
}

/// The rule for which working copy of a repository assesses its server branches: `holder`, the copy
/// whose result holds them now, while it is reachable; otherwise the first reachable copy by path. A
/// new copy that sorts first takes nothing over. One rule for the full scan and for the refresh of a
/// single repository.
pub fn primary_copy<'a>(reachable_copies: impl IntoIterator<Item = &'a str>, holder: Option<&str>) -> Option<&'a str> {
    let reachable: Vec<&'a str> = reachable_copies.into_iter().collect();
    holder
        .and_then(|h| reachable.iter().copied().find(|c| crate::paths::same_path(c, h)))
        .or_else(|| reachable.into_iter().min_by(|a, b| Path::new(a).cmp(Path::new(b))))
}

/// Whether `path` assesses the server branches of its repository: it is the primary copy among the
/// reachable ones (or none is known), and the repository is not excluded.
pub fn assesses_online<'a>(path: &str, identity: &str, excluded: &[String], reachable_copies: impl IntoIterator<Item = &'a str>, holder: Option<&str>) -> bool {
    !excluded.iter().any(|x| x == identity) && primary_copy(reachable_copies, holder).is_none_or(|p| crate::paths::same_path(p, path))
}

/// The repos whose server branches a light check found exactly as their remote-tracking refs.
pub(crate) fn unchanged_on_server(heads: &[ServerHeads]) -> impl Iterator<Item = &str> {
    heads.iter().filter(|h| !h.changed && h.error_kind.is_none()).map(|h| h.path.as_str())
}

/// Takes in light checks: where the server's branches are as the refs say, the refs count as current.
pub(crate) fn note_server_heads(heads: &[ServerHeads], at: i64) {
    for path in unchanged_on_server(heads) {
        analysis::note_remotes_verified(path, at);
    }
}

/// The server's branches per repository identity, asked once per scan from whichever working copy
/// comes first: k copies of one repository cost one authenticated round trip, not k.
#[derive(Default)]
struct ServerAnswers(Mutex<HashMap<String, Arc<OnceCell<ServerAnswer>>>>);

type ServerAnswer = Result<Heads, Unreached>;

/// Every ref the copies of one repository know, with what the snapshot says of it.
type SiblingRefs = Arc<BTreeMap<String, SnapshotEntry>>;

impl ServerAnswers {
    async fn of(&self, identity: &str, ask: impl std::future::Future<Output = ServerAnswer>) -> ServerAnswer {
        let cell = lock(&self.0).entry(identity.to_string()).or_default().clone();
        cell.get_or_init(|| ask).await.clone()
    }
}

/// One repository of the scan, with what the scan found before its pipeline starts.
struct Repo<'a> {
    found: &'a FoundRepo,
    path: String,
    origin: RepoOrigin,
    /// Every working copy of the same repository, this one included; their snapshots fill gaps in
    /// this one's.
    copies: Vec<PathBuf>,
    /// This copy assesses the repository's server branches.
    online: bool,
    /// The server that signs its fetch in; None for a folder on disk.
    server: Option<String>,
}

/// One scan, shared by the pipelines of its repositories.
struct Run<'a, S> {
    state: &'a AppState,
    config: &'a Config,
    request: ScanRequest,
    sink: &'a S,
    cli: Option<Arc<dyn providers::Cli>>,
    shared_prs: SharedPrs,
    servers: ServerAnswers,
    sign_ins: SignIns,
    /// The snapshots of each repository's copies, merged once per scan.
    sibling_refs: Mutex<HashMap<String, Arc<OnceCell<SiblingRefs>>>>,
}

impl<S: ScanSink> Run<'_, S> {
    /// check → fetch → assess → server branches, each step with a slot of the process budget.
    async fn repo(&self, r: &Repo<'_>) {
        let (state, config) = (self.state, self.config);
        let ScanRequest { fetch, changed_only, .. } = self.request;
        // None: no light check, the repo counts as moved. A check that failed did not reach the
        // server: that is said as a failed fetch, not "unchanged", and nothing is fetched.
        let checked = match fetch && changed_only {
            true => Some(self.check(r).await),
            false => None,
        };
        let moved = checked.as_ref().is_none_or(|c| c.as_ref().is_ok_and(|h| h.changed));
        let unreached = checked.and_then(Result::err);
        let fetches = fetch && moved;

        let fetched = match (fetches && config.fetch_on_scan, &unreached) {
            (true, _) => Some(self.fetch(r).await),
            (false, Some(u)) => Some(Some(Fetched::unreached(u.clone()))),
            (false, None) => None,
        };

        let slot = state.budget.acquire().await;
        let generation = state.generations.begin();
        let (previous, verify_files) = state.previous(&r.path);
        let prs = pr_inputs(config.use_providers, fetches, || state.last_prs(&r.origin.identity));
        let opts = ScanOptions {
            fetched: fetched.clone().flatten(),
            providers: prs.ask,
            cached_prs: prs.cached,
            fallback_prs: prs.fallback,
            prs_capped: prs.capped,
            previous,
            verify_files,
            shared_prs: Some(self.shared_prs.clone()),
            wants_prs: r.online,
            sibling_refs: self.sibling_refs(r).await,
            origin: Some(r.origin.clone()),
            cli: self.cli.clone(),
            ..Default::default()
        };
        let mut scan = analysis::scan_repo(r.found, config, &state.snapshots, opts).await;
        drop(slot);
        // Only a list the provider gave now: a cached or stand-in list keeps the time it was read.
        let asked = scan.prs_asked_at.zip(scan.prs.take());
        if state.land(generation, &mut scan, r.online) {
            // Kept only with a result that landed: an assessment that came too late keeps nothing.
            if let Some((at, prs)) = asked {
                state.store_prs(&r.origin.identity, prs, at, scan.prs_capped);
            }
            if unreached.is_some() {
                state.set_online_fetched(&r.path, false);
                scan.result.online_fetched = false;
            }
            self.sink.repo(&scan.result);
        }
        // Also when a newer local result landed: the server branches still need this scan's look.
        // Where the server did not move, they are as the last run assessed them.
        if r.online && moved && unreached.is_none() {
            let job = OnlineJob {
                generation: state.generations.begin(),
                path: r.found.path.clone(),
                identity: r.origin.identity.clone(),
                provider: scan.result.repo.provider,
                default_ref: scan.default_ref.take(),
                fetched: fetched.map(|f| f.is_some_and(|f| f.reached)),
            };
            if let Some(event) = assess_online(state, config, job).await {
                self.sink.online(&event);
            }
        }
    }

    /// What the other copies of the repository know of its refs; None for a repository with one copy.
    async fn sibling_refs(&self, r: &Repo<'_>) -> Option<SiblingRefs> {
        if r.copies.len() < 2 {
            return None;
        }
        let cell = lock(&self.sibling_refs).entry(r.origin.identity.clone()).or_default().clone();
        Some(cell.get_or_init(|| async { Arc::new(self.state.snapshots.merged(&r.copies).await) }).await.clone())
    }

    /// The light check of one working copy against its repository's answer.
    async fn check(&self, r: &Repo<'_>) -> Result<ServerHeads, Unreached> {
        let ask = async {
            let entry = self.sign_ins.enter(r.server.as_deref()).await;
            if let (Entry::Refused(first), Some(server)) = (&entry, &r.server) {
                let detail = format!("{server} refused the sign-in for {first} earlier in this scan");
                return Err(Unreached { kind: FailureKind::AuthRequired, detail });
            }
            let _slot = self.state.budget.acquire().await;
            let answer = server_check::server_branches(&Git::new(&r.found.path), self.request.prompts()).await;
            entry.settle(&r.path, answer.as_ref().err().map(|u| u.kind));
            answer
        };
        let server = self.servers.of(&r.origin.identity, ask).await?;
        let _slot = self.state.budget.acquire().await;
        let heads = server_check::compare(&r.path, &server).await;
        note_server_heads(std::slice::from_ref(&heads), crate::git::snapshot::now());
        match heads.error_kind {
            Some(kind) => Err(Unreached { kind, detail: format!("the remote-tracking refs of {} could not be read", r.path) }),
            None => Ok(heads),
        }
    }

    /// The fetch under the repository's refs lock, with a slot of its own.
    async fn fetch(&self, r: &Repo<'_>) -> Option<Fetched> {
        let entry = self.sign_ins.enter(r.server.as_deref()).await;
        if let (Entry::Refused(first), Some(server)) = (&entry, &r.server) {
            return Some(Fetched::refused(server, first));
        }
        let (_refs, _slot) = self.state.repo_locks.refs_with_slot(&r.path, &self.state.budget).await;
        let fetched = analysis::fetch(&Git::new(&r.found.path), &self.state.snapshots, self.request.prompts()).await.ok();
        entry.settle(&r.path, fetched.as_ref().and_then(|f| f.kind));
        fetched
    }
}

/// The server branches of one primary copy, assessed as soon as its local result is in.
struct OnlineJob {
    /// Taken before the refs are read; see `Generations`.
    generation: u64,
    path: PathBuf,
    identity: String,
    provider: ProviderKind,
    default_ref: Option<String>,
    /// Whether this scan's fetch of the copy reached the server; None without a fetch.
    fetched: Option<bool>,
}

/// None when a newer assessment or a delete on the server came first: its view is the one that stands.
async fn assess_online(state: &AppState, config: &Config, job: OnlineJob) -> Option<OnlineScanned> {
    let _slot = state.budget.acquire().await;
    let path = job.path.to_string_lossy().to_string();
    let prs = state.prs_of_identity(&job.identity);
    let prs = online::PrView::of(job.provider, config.use_providers, prs.as_deref());
    let r = online::scan_with_default(&job.path, config, &job.identity, prs, job.default_ref.as_deref()).await;
    let at = crate::git::snapshot::now();
    match r {
        Ok(scan) => {
            let fetched = state.land_online(job.generation, &path, scan.branches.clone(), at, job.fetched)?;
            Some(OnlineScanned { path, branches: scan.branches, warnings: scan.warnings, error: None, at, fetched })
        }
        Err(e) => Some(OnlineScanned { path, branches: Vec::new(), warnings: Vec::new(), error: Some(format!("{e:#}")), at, fetched: false }),
    }
}

pub async fn run_scan(deps: &ScanDeps<'_>, sink: &impl ScanSink, request: ScanRequest) -> ScanFinished {
    let state = deps.state;
    let started = Instant::now();
    let config = state.config_snapshot().await;
    let config = &config;
    let found = discovery::discover_keyed(&config.roots, config.scan_depth).await;
    // Discovery asked git for each repo's common directory already: the locks need no call of their own.
    for (r, common) in &found {
        if let Some(common) = common {
            state.repo_locks.note(&r.path.to_string_lossy(), common);
        }
    }
    let found: Vec<FoundRepo> = found.into_iter().map(|(r, _)| r).collect();

    // Identities first: working copies of one repository share snapshots, one answer of the server,
    // and only one copy of each repository assesses the server branches (see `primary_copy`).
    let limit = config.concurrency.max(1) as usize;
    let paths: Vec<PathBuf> = found.iter().map(|r| r.path.clone()).collect();
    let origins = crate::bounded::bounded(paths, limit, |p| async move {
        let _slot = state.budget.acquire().await;
        identity::origin_of(&Git::new(&p)).await
    })
    .await;
    let mut copies: BTreeMap<&str, Vec<&Path>> = BTreeMap::new();
    for (r, o) in found.iter().zip(&origins) {
        copies.entry(o.identity.as_str()).or_default().push(&r.path);
    }
    let repos: Vec<Repo> = found
        .iter()
        .zip(&origins)
        .map(|(r, o)| {
            let path = r.path.to_string_lossy().to_string();
            let same = &copies[o.identity.as_str()];
            let reachable = same.iter().map(|p| p.to_str().unwrap_or_default());
            let holder = state.online_holder(&o.identity);
            Repo {
                online: config.scan_online && assesses_online(&path, &o.identity, &config.online_excluded, reachable, holder.as_deref()),
                server: o.remote_url.as_deref().and_then(providers::remote_url::sign_in_server),
                copies: same.iter().map(|p| p.to_path_buf()).collect(),
                found: r,
                path,
                origin: o.clone(),
            }
        })
        .collect();

    let placeholder = |r: &Repo| RepoInfo {
        path: r.path.clone(),
        name: r.found.path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default(),
        root: r.found.root.clone(),
        provider: ProviderKind::None,
        remote_url: None,
        default_branch: None,
        identity: r.origin.identity.clone(),
        links: None,
    };
    sink.started(&ScanStarted { repos: repos.iter().map(placeholder).collect() });

    let run = Run {
        state,
        config,
        request,
        sink,
        cli: deps.cli.clone(),
        shared_prs: SharedPrs::default(),
        servers: ServerAnswers::default(),
        sign_ins: SignIns::default(),
        sibling_refs: Mutex::default(),
    };
    let mut pipelines: FuturesUnordered<_> = repos.iter().map(|r| run.repo(r)).collect();
    let all = async { while pipelines.next().await.is_some() {} };
    // Dropping the pipelines ends their git and provider processes, with everything they started.
    let cancelled = tokio::select! {
        _ = all => false,
        _ = deps.cancel.cancelled() => true,
    };
    drop(pipelines);

    // A full scan saw every repo there is: entries of removed folders would otherwise be cached forever.
    let seen: HashSet<String> = repos.iter().map(|r| r.path.clone()).collect();
    state.prune(&seen, &config.roots).await;
    // A stopped scan did not finish: the time of the last full one stays.
    if !cancelled {
        *lock(&state.scanned_at) = Some(crate::git::snapshot::now());
    }
    state.persist(&[Cache::Results, Cache::Prs, Cache::Assessed, Cache::Statuses, Cache::MergeEvidence]).await;

    ScanFinished { duration_ms: started.elapsed().as_millis() as u32, repo_count: repos.len() as u32, cancelled }
}

impl AppState {
    /// The rule of a full scan for one repo, from the copies known now (see `assesses_online`). Which
    /// of them are there is asked after the results' lock is let go.
    pub(crate) async fn assesses_online(&self, path: &str, identity: &str, config: &Config) -> bool {
        let copies = self.copies_of(identity);
        let mut reachable = Vec::with_capacity(copies.len());
        for copy in &copies {
            if self.reach.folder(copy, &config.roots).await {
                reachable.push(copy.as_str());
            }
        }
        let holder = self.online_holder(identity);
        assesses_online(path, identity, &config.online_excluded, reachable, holder.as_deref())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_unchanged_repo_without_cached_pull_requests_still_asks_the_provider() {
        let run = |use_providers, fetch, cached: Option<Vec<PullRequestInfo>>| {
            let p = pr_inputs(use_providers, fetch, || cached.map(|list| CachedPrs { at: 7, list, capped: false }));
            (p.ask, p.cached.map(|p| p.len()), p.fallback.map(|(l, at)| (l.len(), at)))
        };
        assert_eq!(run(true, false, None), (true, None, None), "first start after a cache bump: no evidence otherwise");
        assert_eq!(run(true, false, Some(Vec::new())), (false, Some(0), None), "the last list stands in");
        assert_eq!(run(false, false, None), (false, None, None), "providers switched off");
    }

    #[test]
    fn a_fetch_asks_anew_and_keeps_the_last_list_for_a_failed_query() {
        let p = pr_inputs(true, true, || Some(CachedPrs { at: 7, list: Vec::new(), capped: false }));
        assert!(p.ask && p.cached.is_none());
        assert_eq!(p.fallback.map(|(l, at)| (l.len(), at)), Some((0, 7)), "a failure is never taken for \"no pull requests\"");
        assert!(pr_inputs(true, true, || None).fallback.is_none());
    }

    #[test]
    fn a_light_check_that_found_the_server_unchanged_vouches_for_the_refs() {
        let heads = [
            ServerHeads { path: "C:/same".into(), changed: false, error_kind: None },
            ServerHeads { path: "C:/moved".into(), changed: true, error_kind: None },
            ServerHeads { path: "C:/offline".into(), changed: false, error_kind: Some(FailureKind::Network) },
        ];
        // A move is followed by a fetch; a server out of reach was not compared at all.
        assert_eq!(unchanged_on_server(&heads).collect::<Vec<_>>(), ["C:/same"]);
    }

    #[test]
    fn the_first_reachable_copy_by_path_assesses_the_server_branches() {
        let copies = ["C:/ws/b", "C:/ws/a-agent-1", "C:/ws/a"];
        assert_eq!(primary_copy(copies, None), Some("C:/ws/a"));
        assert!(assesses_online("C:/ws/a", "id", &[], copies, None));
        assert!(!assesses_online("C:/ws/b", "id", &[], copies, None), "another copy assesses");
        assert!(!assesses_online("C:/ws/a", "id", &["id".to_string()], copies, None), "excluded");
        assert!(assesses_online("C:/ws/b", "id", &[], [], None), "no copy known: this one");
        assert!(assesses_online("C:\\ws\\a\\", "id", &[], copies, None), "however the path is spelled");
    }

    // The held copy is named in another spelling (case, separators): the same folder only on Windows.
    #[cfg(windows)]
    #[test]
    fn the_copy_that_holds_the_server_branches_keeps_them_while_it_is_reachable() {
        let copies = ["C:/ws/b", "C:/ws/a-agent-1", "C:/ws/a"];
        assert_eq!(primary_copy(copies, Some("c:\\ws\\b\\")), Some("C:/ws/b"), "a copy that sorts first takes nothing over");
        assert_eq!(primary_copy(copies, Some("C:/ws/gone")), Some("C:/ws/a"), "out of reach: the first by path");
        assert!(assesses_online("C:/ws/b", "id", &[], copies, Some("C:/ws/b")));
        assert!(!assesses_online("C:/ws/a", "id", &[], copies, Some("C:/ws/b")));
    }
}
