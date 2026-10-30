//! Writing git operations. Each one: preflight → act → structured result or failure, never a half
//! state without saying so. Network operations stream progress and can be cancelled.

use std::path::{Component, Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use tokio::sync::Notify;

use crate::failure;
use crate::git::runner::Git;
use crate::model::*;
use crate::process::{ProcError, ProcOutput};

pub(super) type Op<T> = Result<T, OpFailure>;

/// Commit hooks and network operations may legitimately take minutes.
const LONG: Duration = Duration::from_secs(600);

pub(super) fn fail(op: GitOp, kind: FailureKind, detail: impl Into<String>) -> OpFailure {
    OpFailure { kind, op, detail: detail.into(), path: None, changed: false }
}

pub(super) fn from_text(op: GitOp, detail: String) -> OpFailure {
    let path = failure::lock_path(&detail);
    let network = matches!(op, GitOp::Fetch | GitOp::Pull | GitOp::Push);
    let kind = if network { failure::classify(&detail) } else { failure::classify_local(&detail) };
    OpFailure { kind, op, detail, path, changed: false }
}

fn from_output(op: GitOp, o: &ProcOutput) -> OpFailure {
    from_text(op, o.error_text())
}

pub(super) async fn run(git: &Git, op: GitOp, args: &[&str]) -> Op<String> {
    let o = git.raw(args).await.map_err(|e| from_text(op, format!("{e:#}")))?;
    if o.success() { Ok(o.stdout) } else { Err(from_output(op, &o)) }
}

async fn head(git: &Git) -> Option<String> {
    git.out(&["rev-parse", "HEAD"]).await.ok().map(|s| s.trim().to_string())
}

/// Operations touching the index fail midway when another git process holds its lock.
async fn preflight_index(git: &Git, op: GitOp) -> Op<()> {
    let dir = run(git, op, &["rev-parse", "--path-format=absolute", "--git-dir"]).await?;
    let lock = PathBuf::from(dir.trim()).join("index.lock");
    if lock.exists() {
        let p = crate::paths::slashes(&lock.to_string_lossy());
        return Err(OpFailure { path: Some(p.clone()), ..fail(op, FailureKind::Lock, format!("{p} exists")) });
    }
    Ok(())
}

// ---- branches -----------------------------------------------------------------------------------

/// A ref the frontend names; checked before anything is touched, so "-" or "--detach" never act as options.
fn checked_ref(op: GitOp, r: &str) -> Op<&str> {
    super::history::checked_rev(r).map_err(|_| fail(op, FailureKind::InvalidName, format!("'{r}' is not a ref")))
}

/// `target` is a local branch name or a remote-tracking name like `origin/feature/x`.
pub async fn switch(git: &Git, target: &str, remote: bool, carry: CarryMode) -> Op<OpResult> {
    let op = GitOp::Switch;
    let target = checked_ref(op, target)?;
    preflight_index(git, op).await?;
    let mut result = OpResult::default();
    let msg = format!("McBranchFace: before switching to {target}");
    let own = stash_for_switch(git, op, carry, &msg, &mut result).await?;
    let args: Vec<&str> = if remote { vec!["switch", "--track", target] } else { vec!["switch", target] };
    if let Err(mut f) = run(git, op, &args).await {
        // The switch failed: put the changes back where they were, so nothing moved.
        if let Some(sha) = &own {
            f.changed = pop_own(git, op, sha).await.is_err();
        }
        return Err(f);
    }
    // Conflicts while re-applying: git keeps the stash, the user resolves in the tree.
    if let (CarryMode::Bring, Some(sha)) = (carry, &own) {
        if pop_own(git, op, sha).await.is_err() {
            result.warning = Some(FailureKind::LocalChanges);
        }
    }
    result.sha = head(git).await;
    Ok(result)
}

/// Stashes the local changes unless `carry` keeps them. The stash's commit, read right after the push,
/// is what `pop_own` finds it by later.
async fn stash_for_switch(git: &Git, op: GitOp, carry: CarryMode, msg: &str, result: &mut OpResult) -> Op<Option<String>> {
    if carry == CarryMode::Keep {
        return Ok(None);
    }
    let out = run(git, op, &["stash", "push", "--include-untracked", "-m", msg]).await?;
    result.stashed = !out.contains("No local changes");
    if !result.stashed {
        return Ok(None);
    }
    let sha = run(git, op, &["rev-parse", "--verify", "--quiet", "refs/stash"]).await?;
    Ok(Some(sha.trim().to_string()))
}

/// Applies the stash `sha` and drops it. By its commit, not `stash@{0}`: another git process may have
/// pushed a stash on top meanwhile, and `stash pop` would bring that one. A conflict keeps the stash,
/// as `stash pop` does.
async fn pop_own(git: &Git, op: GitOp, sha: &str) -> Op<()> {
    run(git, op, &["stash", "apply", sha]).await?;
    let selector = stash_selector(git, op, sha).await?;
    drop_checked(git, op, &selector, sha).await
}

async fn check_new_name(git: &Git, op: GitOp, name: &str) -> Op<()> {
    let valid = git.raw(&["check-ref-format", "--branch", name]).await.map_err(|e| from_text(op, format!("{e:#}")))?;
    if !valid.success() || name.trim() != name || name.is_empty() {
        return Err(fail(op, FailureKind::InvalidName, format!("'{name}' is not a valid branch name")));
    }
    if git.ref_exists(&format!("refs/heads/{name}")).await.unwrap_or(false) {
        return Err(fail(op, FailureKind::AlreadyExists, format!("a branch named '{name}' already exists")));
    }
    Ok(())
}

/// A new branch at `start` (`HEAD` or e.g. the remote default branch), switched to at once; local
/// changes are handled as in `switch`, because a different start may conflict with them.
pub async fn switch_to_new(git: &Git, name: &str, start: &str, carry: CarryMode) -> Op<OpResult> {
    let op = GitOp::CreateBranch;
    check_new_name(git, op, name).await?;
    let start = checked_ref(op, start)?;
    preflight_index(git, op).await?;
    let mut result = OpResult::default();
    let msg = format!("McBranchFace: before creating {name}");
    let own = stash_for_switch(git, op, carry, &msg, &mut result).await?;
    // No tracking of the start: a branch made from origin/main must not push back to main.
    if let Err(mut f) = run(git, op, &["switch", "--no-track", "-c", name, start]).await {
        if let Some(sha) = &own {
            f.changed = pop_own(git, op, sha).await.is_err();
        }
        return Err(f);
    }
    if let (CarryMode::Bring, Some(sha)) = (carry, &own) {
        if pop_own(git, op, sha).await.is_err() {
            result.warning = Some(FailureKind::LocalChanges);
        }
    }
    result.sha = head(git).await;
    Ok(result)
}

/// Removes a worktree registration that a folder copy brought along (see `WorktreeInfo::foreign`).
/// The registration folder is moved into `backup_root`, never deleted; the worktree and the
/// repository it really belongs to are not touched.
pub async fn forget_foreign_worktree(git: &Git, worktree: &str, backup_root: &Path) -> Op<OpResult> {
    let op = GitOp::RemoveWorktree;
    let common = super::status::common_dir(git).await.ok_or_else(|| fail(op, FailureKind::Other, "no git directory"))?;
    if !super::status::is_foreign(Path::new(worktree), &common) {
        return Err(fail(op, FailureKind::Other, format!("{worktree} belongs to this repository")));
    }
    // Our registration is the entry whose `gitdir` file names this worktree's `.git`.
    let target = Path::new(worktree).join(".git");
    let target = target.to_string_lossy();
    let entries = std::fs::read_dir(common.join("worktrees")).map_err(|e| fail(op, FailureKind::Other, e.to_string()))?;
    let entry = entries.flatten().map(|e| e.path()).find(|dir| {
        std::fs::read_to_string(dir.join("gitdir")).is_ok_and(|g| crate::paths::same_path(g.trim(), &target))
    });
    let Some(entry) = entry else { return Err(fail(op, FailureKind::Other, format!("no registration for {worktree}"))) };
    let moved = backup_dir(backup_root, git.dir()).and_then(|dir| {
        let dest = dir.join("worktrees").join(entry.file_name().unwrap_or_default());
        std::fs::create_dir_all(dir.join("worktrees")).and_then(|_| move_dir(&entry, &dest)).map(|_| dest)
    });
    let dest = moved.map_err(|e| OpFailure { path: Some(crate::paths::slashes(&entry.to_string_lossy())), ..fail(op, FailureKind::FileInUse, e.to_string()) })?;
    Ok(OpResult { backup_dir: Some(dest.to_string_lossy().to_string()), ..Default::default() })
}

/// A folder of its own for every backup, created here: the second alone let two discards of the same
/// file within a second (in one repo, or in two repos with the same file) overwrite each other's copy.
/// The repo goes into the name, and a counter where the same repo backs up twice in a second. Creating
/// it is the reservation: a check for a free name lets two callers pick the same one.
pub fn backup_dir(backup_root: &Path, repo: &Path) -> std::io::Result<PathBuf> {
    use std::hash::{Hash, Hasher};
    let mut h = std::collections::hash_map::DefaultHasher::new();
    crate::paths::path_key(&repo.to_string_lossy()).hash(&mut h);
    let stem = format!("{}-{:08x}", crate::git::snapshot::now(), h.finish() as u32);
    std::fs::create_dir_all(backup_root)?;
    for n in 1u32..=1000 {
        let dir = if n == 1 { backup_root.join(&stem) } else { backup_root.join(format!("{stem}-{n}")) };
        match std::fs::create_dir(&dir) {
            Ok(()) => return Ok(dir),
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(e) => return Err(e),
        }
    }
    Err(std::io::Error::other(format!("no free backup folder for {stem}")))
}

/// Rename where possible; across drives copy, then delete.
fn move_dir(from: &Path, to: &Path) -> std::io::Result<()> {
    if std::fs::rename(from, to).is_ok() {
        return Ok(());
    }
    copy_tree(from, to)?;
    std::fs::remove_dir_all(from)
}

fn copy_tree(from: &Path, to: &Path) -> std::io::Result<()> {
    std::fs::create_dir_all(to)?;
    for e in std::fs::read_dir(from)? {
        let e = e?;
        if e.file_type()?.is_dir() {
            copy_tree(&e.path(), &to.join(e.file_name()))?;
        } else {
            std::fs::copy(e.path(), to.join(e.file_name()))?;
        }
    }
    Ok(())
}

pub async fn create_branch(git: &Git, name: &str, start: Option<&str>, switch_to: bool) -> Op<OpResult> {
    let op = GitOp::CreateBranch;
    check_new_name(git, op, name).await?;
    let start = checked_ref(op, start.unwrap_or("HEAD"))?;
    if switch_to {
        preflight_index(git, op).await?;
        run(git, op, &["switch", "-c", name, start]).await?;
    } else {
        run(git, op, &["branch", name, start]).await?;
    }
    Ok(OpResult { sha: git.out(&["rev-parse", name]).await.ok().map(|s| s.trim().to_string()), ..Default::default() })
}

/// Brings a local branch up to its upstream as the last fetch left it; nothing goes over the network.
/// Only a fast-forward: a branch with commits of its own is refused, never merged or reset.
pub async fn fast_forward(git: &Git, branch: &str) -> Op<OpResult> {
    let op = GitOp::FastForward;
    let branch = checked_ref(op, branch)?;
    let local = format!("refs/heads/{branch}");
    let upstream = run(git, op, &["rev-parse", "--symbolic-full-name", &format!("{branch}@{{upstream}}")]).await?;
    let upstream = upstream.trim();
    if !git.is_ancestor(&local, upstream).await.map_err(|e| from_text(op, format!("{e:#}")))? {
        return Err(fail(op, FailureKind::Diverged, format!("{branch} has commits that {upstream} lacks")));
    }
    let worktree = run(git, op, &["for-each-ref", "--format=%(worktreepath)", &local]).await?;
    match worktree.trim() {
        "" => run(git, op, &["fetch", "--quiet", ".", &format!("{upstream}:{local}")]).await?,
        // Checked out: the worktree moves with it, and git refuses when local changes are in the way.
        path => run(&Git::new(Path::new(path)), op, &["merge", "--ff-only", "--quiet", upstream]).await?,
    };
    Ok(OpResult { sha: git.out(&["rev-parse", &local]).await.ok().map(|s| s.trim().to_string()), ..Default::default() })
}

// ---- stashes -----------------------------------------------------------------------------------

/// The selector (`stash@{n}`) of a stash by its commit: the numbers shift when another is dropped,
/// the commit does not.
async fn stash_selector(git: &Git, op: GitOp, sha: &str) -> Op<String> {
    let stashes = crate::git::status::stashes(git).await.map_err(|e| from_text(op, format!("{e:#}")))?;
    stashes
        .into_iter()
        .find(|s| s.sha == sha)
        .map(|s| s.selector)
        .ok_or_else(|| fail(op, FailureKind::Changed, format!("stash {sha} is gone")))
}

/// Applies a stash to this worktree and keeps it; conflicts stay in the worktree for the user to solve.
pub async fn stash_apply(git: &Git, sha: &str) -> Op<OpResult> {
    let op = GitOp::StashApply;
    let selector = stash_selector(git, op, sha).await?;
    preflight_index(git, op).await?;
    run(git, op, &["stash", "apply", &selector]).await?;
    Ok(OpResult { sha: head(git).await, ..Default::default() })
}

/// Drops a stash, after a backup ref keeps its commit: the drop can be undone with `git stash store`.
pub async fn stash_drop(git: &Git, sha: &str) -> Op<OpResult> {
    let op = GitOp::StashDrop;
    let selector = stash_selector(git, op, sha).await?;
    let backup = crate::backup_refs::dropped_stash(crate::git::snapshot::now(), sha);
    run(git, op, &["update-ref", &backup, sha, ""]).await?;
    if let Err(e) = drop_checked(git, op, &selector, sha).await {
        let _ = git.raw(&["update-ref", "-d", &backup]).await;
        return Err(e);
    }
    Ok(OpResult { summary: Some(backup), ..Default::default() })
}

/// `git stash drop <selector>`, checked against the commit it was meant for: another git process may
/// have pushed or dropped a stash since the selector was read, which shifts the numbers. A stash
/// dropped by mistake goes back at once, under its message.
pub(crate) async fn drop_checked(git: &Git, op: GitOp, selector: &str, sha: &str) -> Op<()> {
    let out = run(git, op, &["stash", "drop", selector]).await?;
    match dropped_sha(&out) {
        Some(d) if d == sha => Ok(()),
        Some(d) => {
            let message = git.out(&["log", "-1", "--format=%s", d]).await.unwrap_or_default();
            let back = run(git, op, &["stash", "store", "-m", message.trim(), d]).await;
            let f = fail(op, FailureKind::Changed, format!("{selector} was {d}, not {sha}; put back: {}", back.is_ok()));
            Err(OpFailure { changed: back.is_err(), ..f })
        }
        // No "Dropped" line to check against: the list tells whether it is gone.
        None => match crate::git::status::stashes(git).await {
            Ok(list) if list.iter().all(|s| s.sha != sha) => Ok(()),
            _ => Err(fail(op, FailureKind::Other, format!("stash {sha} not dropped: {}", out.trim()))),
        },
    }
}

/// The commit in git's "Dropped refs/stash@{0} (<sha>)".
fn dropped_sha(out: &str) -> Option<&str> {
    let line = out.lines().find(|l| l.starts_with("Dropped "))?;
    let start = line.rfind('(')? + 1;
    let end = line[start..].find(')')? + start;
    Some(&line[start..end]).filter(|s| !s.is_empty() && s.bytes().all(|b| b.is_ascii_hexdigit()))
}

// ---- index and working tree ---------------------------------------------------------------------

/// Paths from the UI are relative to the repo: never absolute, never through "..", so a discard
/// can only ever touch files of this working tree.
fn checked_paths(op: GitOp, paths: &[String]) -> Op<()> {
    for p in paths {
        let path = Path::new(p);
        let escapes = path.components().any(|c| matches!(c, Component::ParentDir | Component::Prefix(_) | Component::RootDir));
        if p.is_empty() || path.is_absolute() || escapes {
            return Err(fail(op, FailureKind::InvalidName, format!("'{p}' is not a path inside the repo")));
        }
    }
    Ok(())
}

pub async fn stage(git: &Git, paths: &[String]) -> Op<OpResult> {
    checked_paths(GitOp::Stage, paths)?;
    preflight_index(git, GitOp::Stage).await?;
    // Paths are file names, never patterns: "routes/[id]" must not also match "routes/i". Not for
    // every command: git stash relies on pathspec magic internally.
    let mut args = vec!["--literal-pathspecs", "add", "--"];
    args.extend(paths.iter().map(String::as_str));
    run(git, GitOp::Stage, &args).await?;
    Ok(OpResult::default())
}

pub async fn unstage(git: &Git, paths: &[String]) -> Op<OpResult> {
    checked_paths(GitOp::Unstage, paths)?;
    preflight_index(git, GitOp::Unstage).await?;
    let mut args = vec!["--literal-pathspecs", "restore", "--staged", "--"];
    args.extend(paths.iter().map(String::as_str));
    run(git, GitOp::Unstage, &args).await?;
    Ok(OpResult::default())
}

/// Throws away unstaged changes and untracked files — after copying every affected file into
/// `backup_root/<timestamp>/`, because git itself keeps no copy of uncommitted work.
pub async fn discard(git: &Git, tracked: &[String], untracked: &[String], backup_root: &Path) -> Op<OpResult> {
    let op = GitOp::Discard;
    checked_paths(op, tracked)?;
    checked_paths(op, untracked)?;
    preflight_index(git, op).await?;
    let root = git.dir().to_path_buf();
    let dir = backup_dir(backup_root, &root).map_err(|e| OpFailure { path: Some(crate::paths::slashes(&backup_root.to_string_lossy())), ..from_text(op, e.to_string()) })?;
    for rel in tracked.iter().chain(untracked) {
        let src = root.join(rel);
        // git lists a folder of new files as one untracked entry: its files are kept as well.
        if let Err(e) = back_up(&src, &dir.join(rel)) {
            // Without a backup nothing is discarded.
            return Err(OpFailure { path: Some(crate::paths::slashes(&src.to_string_lossy())), ..from_text(op, e.to_string()) });
        }
    }
    if !tracked.is_empty() {
        let mut args = vec!["--literal-pathspecs", "restore", "--worktree", "--"];
        args.extend(tracked.iter().map(String::as_str));
        run(git, op, &args).await?;
    }
    for rel in untracked {
        let p = root.join(rel);
        if let Err(e) = remove_untracked(&p) {
            let f = OpFailure { path: Some(crate::paths::slashes(&p.to_string_lossy())), changed: true, ..from_text(op, e.to_string()) };
            return Err(f);
        }
    }
    Ok(OpResult { backup_dir: Some(crate::paths::slashes(&dir.to_string_lossy())), ..Default::default() })
}

/// A read-only file refuses deletion on Windows; it is backed up already, so the attribute goes first.
/// Otherwise a discard of several files stops half way at the first read-only one.
fn remove_untracked(p: &Path) -> std::io::Result<()> {
    let meta = match std::fs::symlink_metadata(p) {
        Ok(m) => m,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(e) => return Err(e),
    };
    if meta.is_dir() {
        return std::fs::remove_dir_all(p);
    }
    if cfg!(windows) && meta.permissions().readonly() {
        let mut writable = meta.permissions();
        // On Windows this clears the read-only attribute; the Unix meaning (world-writable) never applies.
        #[allow(clippy::permissions_set_readonly_false)]
        writable.set_readonly(false);
        std::fs::set_permissions(p, writable)?;
    }
    std::fs::remove_file(p)
}

/// Copies a file, or a folder with everything in it, to `dst`. Links are not followed: what they
/// point to lies outside the working tree and is not discarded.
fn back_up(src: &Path, dst: &Path) -> std::io::Result<()> {
    let meta = match std::fs::symlink_metadata(src) {
        Ok(m) => m,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(e) => return Err(e),
    };
    if meta.is_dir() {
        std::fs::create_dir_all(dst)?;
        for entry in std::fs::read_dir(src)? {
            let entry = entry?;
            back_up(&entry.path(), &dst.join(entry.file_name()))?;
        }
    } else if meta.is_file() {
        if let Some(parent) = dst.parent() {
            std::fs::create_dir_all(parent)?;
        }
        std::fs::copy(src, dst)?;
    }
    Ok(())
}

/// Stages, unstages or discards the chosen lines of one file. The diff is taken again with the
/// context the viewer used, and every chosen hunk must still carry the header that was shown: a
/// file that changed meanwhile is refused, not patched at the wrong place. `git apply --check`
/// runs first; discarding copies the file into `backup_root/<timestamp>/` before it is touched.
pub async fn apply_selection(git: &Git, path: &str, source: DiffSource, context: u32, picks: &[HunkPick], action: ApplyAction, backup_root: &Path) -> Op<OpResult> {
    use super::diff::{PatchError, partial_patch, raw_working};
    let op = match action {
        ApplyAction::Stage => GitOp::Stage,
        ApplyAction::Unstage => GitOp::Unstage,
        ApplyAction::Discard => GitOp::Discard,
    };
    checked_paths(op, &[path.to_string()])?;
    let fits = matches!(
        (action, source),
        (ApplyAction::Stage, DiffSource::Unstaged) | (ApplyAction::Unstage, DiffSource::Staged) | (ApplyAction::Discard, DiffSource::Unstaged)
    );
    if !fits {
        return Err(fail(op, FailureKind::Other, format!("{action:?} does not apply to a {source:?} diff")));
    }
    preflight_index(git, op).await?;
    let opts = DiffOptions { context, whitespace: Whitespace::Keep, full: true };
    let raw = raw_working(git, path, source, &opts, None).await.map_err(|e| from_text(op, format!("{e:#}")))?;
    let reverse = action != ApplyAction::Stage;
    let patch = partial_patch(&raw, picks, reverse).map_err(|e| match e {
        PatchError::Changed => fail(op, FailureKind::Changed, "the file changed since it was shown"),
        PatchError::Nothing => fail(op, FailureKind::Other, "no changed line chosen"),
        PatchError::WholeFileOnly => fail(op, FailureKind::Other, "an added or deleted file moves as a whole"),
    })?;
    // Unique per call: two applications at once must not share, or delete, each other's patch.
    static SEQ: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    let n = SEQ.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let file = std::env::temp_dir().join(format!("mcbranchface-{}-{}-{n}.patch", std::process::id(), crate::git::snapshot::now()));
    std::fs::write(&file, &patch).map_err(|e| from_text(op, e.to_string()))?;
    let result = apply_patch(git, op, action, path, &file, backup_root).await;
    let _ = std::fs::remove_file(&file);
    result
}

async fn apply_patch(git: &Git, op: GitOp, action: ApplyAction, path: &str, file: &Path, backup_root: &Path) -> Op<OpResult> {
    let patch = file.to_string_lossy();
    let mut args = vec!["apply", "--recount", "--whitespace=nowarn"];
    match action {
        ApplyAction::Stage => args.push("--cached"),
        ApplyAction::Unstage => args.extend(["--cached", "-R"]),
        ApplyAction::Discard => args.push("-R"),
    }
    let checked: Vec<&str> = args.iter().copied().chain(["--check", "--", patch.as_ref()]).collect();
    run(git, op, &checked).await?;
    let mut backup_dir = None;
    if action == ApplyAction::Discard {
        let src = git.dir().join(path);
        let copied = self::backup_dir(backup_root, git.dir()).and_then(|dir| {
            let dst = dir.join(path);
            dst.parent().map(std::fs::create_dir_all).transpose().and_then(|_| std::fs::copy(&src, &dst)).map(|_| dir)
        });
        let dir = match copied {
            Ok(dir) => dir,
            // Without a backup nothing is discarded.
            Err(e) => return Err(OpFailure { path: Some(crate::paths::slashes(&src.to_string_lossy())), ..from_text(op, e.to_string()) }),
        };
        backup_dir = Some(crate::paths::slashes(&dir.to_string_lossy()));
    }
    let applied: Vec<&str> = args.iter().copied().chain(["--", patch.as_ref()]).collect();
    run(git, op, &applied).await?;
    Ok(OpResult { backup_dir, ..Default::default() })
}

pub async fn commit(git: &Git, message: &str, amend: bool, allow_pushed: bool) -> Op<OpResult> {
    let op = GitOp::Commit;
    if message.trim().is_empty() && !amend {
        return Err(fail(op, FailureKind::Other, "empty commit message"));
    }
    preflight_index(git, op).await?;
    if amend && !allow_pushed {
        // Amending a pushed commit rewrites shared history; the UI must ask first.
        let on_remote = git.out(&["branch", "-r", "--contains", "HEAD"]).await.unwrap_or_default();
        if !on_remote.trim().is_empty() {
            return Err(fail(op, FailureKind::AlreadyPushed, on_remote.trim().to_string()));
        }
    }
    let mut args = vec!["commit", "-m", message];
    if amend {
        args.push("--amend");
        if message.trim().is_empty() {
            args = vec!["commit", "--amend", "--no-edit"];
        }
    }
    let o = git.raw_with_timeout(&args, LONG).await.map_err(|e| from_text(op, format!("{e:#}")))?;
    if !o.success() {
        return Err(from_text(op, format!("{}\n{}", o.stdout.trim(), o.stderr.trim()).trim().to_string()));
    }
    Ok(OpResult { sha: head(git).await, ..Default::default() })
}

// ---- network ------------------------------------------------------------------------------------

/// "Receiving objects:  45% (450/1000), 1.2 MiB | 2.3 MiB/s" → ("Receiving objects", Some(45)).
pub fn parse_progress(line: &str) -> Option<(String, Option<u32>)> {
    let l = line.trim().trim_start_matches("remote:").trim();
    let (phase, rest) = l.split_once(':')?;
    // URLs ("From https://…") contain a colon too, but are no progress phase.
    if phase.is_empty() || phase.len() > 40 || phase.contains('/') || rest.starts_with("//") {
        return None;
    }
    let pct = rest.trim().split('%').next().and_then(|n| n.trim().parse::<u32>().ok()).filter(|p| *p <= 100);
    Some((phase.to_string(), pct))
}

/// `branch` for a push: the one to publish; None pushes the checked-out one. Fetch and pull ignore it.
pub async fn remote(git: &Git, op: GitOp, branch: Option<&str>, cancel: Arc<Notify>, mut on_progress: impl FnMut(String, Option<u32>) + Send) -> Op<OpResult> {
    let mut args: Vec<String> = match op {
        GitOp::Fetch => vec!["fetch".into(), "--all".into(), "--prune".into()],
        GitOp::Pull => {
            preflight_index(git, op).await?;
            // --no-rebase: a configured pull.rebase must not turn the fast-forward into a rebase.
            vec!["pull".into(), "--ff-only".into(), "--no-rebase".into()]
        }
        GitOp::Push => {
            let branch = match branch {
                Some(b) => checked_ref(op, b)?.to_string(),
                None => git.out(&["symbolic-ref", "--short", "-q", "HEAD"]).await.map_err(|_| fail(op, FailureKind::Other, "detached HEAD"))?.trim().to_string(),
            };
            let cfg = |key: String| async move { git.config_get(&key).await.ok().flatten() };
            let upstream = cfg(format!("branch.{branch}.remote")).await;
            let merge = cfg(format!("branch.{branch}.merge")).await;
            let push_remote = match cfg(format!("branch.{branch}.pushRemote")).await {
                Some(p) => Some(p),
                None => cfg("remote.pushDefault".into()).await,
            };
            let own = format!("refs/heads/{branch}");
            let not_a_remote = |r: &str| r.starts_with('-') || r == ".";
            match (upstream, push_remote) {
                (_, Some(p)) if not_a_remote(&p) => return Err(fail(op, FailureKind::Other, "push remote is not a remote")),
                // A fork setup pushes elsewhere than it pulls from, always under the branch's own name.
                (u, Some(p)) if u.as_deref() != Some(p.as_str()) => vec!["push".into(), p, format!("{own}:{own}")],
                (Some(r), _) if not_a_remote(&r) => return Err(fail(op, FailureKind::Other, "upstream is not a remote")),
                // Remote and refspec spelled out: push.default=matching must never push other branches,
                // and a branch that tracks another name (fix → origin/main) must not write onto it.
                (Some(r), _) => match merge {
                    Some(m) if m == own => vec!["push".into(), r, format!("{own}:{m}")],
                    Some(m) => return Err(fail(op, FailureKind::UpstreamMismatch, format!("{branch} → {r}/{}", m.trim_start_matches("refs/heads/")))),
                    None => vec!["push".into(), r, format!("{own}:{own}")],
                },
                // First push publishes the branch and sets the upstream, like every GUI client does.
                (None, _) => vec!["push".into(), "-u".into(), "origin".into(), branch],
            }
        }
        _ => return Err(fail(op, FailureKind::Other, "not a network operation")),
    };
    args.push("--progress".into());
    let refs: Vec<&str> = args.iter().map(String::as_str).collect();
    let o = git
        .stream(&refs, LONG, cancel, |line| {
            if let Some((phase, pct)) = parse_progress(line) {
                on_progress(phase, pct);
            }
        })
        .await;
    match o {
        Err(ProcError::Cancelled) => Err(fail(op, FailureKind::Cancelled, "cancelled")),
        Err(e) => Err(from_text(op, e.to_string())),
        Ok(o) if !o.success() => Err(from_output(op, &o)),
        Ok(o) => Ok(OpResult {
            sha: head(git).await,
            summary: o.stderr.lines().rev().find(|l| l.contains("->") || l.contains("Fast-forward") || l.contains("up to date")).map(|l| l.trim().to_string()),
            ..Default::default()
        }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn repo_with_two_stashes() -> (tempfile::TempDir, Git, String, String) {
        let dir = tempfile::tempdir().unwrap();
        let run = |args: &[&str]| assert!(std::process::Command::new("git").arg("-C").arg(dir.path()).args(args).status().unwrap().success());
        run(&["init", "-q"]);
        run(&["-c", "user.name=a", "-c", "user.email=a@b", "commit", "-q", "--allow-empty", "-m", "a"]);
        for name in ["first", "second"] {
            std::fs::write(dir.path().join(name), name).unwrap();
            run(&["add", name]);
            run(&["-c", "user.name=a", "-c", "user.email=a@b", "stash", "push", "-q", "-m", name]);
        }
        let sha = |r: &str| String::from_utf8(std::process::Command::new("git").arg("-C").arg(dir.path()).args(["rev-parse", r]).output().unwrap().stdout).unwrap().trim().to_string();
        let (first, second) = (sha("stash@{1}"), sha("stash@{0}"));
        let git = Git::new(dir.path());
        (dir, git, first, second)
    }

    #[tokio::test]
    async fn a_drop_that_hit_another_stash_puts_it_back() {
        let (_dir, git, first, second) = repo_with_two_stashes();
        // The numbers moved: stash@{0} is no longer the stash that was meant.
        let e = drop_checked(&git, GitOp::StashDrop, "stash@{0}", &first).await.unwrap_err();
        assert_eq!((e.kind, e.changed), (FailureKind::Changed, false), "{e:?}");
        let left: Vec<String> = crate::git::status::stashes(&git).await.unwrap().into_iter().map(|s| s.sha).collect();
        assert!(left.contains(&first) && left.contains(&second), "{left:?}");
        let sel = stash_selector(&git, GitOp::StashDrop, &first).await.unwrap();
        drop_checked(&git, GitOp::StashDrop, &sel, &first).await.unwrap();
        let left: Vec<String> = crate::git::status::stashes(&git).await.unwrap().into_iter().map(|s| s.sha).collect();
        assert_eq!(left, [second]);
    }

    #[test]
    fn every_backup_gets_a_folder_of_its_own() {
        let dir = tempfile::tempdir().unwrap();
        let a = backup_dir(dir.path(), Path::new("C:/r")).unwrap();
        let b = backup_dir(dir.path(), Path::new("C:/r")).unwrap();
        assert_ne!(a, b);
        assert!(a.is_dir() && b.is_dir(), "created, so no second caller can pick it");
        let file = dir.path().join("file");
        std::fs::write(&file, "").unwrap();
        assert!(backup_dir(&file, Path::new("C:/r")).is_err());
    }

    #[test]
    fn the_dropped_stash_is_read_from_gits_message() {
        let sha = "0123456789abcdef0123456789abcdef01234567";
        assert_eq!(dropped_sha(&format!("Dropped refs/stash@{{1}} ({sha})\n")), Some(sha));
        assert_eq!(dropped_sha(&format!("Dropped stash@{{0}} ({sha})")), Some(sha));
        assert_eq!(dropped_sha("Dropped stash@{0} (x)"), None);
        assert_eq!(dropped_sha(""), None);
    }

    #[test]
    fn parses_progress_lines() {
        assert_eq!(parse_progress("Receiving objects:  45% (450/1000), 1.2 MiB | 2.3 MiB/s"), Some(("Receiving objects".into(), Some(45))));
        assert_eq!(parse_progress("remote: Counting objects: 100% (5/5), done."), Some(("Counting objects".into(), Some(100))));
        assert_eq!(parse_progress("Writing objects:   3% (1/30)"), Some(("Writing objects".into(), Some(3))));
        assert_eq!(parse_progress("From https://github.com/o/r"), None);
        assert_eq!(parse_progress("To https://x/y.git"), None);
    }
}
