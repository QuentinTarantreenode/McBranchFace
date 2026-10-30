//! The cleanup perspective: deleting local and server branches, the journal of what was deleted, and
//! restoring from it.

use std::collections::HashMap;
use std::sync::atomic::Ordering;

use tauri::State;

use crate::actions::{self, Env};
use crate::git::runner::Git;
use crate::journal::Journal;
use crate::model::*;
use crate::state::AppState;
use crate::{delete, delete_online};

use super::{err, CmdResult};

#[tauri::command]
pub async fn delete_branch(state: State<'_, AppState>, request: DeleteRequest) -> Result<DeleteOutcome, DeleteFailure> {
    let _repo = state.repo_locks.refs(&request.repo_path).await;
    let _guard = state.write_lock.lock().await;
    let config = state.config.read().await.clone();
    let cached_prs = state.prs_of(&request.repo_path);
    let env = Env { config: &config, snapshots: &state.snapshots, journal: &state.journal, cached_prs };
    let outcome = delete::delete(&env, &request).await;
    state.orphans_unchecked.store(true, Ordering::SeqCst);
    outcome
}

/// Branches on the server, per repository in one `ls-remote` and one push; one result per request.
/// One repository at a time under its own refs lock: its server calls take up to a minute each and
/// hold up no other repo. The journal lines take the journal's own lock.
#[tauri::command]
pub async fn delete_remote_branches(state: State<'_, AppState>, requests: Vec<RemoteDeleteRequest>) -> CmdResult<Vec<RemoteDeleteResult>> {
    let config = state.config.read().await.clone();
    let env = Env { config: &config, snapshots: &state.snapshots, journal: &state.journal, cached_prs: None };
    let mut groups: Vec<(String, Vec<usize>)> = Vec::new();
    for (i, r) in requests.iter().enumerate() {
        let key = crate::paths::path_key(&r.repo_path);
        match groups.iter_mut().find(|(k, _)| *k == key) {
            Some((_, list)) => list.push(i),
            None => groups.push((key, vec![i])),
        }
    }
    let mut slots: Vec<Option<RemoteDeleteResult>> = vec![None; requests.len()];
    for (_, idx) in groups {
        let group: Vec<RemoteDeleteRequest> = idx.iter().map(|&i| requests[i].clone()).collect();
        let repo = group[0].repo_path.clone();
        let _repo = state.repo_locks.refs(&repo).await;
        let prs: HashMap<String, Vec<PullRequestInfo>> = state.prs_of(&repo).map(|p| (repo.clone(), p)).into_iter().collect();
        for (i, r) in idx.into_iter().zip(delete_online::delete_many(&env, &group, &prs).await) {
            slots[i] = Some(r);
        }
    }
    let results: Vec<RemoteDeleteResult> = slots.into_iter().flatten().collect();
    state.orphans_unchecked.store(true, Ordering::SeqCst);
    // Deleted server branches must not be offered again from the cached online list.
    state.drop_online_branches(results.iter().filter(|r| r.outcome.is_some()).map(|r| (r.repo_path.as_str(), r.branch.as_str())));
    Ok(results)
}

/// After a branch is gone on the server, the remote-tracking ref in another working copy stays
/// until that copy fetches. Removing it, after recording the snapshot, is what a prune would do.
/// One repo's refs and its own snapshot file: the repo's lock is enough.
#[tauri::command]
pub async fn prune_tracking(state: State<'_, AppState>, path: String, remote: String, branch: String) -> CmdResult<()> {
    let _repo = state.repo_locks.refs(&path).await;
    let git = Git::new(&path);
    state.snapshots.record(&git).await.map_err(err)?;
    let r = format!("refs/remotes/{remote}/{branch}");
    if git.ref_exists(&r).await.map_err(err)? {
        git.out(&["update-ref", "-d", &r]).await.map_err(err)?;
    }
    Ok(())
}

/// Writes a report the UI formatted; only report file types.
#[tauri::command]
pub fn export_report(path: String, content: String) -> CmdResult<()> {
    let lower = path.to_lowercase();
    if !(lower.ends_with(".csv") || lower.ends_with(".md")) {
        return Err(AppError::new(ErrorCode::Other, format!("not a report file: {path}")));
    }
    std::fs::write(&path, content).map_err(err)
}

#[tauri::command]
pub async fn deleted_entries(state: State<'_, AppState>) -> CmdResult<Vec<DeletedEntry>> {
    // A deletion whose journal line could not be written still has its backup ref; list it again.
    // Reading the refs needs no lock; adopting takes the journal's own.
    if state.orphans_unchecked.swap(false, Ordering::SeqCst) {
        let limit = state.config.read().await.concurrency.max(1) as usize;
        let found = actions::find_orphans(&actions::known_backups(&state.journal), &state.known_repos(), limit).await;
        if actions::adopt(&state.journal, found).is_err() {
            state.orphans_unchecked.store(true, Ordering::SeqCst);
        }
    }
    let mut list = state.journal.load().map_err(err)?;
    list.sort_by_key(|e| std::cmp::Reverse(e.deleted_at));
    Ok(list)
}

/// Bytes the backups of "Recently deleted" take on disk.
#[tauri::command]
pub async fn backups_size(state: State<'_, AppState>) -> CmdResult<u64> {
    let journal = Journal::new(state.journal.path().to_path_buf());
    tokio::task::spawn_blocking(move || actions::backups_size(&journal)).await.map_err(err)
}

/// The repos journal entries belong to, for their locks.
fn repos_of(journal: &Journal, ids: &[String]) -> Vec<String> {
    journal.load().unwrap_or_default().into_iter().filter(|e| ids.contains(&e.id)).map(|e| e.repo_path).collect()
}

#[tauri::command]
pub async fn restore_branch(state: State<'_, AppState>, id: String) -> CmdResult<DeletedEntry> {
    let repos = repos_of(&state.journal, std::slice::from_ref(&id));
    // The push of an online restore can take minutes: only the repo's lock, the journal takes its own.
    let _repos = state.repo_locks.refs_all(repos.iter().map(String::as_str)).await;
    actions::restore(&state.journal, &id).await.map_err(err)
}

#[tauri::command]
pub async fn purge_backups(state: State<'_, AppState>, ids: Vec<String>) -> CmdResult<u32> {
    let repos = repos_of(&state.journal, &ids);
    let _repos = state.repo_locks.refs_all(repos.iter().map(String::as_str)).await;
    let _guard = state.write_lock.lock().await;
    actions::purge(&state.journal, &ids).await.map_err(err)
}

#[tauri::command]
pub async fn checkout_default(state: State<'_, AppState>, repo: String) -> CmdResult<String> {
    let _repo = state.repo_locks.working_copy(&repo).await;
    let config = state.config.read().await.clone();
    actions::checkout_default(&config, &repo).await.map_err(err)
}
