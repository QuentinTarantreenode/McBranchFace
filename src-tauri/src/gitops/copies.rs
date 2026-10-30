//! More physical working copies of one repository, e.g. one per agent working in parallel:
//! a linked worktree (shares the object store, needs its own branch) or an independent clone
//! whose `origin` points where the original's does. Everything is local; no credentials needed.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
#[cfg(test)]
use ts_rs::TS;

use crate::failure;
use crate::git::runner::Git;
use crate::journal::Journal;
use crate::model::*;
use crate::paths::same_path;

use super::ops::{fail, from_text, run, Op};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(test, derive(TS))]
#[cfg_attr(test, ts(export))]
pub enum CopyKind {
    Worktree,
    Clone,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(test, derive(TS))]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, ts(export))]
pub struct CopyTarget {
    pub path: String,
    /// Branch the copy works on.
    pub branch: String,
    /// Create `branch` from the start point instead of checking out an existing one.
    pub create: bool,
}

/// What stands in the way of a target, before anything is created.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
#[cfg_attr(test, derive(TS))]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, ts(export))]
pub struct TargetCheck {
    /// The folder exists and is not empty.
    pub path_taken: bool,
    pub name_invalid: bool,
    /// A local branch of that name exists in the original.
    pub branch_exists: bool,
    /// Worktree where the branch is checked out; a second worktree on it is refused by git.
    pub checked_out_at: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[cfg_attr(test, derive(TS))]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, ts(export))]
pub struct CopyOutcome {
    pub path: String,
    pub failure: Option<OpFailure>,
    /// The copy exists, but something optional did not work (e.g. the upstream could not be set).
    pub warning: Option<FailureKind>,
}

fn taken(p: &Path) -> bool {
    p.exists() && std::fs::read_dir(p).map(|mut d| d.next().is_some()).unwrap_or(true)
}

async fn valid_name(git: &Git, name: &str) -> bool {
    !name.is_empty() && name.trim() == name && git.raw(&["check-ref-format", "--branch", name]).await.is_ok_and(|o| o.success())
}

/// Worktree paths by the branch checked out there.
async fn checked_out(git: &Git) -> Vec<(String, String)> {
    let text = git.out(&["worktree", "list", "--porcelain"]).await.unwrap_or_default();
    crate::gitops::status::parse_worktrees(&text)
        .into_iter()
        .filter_map(|w| w.branch.map(|b| (b, w.path)))
        .collect()
}

pub async fn check(source: &Git, kind: CopyKind, targets: &[CopyTarget]) -> Vec<TargetCheck> {
    let busy = checked_out(source).await;
    let mut out = Vec::with_capacity(targets.len());
    for t in targets {
        let branch_exists = source.ref_exists(&format!("refs/heads/{}", t.branch)).await.unwrap_or(false);
        // A clone has its own branches; only a worktree shares them with the original.
        let checked_out_at = if kind == CopyKind::Worktree && !t.create {
            busy.iter().find(|(b, _)| *b == t.branch).map(|(_, p)| crate::paths::slashes(p))
        } else {
            None
        };
        out.push(TargetCheck { path_taken: taken(Path::new(&t.path)), name_invalid: !valid_name(source, &t.branch).await, branch_exists, checked_out_at });
    }
    out
}

/// `count` free folders next to the repository: `<name>-<label>-1`, `-2`, … skipping taken ones.
pub fn free_folders(repo: &Path, label: &str, count: usize) -> Vec<String> {
    let parent = repo.parent().unwrap_or(repo);
    let name = repo.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    (1..)
        .map(|n| parent.join(format!("{name}-{label}-{n}")))
        .filter(|p| !taken(p))
        .take(count)
        .map(|p| crate::paths::slashes(&p.to_string_lossy()))
        .collect()
}

/// Commit of the start point in the original; a clone knows every object of it, not every name.
async fn resolve(source: &Git, op: GitOp, start: &str) -> Op<String> {
    let rev = format!("{start}^{{commit}}");
    run(source, op, &["rev-parse", "--verify", "--quiet", "--end-of-options", &rev])
        .await
        .map(|s| s.trim().to_string())
        .map_err(|_| fail(op, FailureKind::InvalidName, format!("'{start}' is not a commit in this repository")))
}

