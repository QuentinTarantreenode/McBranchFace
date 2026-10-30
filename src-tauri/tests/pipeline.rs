//! The scan pipeline without Tauri: a state of its own in a temporary data folder, a sink that
//! collects what the window would get.
mod common;

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use common::*;
use mcbranchface_lib::config::Config;
use mcbranchface_lib::model::*;
use mcbranchface_lib::scan::{run_scan, ScanDeps, ScanRequest, ScanSink};
use mcbranchface_lib::state::AppState;

#[derive(Default)]
struct Collect {
    started: Mutex<Vec<String>>,
    repos: Mutex<Vec<RepoResult>>,
    online: Mutex<Vec<OnlineScanned>>,
}

impl ScanSink for Collect {
    fn started(&self, e: &ScanStarted) {
        self.started.lock().unwrap().extend(e.repos.iter().map(|r| r.path.clone()));
    }
    fn repo(&self, r: &RepoResult) {
        self.repos.lock().unwrap().push(r.clone());
    }
    fn online(&self, e: &OnlineScanned) {
        self.online.lock().unwrap().push(e.clone());
    }
}

/// Every working copy of the fixture's server, with a counter of the times the server is asked.
struct Copies {
    f: Fixture,
    count: PathBuf,
}

impl Copies {
    /// `work`, `server` and `extra` more clones of one repository.
    fn new(extra: usize) -> Self {
        let f = Fixture::new();
        let base = f.work.parent().unwrap().to_path_buf();
        let origin = base.join("origin.git");
        for i in 1..=extra {
            git(&base, &["clone", "-q", origin.to_str().unwrap(), &format!("copy-{i}")]);
        }
        let count = base.join("asked.txt");
        let c = Self { f, count };
        for copy in c.copies() {
            // git runs the upload pack through the shell with the server's path appended: each run is one
            // round trip to the server, an ls-remote or a fetch.
            let pack = format!("echo x >> '{}'; git upload-pack", c.count.to_string_lossy().replace('\\', "/"));
            git(&copy, &["config", "remote.origin.uploadpack", &pack]);
        }
        c
    }

    fn base(&self) -> &Path {
        self.f.work.parent().unwrap()
    }

    fn copies(&self) -> Vec<PathBuf> {
        let mut all: Vec<PathBuf> = std::fs::read_dir(self.base()).unwrap().flatten().map(|e| e.path()).filter(|p| p.join(".git").exists()).collect();
        all.sort();
        all
    }

    fn asked(&self) -> usize {
        std::fs::read_to_string(&self.count).map(|t| t.lines().count()).unwrap_or(0)
    }

    fn state(&self) -> AppState {
        let config = Config { roots: vec![self.base().to_string_lossy().to_string()], use_providers: false, my_emails: vec![EMAIL.into()], ..Config::default() };
        AppState::with_dir(config, Vec::new(), self.f.data.clone())
    }
}

#[tokio::test]
async fn the_light_check_asks_the_server_once_per_repository_not_once_per_copy() {
    let c = Copies::new(2);
    let state = c.state();
    let sink = Collect::default();
    let deps = ScanDeps::new(&state);
    let before = c.asked();
    let done = run_scan(&deps, &sink, ScanRequest { fetch: true, changed_only: true, ..Default::default() }).await;
    assert_eq!(done.repo_count as usize, c.copies().len(), "{:?}", sink.started.lock().unwrap());
    assert_eq!(c.asked() - before, 1, "{} copies of one repository, nothing changed: one ls-remote", c.copies().len());
    let repos = sink.repos.lock().unwrap();
    assert_eq!(repos.len(), c.copies().len(), "every copy assessed");
    assert!(repos.iter().all(|r| !r.fetched), "nothing moved, nothing fetched");
}

/// Sinks that note when each repo's result came, for timing across repositories.
#[derive(Default)]
struct Timed {
    started: Mutex<Option<std::time::Instant>>,
    repos: Mutex<Vec<(String, std::time::Duration)>>,
}

impl ScanSink for Timed {
    fn started(&self, _: &ScanStarted) {
        *self.started.lock().unwrap() = Some(std::time::Instant::now());
    }
    fn repo(&self, r: &RepoResult) {
        let at = self.started.lock().unwrap().unwrap().elapsed();
        self.repos.lock().unwrap().push((r.repo.path.clone(), at));
    }
    fn online(&self, _: &OnlineScanned) {}
}

#[tokio::test]
async fn a_slow_server_holds_up_no_other_repository() {
    let fast = Copies::new(0);
    let slow = Copies::new(0);
    for copy in slow.copies() {
        git(&copy, &["config", "remote.origin.uploadpack", "sleep 3; git upload-pack"]);
    }
    let roots = vec![fast.base().to_string_lossy().to_string(), slow.base().to_string_lossy().to_string()];
    let config = Config { roots, use_providers: false, ..Config::default() };
    let state = AppState::with_dir(config, Vec::new(), fast.f.data.clone());
    let sink = Timed::default();
    run_scan(&ScanDeps::new(&state), &sink, ScanRequest { fetch: true, changed_only: true, ..Default::default() }).await;
    let repos = sink.repos.lock().unwrap();
    let fast_base = fast.base().to_string_lossy().to_string();
    let first_fast = repos.iter().filter(|(p, _)| p.starts_with(&fast_base)).map(|(_, at)| *at).min().unwrap();
    let last_slow = repos.iter().filter(|(p, _)| !p.starts_with(&fast_base)).map(|(_, at)| *at).max().unwrap();
    assert!(last_slow >= std::time::Duration::from_secs(3), "the slow server took its time: {last_slow:?}");
    assert!(first_fast < std::time::Duration::from_secs(2), "the other repository did not wait for it: {first_fast:?}");
}

