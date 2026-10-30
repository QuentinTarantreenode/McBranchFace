//! Repository state from one `git status --porcelain=v2 --branch -z` call plus the worktree list.

use std::path::{Path, PathBuf};

use anyhow::Result;

use crate::git::runner::Git;
use crate::model::{ChangeType, HeadInfo, RepoStatus, StatusEntry, WorktreeInfo};

pub async fn repo_status(git: &Git) -> Result<RepoStatus> {
    let (status, worktrees, stashes) = tokio::join!(
        git.out(&["status", "--porcelain=v2", "--branch", "-z", "--untracked-files=all"]),
        git.out(&["worktree", "list", "--porcelain"]),
        crate::git::status::stashes(git),
    );
    let (mut head, entries) = parse_status(&status?);
    let mut worktrees = parse_worktrees(&worktrees.unwrap_or_default());
    if head.branch.is_none() {
        if let Some(oid) = head.oid.clone() {
            head.unreferenced = unreferenced(git, &oid).await;
        }
    }
    if worktrees.len() > 1 {
        let common = common_dir(git).await;
        for w in worktrees.iter_mut().filter(|w| !w.is_main) {
            w.foreign = common.as_deref().is_some_and(|c| is_foreign(Path::new(&w.path), c));
            if let (true, false, Some(sha)) = (w.detached, w.foreign, w.head.clone()) {
                w.unreferenced = unreferenced(git, &sha).await;
            }
        }
    }
    let stashes = stashes.map(|s| s.len() as u32).unwrap_or(0);
    Ok(RepoStatus { path: git.dir().to_string_lossy().to_string(), head, entries, worktrees, stashes })
}

/// Commits reachable from `sha` but from no local or remote-tracking branch.
async fn unreferenced(git: &Git, sha: &str) -> u32 {
    let out = git.out(&["rev-list", "--count", sha, "--not", "--branches", "--remotes"]).await;
    out.ok().and_then(|s| s.trim().parse().ok()).unwrap_or(0)
}

pub async fn common_dir(git: &Git) -> Option<PathBuf> {
    let out = git.out(&["rev-parse", "--path-format=absolute", "--git-common-dir"]).await.ok()?;
    Some(PathBuf::from(out.trim()))
}

/// The worktree's `.git` file names the git directory it belongs to; outside ours, the entry is
/// foreign. A worktree folder that is gone is git's own business (`prune`), not a foreign entry.
pub fn is_foreign(worktree: &Path, common: &Path) -> bool {
    let Ok(text) = std::fs::read_to_string(worktree.join(".git")) else { return false };
    let Some(dir) = text.trim().strip_prefix("gitdir:") else { return false };
    !crate::paths::is_under(dir.trim(), &common.to_string_lossy())
}

fn change(c: u8) -> Option<ChangeType> {
    Some(match c {
        b'M' => ChangeType::Modified,
        b'A' => ChangeType::Added,
        b'D' => ChangeType::Deleted,
        b'R' => ChangeType::Renamed,
        b'C' => ChangeType::Copied,
        b'T' => ChangeType::TypeChanged,
        _ => return None,
    })
}