pub async fn add_worktree(source: &Git, target: &CopyTarget, start: &str) -> Op<CopyOutcome> {
    let op = GitOp::AddWorktree;
    preflight(source, op, target).await?;
    if target.create {
        let sha = resolve(source, op, start).await?;
        run(source, op, &["worktree", "add", "-b", &target.branch, "--", &target.path, &sha]).await?;
    } else {
        if let Some((_, at)) = checked_out(source).await.into_iter().find(|(b, _)| *b == target.branch) {
            return Err(OpFailure { path: Some(crate::paths::slashes(&at)), ..fail(op, FailureKind::CheckedOut, format!("'{}' is checked out in {at}", target.branch)) });
        }
        run(source, op, &["worktree", "add", "--", &target.path, &target.branch]).await?;
    }
    Ok(CopyOutcome { path: crate::paths::slashes(&target.path), failure: None, warning: None })
}

/// A worktree shares the branches of its repo: a new one must not exist there yet.
async fn preflight(source: &Git, op: GitOp, target: &CopyTarget) -> Op<()> {
    preflight_target(source, op, target).await?;
    if target.create && source.ref_exists(&format!("refs/heads/{}", target.branch)).await.unwrap_or(false) {
        return Err(fail(op, FailureKind::AlreadyExists, format!("a branch named '{}' already exists", target.branch)));
    }
    Ok(())
}

/// A local clone whose remote-tracking refs are the original's (what it knows of the server), not
/// the original's local branches; `origin` then points to the server. A half-made clone is removed.
pub async fn clone(source: &Git, target: &CopyTarget, start: &str) -> Op<CopyOutcome> {
    let op = GitOp::Clone;
    preflight_target(source, op, target).await?;
    let result = clone_steps(source, target, start).await;
    if let Err(f) = &result {
        // Only what this call created goes; the folder was empty or missing before.
        if f.kind != FailureKind::AlreadyExists {
            let _ = std::fs::remove_dir_all(&target.path);
        }
    }
    result
}

/// What every new copy needs: an absolute, free folder and a valid branch name. Paths are absolute
/// because git resolves a relative one against the repo, the checks here against the process folder,
/// so they would look at two different places.
async fn preflight_target(source: &Git, op: GitOp, target: &CopyTarget) -> Op<()> {
    if !Path::new(&target.path).is_absolute() {
        return Err(fail(op, FailureKind::InvalidName, format!("'{}' is not an absolute path", target.path)));
    }
    if taken(Path::new(&target.path)) {
        return Err(OpFailure { path: Some(crate::paths::slashes(&target.path)), ..fail(op, FailureKind::AlreadyExists, format!("{} exists and is not empty", target.path)) });
    }
    if !valid_name(source, &target.branch).await {
        return Err(fail(op, FailureKind::InvalidName, format!("'{}' is not a valid branch name", target.branch)));
    }
    Ok(())
}

async fn clone_steps(source: &Git, target: &CopyTarget, start: &str) -> Op<CopyOutcome> {
    let op = GitOp::Clone;
    let src = source.dir().to_string_lossy().into_owned();
    let start_sha = if target.create { Some(resolve(source, op, start).await?) } else { None };
    let existing_sha = if target.create {
        None
    } else {
        let local = source.out(&["rev-parse", "--verify", "--quiet", &format!("refs/heads/{}", target.branch)]).await.ok();
        let remote = source.out(&["rev-parse", "--verify", "--quiet", &format!("refs/remotes/origin/{}", target.branch)]).await.ok();
        match local.or(remote) {
            Some(s) => Some(s.trim().to_string()),
            None => return Err(fail(op, FailureKind::NoLongerCandidate, format!("no branch '{}' in the original", target.branch))),
        }
    };

    let parent = PathBuf::from(&target.path);
    let parent = parent.parent().unwrap_or(Path::new("."));
    std::fs::create_dir_all(parent).map_err(|e| from_text(op, e.to_string()))?;
    run(&Git::new(parent), op, &["clone", "--quiet", "--no-checkout", "--", &src, &target.path]).await?;
    let copy = Git::new(&target.path);
    let initial = copy.out(&["symbolic-ref", "--quiet", "--short", "HEAD"]).await.ok().map(|s| s.trim().to_string());

    // The server's branches as the original last saw them, instead of the original's local branches.
    run(&copy, op, &["fetch", "--quiet", "--prune", "--no-tags", &src, "+refs/remotes/origin/*:refs/remotes/origin/*"]).await?;
    if let Ok(head) = source.out(&["symbolic-ref", "--quiet", "refs/remotes/origin/HEAD"]).await {
        let _ = run(&copy, op, &["symbolic-ref", "refs/remotes/origin/HEAD", head.trim()]).await;
    }
    if let Some(url) = source.config_get("remote.origin.url").await.ok().flatten() {
        run(&copy, op, &["remote", "set-url", "origin", &url]).await?;
    }

    let mut warning = None;
    if let Some(sha) = start_sha {
        run(&copy, op, &["switch", "--quiet", "--discard-changes", "--no-track", "-c", &target.branch, &sha]).await?;
    } else if let Some(sha) = existing_sha {
        run(&copy, op, &["switch", "--quiet", "--discard-changes", "-C", &target.branch, &sha]).await?;
        let upstream = format!("refs/remotes/origin/{}", target.branch);
        if copy.ref_exists(&upstream).await.unwrap_or(false)
            && run(&copy, op, &["branch", "--quiet", "--set-upstream-to", &format!("origin/{}", target.branch), &target.branch]).await.is_err()
        {
            warning = Some(FailureKind::Other);
        }
    }
    // The branch clone made for the original's HEAD is a copy of a local branch, which could show as
    // gone here; it stays in the original.
    if let Some(initial) = initial.filter(|b| *b != target.branch) {
        let _ = run(&copy, op, &["branch", "--quiet", "-D", &initial]).await;
    }
    Ok(CopyOutcome { path: crate::paths::slashes(&target.path), failure: None, warning })
}

