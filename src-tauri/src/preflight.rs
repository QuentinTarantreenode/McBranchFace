//! Checks before a destructive step that change nothing: lock files of other git processes, and files
//! held open in a folder that is about to be removed. Shared by every operation that removes a worktree.

use std::path::{Path, PathBuf};

use anyhow::Result;

use crate::git::runner::Git;

/// The first lock file that would make git stop halfway: the branch's ref lock and `packed-refs.lock`
/// when a branch goes, `refs/stash.lock` when stashes are dropped, the worktree's `index.lock`.
pub async fn existing_lock(git: &Git, branch: Option<&str>, worktree: Option<&Path>, touches_stash: bool) -> Result<Option<PathBuf>> {
    let common = git.out(&["rev-parse", "--path-format=absolute", "--git-common-dir"]).await?;
    let common = PathBuf::from(common.trim());
    let mut locks = Vec::new();
    if let Some(b) = branch {
        locks.push(common.join(format!("refs/heads/{b}.lock")));
        locks.push(common.join("packed-refs.lock"));
    }
    if touches_stash {
        locks.push(common.join("refs/stash.lock"));
    }
    if let Some(w) = worktree {
        if let Ok(dir) = Git::new(w).out(&["rev-parse", "--path-format=absolute", "--git-dir"]).await {
            locks.push(PathBuf::from(dir.trim()).join("index.lock"));
        }
    }
    Ok(locks.into_iter().find(|p| p.exists()))
}

#[derive(Debug)]
pub enum Probe {
    /// A program holds a file inside open.
    InUse(std::io::Error),
    /// The name the probe renames to is taken; nothing was renamed.
    Taken { at: PathBuf },
    /// Renamed, but not back: the folder now sits at `at`.
    Stranded { at: PathBuf, error: std::io::Error },
}

const PROBE_SUFFIX: &str = ".mcbranchface-probe";

/// `<name>.<pid>-<n>.mcbranchface-probe`: a folder an earlier run left under the probe name (a crash
/// between the two renames) never collides with a new probe of the same worktree.
fn probe_name(dir: &Path) -> PathBuf {
    static SEQ: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    let n = SEQ.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let name = dir.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
    dir.with_file_name(format!("{name}.{}-{n}{PROBE_SUFFIX}", std::process::id()))
}

/// Whether `file` is a probe of the folder `name`, of this version or of the one before it.
fn is_probe_of(file: &str, name: &str) -> bool {
    if file == format!("{name}{PROBE_SUFFIX}") {
        return true;
    }
    let middle = file.strip_prefix(name).and_then(|r| r.strip_prefix('.')).and_then(|r| r.strip_suffix(PROBE_SUFFIX));
    middle.is_some_and(|m| !m.is_empty() && m.bytes().all(|b| b.is_ascii_digit() || b == b'-'))
}

/// Worktrees that are missing while a probe folder of theirs sits next to them get their name back.
/// Returns the probe folders that could not be renamed (the name is taken, or a program holds them),
/// each with the worktree it belongs to.
pub fn recover_probes<'a>(worktrees: impl IntoIterator<Item = &'a Path>) -> Vec<(PathBuf, PathBuf)> {
    let mut stranded = Vec::new();
    for wt in worktrees {
        let (Some(parent), Some(name)) = (wt.parent(), wt.file_name()) else { continue };
        if wt.exists() {
            continue;
        }
        let name = name.to_string_lossy();
        let Ok(entries) = std::fs::read_dir(parent) else { continue };
        let probes: Vec<PathBuf> = entries.flatten().filter(|e| is_probe_of(&e.file_name().to_string_lossy(), &name)).map(|e| e.path()).collect();
        for probe in probes {
            if wt.exists() || std::fs::rename(&probe, wt).is_err() {
                stranded.push((probe, wt.to_path_buf()));
            }
        }
    }
    stranded
}

/// Renaming a directory fails on Windows while a program holds a file inside open. Without this
/// probe `git worktree remove --force` deletes every other file first and stops at the locked one.
/// The app's own short git calls in the folder (a status refresh, `existing_lock` just before) hold
/// it for a moment too: only a folder still held after about a second counts as in use.
pub async fn probe_not_in_use(dir: &Path) -> std::result::Result<(), Probe> {
    let mut attempt = 0;
    loop {
        match probe_once(dir) {
            Err(Probe::InUse(_)) if attempt < 10 && dir.exists() => {
                attempt += 1;
                tokio::time::sleep(std::time::Duration::from_millis(100)).await;
            }
            done => return done,
        }
    }
}

