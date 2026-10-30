//! Tells the window which external program runs right now and where, while the activity display is on:
//! the frontend names the source and the operation from it (a fetch from origin, the pull requests from
//! Azure DevOps). Off by default; while off, the only cost per command is one relaxed atomic load.

use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::OnceLock;

use serde::Serialize;
use tauri::{AppHandle, Emitter};
#[cfg(test)]
use ts_rs::TS;

static ON: AtomicBool = AtomicBool::new(false);
static NEXT: AtomicU64 = AtomicU64::new(1);
static APP: OnceLock<AppHandle> = OnceLock::new();

pub fn init(app: AppHandle) {
    let _ = APP.set(app);
}

pub fn set(on: bool) {
    ON.store(on, Ordering::Relaxed);
}

#[derive(Debug, Clone, Serialize)]
#[cfg_attr(test, derive(TS))]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, ts(export))]
pub struct ProcessStarted {
    #[cfg_attr(test, ts(type = "number"))]
    pub id: u64,
    pub program: String,
    pub args: Vec<String>,
    pub cwd: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[cfg_attr(test, derive(TS))]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, ts(export))]
pub struct ProcessEnded {
    #[cfg_attr(test, ts(type = "number"))]
    pub id: u64,
    /// Exit code, or what stopped it: "timeout", "cancel", "missing", "io", "signal".
    pub outcome: String,
}

/// The id to end it with; None while the display is off.
pub fn started(cmd: &std::process::Command) -> Option<u64> {
    if !ON.load(Ordering::Relaxed) {
        return None;
    }
    let app = APP.get()?;
    let id = NEXT.fetch_add(1, Ordering::Relaxed);
    let event = ProcessStarted {
        id,
        program: cmd.get_program().to_string_lossy().to_string(),
        args: cmd.get_args().map(|a| a.to_string_lossy().to_string()).collect(),
        cwd: cmd.get_current_dir().map(|d| d.to_string_lossy().to_string()),
    };
    let _ = app.emit("process-started", event);
    Some(id)
}

pub fn ended(id: Option<u64>, outcome: &str) {
    if let (Some(id), Some(app)) = (id, APP.get()) {
        let _ = app.emit("process-ended", ProcessEnded { id, outcome: outcome.to_string() });
    }
}