/// The patch of a removed worktree's staged changes, in its backup folder.
pub const STAGED_PATCH: &str = "staged.patch";
/// Next to a worktree on another volume than the backups: a rename cannot cross volumes.
pub const TRASH: &str = ".mcbranchface-trash";
/// Paths past 260 characters in a worktree must not make git stop half way on Windows.
const LONG_PATHS: [&str; 2] = ["-c", "core.longpaths=true"];

/// Removes a linked worktree by moving its folder into the backups and then dropping git's
/// registration: ignored files, nested repositories and commits on no branch stay, and "Recently
/// deleted" can bring the worktree back or purge it. Without `force` a worktree with changes is
/// refused, as `git worktree remove` does.
pub async fn remove_worktree(source: &Git, path: &str, force: bool, journal: &Journal) -> Op<OpResult> {
    let op = GitOp::RemoveWorktree;
    let listed = checked_out_paths(source).await;
    if !listed.iter().any(|p| same_folder(p, path)) {
        return Err(fail(op, FailureKind::NoLongerCandidate, format!("{path} is not a linked worktree of this repository")));
    }
    check_removable(source, op, Path::new(path)).await?;
    if !force {
        // git's own rule for a removal without force: untracked or changed files, submodules included.
        let changes = run(&Git::new(path), op, &[LONG_PATHS[0], LONG_PATHS[1], "status", "--porcelain", "--ignore-submodules=none"]).await?;
        if !changes.trim().is_empty() {
            return Err(OpFailure { path: Some(crate::paths::slashes(path)), ..fail(op, FailureKind::LocalChanges, format!("'{path}' contains modified or untracked files")) });
        }
    }
    let ts = crate::git::snapshot::now();
    let moved = move_out(source, op, path, &journal.backups_dir(), ts).await?;
    let folder = crate::paths::slashes(&moved.folder.to_string_lossy());
    let name = Path::new(path).file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    let entry = DeletedEntry {
        removed_worktree: Some(crate::paths::slashes(path)),
        worktree_backup: Some(folder.clone()),
        worktree_branch: moved.branch.clone(),
        files_backup: Some(crate::paths::slashes(&moved.backup_dir.to_string_lossy())),
        ..DeletedEntry::new(&source.dir().to_string_lossy(), "", &format!("worktree-{name}"), &moved.head, moved.detached_ref.as_deref().unwrap_or(""), ts)
    };
    // The folder is safe in the backups either way; without the entry it is only not listed.
    let warning = journal.append(&entry).err().map(|_| FailureKind::Other);
    Ok(OpResult { backup_dir: Some(folder), warning, ..Default::default() })
}

/// What `move_out` did with a worktree.
#[derive(Debug, Clone)]
pub struct Moved {
    /// Where the worktree folder is now.
    pub folder: PathBuf,
    /// This removal's folder in the backups: the staged changes, and the worktree folder where it
    /// could be moved there.
    pub backup_dir: PathBuf,
    /// The worktree's HEAD commit; empty for a branch without commits.
    pub head: String,
    /// The branch checked out there; none for a detached HEAD.
    pub branch: Option<String>,
    /// The ref that keeps commits the worktree made on no branch.
    pub detached_ref: Option<String>,
}