fn probe_once(dir: &Path) -> std::result::Result<(), Probe> {
    let probe = probe_name(dir);
    // On Unix a rename onto an empty folder replaces it; the probe must never take a folder's place.
    if probe.exists() {
        return Err(Probe::Taken { at: probe });
    }
    match std::fs::rename(dir, &probe) {
        Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => return Err(Probe::Taken { at: probe }),
        Err(e) => return Err(Probe::InUse(e)),
        Ok(()) => {}
    }
    std::fs::rename(&probe, dir).map_err(|error| Probe::Stranded { at: probe, error })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn a_free_folder_passes_and_stays_where_it_was() {
        let dir = tempfile::tempdir().unwrap();
        let wt = dir.path().join("wt");
        std::fs::create_dir(&wt).unwrap();
        std::fs::write(wt.join("a.txt"), "a").unwrap();
        probe_not_in_use(&wt).await.unwrap();
        assert!(wt.join("a.txt").exists());
        assert!(matches!(probe_not_in_use(&dir.path().join("missing")).await, Err(Probe::InUse(_))));
        assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 1, "no probe folder left behind");
    }

    #[test]
    fn probe_names_are_unique_and_recognised() {
        let a = probe_name(Path::new("/ws/wt"));
        let b = probe_name(Path::new("/ws/wt"));
        assert_ne!(a, b);
        let file = a.file_name().unwrap().to_string_lossy().to_string();
        assert!(is_probe_of(&file, "wt"));
        assert!(is_probe_of("wt.mcbranchface-probe", "wt"), "the name of the version before");
        assert!(!is_probe_of(&file, "w"));
        assert!(!is_probe_of("wt.x.mcbranchface-probe", "wt"));
        assert!(!is_probe_of("wt-2.1-0.mcbranchface-probe", "wt"));
    }

    #[test]
    fn a_folder_left_under_a_probe_name_gets_its_name_back() {
        let dir = tempfile::tempdir().unwrap();
        let wt = dir.path().join("wt");
        let other = dir.path().join("other");
        // Left by a run that stopped between the two renames.
        let left = dir.path().join("wt.4242-7.mcbranchface-probe");
        std::fs::create_dir(&left).unwrap();
        std::fs::write(left.join("a.txt"), "a").unwrap();
        std::fs::create_dir(&other).unwrap();
        let stranded = recover_probes([wt.as_path(), other.as_path()]);
        assert!(stranded.is_empty(), "{stranded:?}");
        assert_eq!(std::fs::read_to_string(wt.join("a.txt")).unwrap(), "a");
        assert!(!left.exists());
    }

    #[test]
    fn a_probe_folder_that_cannot_get_its_name_back_is_named_with_the_worktree() {
        let dir = tempfile::tempdir().unwrap();
        let wt = dir.path().join("wt");
        let left = dir.path().join("wt.4242-7.mcbranchface-probe");
        std::fs::create_dir(&left).unwrap();
        // Two probes of one worktree: the first gets the name, the second finds it taken.
        let second = dir.path().join("wt.4242-8.mcbranchface-probe");
        std::fs::create_dir(&second).unwrap();
        let stranded = recover_probes([wt.as_path()]);
        assert_eq!(stranded.len(), 1, "{stranded:?}");
        assert_eq!(stranded[0].1, wt);
        assert!(stranded[0].0.exists() && wt.exists());
    }

    #[cfg(windows)]
    #[tokio::test]
    async fn a_file_held_open_is_found() {
        use std::os::windows::fs::OpenOptionsExt;
        let dir = tempfile::tempdir().unwrap();
        let wt = dir.path().join("wt");
        std::fs::create_dir(&wt).unwrap();
        std::fs::write(wt.join("a.txt"), "a").unwrap();
        let _held = std::fs::OpenOptions::new().read(true).share_mode(0).open(wt.join("a.txt")).unwrap();
        assert!(matches!(probe_not_in_use(&wt).await, Err(Probe::InUse(_))));
        assert!(wt.join("a.txt").exists());
    }

    #[cfg(windows)]
    #[tokio::test]
    async fn a_file_held_for_a_moment_does_not_count() {
        use std::future::Future;
        use std::os::windows::fs::OpenOptionsExt;
        let dir = tempfile::tempdir().unwrap();
        let wt = dir.path().join("wt");
        std::fs::create_dir(&wt).unwrap();
        std::fs::write(wt.join("a.txt"), "a").unwrap();
        let held = std::fs::OpenOptions::new().read(true).share_mode(0).open(wt.join("a.txt")).unwrap();
        // The file is let go while the probe waits to try again, whatever the machine's load: the first
        // attempt runs on the first poll, finds the file held and leaves the probe waiting.
        let mut probe = std::pin::pin!(probe_not_in_use(&wt));
        let first = std::future::poll_fn(|cx| std::task::Poll::Ready(probe.as_mut().poll(cx))).await;
        assert!(first.is_pending(), "the held file did not stop the first attempt: {first:?}");
        drop(held);
        probe.await.unwrap();
        assert!(wt.join("a.txt").exists());
    }
}
