//! Branch deletion as a pipeline: verify → preflight → backup → act → journal.
//! Everything that can fail without side effects runs before the first destructive step, and the
//! journal is written right after that step (the worktree's removal, else the branch's), so a later
//! failure never hides what is gone.

use std::path::{Path, PathBuf};

use crate::actions::Env;
use crate::backup_refs;
use crate::failure;
use crate::analysis::{self, ScanOptions};
use crate::git::discovery::FoundRepo;
use crate::git::identity;
use crate::git::runner::{fields, Git};
use crate::git::snapshot::now;
use crate::gitops::copies;
use crate::model::*;
use crate::process::ProcOutput;

use DeleteStep as S;
use FailureKind as K;

pub(crate) type Step<T> = Result<T, DeleteFailure>;

pub async fn delete(env: &Env<'_>, req: &DeleteRequest) -> Step<DeleteOutcome> {
    if !Path::new(&req.repo_path).is_dir() {
        return Err(failure(K::RepoMissing, S::Verify, &req.repo_path));
    }
    let git = Git::new(&req.repo_path);
    let url = identity::origin_url_checked(&git).await.map_err(|e| failure(K::ConfigUnreadable, S::Verify, format!("{e:#}")))?;
    let id = identity::repo_identity(&git, url.as_deref()).await;
    if env.config.is_locked(&id, &req.branch) {
        return Err(failure(K::Locked, S::Verify, format!("{id} {}", req.branch)));
    }

    // --- verify: the decision was made on scan data; the repository may have moved on since.
    let full = format!("refs/heads/{}", req.branch);
    let o = git.raw(&["rev-parse", "--verify", "--quiet", &full]).await.map_err(|e| from_err(S::Verify, e))?;
    if !o.success() {
        return Err(failure(K::NoLongerCandidate, S::Verify, format!("{full} not found")));
    }
    let sha = o.stdout.trim().to_string();
    if sha != req.expected_sha {
        return Err(failure(K::Changed, S::Verify, format!("{} -> {}", short(&req.expected_sha), short(&sha))));
    }
    let report = current_report(env, req).await?;
    // A commit between the read above and the fresh assessment: the verdict is about another tip.
    if report.sha != sha {
        return Err(failure(K::Changed, S::Verify, format!("{} -> {}", short(&sha), short(&report.sha))));
    }
    if !req.force && report.verdict != Verdict::Safe {
        return Err(failure(K::NoLongerSafe, S::Verify, format!("{:?}", report.verdict)));
    }
    let worktree = report.worktree.as_ref();
    if let Some(w) = worktree {
        if w.is_main {
            return Err(with_path(failure(K::CurrentBranch, S::Verify, "checked out in main worktree"), &w.path));
        }
        if !req.remove_worktree {
            return Err(with_path(failure(K::WorktreeNotConfirmed, S::Verify, "checked out in linked worktree"), &w.path));
        }
    }
    // Only stashes of this branch that the user ticked: a SHA of another branch's stash is ignored.
    let stashes: Vec<&StashInfo> = report.stashes.iter().filter(|s| req.drop_stashes.contains(&s.sha)).collect();

    preflight(&git, &req.branch, worktree, !stashes.is_empty()).await?;
    // Decided before the worktree goes: a refusal of `branch -d` afterwards would leave the branch
    // without its worktree.
    let may_force = req.force || report.merge_evidence.is_some();
    if !may_force && !merged_for_soft_delete(&git, &req.branch, &sha).await {
        return Err(failure(K::NoLongerSafe, S::Verify, "not merged into its upstream or HEAD"));
    }
    // Volatile: `branch -d` deletes the section with the branch, and nothing else keeps it.
    let branch_config = branch_config(&git, &req.branch).await?;

    // --- backup: everything that is about to disappear gets a ref first.
    let ts = now();
    let stash_count = stashes.len();
    let slot = backup_refs::free_second(&git, ts, |s| {
        std::iter::once(backup_refs::local(s, &req.branch)).chain((0..stash_count).map(|n| backup_refs::stash(s, &req.branch, n))).collect()
    })
    .await;
    let backup_ref = backup_refs::local(slot, &req.branch);
    create_ref(&git, &backup_ref, &sha).await?;
    let mut created = vec![backup_ref.clone()];
    let mut planned = Vec::new();
    for (n, s) in stashes.iter().enumerate() {
        let r = backup_refs::stash(slot, &req.branch, n);
        if let Err(f) = create_ref(&git, &r, &s.sha).await {
            discard(&git, &created).await;
            return Err(f);
        }
        created.push(r.clone());
        planned.push(DroppedStash { sha: s.sha.clone(), message: s.message.clone(), backup_ref: r });
    }
    let value_of = |var: &str| branch_config.iter().find(|(k, _)| k == var).map(|(_, v)| v.clone());
    let mut entry = DeletedEntry {
        upstream_remote: value_of("remote"),
        upstream_merge: value_of("merge"),
        forced: req.force,
        verdict: report.verdict,
        // On record before any is dropped: a stop in between leaves an entry whose restore skips the
        // stashes still there, never a dropped stash that no entry names.
        dropped_stashes: planned,
        ..DeletedEntry::new(&req.repo_path, &req.branch, &req.branch, &sha, &backup_ref, ts)
    };
    entry.branch_config = branch_config;
    let stash_refs: Vec<String> = entry.dropped_stashes.iter().map(|s| s.backup_ref.clone()).collect();
    let mut warnings = Vec::new();

    // --- act: worktree first (git refuses to delete a checked-out branch), then the branch.
    let mut files_backup = None;
    let mut journaled = None;
    if let Some(w) = worktree {
        let moved = match copies::move_out(&git, GitOp::RemoveWorktree, &w.path, &env.journal.backups_dir(), slot).await {
            Ok(m) => m,
            Err(f) => {
                discard(&git, &created).await;
                return Err(from_op(f));
            }
        };
        let folder = crate::paths::slashes(&moved.folder.to_string_lossy());
        entry.removed_worktree = Some(crate::paths::slashes(&w.path));
        entry.worktree_branch = Some(req.branch.clone());
        entry.worktree_backup = Some(folder.clone());
        entry.files_backup = Some(crate::paths::slashes(&moved.backup_dir.to_string_lossy()));
        files_backup = Some(folder);
        // The first step that cannot be taken back: on record before anything else can fail.
        journaled = Some(record(env, &entry, &mut warnings));
    }

    let used_force_flag = match delete_branch(&git, &req.branch, &sha, may_force).await {
        Ok(forced) => forced,
        Err(f) => {
            discard(&git, &stash_refs).await;
            discard(&git, std::slice::from_ref(&backup_ref)).await;
            if journaled == Some(true) {
                // Only the worktree is gone: the entry turns into one for it, which brings it back onto
                // the branch that is still there.
                let partial = DeletedEntry {
                    branch: String::new(),
                    backup_ref: String::new(),
                    upstream_remote: None,
                    upstream_merge: None,
                    branch_config: Vec::new(),
                    dropped_stashes: Vec::new(),
                    ..entry
                };
                if let Err(e) = env.journal.upsert(&partial) {
                    let f = DeleteFailure { detail: format!("{}; journal: {e:#}", f.detail), ..f };
                    return Err(keeps_files(DeleteFailure { changed: true, ..f }, files_backup.as_deref()));
                }
            }
            return Err(keeps_files(DeleteFailure { changed: worktree.is_some(), ..f }, files_backup.as_deref()));
        }
    };
    let journaled = match journaled {
        Some(j) => j,
        // --- journal: the branch is gone, so the record must exist before anything else can fail.
        None => record(env, &entry, &mut warnings),
    };

    // --- stashes last: a failure here leaves the stash in place and is only a warning.
    if !journaled {
        // Dropped without a record, a stash could not be found again: they all stay.
        discard(&git, &stash_refs).await;
        if !entry.dropped_stashes.is_empty() {
            warnings.push(warning(K::Other, S::Stash, "stashes kept: the journal could not be written".into(), None));
        }
        entry.dropped_stashes.clear();
    } else {
        let planned = std::mem::take(&mut entry.dropped_stashes);
        let all = planned.len();
        for s in planned {
            match drop_stash(&git, &s.sha).await {
                Ok(()) => entry.dropped_stashes.push(s),
                Err(f) => {
                    let _ = git.raw(&["update-ref", "-d", &s.backup_ref]).await;
                    warnings.push(warning(f.kind, S::Stash, f.detail, f.path));
                }
            }
        }
        if entry.dropped_stashes.len() != all {
            if let Err(e) = env.journal.upsert(&entry) {
                warnings.push(warning(K::Other, S::Journal, format!("{e:#}"), Some(entry.backup_ref.clone())));
            }
        }
    }

    Ok(DeleteOutcome { entry, used_force_flag, warnings, files_backup })
}

