//! Commit log in pages, commit details and branch lists.

use std::collections::HashSet;

use anyhow::Result;

use crate::git::runner::{fields, Git};
use crate::model::{BranchList, BranchRow, ChangeType, CommitDetail, CommitHit, CommitInfo, FileRef, LogEntry, PullRequestInfo};

/// Commits a PR list can show at most; a larger PR says how many more there are.
pub const PR_COMMIT_LIMIT: u32 = 500;

/// The commits of a PR from the local repository: from the target commit the provider merged
/// against up to the source tip. None when one of the two is not here, so the provider is asked.
pub async fn pr_commits_local(git: &Git, pr: &PullRequestInfo) -> Result<Option<Vec<CommitInfo>>> {
    let (Some(target), Some(source)) = (&pr.target_sha, &pr.source_sha) else { return Ok(None) };
    if !git.commit_exists(target).await? || !git.commit_exists(source).await? {
        return Ok(None);
    }
    let log = log(git, &format!("{target}..{source}"), 0, PR_COMMIT_LIMIT, None).await?;
    Ok(Some(log.into_iter().map(|e| CommitInfo { sha: e.sha, subject: e.subject, author_email: e.email, authored_at: e.time }).collect()))
}

/// Unit separator between fields, NUL (`-z`) between commits: subjects may contain anything else.
const LOG_FORMAT: &str = "--format=%H%x1f%P%x1f%an%x1f%ae%x1f%at%x1f%D%x1f%s";

/// `rev` is one revision or a range (`a..b`, `a...b`); anything git would read as an option is refused.
pub async fn log(git: &Git, rev: &str, skip: u32, limit: u32, query: Option<&str>) -> Result<Vec<LogEntry>> {
    let rev = checked_rev(rev)?;
    if let Some(q) = query.map(str::trim).filter(|q| !q.is_empty()) {
        return search(git, rev, q, skip, limit).await;
    }
    let (skip_arg, n) = (format!("--skip={skip}"), format!("-n{limit}"));
    run_log(git, &[&skip_arg, &n], rev).await
}

pub(crate) fn checked_rev(rev: &str) -> Result<&str> {
    let rev = rev.trim();
    if rev.is_empty() || rev.starts_with('-') || rev.chars().any(|c| c.is_whitespace() || c.is_control()) {
        anyhow::bail!("not a revision: {rev:?}");
    }
    Ok(rev)
}

/// Options first, then the revision behind `--end-of-options`, so it can never act as an option.
async fn run_log(git: &Git, options: &[&str], rev: &str) -> Result<Vec<LogEntry>> {
    let mut args = vec!["log", "-z", LOG_FORMAT];
    args.extend_from_slice(options);
    args.extend_from_slice(&["--end-of-options", rev]);
    args.push("--");
    let o = git.raw(&args).await?;
    // An empty repository has no HEAD yet; that is an empty history, not an error.
    if !o.success() {
        return if o.error_text().contains("does not have any commits") { Ok(Vec::new()) } else { anyhow::bail!(o.error_text()) };
    }
    Ok(parse_log(&o.stdout))
}

/// Message or author contain the text (case-insensitive, literal), or the text is a SHA prefix.
/// git filters the whole history itself; it cannot OR message and author, hence two queries.
async fn search(git: &Git, rev: &str, q: &str, skip: u32, limit: u32) -> Result<Vec<LogEntry>> {
    let grep = format!("--grep={q}");
    let author = format!("--author={q}");
    // Each query only needs as many hits as the pages up to this one show; a short query on a large
    // history would otherwise list most of it on every page.
    let n = format!("-n{}", skip.saturating_add(limit));
    let mut found = run_log(git, &["-i", "--fixed-strings", &n, &grep], rev).await?;
    found.extend(run_log(git, &["-i", "--fixed-strings", &n, &author], rev).await?);
    if q.len() >= 4 && q.chars().all(|c| c.is_ascii_hexdigit()) {
        let spec = format!("{q}^{{commit}}");
        if let Ok(sha) = git.out(&["rev-parse", "--verify", "--quiet", "--end-of-options", &spec]).await {
            let sha = sha.trim();
            if in_rev(git, rev, sha).await {
                found.extend(run_log(git, &["-n1"], sha).await?);
            }
        }
    }
    let mut seen = HashSet::new();
    found.retain(|e| seen.insert(e.sha.clone()));
    found.sort_by_key(|e| std::cmp::Reverse(e.time));
    Ok(found.into_iter().skip(skip as usize).take(limit as usize).collect())
}

const CONTAINS_PARALLEL: usize = 4;

