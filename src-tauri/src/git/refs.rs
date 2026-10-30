use anyhow::Result;

use super::runner::{fields, Git};
use crate::config::Config;

#[derive(Debug, Clone)]
pub struct LocalBranch {
    pub name: String,
    pub sha: String,
    /// Full remote-tracking ref, e.g. `refs/remotes/origin/feature/x`; empty without upstream.
    pub upstream: String,
    pub remote_name: String,
    /// Branch name on the remote, e.g. `refs/heads/feature/x`.
    pub remote_ref: String,
    pub gone: bool,
    pub ahead: u32,
    pub behind: u32,
    pub committed_at: i64,
    pub subject: String,
    pub author_email: String,
    /// Worktree in which the branch is checked out.
    pub worktree_path: Option<String>,
}

/// `%(symref)` names the target of `refs/remotes/origin/HEAD`, so a listing that holds the remote
/// refs answers the default branch without a git call of its own (see `default_branch_in`).
pub const FORMAT: &str = "--format=%(refname)%00%(objectname)%00%(upstream)%00%(upstream:track)%00\
%(upstream:remotename)%00%(upstream:remoteref)%00%(committerdate:unix)%00%(authoremail:trim)%00\
%(worktreepath)%00%(symref)%00%(contents:subject)";
/// Position of `%(symref)` in `FORMAT`.
const SYMREF: usize = 9;

pub async fn local_branches(git: &Git) -> Result<Vec<LocalBranch>> {
    let out = git.out(&["for-each-ref", "refs/heads", FORMAT]).await?;
    Ok(parse_branches(&out))
}

/// The `refs/heads/` lines of `for-each-ref` output in `FORMAT`; other refs in it are skipped.
pub fn parse_branches(out: &str) -> Vec<LocalBranch> {
    let mut list = Vec::new();
    for line in out.lines() {
        let f = fields(line);
        if f.len() < 11 || !f[0].starts_with("refs/heads/") {
            continue;
        }
        list.push(LocalBranch {
            name: f[0].trim_start_matches("refs/heads/").to_string(),
            sha: f[1].to_string(),
            upstream: f[2].to_string(),
            gone: f[3] == "[gone]",
            ahead: track_count(f[3], "ahead "),
            behind: track_count(f[3], "behind "),
            remote_name: f[4].to_string(),
            remote_ref: f[5].to_string(),
            committed_at: f[6].parse().unwrap_or(0),
            author_email: f[7].to_string(),
            worktree_path: Some(f[8].to_string()).filter(|s| !s.is_empty()),
            subject: f[SYMREF + 1..].join(" "),
        });
    }
    list
}

/// Remote-tracking ref that counts as "merged into" for a repository.
pub async fn default_branch(git: &Git, config: &Config, repo_key: &str) -> Result<Option<String>> {
    default_branch_in(git, config, repo_key, None).await
}

/// `default_branch` with a `for-each-ref` listing in `FORMAT` over `refs/heads` and `refs/remotes`
/// at hand: refs are looked up there and origin/HEAD's target read from it, instead of a git call
/// per question. An override outside those namespaces is still asked of git.
pub async fn default_branch_in(git: &Git, config: &Config, repo_key: &str, listing: Option<&str>) -> Result<Option<String>> {
    let refs = Refs { git, listed: listing.map(listed) };
    // The settings hold the folder as the user typed or pasted it.
    let chosen = config.default_branch_overrides.iter().find(|(k, _)| crate::paths::same_path(k, repo_key)).map(|(_, r)| r);
    if let Some(r) = chosen {
        let full = if r.starts_with("refs/") { r.clone() } else { format!("refs/remotes/{r}") };
        if refs.exists(&full).await? {
            return Ok(Some(full));
        }
    }
    if let Some(r) = refs.origin_head().await? {
        if refs.exists(&r).await? {
            return Ok(Some(r));
        }
    }
    for c in &config.default_branch_candidates {
        let full = format!("refs/remotes/origin/{c}");
        if refs.exists(&full).await? {
            return Ok(Some(full));
        }
    }
    Ok(None)
}