/// Appends the entry; a failure is a warning that names the backup ref, from which the next look at
/// "Recently deleted" adopts the entry again.
fn record(env: &Env<'_>, entry: &DeletedEntry, warnings: &mut Vec<DeleteWarning>) -> bool {
    match env.journal.append(entry) {
        Ok(()) => true,
        Err(e) => {
            let path = if entry.backup_ref.is_empty() { entry.worktree_backup.clone() } else { Some(entry.backup_ref.clone()) };
            warnings.push(warning(K::Other, S::Journal, format!("{e:#}"), path));
            false
        }
    }
}

async fn current_report(env: &Env<'_>, req: &DeleteRequest) -> Step<BranchReport> {
    let found = FoundRepo { path: PathBuf::from(&req.repo_path), root: String::new() };
    let opts = ScanOptions {
        fetch: false,
        providers: false,
        only_branch: Some(req.branch.clone()),
        cached_prs: env.cached_prs.clone(),
        fresh: true,
        ..Default::default()
    };
    let scan = analysis::scan_repo(&found, env.config, env.snapshots, opts).await;
    if let Some(e) = scan.result.error {
        return Err(failure(failure::classify_local(&e), S::Verify, e));
    }
    scan.result
        .branches
        .into_iter()
        .next()
        .ok_or_else(|| failure(K::NoLongerCandidate, S::Verify, "deleted, renamed or protected since the scan"))
}

