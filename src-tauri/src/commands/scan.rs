//! Scanning and watching: the Tauri side of the scan pipeline, single-repo refreshes and the light
//! server check.

use std::path::{Path, PathBuf};
use std::sync::atomic::Ordering;

use tauri::{AppHandle, Emitter, Manager, State};

use crate::analysis::{self, ScanOptions};
use crate::git::discovery::FoundRepo;
use crate::git::identity;
use crate::git::runner::{Git, Prompts};
use crate::gitops;
use crate::model::*;
use crate::online;
use crate::scan::pipeline::{note_server_heads, pr_inputs};
use crate::scan::{run_scan, ScanDeps, ScanRequest, ScanSink};
use crate::state::caches::Cache;
use crate::state::{lock, under_roots, AppState};
use crate::watch::{self, WatchedRepo};

use super::{emit_or_log, err, CmdResult};

/// Clears the "scan running" flag and the stop signal however the scan ends.
struct ScanGuard<'a>(&'a AppState);

impl Drop for ScanGuard<'_> {
    fn drop(&mut self) {
        *lock(&self.0.scan_cancel) = None;
        self.0.scanning.store(false, Ordering::SeqCst);
    }
}

/// The scan's results as events for the window.
struct Events<'a>(&'a AppHandle);

impl ScanSink for Events<'_> {
    fn started(&self, e: &ScanStarted) {
        emit_or_log(self.0, "scan-started", e);
    }

    fn repo(&self, r: &RepoResult) {
        emit_or_log(self.0, "scan-repo", r);
    }

    fn online(&self, e: &OnlineScanned) {
        emit_or_log(self.0, "scan-online", e);
    }
}

#[tauri::command]
/// `changed_only`: the light check (ls-remote) asks every repo first; only those whose server moved since
/// their last fetch are fetched and asked for pull requests. The start uses it: a full fetch of every repo
/// and copy cost a minute where nothing had changed. `interactive`: the user asked for it, so a sign-in
/// may ask (once per server); without it nothing ever asks.
pub async fn scan(app: AppHandle, state: State<'_, AppState>, fetch: bool, changed_only: Option<bool>, interactive: Option<bool>) -> CmdResult<ScanFinished> {
    if state.scanning.swap(true, Ordering::SeqCst) {
        return Err(AppError::new(ErrorCode::ScanRunning, ""));
    }
    let _running = ScanGuard(&state);
    let deps = ScanDeps::new(&state);
    *lock(&state.scan_cancel) = Some(deps.cancel.clone());
    let request = ScanRequest { fetch, changed_only: changed_only.unwrap_or(false), interactive: interactive.unwrap_or(false) };
    Ok(run_scan(&deps, &Events(&app), request).await)
}

/// Stops the running scan: its git and provider processes end, the results that landed stay, and the
/// scan returns with `cancelled`. False when no scan runs.
#[tauri::command]
pub fn cancel_scan(state: State<'_, AppState>) -> bool {
    match lock(&state.scan_cancel).as_ref() {
        Some(cancel) => {
            cancel.cancel();
            true
        }
        None => false,
    }
}

#[tauri::command]
pub async fn rescan_repo(state: State<'_, AppState>, path: String, root: String) -> CmdResult<RepoResult> {
    let config = state.config.read().await.clone();
    let prs = pr_inputs(config.use_providers, false, || state.identity_of(&path).and_then(|id| state.last_prs(&id)));
    let found = FoundRepo { path: PathBuf::from(&path), root };
    let opts = ScanOptions {
        fetch: false,
        providers: prs.ask,
        cached_prs: prs.cached,
        fallback_prs: prs.fallback,
        prs_capped: prs.capped,
        ..Default::default()
    };
    let slot = state.budget.acquire().await;
    let generation = state.generations.begin();
    state.untouch(&path);
    let mut scan = analysis::scan_repo(&found, &config, &state.snapshots, opts).await;
    drop(slot);
    let asked = scan.prs_asked_at.zip(scan.prs.take());
    // A single-repo rescan never changes which copy is assessed online, but an excluded repo keeps
    // no server branches: they would come back, deletable, with every watcher event.
    let assessed = !config.online_excluded.contains(&scan.result.repo.identity);
    if state.land(generation, &mut scan, assessed) {
        // Asked only where no list was known: kept, or every watcher event would ask again.
        if let Some((at, prs)) = asked {
            state.store_prs(&scan.result.repo.identity, prs, at, scan.prs_capped);
        }
        return Ok(scan.result);
    }
    // An assessment that started after this one is stored already; it is the answer.
    Ok(state.result_of(&path).unwrap_or(scan.result))
}

