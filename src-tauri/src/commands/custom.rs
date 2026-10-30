//! The host of the user's own commands: rendering the script, running it in a terminal or in the
//! background with live output.

use std::path::Path;
use std::sync::atomic::Ordering;
use std::time::Instant;

use tauri::{AppHandle, Emitter, Manager, State};

use crate::custom;
use crate::model::*;
use crate::state::{lock, AppState};

use super::{err, CmdResult};

#[derive(Debug, Clone, serde::Serialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, ts(export))]
pub struct CommandOutput {
    pub run_id: String,
    pub lines: Vec<custom::OutputLine>,
}

#[derive(Debug, Clone, serde::Serialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, ts(export))]
pub struct CommandDone {
    pub run_id: String,
    pub code: Option<i32>,
    /// "cancelled", "timeout", "missing" or a process error; None when the program ran to its end.
    pub error: Option<String>,
    #[cfg_attr(test, ts(type = "number"))]
    pub duration_ms: u64,
}

fn render_error(e: custom::RenderError) -> AppError {
    match e {
        custom::RenderError::Unsafe(v) => AppError::new(ErrorCode::UnsafeValue, v),
        e @ custom::RenderError::TooLong(_) => AppError::new(ErrorCode::Other, e.to_string()),
        other => AppError::new(ErrorCode::UnknownPlaceholder, other.to_string()),
    }
}

/// The values a script's placeholders stand for in this repo, from its last result.
fn command_context(state: &AppState, repo_path: &str, branch: Option<String>) -> custom::Context {
    let info = state.result_of(repo_path).map(|r| r.repo);
    custom::Context {
        path: repo_path.to_string(),
        repo: info.as_ref().map(|i| i.name.clone()).unwrap_or_else(|| Path::new(repo_path).file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default()),
        identity: info.as_ref().map(|i| i.identity.clone()).unwrap_or_default(),
        branch,
        remote: "origin".into(),
        default_branch: info.and_then(|i| i.default_branch),
    }
}

/// The script as it would run, for the editor's live preview.
#[tauri::command]
pub fn preview_custom_command(state: State<'_, AppState>, script: String, shell: custom::Shell, repo_path: String, branch: Option<String>) -> CmdResult<String> {
    custom::render(&script, &command_context(&state, &repo_path, branch), shell).map_err(render_error)
}

/// Starts a command; in the background its output arrives as command-output events and its end as
/// command-done. Returns the run id.
#[tauri::command]
pub async fn run_custom_command(app: AppHandle, state: State<'_, AppState>, id: String, repo_path: String, branch: Option<String>) -> CmdResult<String> {
    let command = state.config.read().await.commands.iter().find(|c| c.id == id).cloned().ok_or_else(|| AppError::new(ErrorCode::EntryNotFound, id.clone()))?;
    if !Path::new(&repo_path).is_dir() {
        return Err(AppError::new(ErrorCode::PathMissing, repo_path));
    }
    let ctx = command_context(&state, &repo_path, branch);
    let body = custom::render(&command.script, &ctx, command.shell).map_err(render_error)?;
    let (ext, bytes) = custom::script_file(command.shell, &repo_path, &body).map_err(render_error)?;
    // A process-wide counter: time alone repeats within a second, and so does the number of open runs.
    static RUN_SEQ: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    let run_id = format!("run-{}-{}", crate::git::snapshot::now(), RUN_SEQ.fetch_add(1, Ordering::Relaxed));
    let file = custom::write_script(&state.dir.join("commands"), &run_id, &ext, &bytes).map_err(err)?;
    if command.mode == custom::RunMode::Terminal {
        crate::desktop::run_in_terminal(&custom::terminal_line(command.shell, &file)).map_err(err)?;
        return Ok(run_id);
    }
    let cancel = std::sync::Arc::new(tokio::sync::Notify::new());
    lock(&state.running_ops).insert(run_id.clone(), cancel.clone());
    let (program, args) = custom::invocation(command.shell, &file);
    let id = run_id.clone();
    tauri::async_runtime::spawn(async move {
        let started = Instant::now();
        let emitter = app.clone();
        let rid = id.clone();
        let result = custom::run_background(&program, &args, Path::new(&repo_path), custom::TIMEOUT, cancel, move |lines| {
            let _ = emitter.emit("command-output", CommandOutput { run_id: rid.clone(), lines });
        })
        .await;
        let _ = std::fs::remove_file(&file);
        if let Some(state) = app.try_state::<AppState>() {
            lock(&state.running_ops).remove(&id);
        }
        let (code, error) = match result {
            Ok(code) => (code, None),
            Err(crate::process::ProcError::Cancelled) => (None, Some("cancelled".to_string())),
            Err(crate::process::ProcError::Timeout(_)) => (None, Some("timeout".to_string())),
            Err(crate::process::ProcError::NotFound(p)) => (None, Some(format!("missing:{p}"))),
            Err(e) => (None, Some(e.to_string())),
        };
        let _ = app.emit("command-done", CommandDone { run_id: id, code, error, duration_ms: started.elapsed().as_millis() as u64 });
    });
    Ok(run_id)
}

#[tauri::command]
pub fn cancel_custom_command(state: State<'_, AppState>, run_id: String) {
    if let Some(n) = lock(&state.running_ops).get(&run_id) {
        n.notify_one();
    }
}