/// Detects what would make git fail halfway: lock files of other git processes, and what stops the
/// removal of the worktree. Whether a program holds a file in it is probed right before it moves.
async fn preflight(git: &Git, branch: &str, worktree: Option<&WorktreeState>, touches_stash: bool) -> Step<()> {
    let lock = crate::preflight::existing_lock(git, Some(branch), None, touches_stash).await.map_err(|e| from_err(S::Preflight, e))?;
    if let Some(lock) = lock {
        let path = lock.to_string_lossy().to_string();
        return Err(with_path(failure(K::Lock, S::Preflight, format!("{path} exists")), &path));
    }
    if let Some(w) = worktree {
        copies::check_removable(git, GitOp::RemoveWorktree, Path::new(&w.path)).await.map_err(from_op)?;
    }
    Ok(())
}

/// A failure of the worktree's removal in the delete's terms. A lock, or a folder in use when the
/// probe runs right before the move, changed nothing and is a preflight finding.
fn from_op(f: OpFailure) -> DeleteFailure {
    let step = if f.kind == K::Lock || (f.kind == K::FileInUse && !f.changed) { S::Preflight } else { S::Worktree };
    DeleteFailure { kind: f.kind, step, detail: f.detail, path: f.path, changed: f.changed, files_backup: None }
}

/// `branch.<name>.*` as (variable, value), from the repository's own config.
async fn branch_config(git: &Git, branch: &str) -> Step<Vec<(String, String)>> {
    let pattern = format!("^branch\\.{}\\.[^.]+$", regex_escape(branch));
    let o = git.raw(&["config", "--local", "-z", "--get-regexp", &pattern]).await.map_err(|e| from_err(S::Backup, e))?;
    match o.code {
        Some(0) => Ok(parse_branch_config(&o.stdout, branch)),
        // git's code for "nothing matches".
        Some(1) => Ok(Vec::new()),
        _ => Err(failure(K::ConfigUnreadable, S::Backup, o.error_text())),
    }
}

