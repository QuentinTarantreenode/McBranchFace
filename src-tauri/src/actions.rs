use std::collections::HashSet;
use std::path::Path;

use anyhow::Result;

use crate::backup_refs;
use crate::config::Config;
use crate::failure;
use crate::git::refs;
use crate::git::runner::{Git, FETCH_TIMEOUT};
use crate::git::snapshot::{now, SnapshotStore};
use crate::gitops::copies;
use crate::journal::{Edit, Journal};
use crate::model::*;

pub struct Env<'a> {
    pub config: &'a Config,
    pub snapshots: &'a SnapshotStore,
    pub journal: &'a Journal,
    pub cached_prs: Option<Vec<PullRequestInfo>>,
}

fn app(code: ErrorCode, detail: impl Into<String>) -> anyhow::Error {
    AppError::new(code, detail).into()
}

/// Network failures are reported by kind, so the UI can say "sign in" instead of showing git's text.
fn remote_error(text: String) -> anyhow::Error {
    let code = match failure::classify(&text) {
        FailureKind::Network => ErrorCode::Network,
        FailureKind::AuthRequired => ErrorCode::AuthRequired,
        FailureKind::Rejected => ErrorCode::Rejected,
        _ => ErrorCode::Other,
    };
    app(code, text)
}

/// The push of an online restore can take minutes: the journal is read before it and written after it
/// under its own lock, so other repos' deletes append meanwhile and keep their entries.
pub async fn restore(journal: &Journal, id: &str) -> Result<DeletedEntry> {
    let mut entry = journal.load()?.into_iter().find(|e| e.id == id).ok_or_else(|| app(ErrorCode::EntryNotFound, id))?;
    if entry.restored_at.is_some() {
        return Err(app(ErrorCode::AlreadyRestored, entry.branch.clone()));
    }
    let git = Git::new(&entry.repo_path);
    if !git.dir().is_dir() {
        return Err(app(ErrorCode::PathMissing, entry.repo_path.clone()));
    }
    match entry.remote.clone() {
        Some(remote) => restore_online(&git, &entry, &remote).await?,
        None => restore_local(&git, &entry).await?,
    }
    let at = now();
    entry.restored_at = Some(at);
    journal.update(|entries| {
        if let Some(e) = entries.iter_mut().find(|e| e.id == id) {
            e.restored_at = Some(at);
        }
    })?;
    Ok(entry)
}

/// Every step can run again: a restore that stopped half way (the branch made, a stash not) is
/// finished by the next try instead of failing on the branch it created itself.
async fn restore_local(git: &Git, entry: &DeletedEntry) -> Result<()> {
    // A dropped stash or a removed worktree on its own has no branch to bring back.
    if !entry.branch.is_empty() {
        restore_branch_ref(git, entry).await?;
    }
    let present: std::collections::HashSet<String> = git.out(&["stash", "list", "--format=%H"]).await.unwrap_or_default().lines().map(str::to_string).collect();
    // Recorded newest first, as `git stash list` shows them; `stash store` puts each on top, so the
    // oldest goes in first to get the old order back.
    for s in entry.dropped_stashes.iter().rev().filter(|s| !present.contains(&s.sha)) {
        git.out(&["stash", "store", "-m", &s.message, &s.backup_ref]).await?;
    }
    // Older entries name a removed worktree without a folder: git deleted it, nothing to bring back.
    if let (Some(original), Some(moved)) = (&entry.removed_worktree, &entry.worktree_backup) {
        let branch = entry.worktree_branch.as_deref().or((!entry.branch.is_empty()).then_some(entry.branch.as_str()));
        let staged = entry.files_backup.as_ref().map(|d| Path::new(d).join(copies::STAGED_PATCH));
        copies::restore_worktree(git, original, Path::new(moved), branch, &entry.sha, staged.as_deref()).await?;
    }
    Ok(())
}

