//! Handing a file, folder or link to another program; nothing here changes a repository.

use std::path::Path;

use tauri::AppHandle;
use tauri_plugin_opener::OpenerExt;

use crate::desktop;
use crate::model::*;

use super::{err, CmdResult};

/// Opens a file with its default program; one that would run instead is shown in its folder.
#[tauri::command]
pub fn open_file(app: AppHandle, path: String) -> CmdResult<()> {
    let p = Path::new(&path);
    if !p.is_file() {
        return Err(AppError::new(ErrorCode::PathMissing, path));
    }
    if desktop::runs_on_open(p) {
        return app.opener().reveal_item_in_dir(p).map_err(err);
    }
    app.opener().open_path(path, None::<&str>).map_err(err)
}

/// Shows a file or folder selected in the file manager, without running it. A deleted file shows the
/// folder it was in.
#[tauri::command]
pub fn reveal_path(app: AppHandle, path: String) -> CmdResult<()> {
    let p = Path::new(&path);
    if p.exists() {
        return app.opener().reveal_item_in_dir(p).map_err(err);
    }
    match p.parent().filter(|d| d.is_dir()) {
        Some(dir) => app.opener().open_path(dir.to_string_lossy(), None::<&str>).map_err(err),
        None => Err(AppError::new(ErrorCode::PathMissing, path)),
    }
}

#[tauri::command]
pub fn open_folder(app: AppHandle, path: String) -> CmdResult<()> {
    // Folders only: the shell would run a file (see open_file).
    if !Path::new(&path).is_dir() {
        return Err(AppError::new(ErrorCode::PathMissing, path));
    }
    app.opener().open_path(path, None::<&str>).map_err(err)
}

#[tauri::command]
pub fn open_url(app: AppHandle, url: String) -> CmdResult<()> {
    if !(url.starts_with("https://") || url.starts_with("http://")) {
        return Err(AppError::new(ErrorCode::OnlyWebLinks, url));
    }
    app.opener().open_url(url, None::<&str>).map_err(err)
}

#[tauri::command]
pub fn open_terminal(path: String) -> CmdResult<()> {
    desktop::open_terminal(Path::new(&path)).map_err(err)
}

#[tauri::command]
pub fn github_desktop_available() -> bool {
    desktop::github_desktop().is_some()
}

#[tauri::command]
pub fn open_github_desktop(path: String) -> CmdResult<()> {
    desktop::open_in_github_desktop(Path::new(&path)).map_err(err)
}

/// Which of the paths dropped on the window are folders. Only a check: nothing is read or opened.
#[tauri::command]
pub fn folder_kinds(paths: Vec<String>) -> Vec<bool> {
    paths.iter().take(64).map(|p| Path::new(p).is_dir()).collect()
}