/// The commits of one branch as its last assessment counted them, for the window to show: the results
/// carry only the counts.
#[tauri::command]
pub async fn branch_commits(state: State<'_, AppState>, path: String, branch: String) -> CmdResult<BranchCommits> {
    let report = state.branch_report(&path, &branch).ok_or_else(|| AppError::new(ErrorCode::BranchGone, format!("{branch} in {path}")))?;
    let config = state.config_snapshot().await;
    analysis::branch_commits(&Git::new(&path), &config, &path, &report).await.map_err(err)
}

/// Results of the previous run, shown instantly on start while the fresh scan runs.
#[tauri::command]
pub async fn cached_results(state: State<'_, AppState>) -> CmdResult<Vec<RepoResult>> {
    let roots = state.config.read().await.roots.clone();
    Ok(state.results().into_iter().filter(|r| under_roots(&r.repo.path, &roots)).collect())
}

#[tauri::command]
pub async fn repo_status(app: AppHandle, state: State<'_, AppState>, path: String) -> CmdResult<RepoStatus> {
    let roots = state.config.read().await.roots.clone();
    let read = if state.reach.folder(&path, &roots).await {
        gitops::status::repo_status(&Git::new(&path)).await.map_err(err)
    } else {
        Err(AppError::new(ErrorCode::PathMissing, path.clone()))
    };
    {
        let mut map = lock(&state.statuses);
        match &read {
            Ok(st) => map.insert(crate::paths::path_key(&path), st.clone()),
            Err(_) => map.remove(&crate::paths::path_key(&path)),
        };
    }
    // Written at most every two seconds: forty answers at the start make one write.
    if !state.status_dirty.swap(true, Ordering::SeqCst) {
        tauri::async_runtime::spawn(async move {
            tokio::time::sleep(std::time::Duration::from_secs(2)).await;
            let state = app.state::<AppState>();
            state.status_dirty.store(false, Ordering::SeqCst);
            state.persist(&[Cache::Statuses]).await;
        });
    }
    read
}

/// The git state of the previous run for the repos under the folders, and when the last full scan
/// finished: the start shows both before the first git call.
#[tauri::command]
pub async fn cached_status(state: State<'_, AppState>) -> CmdResult<CachedStatus> {
    let roots = state.config.read().await.roots.clone();
    let statuses = lock(&state.statuses).values().filter(|s| under_roots(&s.path, &roots)).cloned().collect();
    let scanned_at = *lock(&state.scanned_at);
    Ok(CachedStatus { statuses, scanned_at })
}

/// Replaces the watched set; changes arrive as `repo-changed` events. Missing folders are skipped,
/// so one moved repository does not stop the others from being watched; a folder that cannot be
/// watched is skipped too, and its repo's next result says so (`RepoWarning::NotWatched`).
#[tauri::command]
pub async fn watch_repos(app: AppHandle, state: State<'_, AppState>, paths: Vec<String>) -> CmdResult<()> {
    let (limit, roots) = {
        let config = state.config.read().await;
        (config.concurrency.max(1) as usize, config.roots.clone())
    };
    let (state, roots) = (&*state, &roots);
    let found = crate::bounded::bounded(paths, limit, |p| async move {
        if !state.reach.folder(&p, roots).await {
            return None;
        }
        let git = Git::new(&p);
        let (common, worktrees) = tokio::join!(git.out(&["rev-parse", "--path-format=absolute", "--git-common-dir"]), git.out(&["worktree", "list", "--porcelain"]));
        // The common directory is the repo's lock key; the Git perspective locks by it without asking.
        if let Ok(common) = &common {
            state.repo_locks.note(&p, common.trim());
        }
        Some(WatchedRepo {
            path: PathBuf::from(&p),
            git_dir: PathBuf::from(common.ok()?.trim()),
            worktrees: gitops::status::parse_worktrees(&worktrees.unwrap_or_default()).into_iter().map(|w| PathBuf::from(w.path)).collect(),
        })
    })
    .await;
    let repos: Vec<WatchedRepo> = found.into_iter().flatten().collect();
    let names: Vec<String> = repos.iter().map(|r| r.path.to_string_lossy().to_string()).collect();
    let watcher = watch::watch(repos, move |ev| {
        app.state::<AppState>().touch(&ev.path);
        let _ = app.emit("repo-changed", ev);
    })
    .map_err(err)?;
    // From here on the watcher sees every change: only assessments that start now are covered by it.
    state.watching(&names, &watcher.failed);
    *lock(&state.watcher) = Some(watcher);
    Ok(())
}