async fn restore_branch_ref(git: &Git, entry: &DeletedEntry) -> Result<()> {
    let head = format!("refs/heads/{}", entry.branch);
    let commit_of = |r: String| async move { git.out(&["rev-parse", "--verify", "--quiet", &format!("{r}^{{commit}}")]).await.map(|s| s.trim().to_string()) };
    if git.ref_exists(&head).await? {
        if commit_of(head.clone()).await? != commit_of(entry.backup_ref.clone()).await? {
            return Err(app(ErrorCode::BranchExists, entry.branch.clone()));
        }
    } else {
        git.out(&["branch", &entry.branch, &entry.backup_ref]).await?;
    }
    let key = |var: &str| format!("branch.{}.{var}", entry.branch);
    if entry.branch_config.is_empty() {
        if let (Some(r), Some(m)) = (&entry.upstream_remote, &entry.upstream_merge) {
            git.out(&["config", &key("remote"), r]).await?;
            git.out(&["config", &key("merge"), m]).await?;
        }
        return Ok(());
    }
    // Replaced, not added to: a second try must not write a value twice.
    let mut vars: Vec<&str> = entry.branch_config.iter().map(|(k, _)| k.as_str()).collect();
    vars.sort_unstable();
    vars.dedup();
    for var in vars {
        let _ = git.raw(&["config", "--unset-all", &key(var)]).await;
    }
    for (var, value) in &entry.branch_config {
        git.out(&["config", "--add", &key(var), value]).await?;
    }
    Ok(())
}

/// Pushes the saved tip back under its old name; refuses when someone created the name again. A
/// branch that is on the server at the saved tip already counts as restored, so a restore whose
/// answer was lost can run again.
async fn restore_online(git: &Git, entry: &DeletedEntry, remote: &str) -> Result<()> {
    if !crate::delete_online::is_remote(git, remote).await {
        return Err(app(ErrorCode::Other, format!("'{remote}' is not a remote of this repo")));
    }
    let head_ref = format!("refs/heads/{}", entry.branch);
    let o = git.raw_with_timeout(&["ls-remote", "--heads", remote, &head_ref], FETCH_TIMEOUT).await?;
    if !o.success() {
        return Err(remote_error(o.error_text()));
    }
    // ls-remote matches the pattern against the end of each name: only the exact ref counts.
    if let Some(on_server) = crate::server_check::parse_server(&o.stdout).get(&entry.branch) {
        if *on_server == entry.sha {
            return Ok(());
        }
        return Err(app(ErrorCode::BranchExists, format!("{remote}/{}", entry.branch)));
    }
    let spec = format!("{}:{head_ref}", entry.backup_ref);
    // Expect the name to be absent: someone creating it between the check and the push is not overwritten.
    let lease = format!("--force-with-lease={head_ref}:");
    let o = git.raw_with_timeout(&["push", "--porcelain", &lease, remote, &spec], FETCH_TIMEOUT).await?;
    if !o.success() {
        return Err(remote_error(o.error_text()));
    }
    Ok(())
}

/// Backup refs without a journal entry (the journal write failed after the branch was gone) become
/// entries again, so "Recently deleted" shows everything that can be restored.
pub async fn adopt_orphans(journal: &Journal, repos: &[String]) -> Result<u32> {
    let found = find_orphans(&known_backups(journal), repos, DEFAULT_PARALLEL).await;
    adopt(journal, found)
}

const DEFAULT_PARALLEL: usize = 4;

/// A backup ref whose branch still points at its commit was made by a delete that did not happen.
/// Only an old one is removed: a delete in progress has made its ref, but not yet its entry.
const PHANTOM_AGE_SECS: i64 = 3600;

/// Every backup ref the journal names, the stash backups of its entries included, by repository: two
/// clones of one repository have refs of the same name that are not the same backup. Empty when the
/// journal cannot be read; `adopt` reads it again before it writes.
pub fn known_backups(journal: &Journal) -> HashSet<(String, String)> {
    known_of(&journal.load().unwrap_or_default())
}

fn known_of(entries: &[DeletedEntry]) -> HashSet<(String, String)> {
    let mut known = HashSet::new();
    for e in entries {
        let repo = crate::paths::path_key(&e.repo_path);
        for r in std::iter::once(&e.backup_ref).chain(e.dropped_stashes.iter().map(|s| &s.backup_ref)).filter(|r| !r.is_empty()) {
            known.insert((repo.clone(), r.clone()));
        }
    }
    known
}

/// Reads only, apart from removing old phantoms: the backup refs of the repos, `limit` at a time, as
/// entries for those `known` does not name. Writing them is `adopt`, under the journal's lock.
pub async fn find_orphans(known: &HashSet<(String, String)>, repos: &[String], limit: usize) -> Vec<DeletedEntry> {
    let per_repo = crate::bounded::bounded(repos.iter().cloned(), limit, |repo| orphans_in(known, repo)).await;
    per_repo.into_iter().flatten().collect()
}