/// `config -z` records are `key\nvalue\0`; a key set without a value has no newline.
fn parse_branch_config(out: &str, branch: &str) -> Vec<(String, String)> {
    let prefix = format!("branch.{branch}.");
    out.split('\0')
        .filter(|r| !r.is_empty())
        .filter_map(|r| {
            let (key, value) = r.split_once('\n').unwrap_or((r, ""));
            let var = key.strip_prefix(&prefix)?;
            (!var.is_empty() && !var.contains('.')).then(|| (var.to_string(), value.to_string()))
        })
        .collect()
}

/// A branch name as a literal in git's extended regular expressions.
fn regex_escape(s: &str) -> String {
    s.chars().fold(String::new(), |mut out, c| {
        if "\\.^$|?*+()[]{}".contains(c) {
            out.push('\\');
        }
        out.push(c);
        out
    })
}

/// git's own rule for `branch -d`: merged into the branch's upstream when that ref exists, else into HEAD.
async fn merged_for_soft_delete(git: &Git, branch: &str, sha: &str) -> bool {
    let upstream = git.out(&["for-each-ref", "--format=%(upstream)", &format!("refs/heads/{branch}")]).await.unwrap_or_default();
    let upstream = upstream.trim();
    let reference = if !upstream.is_empty() && git.ref_exists(upstream).await.unwrap_or(false) { upstream } else { "HEAD" };
    git.is_ancestor(sha, reference).await.unwrap_or(false)
}

/// `branch -d`, and where the caller allows it a forced delete of exactly `sha`; true when forced.
async fn delete_branch(git: &Git, branch: &str, sha: &str, may_force: bool) -> Step<bool> {
    let mut soft = match run(git, S::Branch, &["branch", "-d", branch]).await {
        Ok(_) => return Ok(false),
        Err(f) => f,
    };
    // A worktree folder deleted by hand stays registered and makes git refuse the branch. Only that
    // registration goes: a plain prune would also drop worktrees on a drive that is offline right now.
    if let Some(at) = stale_worktree(&soft.detail) {
        run(git, S::Branch, &["worktree", "remove", "--force", &at]).await?;
        soft = match run(git, S::Branch, &["branch", "-d", branch]).await {
            Ok(_) => return Ok(false),
            Err(f) => f,
        };
    }
    // Checked out somewhere: `-D` refuses that as well, and a ref update would pull the branch out
    // from under the worktree.
    if !may_force || soft.kind != K::Other || held_by_worktree(&soft.detail).is_some() {
        return Err(soft);
    }
    // `branch -D` deletes whatever the branch points to now. With the old value the delete refuses a
    // branch that moved since it was checked, as --force-with-lease does on the server.
    let full = format!("refs/heads/{branch}");
    if let Err(f) = run(git, S::Branch, &["update-ref", "-d", &full, sha]).await {
        let now = git.out(&["rev-parse", "--verify", "--quiet", &full]).await.map(|s| s.trim().to_string()).unwrap_or_default();
        if !now.is_empty() && now != sha {
            return Err(failure(K::Changed, S::Branch, format!("{} -> {}", short(sha), short(&now))));
        }
        return Err(f);
    }
    // What `branch -D` removes along with the ref; the entry keeps a copy. None there is fine.
    let _ = git.raw(&["config", "--remove-section", &format!("branch.{branch}")]).await;
    Ok(true)
}

/// The worktree git names when it refuses a branch, if its folder is gone while its volume is there.
/// An unreachable drive or share is no proof of a deleted folder, and neither is a path of another
/// system (WSL, MSYS): on Windows only a drive or share path can be checked here.
fn stale_worktree(detail: &str) -> Option<String> {
    let at = held_by_worktree(detail)?;
    let path = Path::new(&at);
    if cfg!(windows) && !matches!(path.components().next(), Some(std::path::Component::Prefix(_))) {
        return None;
    }
    let volume = path.ancestors().filter(|a| !a.as_os_str().is_empty()).last()?;
    (!path.exists() && volume.exists()).then_some(at)
}