/// Commits of every branch whose message or author contains `q` (literal, any case), or that `q`
/// names as a SHA prefix; each with the branches that contain it. A cherry-pick keeps its message,
/// so the copies on other branches are found too. At most `limit`; `capped` says there were more.
pub async fn find_everywhere(git: &Git, q: &str, limit: usize) -> Result<(Vec<CommitHit>, bool)> {
    let q = q.trim();
    if q.is_empty() {
        return Ok((Vec::new(), false));
    }
    let n = format!("-n{}", limit + 1);
    let all = |filter: String| {
        let n = n.clone();
        async move {
            let o = git.raw(&["log", "-z", LOG_FORMAT, "--all", "-i", "--fixed-strings", &n, &filter, "--"]).await?;
            Ok::<_, anyhow::Error>(if o.success() { parse_log(&o.stdout) } else { Vec::new() })
        }
    };
    let mut found = all(format!("--grep={q}")).await?;
    found.extend(all(format!("--author={q}")).await?);
    if q.len() >= 4 && q.chars().all(|c| c.is_ascii_hexdigit()) {
        let spec = format!("{q}^{{commit}}");
        if let Ok(sha) = git.out(&["rev-parse", "--verify", "--quiet", "--end-of-options", &spec]).await {
            found.extend(run_log(git, &["-n1"], sha.trim()).await?);
        }
    }
    let mut seen = HashSet::new();
    found.retain(|e| seen.insert(e.sha.clone()));
    found.sort_by_key(|e| std::cmp::Reverse(e.time));
    let capped = found.len() > limit;
    found.truncate(limit);
    // git answers "which refs contain it" per commit only; the hits are asked side by side.
    let contained = crate::bounded::bounded(found.iter().map(|c| c.sha.clone()), CONTAINS_PARALLEL, |sha| async move {
        git.out(&["for-each-ref", "--contains", &sha, "--format=%(refname)", "refs/heads", "refs/remotes"]).await
    })
    .await;
    let mut hits = Vec::with_capacity(found.len());
    for (commit, refs) in found.into_iter().zip(contained) {
        let (mut local, mut remote) = (Vec::new(), Vec::new());
        for r in refs?.lines() {
            if let Some(b) = r.strip_prefix("refs/heads/") {
                local.push(b.to_string());
            } else if let Some(b) = r.strip_prefix("refs/remotes/").filter(|b| !b.ends_with("/HEAD")) {
                remote.push(b.to_string());
            }
        }
        hits.push(CommitHit { commit, local, remote });
    }
    Ok((hits, capped))
}

/// Whether `sha` is part of the history `rev` shows: reachable from its tip and, for `a..b`, not
/// from its base; for `a...b` (symmetric difference) reachable from exactly one side.
async fn in_rev(git: &Git, rev: &str, sha: &str) -> bool {
    let ancestor = |of: &str| {
        let of = if of.is_empty() { "HEAD".to_string() } else { of.to_string() };
        async move { git.raw(&["merge-base", "--is-ancestor", sha, &of]).await.is_ok_and(|o| o.success()) }
    };
    if let Some((left, right)) = rev.split_once("...") {
        return ancestor(left).await != ancestor(right).await;
    }
    match rev.split_once("..") {
        None => ancestor(rev).await,
        Some((base, tip)) => ancestor(tip).await && !ancestor(base).await,
    }
}

pub fn parse_log(text: &str) -> Vec<LogEntry> {
    text.split('\0').filter(|r| !r.trim().is_empty()).filter_map(parse_entry).collect()
}

fn parse_entry(rec: &str) -> Option<LogEntry> {
    let f: Vec<&str> = rec.trim_start_matches('\n').split('\x1f').collect();
    if f.len() < 7 {
        return None;
    }
    Some(LogEntry {
        sha: f[0].to_string(),
        parents: f[1].split(' ').filter(|p| !p.is_empty()).map(String::from).collect(),
        author: f[2].to_string(),
        email: f[3].to_string(),
        time: f[4].parse().unwrap_or(0),
        refs: f[5]
            .split(", ")
            .filter(|r| !r.is_empty())
            .map(|r| r.trim_start_matches("HEAD -> ").trim_start_matches("tag: ").to_string())
            .collect(),
        subject: f[6..].join("\x1f"),
    })
}

pub async fn commit_detail(git: &Git, sha: &str) -> Result<CommitDetail> {
    let sha = checked_rev(sha)?;
    let entry_text = git.out(&["log", "-z", "-n1", LOG_FORMAT, "--end-of-options", sha, "--"]).await?;
    let entry = parse_log(&entry_text).into_iter().next().ok_or_else(|| anyhow::anyhow!("commit {sha} not found"))?;
    let body = git.out(&["log", "-n1", "--format=%b", "--end-of-options", sha, "--"]).await?.trim().to_string();
    // First parent for merges, like the diff view; --root makes the initial commit list its files.
    let files = git
        .out(&["diff-tree", "--no-commit-id", "-r", "-z", "--name-status", "--root", "-m", "--first-parent", "-M", sha])
        .await?;
    Ok(CommitDetail { entry, body, files: parse_name_status(&files) })
}

