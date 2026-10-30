//! What the app keeps between commands: the configuration, the last results of every repository and
//! the caches that bring them back after a restart. Plain data and locks, no Tauri: the headless scan
//! and the tests build one of their own.

pub mod budget;
pub mod caches;
pub mod landing;
pub mod reach;

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::atomic::AtomicBool;

use tokio::sync::{Mutex, RwLock};

use crate::config::{self, Config, StartupIssue};
use crate::git::merged;
use crate::git::snapshot::SnapshotStore;
use crate::journal::Journal;
use crate::locks::RepoLocks;
use crate::model::*;
use crate::watch::RepoWatcher;

use caches::{read_cache, CacheFiles, CachedPrs, ResultsCache};
use landing::Generations;

pub struct AppState {
    /// The app data folder this state reads and writes: config::app_dir() in the app.
    pub(crate) dir: PathBuf,
    pub(crate) config: RwLock<Config>,
    pub(crate) startup_issues: Vec<StartupIssue>,
    pub(crate) snapshots: SnapshotStore,
    pub(crate) journal: Journal,
    pub(crate) prs: std::sync::Mutex<HashMap<String, CachedPrs>>,
    pub(crate) scanning: AtomicBool,
    /// Serializes what writes files shared by all repos: the delete journal, its backups, new working
    /// copies. Lock order: the repo locks first, then this one, and it is held only for the work that
    /// needs it. Waiting for a repo (a push may hold it for minutes) never blocks the other repos.
    pub(crate) write_lock: Mutex<()>,
    /// One per repo, for what writes its refs; taken before `write_lock`, never after it.
    pub(crate) repo_locks: RepoLocks,
    /// Last result per repo; persisted so the next start shows data before any git call.
    pub(crate) results: std::sync::Mutex<HashMap<String, RepoResult>>,
    /// When the last full scan finished; persisted with the results.
    pub(crate) scanned_at: std::sync::Mutex<Option<i64>>,
    /// Which assessment of a repo is the newest; see `Generations`.
    pub(crate) generations: Generations,
    pub(crate) watcher: std::sync::Mutex<Option<RepoWatcher>>,
    pub(crate) caches: CacheFiles,
    /// Running network operations by id, so the UI can cancel them.
    pub(crate) running_ops: std::sync::Mutex<HashMap<String, std::sync::Arc<tokio::sync::Notify>>>,
    /// Last git state per worktree, keyed by `path_key`; persisted so the next start shows branches and changes at once.
    pub(crate) statuses: std::sync::Mutex<HashMap<String, RepoStatus>>,
    pub(crate) status_dirty: AtomicBool,
    /// Fingerprint of the inputs of each repo's last assessment (see `analysis::fingerprint`).
    pub(crate) assessed: std::sync::Mutex<HashMap<String, u64>>,
    /// Repos the watcher reported since their last assessment: their files may have changed, which
    /// the fingerprint does not see.
    pub(crate) touched: std::sync::Mutex<HashSet<String>>,
    /// Per repo, the generation from which on the watcher sees its changes (see `AppState::previous`).
    /// Missing: not watched, or one of its folders could not be.
    pub(crate) watched_since: std::sync::Mutex<HashMap<String, u64>>,
    /// Repos one of whose folders the watcher could not observe: the folder and why.
    pub(crate) unwatched: std::sync::Mutex<HashMap<String, (String, String)>>,
    /// Backup refs may lack a journal entry: at start (an earlier run may have failed to write it) and
    /// after a delete. "Recently deleted" looks for them only then, not on every open.
    pub(crate) orphans_unchecked: AtomicBool,
    /// Process slots shared by every background job (see `Budget`).
    pub(crate) budget: budget::Budget,
    /// Whether folders are there, without blocking on a drive that went away.
    pub(crate) reach: reach::Reach,
    /// The running scan's stop signal; None while no scan runs.
    pub(crate) scan_cancel: std::sync::Mutex<Option<std::sync::Arc<crate::scan::Cancel>>>,
}

