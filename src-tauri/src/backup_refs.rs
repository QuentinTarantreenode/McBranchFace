//! Names of the refs that keep what a delete removed. They live in a namespace of their own, so gc
//! keeps the commits and no branch or tag is ever mistaken for a backup.

use crate::git::runner::Git;

pub const LOCAL: &str = "refs/mcbranchface/backup";
/// Kept apart from local backups, so a local branch named "origin/x" is never mistaken for one.
pub const REMOTE: &str = "refs/mcbranchface/remote-backup";
pub const STASH: &str = "refs/mcbranchface/stash";

pub fn local(ts: i64, branch: &str) -> String {
    format!("{LOCAL}/{ts}/{branch}")
}

pub fn remote(ts: i64, remote: &str, branch: &str) -> String {
    format!("{REMOTE}/{ts}/{remote}/{branch}")
}

pub fn stash(ts: i64, branch: &str, n: usize) -> String {
    format!("{STASH}/{ts}/{branch}/{n}")
}

/// A stash dropped on its own, outside a branch delete: it stands alone in the journal.
pub fn dropped_stash(ts: i64, sha: &str) -> String {
    format!("{STASH}/{ts}/dropped/{}", &sha[..sha.len().min(12)])
}

/// Commits a removed worktree made on no branch (a detached HEAD). The folder name is reduced to what
/// any ref accepts; the journal entry, not the name, ties the ref to its worktree.
pub fn worktree(ts: i64, folder: &str) -> String {
    let name: String = folder.chars().map(|c| if c.is_ascii_alphanumeric() || c == '-' || c == '_' { c } else { '-' }).collect();
    format!("{LOCAL}/{ts}/worktree-{name}")
}

/// Seconds tried past `ts`; beyond that the create-only ref update fails visibly.
const MAX_SHIFT: i64 = 600;

/// The first second from `ts` on at which none of `names(second)` exists. The second stays a plain
/// number because the orphan adoption reads it as the time of the delete; a second delete of the same
/// branch within one second (restore, then delete again) takes the next free one instead of failing.
pub async fn free_second(git: &Git, ts: i64, names: impl Fn(i64) -> Vec<String>) -> i64 {
    for s in ts..ts + MAX_SHIFT {
        let mut taken = false;
        for n in names(s) {
            // An unanswered check counts as taken: the next second is as good, a clash is not.
            if git.ref_exists(&n).await.unwrap_or(true) {
                taken = true;
                break;
            }
        }
        if !taken {
            return s;
        }
    }
    ts
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_keep_the_layout_readers_parse() {
        assert_eq!(local(17, "feature/x"), "refs/mcbranchface/backup/17/feature/x");
        assert_eq!(remote(18, "origin", "feature/y"), "refs/mcbranchface/remote-backup/18/origin/feature/y");
        assert_eq!(stash(19, "feature/x", 0), "refs/mcbranchface/stash/19/feature/x/0");
        assert_eq!(dropped_stash(19, "0123456789abcdef"), "refs/mcbranchface/stash/19/dropped/0123456789ab");
        assert_eq!(worktree(20, "my wt.v2..lock"), "refs/mcbranchface/backup/20/worktree-my-wt-v2--lock");
    }

    #[tokio::test]
    async fn a_taken_second_moves_on_to_the_next_free_one() {
        let dir = tempfile::tempdir().unwrap();
        let run = |args: &[&str]| assert!(std::process::Command::new("git").arg("-C").arg(dir.path()).args(args).status().unwrap().success());
        run(&["init", "-q"]);
        run(&["-c", "user.name=a", "-c", "user.email=a@b", "commit", "-q", "--allow-empty", "-m", "a"]);
        let git = Git::new(dir.path());
        assert_eq!(free_second(&git, 100, |s| vec![local(s, "x")]).await, 100);
        run(&["update-ref", &local(100, "x"), "HEAD"]);
        run(&["update-ref", &local(101, "x"), "HEAD"]);
        assert_eq!(free_second(&git, 100, |s| vec![local(s, "x")]).await, 102);
        assert_eq!(free_second(&git, 100, |s| vec![local(s, "y")]).await, 100, "another branch is not affected");
    }
}