/// What stops a worktree removal before anything changes: a lock of another git process, an
/// operation under way that would be lost with the worktree's git directory, a lock set with
/// `git worktree lock`.
pub async fn check_removable(source: &Git, op: GitOp, dir: &Path) -> Op<()> {
    let lock = crate::preflight::existing_lock(source, None, Some(dir), false).await.map_err(|e| from_text(op, format!("{e:#}")))?;
    if let Some(lock) = lock {
        let path = crate::paths::slashes(&lock.to_string_lossy());
        return Err(OpFailure { path: Some(path.clone()), ..fail(op, FailureKind::Lock, format!("{path} exists")) });
    }
    let admin = run(&Git::new(dir), op, &["rev-parse", "--path-format=absolute", "--git-dir"]).await?;
    let admin = PathBuf::from(admin.trim());
    let at = |f: OpFailure| OpFailure { path: Some(crate::paths::slashes(&dir.to_string_lossy())), ..f };
    if let Some(what) = operation_in_progress(&admin) {
        return Err(at(fail(op, FailureKind::OperationInProgress, format!("{what} in {}", admin.display()))));
    }
    if admin.join("locked").exists() {
        let reason = std::fs::read_to_string(admin.join("locked")).unwrap_or_default();
        return Err(at(fail(op, FailureKind::Other, format!("cannot remove a locked working tree: {}", reason.trim()))));
    }
    Ok(())
}

/// The state files git keeps in a worktree's git directory while an operation waits for the user.
fn operation_in_progress(admin: &Path) -> Option<&'static str> {
    ["rebase-merge", "rebase-apply", "MERGE_HEAD", "CHERRY_PICK_HEAD", "REVERT_HEAD", "BISECT_LOG"].into_iter().find(|f| admin.join(f).exists())
}

/// Moves a linked worktree out of the way, keeping everything git would delete: commits on no branch
/// get a backup ref, the staged changes a patch (the index goes with the registration), the folder
/// moves as a whole into the backups. Then git drops only the registration. The probe runs right
/// before the move; a failure before the move changes nothing, one after it moves the folder back.
pub async fn move_out(source: &Git, op: GitOp, path: &str, backup_root: &Path, ts: i64) -> Op<Moved> {
    let dir = Path::new(path);
    check_removable(source, op, dir).await?;
    let wt = Git::new(dir);
    let head = wt.out(&["rev-parse", "--verify", "--quiet", "HEAD"]).await.map(|s| s.trim().to_string()).unwrap_or_default();
    let branch = wt.out(&["symbolic-ref", "--quiet", "--short", "HEAD"]).await.ok().map(|s| s.trim().to_string()).filter(|s| !s.is_empty());
    let mut detached_ref = None;
    if !head.is_empty() {
        let count = run(&wt, op, &["rev-list", "--count", "HEAD", "--not", "--branches", "--remotes"]).await?;
        if count.trim().parse::<u32>().unwrap_or(0) > 0 {
            let name = dir.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
            let slot = crate::backup_refs::free_second(source, ts, |s| vec![crate::backup_refs::worktree(s, &name)]).await;
            let r = crate::backup_refs::worktree(slot, &name);
            run(source, op, &["update-ref", &r, &head, ""]).await?;
            detached_ref = Some(r);
        }
    }
    let abandon = |backup: Option<&Path>| {
        let refs: Vec<String> = detached_ref.iter().cloned().collect();
        let backup = backup.map(Path::to_path_buf);
        async move {
            for r in refs {
                let _ = source.raw(&["update-ref", "-d", &r]).await;
            }
            if let Some(b) = backup {
                let _ = std::fs::remove_dir_all(b);
            }
        }
    };
    let backup = match super::ops::backup_dir(backup_root, dir) {
        Ok(b) => b,
        Err(e) => {
            abandon(None).await;
            return Err(OpFailure { path: Some(crate::paths::slashes(&backup_root.to_string_lossy())), ..from_text(op, e.to_string()) });
        }
    };
    // Written by git itself: the patch carries the files' bytes, which need not be UTF-8.
    let patch = backup.join(STAGED_PATCH);
    let output = format!("--output={}", patch.to_string_lossy());
    let saved = run(&wt, op, &[LONG_PATHS[0], LONG_PATHS[1], "diff", "--cached", "--binary", &output]).await;
    if std::fs::metadata(&patch).is_ok_and(|m| m.len() == 0) {
        let _ = std::fs::remove_file(&patch);
    }
    if let Err(f) = saved {
        abandon(Some(&backup)).await;
        return Err(f);
    }
    if let Err(f) = probe(op, dir).await {
        abandon(Some(&backup)).await;
        return Err(f);
    }
    let folder = match move_folder(dir, &backup.join("worktree"), ts) {
        Ok(folder) => folder,
        Err(e) => {
            abandon(Some(&backup)).await;
            let kind = if e.kind() == std::io::ErrorKind::PermissionDenied { FailureKind::FileInUse } else { failure::classify_local(&e.to_string()) };
            return Err(OpFailure { path: Some(crate::paths::slashes(path)), ..fail(op, kind, e.to_string()) });
        }
    };
    // The folder is gone from its place: git now drops only the registration.
    if let Err(f) = run(source, op, &[LONG_PATHS[0], LONG_PATHS[1], "worktree", "remove", "--force", path]).await {
        // A registration without its folder looks like a worktree deleted by hand: the folder goes back.
        let back = std::fs::rename(&folder, dir);
        if back.is_ok() {
            abandon(Some(&backup)).await;
        }
        let path = if back.is_ok() { path.to_string() } else { folder.to_string_lossy().into_owned() };
        return Err(OpFailure { path: Some(crate::paths::slashes(&path)), changed: back.is_err(), ..f });
    }
    Ok(Moved { folder, backup_dir: backup, head, branch, detached_ref })
}

