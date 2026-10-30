//! The Git perspective: reading history and diffs, and the writing operations of one working copy.

use std::sync::atomic::Ordering;

use tauri::{AppHandle, Emitter, State};

use crate::actions;
use crate::git::identity;
use crate::git::runner::Git;
use crate::gitops;
use crate::model::*;
use crate::state::caches::Cache;
use crate::state::{lock, AppState};

use super::{err, CmdResult};

type OpResultCmd = Result<OpResult, OpFailure>;

#[tauri::command]
pub async fn git_log(path: String, rev: String, skip: u32, limit: u32, query: Option<String>) -> CmdResult<Vec<LogEntry>> {
    gitops::history::log(&Git::new(&path), &rev, skip, limit.min(1000), query.as_deref()).await.map_err(err)
}

/// Hits a working copy lists at most; the dialog says when there are more.
const FIND_LIMIT: usize = 30;

/// One text over every working copy at once: where is this commit, a fix or its cherry-picks.
#[tauri::command]
pub async fn find_commit(state: State<'_, AppState>, paths: Vec<String>, query: String) -> CmdResult<Vec<RepoHits>> {
    let limit = state.config.read().await.concurrency.max(1) as usize;
    let (query, budget) = (&query, &state.budget);
    let mut out = crate::bounded::bounded(paths, limit, |path| async move {
        let _slot = budget.acquire().await;
        match gitops::history::find_everywhere(&Git::new(&path), query, FIND_LIMIT).await {
            Ok((hits, capped)) => RepoHits { repo_path: path, hits, capped, error: None },
            Err(e) => RepoHits { repo_path: path, hits: Vec::new(), capped: false, error: Some(format!("{e:#}")) },
        }
    })
    .await;
    out.sort_by(|a, b| a.repo_path.cmp(&b.repo_path));
    Ok(out)
}

#[tauri::command]
pub async fn commit_detail(path: String, sha: String) -> CmdResult<CommitDetail> {
    gitops::history::commit_detail(&Git::new(&path), &sha).await.map_err(err)
}

#[tauri::command]
pub async fn branch_list(state: State<'_, AppState>, path: String) -> CmdResult<BranchList> {
    let config = state.config_snapshot().await;
    gitops::history::branches(&Git::new(&path), |email| config.is_my_email(email)).await.map_err(err)
}

#[tauri::command]
pub async fn working_diff(path: String, file: String, source: DiffSource, options: DiffOptions, orig_path: Option<String>) -> CmdResult<FileDiff> {
    gitops::diff::working_diff(&Git::new(&path), &file, source, &options, orig_path.as_deref()).await.map_err(err)
}

#[tauri::command]
pub async fn commit_diff(path: String, sha: String, file: String, options: DiffOptions, orig_path: Option<String>) -> CmdResult<FileDiff> {
    gitops::diff::commit_diff(&Git::new(&path), &sha, &file, &options, orig_path.as_deref()).await.map_err(err)
}

/// Files touched by a stash, so the user can decide whether it still matters.
#[tauri::command]
pub async fn stash_stat(repo: String, sha: String) -> CmdResult<String> {
    // `stash show` hands options on to diff (`--output=<file>` writes a file): only a SHA passes.
    if !is_sha(&sha) {
        return Err(AppError::new(ErrorCode::UnsafeValue, sha));
    }
    Git::new(&repo).out(&["stash", "show", "--stat", "--no-color", &sha]).await.map_err(err)
}

fn is_sha(s: &str) -> bool {
    (7..=64).contains(&s.len()) && s.bytes().all(|b| b.is_ascii_hexdigit())
}

/// The open pull requests of a repo, newest first. From what the last scan brought, unless asked to
/// refresh or nothing is known yet; then the provider is asked for this one repo (network).
#[tauri::command]
pub async fn open_pull_requests(state: State<'_, AppState>, path: String, refresh: bool) -> CmdResult<Vec<PullRequestInfo>> {
    let cached = state.prs_of(&path);
    let use_providers = state.config.read().await.use_providers;
    let list = match cached {
        Some(list) if !refresh => list,
        _ if !use_providers => Vec::new(),
        _ => {
            let git = Git::new(&path);
            let origin = identity::origin_of(&git).await;
            let remote = origin.remote_url.as_deref().map(crate::providers::remote_url::parse).unwrap_or(crate::providers::remote_url::Remote::Other);
            let fresh = crate::providers::pull_requests(&remote).await.map_err(err)?;
            state.store_prs(&origin.identity, fresh.prs.clone(), crate::git::snapshot::now(), fresh.capped);
            state.persist(&[Cache::Prs]).await;
            fresh.prs
        }
    };
    Ok(open_newest_first(list))
}