/// "used by worktree at '<path>'" (current git) or "checked out at '<path>'" (older git).
fn held_by_worktree(detail: &str) -> Option<String> {
    let start = ["used by worktree at '", "checked out at '"].iter().find_map(|m| detail.find(m).map(|i| i + m.len()))?;
    let len = detail[start..].find('\'')?;
    Some(detail[start..start + len].to_string())
}

/// A failure after the worktree was moved names where it is now: it is gone from its place.
fn keeps_files(f: DeleteFailure, files_backup: Option<&str>) -> DeleteFailure {
    DeleteFailure { files_backup: files_backup.map(String::from), ..f }
}

async fn drop_stash(git: &Git, sha: &str) -> Step<()> {
    // Indices shift after each drop, so the selector is resolved fresh every time.
    let list = run(git, S::Stash, &["stash", "list", "--format=%gd%x00%H"]).await?;
    let Some(selector) = list.lines().map(fields).find(|f| f.len() >= 2 && f[1] == sha).map(|f| f[0].to_string()) else {
        return Ok(());
    };
    crate::gitops::ops::drop_checked(git, GitOp::StashDrop, &selector, sha)
        .await
        .map_err(|f| DeleteFailure { kind: f.kind, step: S::Stash, detail: f.detail, path: f.path, changed: f.changed, files_backup: None })
}

/// Create-only (empty old value): a backup never overwrites another backup of the same name.
pub(crate) async fn create_ref(git: &Git, name: &str, sha: &str) -> Step<()> {
    run(git, S::Backup, &["update-ref", name, sha, ""]).await.map(|_| ())
}

pub(crate) async fn discard(git: &Git, refs: &[String]) {
    for r in refs {
        let _ = git.raw(&["update-ref", "-d", r]).await;
    }
}

pub(crate) async fn run(git: &Git, step: DeleteStep, args: &[&str]) -> Step<String> {
    let o = git.raw(args).await.map_err(|e| from_err(step, e))?;
    if o.success() { Ok(o.stdout) } else { Err(from_output(step, &o)) }
}

pub(crate) fn failure(kind: FailureKind, step: DeleteStep, detail: impl Into<String>) -> DeleteFailure {
    DeleteFailure { kind, step, detail: detail.into(), path: None, changed: false, files_backup: None }
}

pub(crate) fn with_path(f: DeleteFailure, path: &str) -> DeleteFailure {
    DeleteFailure { path: Some(crate::paths::slashes(path)), ..f }
}

/// For local git commands: running out of time there is a local `Timeout`, not the network.
pub(crate) fn from_output(step: DeleteStep, o: &ProcOutput) -> DeleteFailure {
    from_text(step, o.error_text(), failure::classify_local)
}

pub(crate) fn from_err(step: DeleteStep, e: anyhow::Error) -> DeleteFailure {
    from_text(step, format!("{e:#}"), failure::classify_local)
}

/// For commands that talk to the server (`ls-remote`, `push`).
pub(crate) fn from_network_output(step: DeleteStep, o: &ProcOutput) -> DeleteFailure {
    from_text(step, o.error_text(), failure::classify)
}

pub(crate) fn from_network_err(step: DeleteStep, e: anyhow::Error) -> DeleteFailure {
    from_text(step, format!("{e:#}"), failure::classify)
}

fn from_text(step: DeleteStep, detail: String, classify: fn(&str) -> FailureKind) -> DeleteFailure {
    let f = failure(classify(&detail), step, detail);
    match failure::lock_path(&f.detail) {
        Some(p) => with_path(f, &p),
        None => f,
    }
}

pub(crate) fn warning(kind: FailureKind, step: DeleteStep, detail: String, path: Option<String>) -> DeleteWarning {
    DeleteWarning { kind, step, detail, path }
}

