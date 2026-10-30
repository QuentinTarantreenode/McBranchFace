//! The Tauri commands: thin adapters from the window to the state, the scan pipeline and the git
//! operations. Every `#[tauri::command]` is listed in the lock table below.

pub mod cleanup;
pub mod config;
pub mod copies;
pub mod custom;
pub mod git;
pub mod open;
pub mod scan;

use tauri::{AppHandle, Emitter};

use crate::model::{AppError, ErrorCode};

type CmdResult<T> = Result<T, AppError>;

/// A lost event leaves the UI one update behind; the scan goes on and its results are still persisted.
fn emit_or_log<S: serde::Serialize + Clone>(app: &AppHandle, event: &str, payload: S) {
    if let Err(e) = app.emit(event, payload) {
        crate::diagnostics::note(&[format!("emit {event} failed: {e}")]);
    }
}

/// Keeps a structured error if one travels inside the anyhow chain, otherwise wraps the text.
fn err(e: impl Into<anyhow::Error>) -> AppError {
    let e: anyhow::Error = e.into();
    match e.downcast_ref::<AppError>() {
        Some(a) => a.clone(),
        None => AppError::new(ErrorCode::Other, format!("{e:#}")),
    }
}

#[cfg(test)]
mod tests {
    /// How a command may run beside the others. An operation in one repo never waits for one in
    /// another; only what writes the shared journal, its backups or new copies takes the global lock
    /// as well, and then after its repos' locks: waiting for a repo must never hold up every other one.
    /// A repo's refs lock is shared by all its working copies; the index lock is one working copy's.
    #[derive(Debug, Clone, Copy)]
    enum Runs {
        /// Changes no repository and no file shared by all repos: takes no lock.
        ReadOnly,
        /// Writes refs of its own repos (and maybe a working copy's files): their refs locks, never the global one.
        Repo,
        /// Writes only the index and files of one working copy: its index lock, so it never waits for a fetch.
        Index,
        /// Writes a repo and the shared journal, backups or copies: the repo locks first, then the global one.
        RepoThenGlobal,
        /// Writes only the shared journal, under the journal's own lock.
        Journal,
        /// Outside these rules, for the reason given.
        Exempt(&'static str),
    }

    const EXTERNAL: &str = "hands a path or link to another program; changes nothing itself";