/// Ref → `%(symref)` of a listing in `FORMAT`.
fn listed(listing: &str) -> std::collections::HashMap<&str, &str> {
    listing
        .lines()
        .filter_map(|l| {
            let f = fields(l);
            Some((*f.first()?, f.get(SYMREF).copied().unwrap_or("")))
        })
        .collect()
}

struct Refs<'a> {
    git: &'a Git,
    listed: Option<std::collections::HashMap<&'a str, &'a str>>,
}

impl Refs<'_> {
    async fn exists(&self, full: &str) -> Result<bool> {
        match &self.listed {
            Some(m) if full.starts_with("refs/heads/") || full.starts_with("refs/remotes/") => Ok(m.contains_key(full)),
            _ => self.git.ref_exists(full).await,
        }
    }

    async fn origin_head(&self) -> Result<Option<String>> {
        const HEAD: &str = "refs/remotes/origin/HEAD";
        if let Some(m) = &self.listed {
            return Ok(m.get(HEAD).filter(|t| !t.is_empty()).map(|t| t.to_string()));
        }
        let o = self.git.raw(&["symbolic-ref", "-q", HEAD]).await?;
        Ok(o.success().then(|| o.stdout.trim().to_string()))
    }
}

/// "[ahead 2, behind 1]" → 2 for "ahead ", 1 for "behind ".
fn track_count(track: &str, key: &str) -> u32 {
    track
        .find(key)
        .and_then(|i| track[i + key.len()..].split(|c: char| !c.is_ascii_digit()).next())
        .and_then(|n| n.parse().ok())
        .unwrap_or(0)
}

pub fn short_ref(full: &str) -> &str {
    full.strip_prefix("refs/remotes/")
        .or_else(|| full.strip_prefix("refs/heads/"))
        .unwrap_or(full)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// One `for-each-ref` line in `FORMAT`.
    fn line(name: &str, symref: &str) -> String {
        [name, "sha", "", "", "", "", "1", "a@x", "", symref, "subject"].join("\0")
    }

    #[tokio::test]
    async fn the_default_branch_comes_from_the_listing_without_asking_git() {
        // No repository there: any git call would fail.
        let git = Git::new(std::env::temp_dir().join("mbf-no-repo-here"));
        let listing = [line("refs/heads/main", ""), line("refs/remotes/origin/HEAD", "refs/remotes/origin/main"), line("refs/remotes/origin/main", ""), line("refs/remotes/origin/dev", "")].join("\n");
        let config = Config::default();
        assert_eq!(default_branch_in(&git, &config, "C:/r", Some(&listing)).await.unwrap().as_deref(), Some("refs/remotes/origin/main"));

        let mut chosen = Config::default();
        chosen.default_branch_overrides.insert("C:\\r\\".into(), "origin/dev".into());
        assert_eq!(default_branch_in(&git, &chosen, "C:/r", Some(&listing)).await.unwrap().as_deref(), Some("refs/remotes/origin/dev"));

        let without_head = [line("refs/remotes/origin/main", "")].join("\n");
        let candidates = Config { default_branch_candidates: vec!["master".into(), "main".into()], ..Config::default() };
        assert_eq!(default_branch_in(&git, &candidates, "C:/r", Some(&without_head)).await.unwrap().as_deref(), Some("refs/remotes/origin/main"));
        let parsed = parse_branches(&listing);
        assert_eq!((parsed.len(), parsed[0].subject.as_str()), (1, "subject"), "the symref field is not part of the subject");
    }

    #[test]
    fn upstream_track() {
        assert_eq!(track_count("[ahead 2, behind 13]", "ahead "), 2);
        assert_eq!(track_count("[ahead 2, behind 13]", "behind "), 13);
        assert_eq!(track_count("[behind 4]", "ahead "), 0);
        assert_eq!(track_count("[gone]", "behind "), 0);
        assert_eq!(track_count("", "ahead "), 0);
    }
}