fn open_newest_first(list: Vec<PullRequestInfo>) -> Vec<PullRequestInfo> {
    let mut open: Vec<_> = list.into_iter().filter(|p| p.state == crate::model::PrState::Open).collect();
    open.sort_by(|a, b| b.created_at.cmp(&a.created_at).then(b.id.cmp(&a.id)));
    open
}

/// The commits of a PR: locally when both ends are here, else from the provider (network).
#[tauri::command]
pub async fn pr_commits(path: String, pr: PullRequestInfo) -> CmdResult<PrCommits> {
    let git = Git::new(&path);
    if let Some(commits) = gitops::history::pr_commits_local(&git, &pr).await.map_err(err)? {
        return Ok(PrCommits { commits, from_provider: false });
    }
    let remote = identity::origin_url(&git).await.as_deref().map(crate::providers::remote_url::parse).unwrap_or(crate::providers::remote_url::Remote::Other);
    let commits = crate::providers::pr_commits(&remote, pr.id).await.map_err(err)?;
    Ok(PrCommits { commits, from_provider: true })
}

#[tauri::command]
pub async fn git_switch(state: State<'_, AppState>, path: String, target: String, remote: bool, carry: CarryMode) -> OpResultCmd {
    let _repo = state.repo_locks.working_copy(&path).await;
    gitops::ops::switch(&Git::new(&path), &target, remote, carry).await
}

#[tauri::command]
pub async fn git_switch_new(state: State<'_, AppState>, path: String, name: String, start: String, carry: CarryMode) -> OpResultCmd {
    let _repo = state.repo_locks.working_copy(&path).await;
    gitops::ops::switch_to_new(&Git::new(&path), &name, &start, carry).await
}

#[tauri::command]
pub async fn forget_foreign_worktree(state: State<'_, AppState>, path: String, worktree: String) -> OpResultCmd {
    let _repo = state.repo_locks.refs(&path).await;
    gitops::ops::forget_foreign_worktree(&Git::new(&path), &worktree, &state.backups_dir()).await
}

#[tauri::command]
pub async fn git_fast_forward(state: State<'_, AppState>, path: String, branch: String) -> OpResultCmd {
    let _repo = state.repo_locks.working_copy(&path).await;
    gitops::ops::fast_forward(&Git::new(&path), &branch).await
}

/// `path`: the worktree the stash is applied to; the stash itself is shared by all of them.
#[tauri::command]
pub async fn git_stash_apply(state: State<'_, AppState>, path: String, sha: String) -> OpResultCmd {
    let _repo = state.repo_locks.index_reading_refs(&path).await;
    gitops::ops::stash_apply(&Git::new(&path), &sha).await
}

/// The dropped stash keeps a backup ref and gets a journal entry, so "Recently deleted" can bring it
/// back and purging the backups removes it.
#[tauri::command]
pub async fn git_stash_drop(state: State<'_, AppState>, path: String, sha: String) -> OpResultCmd {
    let _repo = state.repo_locks.refs(&path).await;
    let done = gitops::ops::stash_drop(&Git::new(&path), &sha).await?;
    if let Some(backup) = &done.summary {
        if actions::journal_stash_drop(&state.journal, &path, backup).await.is_err() {
            // The backup ref stays; the next look at "Recently deleted" adopts it.
            state.orphans_unchecked.store(true, Ordering::SeqCst);
        }
    }
    Ok(done)
}

#[tauri::command]
pub async fn git_create_branch(state: State<'_, AppState>, path: String, name: String, start: Option<String>, switch: bool) -> OpResultCmd {
    let _repo = state.repo_locks.working_copy(&path).await;
    gitops::ops::create_branch(&Git::new(&path), &name, start.as_deref(), switch).await
}