    /// Every command of the modules below. A new command fails `every_command_says_how_it_runs_beside_the_others`
    /// until it is listed here.
    const COMMANDS: &[(&str, Runs)] = &[
        ("get_config", Runs::ReadOnly),
        ("startup_issues", Runs::ReadOnly),
        ("save_config", Runs::Exempt("writes config.json under the config's own RwLock; no repository state")),
        ("window_capabilities", Runs::ReadOnly),
        ("set_tray_status", Runs::Exempt("changes the tray icon only")),
        ("app_info", Runs::ReadOnly),
        ("diagnostics_note", Runs::Exempt("appends to the app's own log only")),
        ("provider_identity", Runs::ReadOnly),
        ("set_activity_watch", Runs::Exempt("switches the activity display; no repository state")),
        ("export_config", Runs::Exempt("writes only the export file the user chose")),
        ("import_config", Runs::ReadOnly),
        ("environment_status", Runs::ReadOnly),
        ("run_tool_command", Runs::Exempt("starts an allowlisted install or login command in a visible terminal")),
        ("scan", Runs::Exempt("fetches each repo under that repo's lock, taken per repo inside run_scan")),
        ("cancel_scan", Runs::Exempt("signals the running scan, whose pipelines hold their own locks")),
        ("rescan_repo", Runs::ReadOnly),
        ("cached_results", Runs::ReadOnly),
        ("branch_commits", Runs::ReadOnly),
        ("repo_status", Runs::ReadOnly),
        ("cached_status", Runs::ReadOnly),
        ("git_log", Runs::ReadOnly),
        ("find_commit", Runs::ReadOnly),
        ("commit_detail", Runs::ReadOnly),
        ("branch_list", Runs::ReadOnly),
        ("working_diff", Runs::ReadOnly),
        ("commit_diff", Runs::ReadOnly),
        ("watch_repos", Runs::ReadOnly),
        ("delete_branch", Runs::RepoThenGlobal),
        // Each repo under its refs lock while its server calls run; the journal takes its own lock.
        ("delete_remote_branches", Runs::Repo),
        ("prune_tracking", Runs::Repo),
        ("export_report", Runs::Exempt("writes only the report file the user chose")),
        // Locks its repo only when it fetches.
        ("refresh_online", Runs::Repo),
        // Adopting orphaned backup refs appends to the journal.
        ("deleted_entries", Runs::Journal),
        ("backups_size", Runs::ReadOnly),
        // An online restore pushes for minutes: only its repo's lock; the journal takes its own.
        ("restore_branch", Runs::Repo),
        ("purge_backups", Runs::RepoThenGlobal),
        ("checkout_default", Runs::Repo),
        ("stash_stat", Runs::ReadOnly),
        ("open_file", Runs::Exempt(EXTERNAL)),
        ("reveal_path", Runs::Exempt(EXTERNAL)),
        ("open_folder", Runs::Exempt(EXTERNAL)),
        ("open_url", Runs::Exempt(EXTERNAL)),
        ("open_terminal", Runs::Exempt(EXTERNAL)),
        ("github_desktop_available", Runs::ReadOnly),
        ("open_github_desktop", Runs::Exempt(EXTERNAL)),
        ("git_switch", Runs::Repo),
        ("folder_kinds", Runs::ReadOnly),
        ("open_pull_requests", Runs::ReadOnly),
        ("pr_commits", Runs::ReadOnly),
        ("git_switch_new", Runs::Repo),
        ("forget_foreign_worktree", Runs::Repo),
        ("git_fast_forward", Runs::Repo),
        // Reads the stash, which a drop in another worktree could change: the refs shared, the index its own.
        ("git_stash_apply", Runs::Index),
        ("git_stash_drop", Runs::Repo),
        ("git_create_branch", Runs::Repo),
        ("git_stage", Runs::Index),
        ("git_unstage", Runs::Index),
        ("git_discard", Runs::Index),
        ("git_apply_selection", Runs::Index),
        ("git_commit", Runs::Repo),
        ("git_remote", Runs::Repo),
        ("git_clone", Runs::Exempt("creates a new folder; no existing repository is involved")),
        ("git_cancel", Runs::Exempt("signals a running operation, which holds its own lock")),
        ("free_copy_folders", Runs::ReadOnly),
        ("check_copy_targets", Runs::ReadOnly),
        ("create_working_copies", Runs::Repo),
        ("remove_worktree", Runs::RepoThenGlobal),
        ("server_heads", Runs::ReadOnly),
        ("fetch_repo", Runs::Repo),
        ("preview_custom_command", Runs::ReadOnly),
        ("run_custom_command", Runs::Exempt("runs the user's own script; what it changes is up to the script")),
        ("cancel_custom_command", Runs::Exempt("signals a running custom command")),
    ];

    /// The command modules without their tests, so the checks never read their own source.
    fn command_source() -> String {
        let files = [
            include_str!("cleanup.rs"),
            include_str!("config.rs"),
            include_str!("copies.rs"),
            include_str!("custom.rs"),
            include_str!("git.rs"),
            include_str!("open.rs"),
            include_str!("scan.rs"),
        ];
        files.iter().map(|f| without_tests(f)).collect::<Vec<_>>().join("\n")
    }

    fn without_tests(source: &str) -> &str {
        let end = source.find("#[cfg(test)]\nmod tests {").or_else(|| source.find("#[cfg(test)]\r\nmod tests {"));
        &source[..end.unwrap_or(source.len())]
    }

    /// The names of the `#[tauri::command]` functions, in source order.
    fn command_names(source: &str) -> Vec<String> {
        let mut names = Vec::new();
        let mut attributed = false;
        for line in source.lines().map(str::trim) {
            if line == "#[tauri::command]" {
                attributed = true;
            } else if attributed && !(line.starts_with("///") || line.starts_with("//") || line.starts_with("#[")) {
                let name = line.split_once("fn ").and_then(|(_, rest)| rest.split_once('(')).map(|(n, _)| n.trim().to_string());
                names.push(name.unwrap_or_else(|| panic!("#[tauri::command] on something else: {line}")));
                attributed = false;
            }
        }
        names
    }