pub(crate) fn short(sha: &str) -> &str {
    &sha[..sha.len().min(8)]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_worktree_git_names_is_read_from_both_message_forms() {
        let new = "error: cannot delete branch 'x' used by worktree at 'C:/ws/wt-x'";
        let old = "error: Cannot delete branch 'x' checked out at '/ws/wt-x'";
        assert_eq!(held_by_worktree(new).as_deref(), Some("C:/ws/wt-x"));
        assert_eq!(held_by_worktree(old).as_deref(), Some("/ws/wt-x"));
        assert_eq!(held_by_worktree("error: The branch 'x' is not fully merged."), None);
    }

    #[test]
    fn only_a_missing_folder_on_a_present_volume_is_stale() {
        let dir = tempfile::tempdir().unwrap();
        let gone = dir.path().join("gone").to_string_lossy().replace('\\', "/");
        let here = dir.path().to_string_lossy().replace('\\', "/");
        let at = |p: &str| format!("error: cannot delete branch 'x' used by worktree at '{p}'");
        assert_eq!(stale_worktree(&at(&gone)), Some(gone.clone()));
        assert_eq!(stale_worktree(&at(&here)), None, "a worktree that is there is no registration to drop");
        if cfg!(windows) {
            // A drive letter that is not connected: the folder may well exist there.
            let offline = (b'D'..=b'Z').map(|c| format!("{}:/", c as char)).find(|d| !Path::new(d).exists());
            if let Some(d) = offline {
                assert_eq!(stale_worktree(&at(&format!("{d}wt-x"))), None);
            }
            // A worktree registered from WSL or MSYS: its path means nothing to this system.
            assert_eq!(stale_worktree(&at("/mnt/c/ws/wt-x")), None);
            assert_eq!(stale_worktree(&at("/c/ws/wt-x")), None);
        }
    }

    #[test]
    fn the_branch_section_is_read_whole_and_the_name_is_matched_literally() {
        let out = "branch.feat/a.b.remote\norigin\0branch.feat/a.b.merge\nrefs/heads/feat/a.b\0branch.feat/a.b.rebase\ntrue\0branch.feat/a.b.flag\0";
        let got = parse_branch_config(out, "feat/a.b");
        assert_eq!(got, [("remote", "origin"), ("merge", "refs/heads/feat/a.b"), ("rebase", "true"), ("flag", "")].map(|(k, v)| (k.to_string(), v.to_string())));
        assert!(parse_branch_config("branch.other.remote\norigin\0", "feat/a.b").is_empty());
        assert_eq!(regex_escape("fix/a.b+c(1)"), "fix/a\\.b\\+c\\(1\\)");
    }

    #[test]
    fn a_failure_after_the_file_backup_names_it() {
        let f = keeps_files(failure(K::Other, S::Branch, "refused"), Some("C:/b/1"));
        assert_eq!((f.detail.as_str(), f.files_backup.as_deref()), ("refused", Some("C:/b/1")), "a fact of its own, git's text stays as it was");
        assert_eq!(keeps_files(failure(K::Other, S::Branch, "refused"), None).files_backup, None);
        let json = serde_json::to_value(failure(K::Other, S::Branch, "x")).unwrap();
        assert!(json.get("filesBackup").is_none(), "absent when there is none, as the bindings declare it optional");
    }

    #[test]
    fn a_local_step_out_of_time_is_a_timeout_and_a_server_step_the_network() {
        assert_eq!(from_err(S::Branch, anyhow::anyhow!("'git' timed out")).kind, K::Timeout);
        assert_eq!(from_network_err(S::Branch, anyhow::anyhow!("'git' timed out")).kind, K::Network);
    }

    #[test]
    fn process_errors_keep_the_lock_path() {
        let f = from_err(S::Branch, anyhow::anyhow!(r"fatal: Unable to create 'C:\r\.git\index.lock': File exists."));
        assert_eq!(f.kind, K::Lock);
        assert_eq!(f.path.as_deref(), Some("C:/r/.git/index.lock"));
        assert_eq!(warning(K::Other, S::Journal, "d".into(), None).detail, "d");
    }
}
