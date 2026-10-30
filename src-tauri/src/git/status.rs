use anyhow::Result;

use super::runner::{fields, Git};
use crate::model::{FileChange, FileChangeKind};

pub async fn worktree_changes(git: &Git) -> Result<Vec<FileChange>> {
    let out = git.out(&["status", "--porcelain=v2", "--untracked-files=normal"]).await?;
    Ok(out.lines().filter_map(parse_status_line).collect())
}

fn parse_status_line(line: &str) -> Option<FileChange> {
    let (tag, rest) = line.split_once(' ')?;
    match tag {
        "?" => Some(FileChange { path: rest.to_string(), kind: FileChangeKind::Untracked }),
        "u" => {
            let path = rest.splitn(10, ' ').nth(9)?;
            Some(FileChange { path: path.to_string(), kind: FileChangeKind::Conflicted })
        }
        "1" | "2" => {
            let field_count = if tag == "1" { 8 } else { 9 };
            let xy = rest.get(0..2)?;
            let path = rest.splitn(field_count, ' ').nth(field_count - 1)?;
            // Renames carry "new<TAB>old"; the new path is what the user sees in the tree.
            let path = path.split('\t').next().unwrap_or(path);
            let staged = !xy.starts_with('.');
            let unstaged = !xy.ends_with('.');
            let kind = match (staged, unstaged) {
                (true, true) => FileChangeKind::StagedAndUnstaged,
                (true, false) => FileChangeKind::Staged,
                _ => FileChangeKind::Unstaged,
            };
            Some(FileChange { path: path.to_string(), kind })
        }
        _ => None,
    }
}

#[derive(Debug, Clone)]
pub struct RawStash {
    pub selector: String,
    pub sha: String,
    pub base: String,
    pub message: String,
}

impl RawStash {
    /// Branch name git wrote into the stash message ("WIP on x: …" / "On x: …").
    pub fn branch_hint(&self) -> Option<&str> {
        let rest = self.message.strip_prefix("WIP on ").or_else(|| self.message.strip_prefix("On "))?;
        rest.split_once(':').map(|(b, _)| b)
    }
}

pub const STASH_FORMAT: &str = "--format=%gd%x00%H%x00%P%x00%gs";

pub async fn stashes(git: &Git) -> Result<Vec<RawStash>> {
    let o = git.raw(&["stash", "list", STASH_FORMAT]).await?;
    if !o.success() {
        return Ok(Vec::new());
    }
    Ok(parse_stashes(&o.stdout))
}

/// `git stash list` in `STASH_FORMAT`.
pub fn parse_stashes(out: &str) -> Vec<RawStash> {
    out.lines()
        .filter_map(|line| {
            let f = fields(line);
            (f.len() >= 4).then(|| RawStash {
                selector: f[0].to_string(),
                sha: f[1].to_string(),
                base: f[2].split(' ').next().unwrap_or_default().to_string(),
                message: f[3..].join(" "),
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_porcelain_v2() {
        let c = parse_status_line("1 .M N... 100644 100644 100644 abc abc src/a b.rs").unwrap();
        assert_eq!(c.path, "src/a b.rs");
        assert_eq!(c.kind, FileChangeKind::Unstaged);
        let c = parse_status_line("2 R. N... 100644 100644 100644 abc abc R100 new.rs\told.rs").unwrap();
        assert_eq!(c.path, "new.rs");
        assert_eq!(c.kind, FileChangeKind::Staged);
        let c = parse_status_line("? tmp/x.txt").unwrap();
        assert_eq!(c.kind, FileChangeKind::Untracked);
        let c = parse_status_line("u UU N... 100644 100644 100644 100644 a b c f.txt").unwrap();
        assert_eq!(c.path, "f.txt");
        assert_eq!(c.kind, FileChangeKind::Conflicted);
    }
}