/// Parses porcelain v2 with `-z`: records are NUL-terminated, and a rename record is followed by
/// one extra record holding the original path.
pub fn parse_status(text: &str) -> (HeadInfo, Vec<StatusEntry>) {
    let mut head = HeadInfo { branch: None, oid: None, upstream: None, ahead: 0, behind: 0, unreferenced: 0 };
    let mut entries = Vec::new();
    let mut records = text.split('\0').filter(|r| !r.is_empty());
    while let Some(rec) = records.next() {
        if let Some(h) = rec.strip_prefix("# ") {
            let (key, value) = h.split_once(' ').unwrap_or((h, ""));
            match key {
                "branch.oid" if value != "(initial)" => head.oid = Some(value.to_string()),
                "branch.head" if value != "(detached)" => head.branch = Some(value.to_string()),
                "branch.upstream" => head.upstream = Some(value.to_string()),
                "branch.ab" => {
                    for part in value.split(' ') {
                        if let Some(n) = part.strip_prefix('+') {
                            head.ahead = n.parse().unwrap_or(0);
                        } else if let Some(n) = part.strip_prefix('-') {
                            head.behind = n.parse().unwrap_or(0);
                        }
                    }
                }
                _ => {}
            }
            continue;
        }
        let (tag, rest) = rec.split_once(' ').unwrap_or((rec, ""));
        match tag {
            "?" => entries.push(StatusEntry::untracked(rest)),
            "1" | "2" => {
                let n = if tag == "1" { 8 } else { 9 };
                let xy = rest.as_bytes();
                let Some(path) = rest.splitn(n, ' ').nth(n - 1) else { continue };
                let orig = if tag == "2" { records.next().map(String::from) } else { None };
                entries.push(StatusEntry {
                    path: path.to_string(),
                    orig_path: orig,
                    staged: xy.first().and_then(|&c| change(c)),
                    unstaged: xy.get(1).and_then(|&c| change(c)),
                    conflicted: false,
                    untracked: false,
                });
            }
            "u" => {
                if let Some(path) = rest.splitn(10, ' ').nth(9) {
                    entries.push(StatusEntry {
                        path: path.to_string(),
                        orig_path: None,
                        staged: None,
                        unstaged: None,
                        conflicted: true,
                        untracked: false,
                    });
                }
            }
            _ => {}
        }
    }
    (head, entries)
}

pub fn parse_worktrees(text: &str) -> Vec<WorktreeInfo> {
    let mut out = Vec::new();
    for block in text.split("\n\n").filter(|b| !b.trim().is_empty()) {
        let mut wt = WorktreeInfo { path: String::new(), branch: None, head: None, is_main: out.is_empty(), detached: false, foreign: false, unreferenced: 0 };
        for line in block.lines() {
            if let Some(p) = line.strip_prefix("worktree ") {
                wt.path = p.to_string();
            } else if let Some(b) = line.strip_prefix("branch ") {
                wt.branch = Some(b.trim_start_matches("refs/heads/").to_string());
            } else if let Some(h) = line.strip_prefix("HEAD ") {
                wt.head = Some(h.to_string());
            } else if line == "detached" {
                wt.detached = true;
            }
        }
        if !wt.path.is_empty() {
            out.push(wt);
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_branch_headers_and_entries() {
        let text = "# branch.oid 1234\0# branch.head feature/x\0# branch.upstream origin/feature/x\0# branch.ab +2 -1\0\
1 .M N... 100644 100644 100644 aaa aaa src/a b.rs\0\
1 A. N... 000000 100644 100644 000 bbb new.rs\0\
2 R. N... 100644 100644 100644 ccc ccc R100 renamed.rs\0old.rs\0\
u UU N... 100644 100644 100644 100644 a b c conflict.txt\0\
? notes.txt\0";
        let (head, e) = parse_status(text);
        assert_eq!(head.branch.as_deref(), Some("feature/x"));
        assert_eq!(head.upstream.as_deref(), Some("origin/feature/x"));
        assert_eq!((head.ahead, head.behind), (2, 1));
        assert_eq!(e.len(), 5);
        assert_eq!((e[0].path.as_str(), e[0].staged, e[0].unstaged), ("src/a b.rs", None, Some(ChangeType::Modified)));
        assert_eq!(e[1].staged, Some(ChangeType::Added));
        assert_eq!((e[2].path.as_str(), e[2].orig_path.as_deref()), ("renamed.rs", Some("old.rs")));
        assert!(e[3].conflicted);
        assert!(e[4].untracked);
    }

    #[test]
    fn detached_head_has_no_branch() {
        let (head, _) = parse_status("# branch.oid abc\0# branch.head (detached)\0");
        assert_eq!(head.branch, None);
        assert_eq!(head.oid.as_deref(), Some("abc"));
    }

    #[test]
    fn parses_worktree_list() {
        let text = "worktree C:/r\nHEAD 111\nbranch refs/heads/main\n\nworktree C:/wt\nHEAD 222\ndetached\n";
        let w = parse_worktrees(text);
        assert_eq!(w.len(), 2);
        assert!(w[0].is_main && w[0].branch.as_deref() == Some("main"));
        assert!(!w[1].is_main && w[1].detached && w[1].branch.is_none());
    }
}