#[tokio::test]
async fn a_copy_behind_the_server_is_fetched_and_the_others_are_not() {
    let c = Copies::new(1);
    c.f.on_server(|s| commit(s, "new.txt", "new\n", "on the server"));
    // `server` pushed it and knows it; the other copies are behind.
    let state = c.state();
    let sink = Collect::default();
    run_scan(&ScanDeps::new(&state), &sink, ScanRequest { fetch: true, changed_only: true, ..Default::default() }).await;
    let repos = sink.repos.lock().unwrap();
    let fetched = |name: &str| repos.iter().find(|r| r.repo.path.ends_with(name)).map(|r| r.fetched);
    assert_eq!(fetched("work"), Some(true));
    assert_eq!(fetched("copy-1"), Some(true));
    assert_eq!(fetched("server"), Some(false), "its refs are what the server has");
}

#[tokio::test]
async fn a_new_copy_that_sorts_first_does_not_take_the_server_branches_over() {
    let c = Copies::new(0);
    let state = c.state();
    let online = |sink: &Collect| sink.online.lock().unwrap().iter().map(|e| e.path.clone()).collect::<Vec<_>>();
    let first = Collect::default();
    run_scan(&ScanDeps::new(&state), &first, ScanRequest::default()).await;
    let assessing = online(&first);
    assert_eq!(assessing.len(), 1, "one copy assesses the server branches: {assessing:?}");

    let origin = c.base().join("origin.git");
    git(c.base(), &["clone", "-q", origin.to_str().unwrap(), "a-new-copy"]);
    let second = Collect::default();
    run_scan(&ScanDeps::new(&state), &second, ScanRequest::default()).await;
    assert_eq!(online(&second), assessing, "the copy that assessed them goes on");
    let new = c.base().join("a-new-copy").to_string_lossy().to_string();
    assert!(state.results().iter().any(|r| r.repo.path == new && r.online.is_none()));
}

#[tokio::test]
async fn a_light_check_that_did_not_reach_the_server_says_so_at_every_copy() {
    let c = Copies::new(1);
    for copy in c.copies() {
        git(&copy, &["config", "remote.origin.uploadpack", "echo 'fatal: unable to access: Could not resolve host: example.invalid' >&2; exit 128"]);
    }
    let state = c.state();
    let sink = Collect::default();
    run_scan(&ScanDeps::new(&state), &sink, ScanRequest { fetch: true, changed_only: true, ..Default::default() }).await;
    let repos = sink.repos.lock().unwrap();
    assert_eq!(repos.len(), c.copies().len());
    for r in repos.iter() {
        assert!(!r.fetched && !r.online_fetched, "{}", r.repo.path);
        // Not fetched because the server was out of reach: said like a fetch that failed, with git's words.
        assert_eq!(r.fetch_error_kind, Some(FailureKind::Network), "{}: {:?}", r.repo.path, r.fetch_error);
        assert!(r.fetch_error.as_deref().is_some_and(|e| e.contains("Could not resolve host")), "{:?}", r.fetch_error);
    }
}

#[tokio::test]
async fn a_server_that_refused_the_sign_in_is_not_asked_again_in_the_same_scan() {
    let c = Copies::new(2);
    let origin = c.base().join("origin.git").to_string_lossy().replace('\\', "/");
    let url = "https://auth.example.invalid/team/repo.git";
    let refuse = format!("echo x >> '{}'; echo 'fatal: Authentication failed for {url}' >&2; exit 128", c.count.to_string_lossy().replace('\\', "/"));
    for copy in c.copies() {
        // The server named by the URL, reached in the folder: every call fails as with an expired token.
        git(&copy, &["config", &format!("url.{origin}.insteadOf"), url]);
        git(&copy, &["remote", "set-url", "origin", url]);
        git(&copy, &["config", "remote.origin.uploadpack", &refuse]);
    }
    let state = c.state();
    let sink = Collect::default();
    run_scan(&ScanDeps::new(&state), &sink, ScanRequest { fetch: true, ..Default::default() }).await;
    assert_eq!(c.asked(), 1, "{} copies on one server: asked once", c.copies().len());
    let repos = sink.repos.lock().unwrap();
    assert_eq!(repos.len(), c.copies().len(), "every copy still assessed locally");
    assert!(repos.iter().all(|r| r.fetch_error_kind == Some(FailureKind::AuthRequired)), "{:?}", repos.iter().map(|r| &r.fetch_error).collect::<Vec<_>>());
    let skipped = repos.iter().filter(|r| r.fetch_error.as_deref().is_some_and(|e| e.contains("earlier in this scan"))).count();
    assert_eq!(skipped, c.copies().len() - 1);
}