async fn orphans_in(known: &HashSet<(String, String)>, repo: String) -> Vec<DeletedEntry> {
    let git = Git::new(&repo);
    if !git.dir().is_dir() {
        return Vec::new();
    }
    let key = crate::paths::path_key(&repo);
    let args = ["for-each-ref", "--format=%(refname)%00%(objectname)%00%(contents:subject)", backup_refs::LOCAL, backup_refs::REMOTE, backup_refs::STASH];
    let out = git.out(&args).await.unwrap_or_default();
    let unknown: Vec<(&str, &str, &str)> = out
        .lines()
        .filter_map(|l| {
            let mut f = l.splitn(3, '\0');
            Some((f.next()?, f.next()?, f.next().unwrap_or_default()))
        })
        .filter(|(name, _, _)| !known.contains(&(key.clone(), name.to_string())))
        .collect();
    if unknown.is_empty() {
        return Vec::new();
    }
    let remotes: Vec<String> = git.out(&["remote"]).await.unwrap_or_default().lines().map(|l| l.trim().to_string()).filter(|l| !l.is_empty()).collect();
    let stashed: HashSet<String> = git.out(&["stash", "list", "--format=%H"]).await.unwrap_or_default().lines().map(str::to_string).collect();
    let now = now();
    let mut entries = Vec::new();
    let mut branch_stashes = Vec::new();
    for (name, sha, subject) in unknown {
        let Some(parsed) = parse_backup_ref(name, &remotes) else { continue };
        // Still in place: the branch at the same commit, the stash still in the list.
        let phantom = match parsed.kind {
            RefKind::Local => git.out(&["rev-parse", "--verify", "--quiet", &format!("refs/heads/{}", parsed.branch)]).await.is_ok_and(|s| s.trim() == sha),
            RefKind::Remote => false,
            RefKind::DroppedStash | RefKind::BranchStash(_) => stashed.contains(sha),
        };
        if phantom {
            if now - parsed.ts > PHANTOM_AGE_SECS {
                let _ = git.raw(&["update-ref", "-d", name, sha]).await;
            }
            continue;
        }
        let stash = DroppedStash { sha: sha.to_string(), message: subject.to_string(), backup_ref: name.to_string() };
        match parsed.kind {
            RefKind::BranchStash(n) => branch_stashes.push((parsed, n, stash)),
            RefKind::DroppedStash => entries.push(DeletedEntry { dropped_stashes: vec![stash], ..DeletedEntry::new(&repo, "", "adopted-stash", sha, name, parsed.ts) }),
            RefKind::Local | RefKind::Remote => {
                let id_name = format!("adopted-{}", parsed.branch);
                entries.push(DeletedEntry { remote: parsed.remote.clone(), ..DeletedEntry::new(&repo, &parsed.branch, &id_name, sha, name, parsed.ts) });
            }
        }
    }
    // A branch delete's stash backups go with its entry; one whose entry is gone stands alone.
    branch_stashes.sort_by_key(|(_, n, _)| *n);
    for (parsed, _, stash) in branch_stashes {
        let owner = entries.iter_mut().find(|e| e.remote.is_none() && e.branch == parsed.branch && backup_ts(&e.backup_ref) == Some(parsed.ts));
        match owner {
            Some(e) => e.dropped_stashes.push(stash),
            None => {
                let (sha, name) = (stash.sha.clone(), stash.backup_ref.clone());
                entries.push(DeletedEntry { dropped_stashes: vec![stash], ..DeletedEntry::new(&repo, "", "adopted-stash", &sha, &name, parsed.ts) });
            }
        }
    }
    entries
}

/// The second a local backup ref or a branch delete's stash backup was made, from its name.
fn backup_ts(name: &str) -> Option<i64> {
    parse_backup_ref(name, &[]).filter(|p| matches!(p.kind, RefKind::Local | RefKind::BranchStash(_))).map(|p| p.ts)
}

/// Adds the found entries the journal still does not name, under the journal's lock, so nothing
/// appended meanwhile is added twice. A stash backup of a branch delete whose entry is in the journal
/// joins that entry.
pub fn adopt(journal: &Journal, found: Vec<DeletedEntry>) -> Result<u32> {
    if found.is_empty() {
        return Ok(0);
    }
    journal.edit(|entries| adopt_into(entries, found))
}

