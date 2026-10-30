//! Further working copies of a repository: worktrees and local clones for parallel work.

use std::path::Path;

use tauri::{AppHandle, Emitter, State};

use crate::git::runner::Git;
use crate::gitops;
use crate::model::*;
use crate::state::{lock, AppState};

use super::CmdResult;

/// Several at once for parallel work; one failing does not undo the others.
const MAX_COPIES: usize = 8;

#[tauri::command]
pub fn free_copy_folders(path: String, label: String, count: usize) -> Vec<String> {
    gitops::copies::free_folders(Path::new(&path), &label, count.min(MAX_COPIES))
}

#[tauri::command]
pub async fn check_copy_targets(path: String, kind: gitops::copies::CopyKind, targets: Vec<gitops::copies::CopyTarget>) -> Vec<gitops::copies::TargetCheck> {
    gitops::copies::check(&Git::new(&path), kind, &targets).await
}

#[tauri::command]
pub async fn create_working_copies(
    app: AppHandle,
    state: State<'_, AppState>,
    path: String,
    kind: gitops::copies::CopyKind,
    start: String,
    targets: Vec<gitops::copies::CopyTarget>,
    id: String,
) -> CmdResult<Vec<gitops::copies::CopyOutcome>> {
    use gitops::copies::{self, CopyKind, CopyOutcome};
    // A worktree writes the source repo's refs, a clone only reads it: the source's lock covers both,
    // and a long clone holds up no other repo.
    let _repo = state.repo_locks.refs(&path).await;
    let source = Git::new(&path);
    let cancel = std::sync::Arc::new(tokio::sync::Notify::new());
    lock(&state.running_ops).insert(id.clone(), cancel.clone());
    let op = if kind == CopyKind::Worktree { GitOp::AddWorktree } else { GitOp::Clone };
    let total = targets.len().min(MAX_COPIES);
    let mut out = Vec::with_capacity(total);
    for (i, t) in targets.iter().take(MAX_COPIES).enumerate() {
        let name = Path::new(&t.path).file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
        let _ = app.emit("op-progress", OpProgress { id: id.clone(), op, phase: format!("{}/{total} · {name}", i + 1), percent: Some((i * 100 / total.max(1)) as u32) });
        let step = async {
            match kind {
                CopyKind::Worktree => copies::add_worktree(&source, t, &start).await,
                CopyKind::Clone => copies::clone(&source, t, &start).await,
            }
        };
        let r = tokio::select! {
            r = step => r,
            _ = cancel.notified() => Err(OpFailure { kind: FailureKind::Cancelled, op, detail: String::new(), path: None, changed: false }),
        };
        let cancelled = matches!(&r, Err(f) if f.kind == FailureKind::Cancelled);
        out.push(r.unwrap_or_else(|f| CopyOutcome { path: t.path.replace('\\', "/"), failure: Some(f), warning: None }));
        if cancelled {
            break;
        }
    }
    lock(&state.running_ops).remove(&id);
    Ok(out)
}

#[tauri::command]
pub async fn remove_worktree(state: State<'_, AppState>, path: String, worktree: String, force: bool) -> Result<OpResult, OpFailure> {
    // The worktree's index too: staging in it must not run while it goes.
    let _repo = state.repo_locks.refs(&path).await;
    let _index = state.repo_locks.index(&worktree).await;
    let _guard = state.write_lock.lock().await;
    gitops::copies::remove_worktree(&Git::new(&path), &worktree, force, &state.journal).await
}
