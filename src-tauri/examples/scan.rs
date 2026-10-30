//! Headless scan through the app's own pipeline (identities, shared pull requests, takeover of
//! unchanged repos, the light check, the server branches), for verification and measurements:
//!
//!   cargo run --example scan -- <root>... [--fetch] [--changed-only] [--interactive] [--no-providers]
//!                               [--online] [--passes N] [--json] [--data-dir <folder>]
//!
//! Without `--data-dir` it works in a temporary data folder of its own: the running app's snapshots
//! and caches stay untouched, and every run starts cold. `--data-dir` reads `config.json` there (roots
//! given on the command line replace its folders) and keeps snapshots and caches there, so a second
//! run shows what they save. `--json` prints the outcome and every result as JSON instead of a summary.
//!
//! Each pass also says what it cost: the programs it started (git, az, gh), the bytes of the events
//! the window would have received, and the size of the results cache it left.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::Instant;

use mcbranchface_lib::config::{self, Config};
use mcbranchface_lib::model::*;
use mcbranchface_lib::process;
use mcbranchface_lib::scan::{run_scan, ScanDeps, ScanRequest, ScanSink};
use mcbranchface_lib::state::AppState;

struct Args {
    roots: Vec<String>,
    request: ScanRequest,
    providers: bool,
    online: bool,
    passes: usize,
    json: bool,
    data_dir: Option<PathBuf>,
}

fn args() -> Args {
    let all: Vec<String> = std::env::args().skip(1).collect();
    let value = |name: &str| all.iter().position(|a| a == name).and_then(|i| all.get(i + 1)).cloned();
    let flag = |name: &str| all.iter().any(|a| a == name);
    let takes_value = ["--passes", "--data-dir"];
    let roots = all
        .iter()
        .enumerate()
        .filter(|(i, a)| !a.starts_with("--") && !(*i > 0 && takes_value.contains(&all[i - 1].as_str())))
        .map(|(_, a)| a.clone())
        .collect();
    Args {
        roots,
        request: ScanRequest { fetch: flag("--fetch"), changed_only: flag("--changed-only"), interactive: flag("--interactive") },
        providers: !flag("--no-providers"),
        online: flag("--online"),
        passes: value("--passes").and_then(|n| n.parse().ok()).unwrap_or(1).max(1),
        json: flag("--json"),
        data_dir: value("--data-dir").map(PathBuf::from),
    }
}

/// Prints each result as it lands, or collects the online events for the JSON at the end.
struct Print {
    json: bool,
    started: Instant,
    online: Mutex<Vec<OnlineScanned>>,
    /// What the events of this pass weigh as JSON, the way Tauri sends them to the window.
    event_bytes: AtomicU64,
}

impl Print {
    fn weigh(&self, event: &impl serde::Serialize) {
        let bytes = serde_json::to_vec(event).map_or(0, |v| v.len() as u64);
        self.event_bytes.fetch_add(bytes, Ordering::Relaxed);
    }
}

impl ScanSink for Print {
    fn started(&self, e: &ScanStarted) {
        self.weigh(e);
        if !self.json {
            println!("{} repositories", e.repos.len());
        }
    }

    fn repo(&self, r: &RepoResult) {
        self.weigh(r);
        if self.json {
            return;
        }
        let count = |v| r.branches.iter().filter(|b| b.verdict == v).count();
        println!(
            "{:>6} ms  {:<60} {:>3} branches  safe {} review {} unsafe {} blocked {}{}{}",
            self.started.elapsed().as_millis(),
            r.repo.path,
            r.local_branch_count,
            count(Verdict::Safe),
            count(Verdict::Review),
            count(Verdict::Unsafe),
            count(Verdict::Blocked),
            if r.fetched { "  fetched" } else { "" },
            r.fetch_error.as_deref().map(|e| format!("  fetch: {e}")).unwrap_or_default(),
        );
        for w in &r.warnings {
            println!("            ! {w:?}");
        }
        if let Some(e) = &r.error {
            println!("            ! {e}");
        }
    }

    fn online(&self, e: &OnlineScanned) {
        self.weigh(e);
        if !self.json {
            let count = |v| e.branches.iter().filter(|b| b.verdict == v).count();
            let error = e.error.as_deref().map(|e| format!("  error: {e}")).unwrap_or_default();
            println!(
                "{:>6} ms  {:<60} online: {} branches, {} merged, {} inactive{error}",
                self.started.elapsed().as_millis(),
                e.path,
                e.branches.len(),
                count(OnlineVerdict::Merged),
                count(OnlineVerdict::Inactive)
            );
        }
        self.online.lock().unwrap_or_else(|p| p.into_inner()).push(e.clone());
    }
}

#[tokio::main]
async fn main() {
    let a = args();
    let scratch = tempfile::tempdir().expect("a temporary data folder");
    let (dir, mut cfg) = match &a.data_dir {
        Some(dir) => (dir.clone(), config::load_from(&dir.join("config.json")).0),
        None => (scratch.path().to_path_buf(), Config::default()),
    };
    if !a.roots.is_empty() {
        cfg.roots = a.roots.clone();
    }
    if cfg.roots.is_empty() {
        eprintln!("usage: cargo run --example scan -- <root>... [--fetch] [--changed-only] [--json] [--data-dir <folder>]");
        std::process::exit(2);
    }
    cfg.use_providers = a.providers && cfg.use_providers;
    cfg.scan_online = a.online;
    let state = AppState::with_dir(cfg, Vec::new(), dir.clone());
    let deps = ScanDeps::new(&state);
    let mut finished = Vec::new();
    let mut costs = Vec::new();
    for pass in 1..=a.passes {
        let sink = Print { json: a.json, started: Instant::now(), online: Mutex::default(), event_bytes: AtomicU64::new(0) };
        let before = process::started();
        let done = run_scan(&deps, &sink, a.request).await;
        let cost = serde_json::json!({
            "pass": pass,
            "durationMs": done.duration_ms,
            "processes": process::started() - before,
            "eventBytes": sink.event_bytes.load(Ordering::Relaxed),
            "resultsCacheBytes": results_cache_bytes(&dir),
        });
        if !a.json {
            println!("pass {pass}: {} repositories in {} ms{}", done.repo_count, done.duration_ms, if done.cancelled { ", cancelled" } else { "" });
            println!("        {} processes, events {} bytes, results cache {} bytes", cost["processes"], cost["eventBytes"], cost["resultsCacheBytes"]);
        }
        costs.push(cost);
        finished.push((done, sink.online.into_inner().unwrap_or_default()));
    }
    if a.json {
        let (done, online) = finished.pop().expect("at least one pass");
        let out = serde_json::json!({ "finished": done, "passes": costs, "results": state.results(), "online": online });
        println!("{}", serde_json::to_string_pretty(&out).expect("results serialize"));
    }
}

/// The results cache the scan wrote, whatever version its name carries.
fn results_cache_bytes(dir: &Path) -> u64 {
    let Ok(entries) = std::fs::read_dir(dir.join("cache")) else { return 0 };
    entries
        .flatten()
        .filter(|e| {
            let name = e.file_name().to_string_lossy().into_owned();
            name.starts_with("last-scan-") && name.ends_with(".json")
        })
        .filter_map(|e| e.metadata().ok())
        .map(|m| m.len())
        .sum()
}