fn adopt_into(entries: &mut Vec<DeletedEntry>, found: Vec<DeletedEntry>) -> (Edit, u32) {
    let known = known_of(entries);
    let mut joined = false;
    let mut fresh = Vec::new();
    for entry in found.into_iter().filter(|e| !known.contains(&(crate::paths::path_key(&e.repo_path), e.backup_ref.clone()))) {
        let owner = match parse_backup_ref(&entry.backup_ref, &[]) {
            Some(BackupRef { kind: RefKind::BranchStash(_), ts, branch, .. }) => {
                let repo = crate::paths::path_key(&entry.repo_path);
                entries.iter_mut().find(|e| crate::paths::path_key(&e.repo_path) == repo && e.remote.is_none() && e.branch == branch && backup_ts(&e.backup_ref) == Some(ts))
            }
            _ => None,
        };
        match owner {
            Some(e) => {
                e.dropped_stashes.extend(entry.dropped_stashes);
                joined = true;
            }
            None => fresh.push(entry),
        }
    }
    let adopted = fresh.len() as u32 + u32::from(joined);
    let how = match (joined, fresh.is_empty()) {
        (true, _) => {
            entries.extend(fresh);
            Edit::Rewrite
        }
        (false, true) => Edit::Keep,
        (false, false) => Edit::Append(fresh),
    };
    (how, adopted)
}

/// A stash dropped in the Git perspective, as an entry without a branch: restore stores it again,
/// purge removes its backup.
pub async fn journal_stash_drop(journal: &Journal, repo: &str, backup_ref: &str) -> Result<()> {
    let git = Git::new(repo);
    let out = git.out(&["log", "-1", "--format=%H%x00%s", backup_ref]).await?;
    let out = out.trim_end();
    let (sha, message) = out.split_once('\0').unwrap_or((out, ""));
    let ts = now();
    let stash = DroppedStash { sha: sha.to_string(), message: message.to_string(), backup_ref: backup_ref.to_string() };
    let entry = DeletedEntry { dropped_stashes: vec![stash], ..DeletedEntry::new(repo, "", "stash", sha, backup_ref, ts) };
    journal.append(&entry)
}

#[derive(Debug, Clone, Copy, PartialEq)]
enum RefKind {
    Local,
    Remote,
    /// Dropped on its own in the Git perspective.
    DroppedStash,
    /// Dropped with a branch delete, the stash's place in that delete's list.
    BranchStash(usize),
}

struct BackupRef {
    ts: i64,
    remote: Option<String>,
    branch: String,
    kind: RefKind,
}

/// `refs/mcbranchface/backup/<ts>/<branch>`, `refs/mcbranchface/remote-backup/<ts>/<remote>/<branch>`,
/// `refs/mcbranchface/stash/<ts>/dropped/<sha prefix>` or `refs/mcbranchface/stash/<ts>/<branch>/<n>`.
/// A remote name may contain `/`: the longest of the repo's remotes that fits wins.
fn parse_backup_ref(name: &str, remotes: &[String]) -> Option<BackupRef> {
    if let Some(rest) = name.strip_prefix(&format!("{}/", backup_refs::REMOTE)) {
        let (ts, rest) = rest.split_once('/')?;
        let ts = ts.parse().ok()?;
        let fits = |r: &&String| rest.len() > r.len() + 1 && rest.starts_with(r.as_str()) && rest.as_bytes()[r.len()] == b'/';
        let (remote, branch) = match remotes.iter().filter(fits).max_by_key(|r| r.len()) {
            Some(r) => (r.as_str(), &rest[r.len() + 1..]),
            None => rest.split_once('/')?,
        };
        return Some(BackupRef { ts, remote: Some(remote.to_string()), branch: branch.to_string(), kind: RefKind::Remote });
    }
    if let Some(rest) = name.strip_prefix(&format!("{}/", backup_refs::STASH)) {
        let (ts, rest) = rest.split_once('/')?;
        let ts = ts.parse().ok()?;
        if let Some(sha) = rest.strip_prefix("dropped/") {
            if sha.len() == 12 && sha.bytes().all(|b| b.is_ascii_hexdigit()) {
                return Some(BackupRef { ts, remote: None, branch: String::new(), kind: RefKind::DroppedStash });
            }
        }
        let (branch, n) = rest.rsplit_once('/')?;
        let n = n.parse().ok().filter(|_| !branch.is_empty())?;
        return Some(BackupRef { ts, remote: None, branch: branch.to_string(), kind: RefKind::BranchStash(n) });
    }
    let rest = name.strip_prefix(&format!("{}/", backup_refs::LOCAL))?;
    let (ts, branch) = rest.split_once('/')?;
    Some(BackupRef { ts: ts.parse().ok()?, remote: None, branch: branch.to_string(), kind: RefKind::Local })
}