#[tokio::test]
async fn a_cancelled_scan_ends_its_processes_and_keeps_what_landed() {
    let fast = Copies::new(0);
    let slow = Copies::new(1);
    for copy in slow.copies() {
        git(&copy, &["config", "remote.origin.uploadpack", "sleep 30; git upload-pack"]);
    }
    let roots = vec![fast.base().to_string_lossy().to_string(), slow.base().to_string_lossy().to_string()];
    let config = Config { roots, use_providers: false, ..Config::default() };
    let state = AppState::with_dir(config, Vec::new(), fast.f.data.clone());
    let deps = ScanDeps::new(&state);
    let sink = Collect::default();
    let started = std::time::Instant::now();
    let cancel = deps.cancel.clone();
    let fast_base = fast.base().to_string_lossy().to_string();
    let fast_copies = fast.copies().len();
    // Cancelled once the fast repository has reported, not after a fixed time: a slow runner needs longer for
    // its fetch. The slow one waits 30 s, so the bound below only ends a scan that never reports.
    let stop = async {
        let bound = std::time::Instant::now() + std::time::Duration::from_secs(20);
        while std::time::Instant::now() < bound {
            let reported = sink.repos.lock().unwrap().iter().filter(|r| r.repo.path.starts_with(&fast_base)).count();
            if reported >= fast_copies {
                break;
            }
            tokio::time::sleep(std::time::Duration::from_millis(20)).await;
        }
        cancel.cancel();
        std::time::Instant::now()
    };
    let (done, cancelled_at) = tokio::join!(run_scan(&deps, &sink, ScanRequest { fetch: true, ..Default::default() }), stop);
    assert!(done.cancelled);
    assert!(cancelled_at.elapsed() < std::time::Duration::from_secs(10), "the fetches waiting 30 s were ended: {:?}", started.elapsed());
    let landed: Vec<String> = sink.repos.lock().unwrap().iter().map(|r| r.repo.path.clone()).collect();
    assert_eq!(landed.iter().filter(|p| p.starts_with(&fast_base)).count(), fast.copies().len(), "the fast repository's results stay: {landed:?}");
    assert_eq!(state.results().len(), landed.len(), "and only those landed");
}

/// gh answering with as many pull requests as the app asks for: older ones are missing.
struct CappedGh;

impl mcbranchface_lib::providers::Cli for CappedGh {
    fn run<'a>(&'a self, _: mcbranchface_lib::providers::Tool, _: &'a [&'a str], _: std::time::Duration) -> mcbranchface_lib::providers::CliFuture<'a> {
        let entries: Vec<String> = (1..=mcbranchface_lib::providers::PR_LIMIT)
            .map(|i| format!(r#"{{"number": {i}, "state": "OPEN", "headRefName": "b{i}", "baseRefName": "main", "url": "u"}}"#))
            .collect();
        let out = mcbranchface_lib::process::ProcOutput { code: Some(0), stdout: format!("[{}]", entries.join(",")), stderr: String::new() };
        Box::pin(async move { Ok(out) })
    }
}

#[tokio::test]
async fn a_capped_pull_request_list_is_said_also_when_it_comes_from_the_cache() {
    let c = Copies::new(0);
    let origin = c.base().join("origin.git").to_string_lossy().replace('\\', "/");
    let url = "https://github.com/o/r.git";
    for copy in c.copies() {
        git(&copy, &["config", &format!("url.{origin}.insteadOf"), url]);
        git(&copy, &["remote", "set-url", "origin", url]);
        // A branch to assess in every copy: only then are its pull requests asked for.
        git(&copy, &["branch", "topic"]);
    }
    let config = Config { roots: vec![c.base().to_string_lossy().to_string()], use_providers: true, fetch_on_scan: false, ..Config::default() };
    let capped = |sink: &Collect| {
        let repos = sink.repos.lock().unwrap();
        !repos.is_empty() && repos.iter().all(|r| r.warnings.iter().any(|w| matches!(w, RepoWarning::PrListCapped { .. })))
    };
    async fn scan(state: &AppState, request: ScanRequest) -> Collect {
        let deps = ScanDeps { cli: Some(std::sync::Arc::new(CappedGh)), ..ScanDeps::new(state) };
        let sink = Collect::default();
        run_scan(&deps, &sink, request).await;
        sink
    }

    let state = AppState::with_dir(config.clone(), Vec::new(), c.f.data.clone());
    assert!(capped(&scan(&state, ScanRequest { fetch: true, ..Default::default() }).await), "asked now");
    // Without a fetch the last list stands in: it is just as incomplete.
    let cached = scan(&state, ScanRequest::default()).await;
    assert!(capped(&cached), "{:?}", cached.repos.lock().unwrap().iter().map(|r| &r.warnings).collect::<Vec<_>>());
    // So it is after a restart, read from the cache file.
    let restarted = AppState::with_dir(config, Vec::new(), c.f.data.clone());
    assert!(capped(&scan(&restarted, ScanRequest::default()).await));
}