#[tauri::command]
pub async fn git_stage(state: State<'_, AppState>, path: String, paths: Vec<String>) -> OpResultCmd {
    let _repo = state.repo_locks.index(&path).await;
    gitops::ops::stage(&Git::new(&path), &paths).await
}

#[tauri::command]
pub async fn git_unstage(state: State<'_, AppState>, path: String, paths: Vec<String>) -> OpResultCmd {
    let _repo = state.repo_locks.index(&path).await;
    gitops::ops::unstage(&Git::new(&path), &paths).await
}

#[tauri::command]
pub async fn git_discard(state: State<'_, AppState>, path: String, tracked: Vec<String>, untracked: Vec<String>) -> OpResultCmd {
    let _repo = state.repo_locks.index(&path).await;
    gitops::ops::discard(&Git::new(&path), &tracked, &untracked, &state.backups_dir()).await
}

/// Stages, unstages or discards chosen hunks or lines of one file; see `ops::apply_selection`.
#[tauri::command]
pub async fn git_apply_selection(
    state: State<'_, AppState>,
    path: String,
    file: String,
    source: DiffSource,
    context: u32,
    picks: Vec<HunkPick>,
    action: ApplyAction,
) -> OpResultCmd {
    let _repo = state.repo_locks.index(&path).await;
    gitops::ops::apply_selection(&Git::new(&path), &file, source, context, &picks, action, &state.backups_dir()).await
}

#[tauri::command]
pub async fn git_commit(state: State<'_, AppState>, path: String, message: String, amend: bool, allow_pushed: bool) -> OpResultCmd {
    let _repo = state.repo_locks.working_copy(&path).await;
    gitops::ops::commit(&Git::new(&path), &message, amend, allow_pushed).await
}

/// Fetch, pull or push with `op-progress` events; `id` lets the UI cancel it.
#[tauri::command]
pub async fn git_remote(app: AppHandle, state: State<'_, AppState>, path: String, op: GitOp, id: String, branch: Option<String>) -> OpResultCmd {
    // Only this repo's lock: a push or pull can take minutes and must not hold up work in other repos.
    // A pull changes the files of the working copy too; a fetch or push only refs.
    let _repo = if op == GitOp::Pull { state.repo_locks.working_copy(&path).await } else { state.repo_locks.refs(&path).await };
    let git = Git::new(&path);
    // Pruning deletes remote-tracking refs; the snapshot keeps what was pushed (see analysis).
    let _ = state.snapshots.record(&git).await;
    let cancel = std::sync::Arc::new(tokio::sync::Notify::new());
    lock(&state.running_ops).insert(id.clone(), cancel.clone());
    let emit_id = id.clone();
    let result = gitops::ops::remote(&git, op, branch.as_deref(), cancel, move |phase, percent| {
        let _ = app.emit("op-progress", OpProgress { id: emit_id.clone(), op, phase, percent });
    })
    .await;
    lock(&state.running_ops).remove(&id);
    result
}

#[tauri::command]
pub fn git_cancel(state: State<'_, AppState>, id: String) {
    if let Some(n) = lock(&state.running_ops).get(&id) {
        n.notify_one();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn open_pull_requests_are_the_open_ones_newest_first() {
        let pr = |id: u32, state: crate::model::PrState, created: Option<i64>| PullRequestInfo {
            id,
            title: String::new(),
            state,
            url: String::new(),
            author: String::new(),
            author_name: None,
            source_ref: String::new(),
            target_ref: String::new(),
            source_sha: None,
            created_at: created,
            closed_at: None,
            target_sha: None,
            reviewers: Vec::new(),
            is_draft: false,
            has_conflicts: false,
        };
        use crate::model::PrState::*;
        let list = vec![pr(1, Open, Some(10)), pr(2, Merged, Some(30)), pr(3, Open, Some(20)), pr(4, Closed, None), pr(5, Open, None)];
        let ids: Vec<u32> = open_newest_first(list).iter().map(|p| p.id).collect();
        assert_eq!(ids, vec![3, 1, 5]);
    }

    #[test]
    fn only_a_sha_reaches_stash_show() {
        assert!(is_sha("0123abc") && is_sha(&"a".repeat(40)));
        assert!(!is_sha("--output=x.txt") && !is_sha("012345") && !is_sha("xyz1234"));
    }
}