/// `--name-status -z`: status, then one path (or two for renames and copies), all NUL-separated.
pub fn parse_name_status(text: &str) -> Vec<FileRef> {
    let mut out = Vec::new();
    let mut it = text.split('\0').filter(|s| !s.is_empty());
    while let Some(status) = it.next() {
        let change = match status.as_bytes().first() {
            Some(b'A') => ChangeType::Added,
            Some(b'D') => ChangeType::Deleted,
            Some(b'R') => ChangeType::Renamed,
            Some(b'C') => ChangeType::Copied,
            Some(b'T') => ChangeType::TypeChanged,
            Some(b'M') => ChangeType::Modified,
            _ => continue,
        };
        if matches!(change, ChangeType::Renamed | ChangeType::Copied) {
            let (Some(from), Some(to)) = (it.next(), it.next()) else { break };
            out.push(FileRef { path: to.to_string(), orig_path: Some(from.to_string()), change });
        } else if let Some(p) = it.next() {
            out.push(FileRef { path: p.to_string(), orig_path: None, change });
        }
    }
    out
}

const BRANCH_FORMAT: &str = "--format=%(refname)%00%(objectname)%00%(upstream:short)%00%(upstream:track)%00%(HEAD)%00\
%(worktreepath)%00%(committerdate:unix)%00%(authorname)%00%(authoremail)%00%(contents:subject)";

/// `is_mine` decides by the author e-mail of the tip, the same rule the scan uses for its own branches.
pub async fn branches(git: &Git, is_mine: impl Fn(&str) -> bool) -> Result<BranchList> {
    let out = git.out(&["for-each-ref", "--sort=-committerdate", BRANCH_FORMAT, "refs/heads", "refs/remotes"]).await?;
    let mut list = BranchList { local: Vec::new(), remote: Vec::new() };
    for line in out.lines() {
        let f = fields(line);
        if f.len() < 10 || f[0].ends_with("/HEAD") {
            continue;
        }
        let (ahead, behind, gone) = parse_track(f[3]);
        let remote = f[0].starts_with("refs/remotes/");
        let row = BranchRow {
            name: f[0].trim_start_matches("refs/heads/").trim_start_matches("refs/remotes/").to_string(),
            full_ref: f[0].to_string(),
            sha: f[1].to_string(),
            upstream: Some(f[2].to_string()).filter(|s| !s.is_empty()),
            ahead,
            behind,
            gone,
            is_head: f[4] == "*",
            worktree_path: Some(f[5].to_string()).filter(|s| !s.is_empty()),
            committed_at: f[6].parse().unwrap_or(0),
            author: f[7].to_string(),
            is_mine: is_mine(f[8].trim_start_matches('<').trim_end_matches('>')),
            subject: f[9..].join(" "),
        };
        if remote { list.remote.push(row) } else { list.local.push(row) }
    }
    Ok(list)
}

/// "[ahead 2, behind 1]", "[gone]" or "".
pub fn parse_track(t: &str) -> (u32, u32, bool) {
    let inner = t.trim_start_matches('[').trim_end_matches(']');
    let (mut ahead, mut behind) = (0, 0);
    for part in inner.split(", ") {
        if let Some(n) = part.strip_prefix("ahead ") {
            ahead = n.parse().unwrap_or(0);
        } else if let Some(n) = part.strip_prefix("behind ") {
            behind = n.parse().unwrap_or(0);
        }
    }
    (ahead, behind, inner == "gone")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_log_records() {
        let text = "aaa\x1fp1 p2\x1fAnna\x1fa@x\x1f100\x1fHEAD -> main, origin/main, tag: v1\x1fMerge: a\x1fb\0\nbbb\x1f\x1fBo\x1fb@x\x1f50\x1f\x1finit\0";
        let l = parse_log(text);
        assert_eq!(l.len(), 2);
        assert_eq!(l[0].parents, vec!["p1", "p2"]);
        assert_eq!(l[0].refs, vec!["main", "origin/main", "v1"]);
        assert_eq!(l[0].subject, "Merge: a\x1fb", "separator inside the subject survives");
        assert!(l[1].parents.is_empty() && l[1].refs.is_empty());
    }

    #[test]
    fn parses_name_status() {
        let f = parse_name_status("M\0src/a.rs\0R087\0old.rs\0new.rs\0A\0x y.txt\0");
        assert_eq!(f.len(), 3);
        assert_eq!(f[1].change, ChangeType::Renamed);
        assert_eq!((f[1].path.as_str(), f[1].orig_path.as_deref()), ("new.rs", Some("old.rs")));
        assert_eq!(f[2].path, "x y.txt");
    }

    #[test]
    fn parses_tracking_info() {
        assert_eq!(parse_track("[ahead 2, behind 1]"), (2, 1, false));
        assert_eq!(parse_track("[behind 3]"), (0, 3, false));
        assert_eq!(parse_track("[gone]"), (0, 0, true));
        assert_eq!(parse_track(""), (0, 0, false));
    }
}