/// Removes backup refs, the files of the backups (a moved worktree folder included) and journal
/// entries; afterwards a restore is no longer possible. An entry whose backup could not be removed
/// stays: dropped from the journal, the ref would come back as an orphan and the folder would be
/// lost to the list. A missing repo folder took its refs along, so its entry goes.
pub async fn purge(journal: &Journal, ids: &[String]) -> Result<u32> {
    let entries = journal.load()?;
    let backups = journal.backups_dir();
    let mut purged = std::collections::HashSet::new();
    for e in entries.iter().filter(|e| ids.contains(&e.id)) {
        let git = Git::new(&e.repo_path);
        let mut removed = true;
        if git.dir().is_dir() {
            for r in std::iter::once(&e.backup_ref).chain(e.dropped_stashes.iter().map(|s| &s.backup_ref)).filter(|r| !r.is_empty()) {
                let ok = git.raw(&["update-ref", "-d", r]).await.is_ok_and(|o| o.success());
                removed &= ok || !git.ref_exists(r).await.unwrap_or(true);
            }
        }
        for dir in [&e.worktree_backup, &e.files_backup].into_iter().flatten().filter(|d| is_backup_folder(&backups, d)) {
            match std::fs::remove_dir_all(dir) {
                Ok(()) => {}
                Err(err) if err.kind() == std::io::ErrorKind::NotFound => {}
                Err(_) => removed = false,
            }
        }
        // The trash folder next to a worktree on another volume goes with its last entry.
        if let Some(trash) = e.worktree_backup.as_deref().and_then(|w| Path::new(w).parent()).filter(|p| p.file_name().is_some_and(|n| n == copies::TRASH)) {
            let _ = std::fs::remove_dir(trash);
        }
        if removed {
            purged.insert(e.id.clone());
        }
    }
    // Entries added since the read above stay: only the purged ones go.
    journal.update(|entries| entries.retain(|e| !purged.contains(&e.id)))?;
    Ok(purged.len() as u32)
}

/// Only a folder below the backups or in a worktree trash folder is ever deleted: a journal edited by
/// hand must not make a purge delete anything else.
fn is_backup_folder(backups: &Path, dir: &str) -> bool {
    let p = Path::new(dir);
    let below = crate::paths::is_under(dir, &backups.to_string_lossy()) && !crate::paths::same_path(dir, &backups.to_string_lossy());
    let in_trash = p.parent().and_then(Path::file_name).is_some_and(|n| n == copies::TRASH);
    below || in_trash
}

/// Bytes the backups take on disk: the backups folder, and moved worktrees outside it.
pub fn backups_size(journal: &Journal) -> u64 {
    let backups = journal.backups_dir();
    let outside: u64 = journal
        .load()
        .unwrap_or_default()
        .iter()
        .filter_map(|e| e.worktree_backup.as_deref())
        .filter(|w| !crate::paths::is_under(w, &backups.to_string_lossy()))
        .map(|w| size_of(Path::new(w)))
        .sum();
    size_of(&backups) + outside
}

/// Links are counted, not followed: what they point to is not part of the backup.
fn size_of(path: &Path) -> u64 {
    let mut total = 0;
    let mut stack = vec![path.to_path_buf()];
    while let Some(p) = stack.pop() {
        let Ok(meta) = std::fs::symlink_metadata(&p) else { continue };
        if meta.is_dir() {
            stack.extend(std::fs::read_dir(&p).into_iter().flatten().flatten().map(|e| e.path()));
        } else {
            total += meta.len();
        }
    }
    total
}