/// The online lists of the last scan, e.g. after a restore pushed a branch back.
/// Re-assesses the server branches of one repository: after a fetch of its own, or on the refs a
/// fetch elsewhere (terminal, IDE) just brought in.
#[tauri::command]
/// `interactive`: the user asked for the fetch, so a sign-in may ask.
pub async fn refresh_online(state: State<'_, AppState>, path: String, fetch: bool, interactive: Option<bool>) -> CmdResult<OnlineScanned> {
    let config = state.config.read().await.clone();
    let git = Git::new(&path);
    let origin = identity::origin_of(&git).await;
    let provider = origin.remote_url.as_deref().map_or(ProviderKind::None, |u| crate::providers::kind_of(&crate::providers::remote_url::parse(u)));
    let id = origin.identity;
    let (mut fetched, mut error, mut warnings) = (None, None, Vec::new());
    if fetch {
        let (_repo, _slot) = state.repo_locks.refs_with_slot(&path, &state.budget).await;
        let prompts = if interactive.unwrap_or(false) { Prompts::Allowed } else { Prompts::Never };
        let f = analysis::fetch(&git, &state.snapshots, prompts).await.map_err(err)?;
        (fetched, error, warnings) = (Some(f.reached), f.error, f.warnings);
    }
    let at = crate::git::snapshot::now();
    // The rule of a full scan: another copy assesses this repository, or it is excluded.
    if !state.assesses_online(&path, &id, &config).await {
        state.forget_online(&path);
        return Ok(OnlineScanned { path, branches: Vec::new(), warnings, error, at, fetched: fetched.unwrap_or(false) });
    }
    let prs = state.prs_of_identity(&id);
    let prs = online::PrView::of(provider, config.use_providers, prs.as_deref());
    let slot = state.budget.acquire().await;
    let generation = state.generations.begin();
    let scan = online::scan(Path::new(&path), &config, &id, prs).await.map_err(err)?;
    drop(slot);
    warnings.extend(scan.warnings);
    match state.land_online(generation, &path, scan.branches.clone(), at, fetched) {
        Some(fetched) => Ok(OnlineScanned { path, branches: scan.branches, warnings, error, at, fetched }),
        // A newer assessment or a delete on the server came first: what stands now is the answer.
        None => {
            let (branches, at, fetched) = state.online_of(&path);
            Ok(OnlineScanned { path, branches, warnings, error, at, fetched })
        }
    }
}

/// The light server check for several repositories at once; see `server_check`.
#[tauri::command]
pub async fn server_heads(state: State<'_, AppState>, paths: Vec<String>) -> CmdResult<Vec<crate::server_check::ServerHeads>> {
    let (limit, roots) = {
        let config = state.config.read().await;
        (config.concurrency.max(1) as usize, config.roots.clone())
    };
    let (state, roots) = (&*state, &roots);
    let heads = crate::bounded::bounded(paths, limit, |p| async move {
        // A repo below a root out of reach is not asked: its folder would block on the drive first.
        if !state.reach.folder(&p, roots).await {
            return crate::server_check::ServerHeads { path: p, changed: false, error_kind: Some(FailureKind::RepoMissing) };
        }
        let _slot = state.budget.acquire().await;
        crate::server_check::check(&p).await
    })
    .await;
    note_server_heads(&heads, crate::git::snapshot::now());
    Ok(heads)
}

/// Fetch of one repository, e.g. after the server check saw a change; the snapshot is recorded
/// first because the prune removes what was pushed.
#[tauri::command]
pub async fn fetch_repo(state: State<'_, AppState>, path: String) -> CmdResult<bool> {
    let (_repo, _slot) = state.repo_locks.refs_with_slot(&path, &state.budget).await;
    // Started by the server check in the background: it never asks the user.
    let f = analysis::fetch(&Git::new(&path), &state.snapshots, Prompts::Never).await.map_err(err)?;
    Ok(f.reached)
}