impl AppState {
    pub fn new(config: Config, startup_issues: Vec<StartupIssue>) -> Self {
        Self::with_dir(config, startup_issues, config::app_dir())
    }

    /// The state of the app data folder `dir`; the headless scan points it at a folder of its own.
    pub fn with_dir(config: Config, mut startup_issues: Vec<StartupIssue>, dir: PathBuf) -> Self {
        let cache_dir = dir.join("cache");
        merged::load_cache(&cache_dir.join(caches::MERGE_CACHE));
        let last: ResultsCache = read_cache(&cache_dir.join(caches::RESULTS_CACHE));
        let results: HashMap<String, RepoResult> = last.results.into_iter().map(|r| (crate::paths::path_key(&r.repo.path), r)).collect();
        let statuses: Vec<RepoStatus> = read_cache(&cache_dir.join(caches::STATUS_CACHE));
        // A worktree a crashed run left under a probe name gets its name back before anything looks for it;
        // one that cannot is for the user to rename.
        let stranded = crate::preflight::recover_probes(statuses.iter().flat_map(|s| s.worktrees.iter().map(|w| Path::new(&w.path))));
        if !stranded.is_empty() {
            let slashes = |p: &Path| crate::paths::slashes(&p.to_string_lossy());
            let folders = stranded.iter().map(|(at, wt)| config::ProbeLeftover { path: slashes(at), original: slashes(wt) }).collect();
            startup_issues.push(StartupIssue::ProbeLeftovers { folders });
        }
        let prs: HashMap<String, CachedPrs> = match cache_dir.join(caches::PRS_CACHE).exists() {
            true => read_cache(&cache_dir.join(caches::PRS_CACHE)),
            false => caches::prs_by_identity(read_cache(&cache_dir.join(caches::PRS_CACHE_V3)), &results),
        };
        // The fingerprints of the last run: the first scan takes over every repo whose refs and files are
        // as they were, instead of assessing each branch again.
        let assessed: HashMap<String, u64> = caches::rekey(read_cache(&cache_dir.join(caches::ASSESSED_CACHE)));
        // Only now: an older cache that is carried over must be read first.
        caches::remove_old_caches(&cache_dir);
        let config_concurrency = config.concurrency as usize;
        Self {
            config: RwLock::new(config),
            startup_issues,
            snapshots: SnapshotStore::new(dir.join("snapshots")),
            journal: Journal::new(dir.join("deleted.jsonl")),
            prs: std::sync::Mutex::new(prs),
            scanning: AtomicBool::new(false),
            write_lock: Mutex::new(()),
            repo_locks: Default::default(),
            results: std::sync::Mutex::new(results),
            scanned_at: std::sync::Mutex::new(last.scanned_at),
            generations: Generations::default(),
            watcher: std::sync::Mutex::new(None),
            caches: CacheFiles::new(cache_dir),
            running_ops: std::sync::Mutex::new(HashMap::new()),
            statuses: std::sync::Mutex::new(statuses.into_iter().map(|s| (crate::paths::path_key(&s.path), s)).collect()),
            status_dirty: AtomicBool::new(false),
            assessed: std::sync::Mutex::new(assessed),
            touched: Default::default(),
            watched_since: Default::default(),
            unwatched: Default::default(),
            orphans_unchecked: AtomicBool::new(true),
            budget: budget::Budget::new(config_concurrency),
            scan_cancel: std::sync::Mutex::new(None),
            reach: reach::Reach::default(),
            dir,
        }
    }

    pub async fn config_snapshot(&self) -> Config {
        self.config.read().await.clone()
    }

    pub async fn set_config(&self, config: Config) {
        *self.config.write().await = config;
    }

    /// Where discarded files and the files of force-removed worktrees are kept.
    pub(crate) fn backups_dir(&self) -> PathBuf {
        self.dir.join("backups")
    }

    /// The last result of every repo, for the headless scan and the start of the UI.
    pub fn results(&self) -> Vec<RepoResult> {
        let mut list: Vec<RepoResult> = lock(&self.results).values().cloned().collect();
        list.sort_by(|a, b| a.repo.path.cmp(&b.repo.path));
        list
    }