/// The folder can be renamed, i.e. no program holds a file in it; retried for about a second.
async fn probe(op: GitOp, dir: &Path) -> Op<()> {
    use crate::preflight::Probe;
    let at = |p: &Path| Some(crate::paths::slashes(&p.to_string_lossy()));
    match crate::preflight::probe_not_in_use(dir).await {
        Ok(()) => Ok(()),
        Err(Probe::InUse(e)) => Err(OpFailure { path: at(dir), ..fail(op, FailureKind::FileInUse, e.to_string()) }),
        Err(Probe::Taken { at: probe }) => Err(OpFailure { path: at(&probe), ..fail(op, FailureKind::AlreadyExists, format!("{} exists", probe.display())) }),
        Err(Probe::Stranded { at: probe, error }) => {
            let f = fail(op, FailureKind::Other, format!("{error}; worktree left at {}", probe.display()));
            Err(OpFailure { path: at(&probe), changed: true, ..f })
        }
    }
}

/// Renames `dir` to `dest`. Across volumes a rename is impossible and a copy is what git's deletion
/// would have needed to survive; the folder then goes to a trash folder next to it instead.
fn move_folder(dir: &Path, dest: &Path, ts: i64) -> std::io::Result<PathBuf> {
    match std::fs::rename(dir, dest) {
        Ok(()) => Ok(dest.to_path_buf()),
        Err(e) if is_cross_volume(&e) => {
            let trash = dir.parent().unwrap_or(dir).join(TRASH);
            std::fs::create_dir_all(&trash)?;
            let name = dir.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
            let dest = (1u32..=1000)
                .map(|n| trash.join(if n == 1 { format!("{ts}-{name}") } else { format!("{ts}-{name}-{n}") }))
                .find(|p| !p.exists())
                .ok_or_else(|| std::io::Error::other("no free name in the trash folder"))?;
            std::fs::rename(dir, &dest)?;
            Ok(dest)
        }
        Err(e) => Err(e),
    }
}

/// ERROR_NOT_SAME_DEVICE on Windows, EXDEV elsewhere.
fn is_cross_volume(e: &std::io::Error) -> bool {
    e.kind() == std::io::ErrorKind::CrossesDevices || e.raw_os_error() == Some(if cfg!(windows) { 17 } else { 18 })
}

