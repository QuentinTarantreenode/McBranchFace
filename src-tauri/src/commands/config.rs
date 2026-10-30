//! Settings, the window and the environment: nothing here touches a repository.

use std::path::Path;

use tauri::{Manager, State};

use crate::config::{self, Config, ImportFailure, ImportPreview, StartupIssue};
use crate::git::runner::Git;
use crate::model::*;
use crate::state::AppState;
use crate::{desktop, environment, tray};

use super::{err, CmdResult};

pub async fn initial_config() -> (Config, Vec<StartupIssue>) {
    let (mut c, issue) = config::load();
    let issues: Vec<StartupIssue> = issue.into_iter().chain(config::check_app_dir()).chain(config::take_crash_report()).collect();
    crate::diagnostics::set(c.diagnostics);
    if c.my_emails.is_empty() {
        if let Ok(o) = Git::new(std::env::temp_dir()).raw(&["config", "--global", "user.email"]).await {
            let mail = o.stdout.trim();
            if !mail.is_empty() {
                c.my_emails.push(mail.to_string());
            }
        }
    }
    (c, issues)
}

#[tauri::command]
pub async fn get_config(state: State<'_, AppState>) -> CmdResult<Config> {
    Ok(state.config.read().await.clone())
}

#[tauri::command]
pub fn startup_issues(state: State<'_, AppState>) -> Vec<StartupIssue> {
    state.startup_issues.clone()
}

#[tauri::command]
/// Returns what was saved: sanitized, and with the autostart flag the system really has.
pub async fn save_config(app: tauri::AppHandle, state: State<'_, AppState>, config: Config) -> CmdResult<Config> {
    let mut config = config;
    config.sanitize();
    apply_autostart(&app, &mut config, false);
    config::save(&config).map_err(err)?;
    crate::diagnostics::set(config.diagnostics);
    if let Some(t) = app.try_state::<tray::TrayState>() {
        t.apply(config.window.close_to_tray, config.window.minimize_to_tray);
    }
    state.budget.resize(config.concurrency as usize);
    *state.config.write().await = config.clone();
    Ok(config)
}

/// Brings the autostart entry and the config together (see tray::reconcile_autostart). A failure
/// to change the system entry keeps the flag at what the system really does.
pub fn apply_autostart<R: tauri::Runtime>(app: &tauri::AppHandle<R>, config: &mut Config, at_start: bool) {
    use tauri_plugin_autostart::ManagerExt;
    let launcher = app.autolaunch();
    let Ok(system) = launcher.is_enabled() else { return };
    let (keep, change) = tray::reconcile_autostart(config.window.autostart, system, at_start);
    config.window.autostart = keep;
    if let Some(on) = change {
        let done = if on { launcher.enable() } else { launcher.disable() };
        if done.is_err() {
            config.window.autostart = system;
        }
    }
}

#[tauri::command]
pub fn window_capabilities(app: tauri::AppHandle) -> tray::WindowCapabilities {
    use std::sync::atomic::Ordering;
    use tauri_plugin_autostart::ManagerExt;
    let s = app.try_state::<tray::TrayState>();
    tray::WindowCapabilities {
        tray: s.as_ref().is_some_and(|s| s.available.load(Ordering::Relaxed)),
        autostart: app.autolaunch().is_enabled().is_ok(),
        started_hidden: s.as_ref().is_some_and(|s| s.started_hidden.load(Ordering::Relaxed)),
        home: dirs::home_dir().map(|p| p.to_string_lossy().into_owned()),
    }
}

#[tauri::command]
pub fn set_tray_status(app: tauri::AppHandle, status: tray::TrayStatus) -> CmdResult<()> {
    tray::update(&app, &status).map_err(|e| AppError::new(ErrorCode::Other, e.to_string()))
}

#[tauri::command]
pub fn app_info() -> crate::diagnostics::AppInfo {
    crate::diagnostics::app_info()
}

#[tauri::command]
pub fn diagnostics_note(lines: Vec<String>) {
    crate::diagnostics::note(&lines);
}

#[tauri::command]
pub async fn provider_identity(kind: crate::model::ProviderKind) -> Option<String> {
    crate::providers::identity(kind).await
}

#[tauri::command]
pub fn set_activity_watch(on: bool) {
    crate::activity::set(on);
}

#[tauri::command]
pub async fn export_config(state: State<'_, AppState>, path: String) -> CmdResult<()> {
    let config = state.config.read().await.clone();
    config::export_to(Path::new(&path), &config).map_err(err)
}

/// Only reads and validates; the UI shows a preview and saves through `save_config`.
#[tauri::command]
pub fn import_config(path: String) -> Result<ImportPreview, ImportFailure> {
    config::import_from(Path::new(&path))
}

#[tauri::command]
pub async fn environment_status() -> CmdResult<Vec<ToolStatus>> {
    Ok(environment::status_all().await)
}

/// Runs an allowlisted install or login command in a visible terminal; the UI names it, never writes it.
#[tauri::command]
pub fn run_tool_command(tool: ToolId, action: ToolAction) -> CmdResult<()> {
    let command = environment::command_for(tool, action)
        .ok_or_else(|| AppError::new(ErrorCode::NoToolCommand, format!("{tool:?} {action:?}")))?;
    desktop::run_in_terminal(command).map_err(err)
}