pub async fn checkout_default(config: &Config, repo: &str) -> Result<String> {
    let git = Git::new(repo);
    let tracked = git.out(&["status", "--porcelain=v2", "--untracked-files=no"]).await?;
    if !tracked.trim().is_empty() {
        return Err(app(ErrorCode::WorkingTreeDirty, repo));
    }
    let default = refs::default_branch(&git, config, repo).await?.ok_or_else(|| app(ErrorCode::NoDefaultBranch, repo))?;
    let short_remote = refs::short_ref(&default).to_string();
    let local = short_remote.split_once('/').map(|(_, b)| b.to_string()).unwrap_or(short_remote.clone());
    let o = if git.ref_exists(&format!("refs/heads/{local}")).await? {
        git.raw(&["switch", &local]).await?
    } else {
        git.raw(&["switch", "--track", &short_remote]).await?
    };
    if !o.success() {
        return Err(app(ErrorCode::Other, format!("git switch: {}", o.error_text())));
    }
    Ok(local)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn code_of(text: &str) -> ErrorCode {
        remote_error(text.into()).downcast::<AppError>().unwrap().code
    }

    #[test]
    fn server_errors_are_named_by_kind() {
        assert_eq!(code_of("fatal: unable to access 'https://x/': Could not resolve host: x"), ErrorCode::Network);
        assert_eq!(code_of("fatal: Authentication failed for 'https://x/'"), ErrorCode::AuthRequired);
        assert_eq!(code_of(" ! [remote rejected] x (protected branch hook declined)"), ErrorCode::Rejected);
        assert_eq!(code_of("something else"), ErrorCode::Other);
        assert_eq!(AppError::new(ErrorCode::Network, "down").to_string(), "Network: down");
    }

    #[test]
    fn backup_refs_parse_in_all_forms() {
        let remotes = ["origin".to_string(), "team/upstream".to_string(), "team".to_string()];
        let l = parse_backup_ref("refs/mcbranchface/backup/17/feature/x", &remotes).unwrap();
        assert_eq!((l.ts, l.remote, l.branch.as_str(), l.kind), (17, None, "feature/x", RefKind::Local));
        let r = parse_backup_ref("refs/mcbranchface/remote-backup/18/origin/feature/y", &remotes).unwrap();
        assert_eq!((r.ts, r.remote.as_deref(), r.branch.as_str()), (18, Some("origin"), "feature/y"));
        let r = parse_backup_ref("refs/mcbranchface/remote-backup/18/team/upstream/feature/y", &remotes).unwrap();
        assert_eq!((r.remote.as_deref(), r.branch.as_str()), (Some("team/upstream"), "feature/y"), "the longest remote name wins");
        let r = parse_backup_ref("refs/mcbranchface/remote-backup/18/gone/feature/y", &remotes).unwrap();
        assert_eq!((r.remote.as_deref(), r.branch.as_str()), (Some("gone"), "feature/y"), "an unknown remote: its first segment");
        let s = parse_backup_ref("refs/mcbranchface/stash/19/dropped/0123456789ab", &remotes).unwrap();
        assert_eq!((s.ts, s.branch.as_str(), s.kind), (19, "", RefKind::DroppedStash));
        let b = parse_backup_ref("refs/mcbranchface/stash/19/feature/x/1", &remotes).unwrap();
        assert_eq!((b.ts, b.branch.as_str(), b.kind), (19, "feature/x", RefKind::BranchStash(1)), "a branch delete's stash, for its entry");
        let d = parse_backup_ref("refs/mcbranchface/stash/19/dropped/0", &remotes).unwrap();
        assert_eq!((d.branch.as_str(), d.kind), ("dropped", RefKind::BranchStash(0)), "a branch named like the folder");
        assert!(parse_backup_ref("refs/mcbranchface/stash/19/feature/x", &remotes).is_none());
        assert!(parse_backup_ref("refs/mcbranchface/backup/x/y", &remotes).is_none());
        assert!(parse_backup_ref("refs/heads/main", &remotes).is_none());
        assert_eq!(backup_ts("refs/mcbranchface/backup/17/feature/x"), Some(17));
        assert_eq!(backup_ts("refs/mcbranchface/remote-backup/17/origin/x"), None);
    }

    #[test]
    fn only_folders_of_the_backups_are_purged() {
        let backups = Path::new("C:/data/backups");
        assert!(is_backup_folder(backups, "C:/data/backups/1-abc"));
        assert!(is_backup_folder(backups, "C:/data/backups/1-abc/worktree"));
        assert!(is_backup_folder(backups, "D:/ws/.mcbranchface-trash/1-wt"));
        assert!(!is_backup_folder(backups, "C:/data/backups"), "never the backups folder itself");
        assert!(!is_backup_folder(backups, "C:/ws/repo"));
        assert!(!is_backup_folder(backups, "D:/ws/.mcbranchface-trash"));
    }
}