    pub(crate) fn known_repos(&self) -> Vec<String> {
        lock(&self.results).values().map(|r| r.repo.path.clone()).collect()
    }

    /// The last pull request list of a repository, by its identity: all its working copies share it.
    pub(crate) fn prs_of_identity(&self, identity: &str) -> Option<Vec<PullRequestInfo>> {
        lock(&self.prs).get(identity).map(|c| c.list.clone())
    }

    /// `prs_of_identity` of the repository a working copy belongs to, as its last result names it.
    pub(crate) fn prs_of(&self, path: &str) -> Option<Vec<PullRequestInfo>> {
        self.prs_of_identity(&self.identity_of(path)?)
    }

    pub(crate) fn last_prs(&self, identity: &str) -> Option<CachedPrs> {
        lock(&self.prs).get(identity).cloned()
    }

    /// A list read earlier than the one kept never replaces it.
    pub(crate) fn store_prs(&self, identity: &str, list: Vec<PullRequestInfo>, at: i64, capped: bool) {
        let mut map = lock(&self.prs);
        if map.get(identity).is_none_or(|kept| kept.at <= at) {
            map.insert(identity.to_string(), CachedPrs { at, list, capped });
        }
    }
}

/// A poisoned lock still holds data that is consistent for these maps: every writer replaces whole
/// entries.
pub(crate) fn lock<T>(m: &std::sync::Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|p| p.into_inner())
}

/// Whether a path lies in one of the folders, however its separators and case are spelled.
pub(crate) fn under_roots(path: &str, roots: &[String]) -> bool {
    roots.iter().any(|r| crate::paths::is_under(path, r))
}

#[cfg(test)]
mod tests {
    use super::*;

    // Case and separators are spelling only on Windows.
    #[cfg(windows)]
    #[test]
    fn cached_statuses_belong_to_the_folders_however_they_are_spelled() {
        let roots = vec!["C:\\ws\\Acme26".to_string()];
        assert!(under_roots("c:/ws/acme26/feature1/Core", &roots));
        assert!(under_roots("C:\\ws\\Acme26", &roots));
        // A sibling whose name only starts the same is not inside.
        assert!(!under_roots("C:/ws/Acme26-old/Core", &roots));
        assert!(!under_roots("D:/other", &roots));
    }

    #[test]
    fn a_worktree_left_under_its_probe_name_is_a_startup_issue_with_both_names() {
        let dir = tempfile::tempdir().unwrap();
        let wt = dir.path().join("ws").join("core-agent-1");
        let probe = |n: u32| dir.path().join("ws").join(format!("core-agent-1.4242-{n}.mcbranchface-probe"));
        std::fs::create_dir_all(probe(1)).unwrap();
        std::fs::create_dir_all(probe(2)).unwrap();
        let slashes = |p: &Path| crate::paths::slashes(&p.to_string_lossy());
        let status = serde_json::json!([{
            "path": slashes(&dir.path().join("ws").join("core")),
            "head": { "branch": "main", "oid": null, "upstream": null, "ahead": 0, "behind": 0, "unreferenced": 0 },
            "entries": [], "stashes": 0,
            "worktrees": [{ "path": slashes(&wt), "branch": "agent/1", "head": null, "isMain": false, "detached": false, "foreign": false, "unreferenced": 0 }]
        }]);
        std::fs::create_dir_all(dir.path().join("data").join("cache")).unwrap();
        std::fs::write(dir.path().join("data").join("cache").join(caches::STATUS_CACHE), status.to_string()).unwrap();
        let state = AppState::with_dir(Config::default(), Vec::new(), dir.path().join("data"));
        assert!(wt.is_dir(), "one probe folder got the name back");
        let [StartupIssue::ProbeLeftovers { folders }] = state.startup_issues.as_slice() else { panic!("{:?}", state.startup_issues) };
        assert_eq!(folders.len(), 1);
        assert_eq!(folders[0].original, slashes(&wt));
        assert!(Path::new(&folders[0].path).is_dir(), "the other is named where it is");
    }
}