/// Brings a removed worktree back: registered again at its old place, on `branch` where that still
/// exists and is free (else detached at `sha`), with the folder as it was moved away and the staged
/// changes staged again. Runs again after a stop half way: a worktree already back is left as it is.
pub async fn restore_worktree(source: &Git, original: &str, moved: &Path, branch: Option<&str>, sha: &str, staged: Option<&Path>) -> anyhow::Result<()> {
    let target = Path::new(original);
    if !moved.is_dir() {
        if target.join(".git").exists() && checked_out_paths(source).await.iter().any(|p| same_path(p, original)) {
            return Ok(());
        }
        anyhow::bail!("the moved worktree folder {} is gone", moved.display());
    }
    if taken(target) {
        return Err(AppError::new(ErrorCode::Other, format!("{original} exists; the worktree stays in {}", moved.display())).into());
    }
    // A fresh registration next to the old place; only its `.git` file is taken over.
    let name = target.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    let tmp = target.with_file_name(format!("{name}.mcbranchface-restore-{}-{}", std::process::id(), crate::git::snapshot::now()));
    let tmp_arg = tmp.to_string_lossy().into_owned();
    let free = match branch {
        Some(b) if source.ref_exists(&format!("refs/heads/{b}")).await.unwrap_or(false) => !checked_out(source).await.iter().any(|(x, _)| x == b),
        _ => false,
    };
    let mut add = vec![LONG_PATHS[0], LONG_PATHS[1], "worktree", "add", "--no-checkout"];
    match branch {
        Some(b) if free => add.extend(["--", tmp_arg.as_str(), b]),
        _ => add.extend(["--detach", "--", tmp_arg.as_str(), sha]),
    }
    source.out(&add).await?;
    let adopted = std::fs::copy(tmp.join(".git"), moved.join(".git")).and_then(|_| std::fs::rename(moved, target));
    if let Err(e) = adopted {
        let _ = source.raw(&["worktree", "remove", "--force", &tmp_arg]).await;
        return Err(anyhow::Error::new(e).context(format!("cannot move {} back to {original}", moved.display())));
    }
    source.out(&["worktree", "repair", original]).await?;
    let _ = std::fs::remove_dir_all(&tmp);
    let wt = Git::new(target);
    // The index went with the old registration: rebuilt from HEAD, the working files untouched.
    wt.out(&[LONG_PATHS[0], LONG_PATHS[1], "reset", "--quiet"]).await?;
    if let Some(patch) = staged.filter(|p| p.is_file()) {
        // The files are back either way; only what was staged would stay unstaged.
        let _ = wt.raw(&["apply", "--cached", "--binary", &patch.to_string_lossy()]).await;
    }
    Ok(())
}

/// Whether two spellings name the same folder. git lists the long form of a path, while the app may hold
/// the 8.3 short form (`RUNNER~1` on CI runners): the text differs, the folder does not. Resolved where
/// both exist; otherwise the text decides.
fn same_folder(a: &str, b: &str) -> bool {
    match (std::fs::canonicalize(a), std::fs::canonicalize(b)) {
        (Ok(x), Ok(y)) => same_path(&x.to_string_lossy(), &y.to_string_lossy()),
        _ => same_path(a, b),
    }
}

async fn checked_out_paths(git: &Git) -> Vec<String> {
    let text = git.out(&["worktree", "list", "--porcelain"]).await.unwrap_or_default();
    crate::gitops::status::parse_worktrees(&text).into_iter().filter(|w| !w.is_main).map(|w| w.path).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_operation_that_waits_for_the_user_is_found() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(operation_in_progress(dir.path()), None);
        for f in ["MERGE_HEAD", "CHERRY_PICK_HEAD", "REVERT_HEAD", "BISECT_LOG"] {
            std::fs::write(dir.path().join(f), "").unwrap();
            assert_eq!(operation_in_progress(dir.path()), Some(f));
            std::fs::remove_file(dir.path().join(f)).unwrap();
        }
        std::fs::create_dir(dir.path().join("rebase-apply")).unwrap();
        assert_eq!(operation_in_progress(dir.path()), Some("rebase-apply"));
    }

    #[test]
    fn a_move_within_a_volume_is_a_rename() {
        let dir = tempfile::tempdir().unwrap();
        let wt = dir.path().join("wt");
        std::fs::create_dir_all(wt.join("deep")).unwrap();
        std::fs::write(wt.join("deep").join("a.txt"), "a").unwrap();
        let dest = dir.path().join("backups").join("1-x");
        std::fs::create_dir_all(&dest).unwrap();
        let moved = move_folder(&wt, &dest.join("worktree"), 1).unwrap();
        assert_eq!(moved, dest.join("worktree"));
        assert_eq!(std::fs::read_to_string(moved.join("deep").join("a.txt")).unwrap(), "a");
        assert!(!wt.exists());
        assert!(is_cross_volume(&std::io::Error::from_raw_os_error(if cfg!(windows) { 17 } else { 18 })));
        assert!(!is_cross_volume(&std::io::Error::from(std::io::ErrorKind::PermissionDenied)));
    }
}