    /// The body of a function: from its signature to the first line that is a lone `}`, whatever the
    /// line endings.
    fn body_of(source: &str, name: &str) -> String {
        let start = [format!("pub async fn {name}("), format!("pub fn {name}(")]
            .iter()
            .find_map(|s| source.find(s.as_str()))
            .unwrap_or_else(|| panic!("{name} not found"));
        let mut body = String::new();
        for line in source[start..].lines() {
            body.push_str(line);
            body.push('\n');
            if line.trim_end() == "}" {
                return body;
            }
        }
        panic!("{name} has no end")
    }

    #[test]
    fn every_command_says_how_it_runs_beside_the_others() {
        let source = command_source();
        let source = source.as_str();
        let names = command_names(source);
        let listed: Vec<&str> = COMMANDS.iter().map(|(n, _)| *n).collect();
        let unlisted: Vec<&String> = names.iter().filter(|n| !listed.contains(&n.as_str())).collect();
        assert!(unlisted.is_empty(), "classify these commands in COMMANDS: {unlisted:?}");
        let gone: Vec<&&str> = listed.iter().filter(|n| !names.iter().any(|m| m == *n)).collect();
        assert!(gone.is_empty(), "COMMANDS lists commands that no longer exist: {gone:?}");
        assert_eq!(names.len(), listed.len(), "a command is listed twice");

        let global = "state.write_lock";
        let refs = |b: &str| ["state.repo_locks.refs", "state.repo_locks.working_copy"].iter().filter_map(|p| b.find(p)).min();
        let index = |b: &str| ["state.repo_locks.index(", "state.repo_locks.index_reading_refs("].iter().filter_map(|p| b.find(p)).min();
        for &(name, runs) in COMMANDS {
            let b = body_of(source, name);
            let (r, i, g) = (refs(&b), index(&b), b.find(global));
            let any = r.is_some() || i.is_some();
            match runs {
                Runs::ReadOnly => assert!(!any && g.is_none(), "{name} is read-only and must not take a lock"),
                Runs::Repo => assert!(r.is_some() && g.is_none(), "{name} must lock its repo's refs, and only its repo"),
                Runs::Index => assert!(i.is_some() && r.is_none() && g.is_none(), "{name} writes one index and must not wait for the refs"),
                Runs::RepoThenGlobal => {
                    assert!(r.is_some(), "{name} writes refs of a repo and must lock it");
                    assert!(g.is_some(), "{name} writes the shared journal or backups");
                    assert!(r < g, "{name}: the repo lock comes first, then the global one");
                }
                Runs::Journal => assert!(g.is_none() && !any, "{name} writes only the journal, which locks itself"),
                Runs::Exempt(why) => assert!(!why.trim().is_empty(), "{name}: an exemption needs its reason"),
            }
        }
        // The checker itself: a body ends where the function does, and a command is found in any form.
        assert!(!body_of(source, "checkout_default").contains("fn stash_stat"));
        assert!(names.iter().any(|n| n == "save_config"), "a doc comment between attribute and signature");
        assert!(names.iter().any(|n| n == "app_info"), "a synchronous command");
    }

    #[test]
    fn every_command_is_registered() {
        let lib = include_str!("../lib.rs");
        let start = lib.find("generate_handler![").expect("generate_handler") + "generate_handler![".len();
        let list = &lib[start..start + lib[start..].find(']').expect("end of generate_handler")];
        // Registered by their module path; the name is the last segment.
        let mut registered: Vec<&str> = list.split(',').map(str::trim).filter(|s| !s.is_empty()).map(|s| s.rsplit("::").next().unwrap_or(s)).collect();
        let mut names = command_names(&command_source());
        registered.sort_unstable();
        names.sort_unstable();
        assert_eq!(registered, names, "generate_handler! and the #[tauri::command] functions differ");
    }
}
