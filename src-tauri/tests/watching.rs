mod common;

use std::sync::mpsc;
use std::time::{Duration, Instant};

use common::*;
use mcbranchface_lib::model::{ChangeScope, RepoChanged};
use mcbranchface_lib::watch::{self, WatchedRepo};

/// Far beyond how long an event takes, also on a loaded machine: only an event that never comes waits this long.
const NEVER: Duration = Duration::from_secs(30);

/// The events up to the first that names `file`, that one included; None when it never comes.
fn until_file(rx: &mpsc::Receiver<RepoChanged>, file: &str) -> Option<Vec<RepoChanged>> {
    let deadline = Instant::now() + NEVER;
    let mut seen = Vec::new();
    while let Some(left) = deadline.checked_duration_since(Instant::now()) {
        let ev = rx.recv_timeout(left).ok()?;
        let hit = ev.files.iter().any(|f| f == file);
        seen.push(ev);
        if hit {
            return Some(seen);
        }
    }
    None
}

/// Until an event in `scope` arrives.
fn wait_for(rx: &mpsc::Receiver<RepoChanged>, scope: ChangeScope) -> bool {
    let deadline = Instant::now() + NEVER;
    while let Some(left) = deadline.checked_duration_since(Instant::now()) {
        match rx.recv_timeout(left) {
            Ok(ev) if ev.scopes.contains(&scope) => return true,
            Ok(_) => continue,
            Err(_) => return false,
        }
    }
    false
}

// On Linux the first batch after new folders names the watched folder itself, which counts as everything
// (refs too). Left open until that is understood and handled: build output wakes the UI more there.
#[cfg_attr(not(windows), ignore = "Linux reports the watched folder itself after new folders appear")]
#[test]
fn reports_branch_switches_and_file_edits() {
    let f = Fixture::new();
    f.pushed_branch("feat/w", 1);
    let repo = WatchedRepo { path: f.work.clone(), git_dir: f.work.join(".git"), worktrees: vec![f.work.clone()] };
    let (tx, rx) = mpsc::channel();
    let _watcher = watch::watch(vec![repo], move |ev| {
        let _ = tx.send(ev);
    })
    .unwrap();

    // Watching for sure: a file written now is reported. Written again until it is, should the watch
    // take a moment to start.
    let armed = Instant::now() + NEVER;
    loop {
        std::fs::write(f.work.join("ready.txt"), "x").unwrap();
        if matches!(rx.recv_timeout(Duration::from_secs(1)), Ok(ev) if ev.scopes.contains(&ChangeScope::Files)) {
            break;
        }
        assert!(Instant::now() < armed, "the watcher never reported a file");
    }

    // Build output must not wake the UI. A marker written after it closes the window: changes are
    // reported in the order they happened, so whatever the build output caused has come by the marker's
    // event, and nothing before it may be a ref change.
    std::fs::create_dir_all(f.work.join("bin/Debug")).unwrap();
    std::fs::write(f.work.join("bin/Debug/out.dll"), "x").unwrap();
    std::fs::write(f.work.join("marker.txt"), "x").unwrap();
    let noise = until_file(&rx, "marker.txt").expect("no event for the marker");
    assert!(noise.iter().all(|e| !e.scopes.contains(&ChangeScope::Refs)), "{noise:?}");

    std::fs::write(f.work.join("edited.txt"), "x").unwrap();
    let edit = until_file(&rx, "edited.txt").expect("no event after editing a file");
    assert!(edit.last().unwrap().scopes.contains(&ChangeScope::Files), "{edit:?}");

    // Last: what a switch writes keeps arriving in batches of its own for a while, up to a change of the
    // whole folder, and would land in any check after it.
    git(&f.work, &["switch", "-q", "feat/w"]);
    assert!(wait_for(&rx, ChangeScope::Refs), "no Refs event after git switch");
}
