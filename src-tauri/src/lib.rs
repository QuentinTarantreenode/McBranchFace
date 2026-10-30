pub mod actions;
pub mod activity;
pub mod analysis;
pub mod assess;
pub mod backup_refs;
pub mod bounded;
pub mod commands;
pub mod config;
pub mod custom;
pub mod prompts;
pub mod delete;
pub mod delete_online;
pub mod desktop;
pub mod diagnostics;
pub mod environment;
pub mod failure;
pub mod git;
pub mod gitops;
pub mod journal;
pub mod locks;
pub mod model;
pub mod online;
pub mod paths;
pub mod preflight;
pub mod process;
pub mod providers;
pub mod scan;
pub mod server_check;
pub mod state;
pub mod tray;
pub mod watch;
pub mod window_chrome;
#[cfg(test)]
mod test_env;

use std::time::Duration;

use tauri::Manager;

/// The window starts hidden and is shown by the frontend after its first frame; this is the
/// fallback so a frontend failure can never leave an invisible app running.
const SHOW_FALLBACK: Duration = Duration::from_secs(3);

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    config::install_crash_log();
    let (config, issues) = tauri::async_runtime::block_on(commands::config::initial_config());
    let on_top = config.ui.always_on_top;
    // None: the window follows the system, and so does the page's prefers-color-scheme.
    let theme = match config.theme {
        config::Theme::System => None,
        config::Theme::Dark => Some(tauri::Theme::Dark),
        config::Theme::Light => Some(tauri::Theme::Light),
    };
    let tray_state = tray::TrayState::default();
    tray_state.apply(config.window.close_to_tray, config.window.minimize_to_tray);
    // Started by the system with the tray option: stay in the tray until the user opens the window.
    let started_hidden = config.window.start_hidden && std::env::args().any(|a| a == tray::HIDDEN_ARG);
    tray_state.started_hidden.store(started_hidden, std::sync::atomic::Ordering::Relaxed);
    let config_for_state = config;
    let context = tauri::generate_context!();
    // The system's start entry is named after the product, so a build under another name (the E2E build)
    // never reads or rewrites the entry of the installed app.
    let start_entry = context.config().product_name.clone().unwrap_or_else(|| "McBranchFace".into());
    tauri::Builder::default()
        // Two instances would both watch the repos and write the same config: a second start
        // brings the running window to the front instead. Must be the first plugin.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| tray::show_main(app)))
        .plugin(
            // macOS uses a LaunchAgent by default; Windows the Run key, Linux an autostart .desktop file.
            tauri_plugin_autostart::Builder::new().args([tray::HIDDEN_ARG]).app_name(start_entry).build(),
        )
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .manage(state::AppState::new(config_for_state, issues))
        .manage(tray_state)
        .setup(move |app| {
            let handle = app.handle().clone();
            activity::init(handle.clone());
            // The system entry may have been removed in the OS settings meanwhile.
            let state = app.state::<state::AppState>();
            let mut config = tauri::async_runtime::block_on(state.config_snapshot());
            let before = config.window.autostart;
            commands::config::apply_autostart(&handle, &mut config, true);
            if config.window.autostart != before {
                let _ = config::save(&config);
                tauri::async_runtime::block_on(state.set_config(config));
            }
            tray::install(&handle);
            if let Some(window) = app.get_webview_window("main") {
                // Native title bar in the app theme before anything is visible.
                let _ = window.set_theme(theme);
                let _ = window.set_always_on_top(on_top);
                window_chrome::watch(&window);
                if !tray::keep_hidden(&window) {
                    std::thread::spawn(move || {
                        std::thread::sleep(SHOW_FALLBACK);
                        let _ = window.show();
                    });
                }
            }
            Ok(())
        })
        .on_window_event(tray::on_window_event)
        .invoke_handler(tauri::generate_handler![
            commands::config::get_config,
            commands::config::save_config,
            commands::config::app_info,
            commands::config::diagnostics_note,
            commands::config::set_activity_watch,
            commands::config::provider_identity,
            commands::config::window_capabilities,
            commands::config::set_tray_status,
            commands::custom::run_custom_command,
            commands::custom::cancel_custom_command,
            commands::custom::preview_custom_command,
            commands::config::startup_issues,
            commands::config::export_config,
            commands::config::import_config,
            commands::config::environment_status,
            commands::config::run_tool_command,
            commands::scan::scan,
            commands::scan::cancel_scan,
            commands::scan::rescan_repo,
            commands::scan::cached_results,
            commands::scan::branch_commits,
            commands::scan::repo_status,
            commands::scan::cached_status,
            commands::scan::watch_repos,
            commands::git::git_log,
            commands::git::pr_commits,
            commands::git::open_pull_requests,
            commands::open::folder_kinds,
            commands::git::commit_detail,
            commands::git::find_commit,
            commands::git::branch_list,
            commands::git::working_diff,
            commands::git::commit_diff,
            commands::git::git_apply_selection,
            commands::git::git_switch,
            commands::git::git_create_branch,
            commands::git::git_fast_forward,
            commands::git::git_stash_apply,
            commands::git::git_stash_drop,
            commands::git::git_switch_new,
            commands::git::forget_foreign_worktree,
            commands::git::git_stage,
            commands::git::git_unstage,
            commands::git::git_discard,
            commands::git::git_commit,
            commands::git::git_remote,
            commands::git::git_clone,
            commands::git::git_cancel,
            commands::copies::free_copy_folders,
            commands::copies::check_copy_targets,
            commands::copies::create_working_copies,
            commands::copies::remove_worktree,
            commands::cleanup::delete_branch,
            commands::cleanup::delete_remote_branches,
            commands::cleanup::prune_tracking,
            commands::scan::server_heads,
            commands::scan::fetch_repo,
            commands::cleanup::export_report,
            commands::scan::refresh_online,
            commands::cleanup::deleted_entries,
            commands::cleanup::restore_branch,
            commands::cleanup::purge_backups,
            commands::cleanup::backups_size,
            commands::cleanup::checkout_default,
            commands::git::stash_stat,
            commands::open::open_folder,
            commands::open::reveal_path,
            commands::open::open_file,
            commands::open::open_url,
            commands::open::open_terminal,
            commands::open::github_desktop_available,
            commands::open::open_github_desktop,
        ])
        .run(context)
        .expect("error while running tauri application");
}
