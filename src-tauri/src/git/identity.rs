use std::collections::HashMap;
use std::sync::{LazyLock, Mutex};

use super::runner::Git;
use crate::paths::path_key;
use crate::providers::remote_url;

/// Root commit per common git dir, for the life of the process: `rev-list --max-parents=0` walks the
/// whole history, on every scan of every repo without origin otherwise. The root is part of
/// persisted keys (locks, ignores, notes), so it stays in the identity.
static ROOTS: LazyLock<Mutex<HashMap<String, String>>> = LazyLock::new(Default::default);

/// Origin URL and identity of a working copy: found once per scan and handed to the analysis.
#[derive(Debug, Clone)]
pub struct RepoOrigin {
    pub remote_url: Option<String>,
    pub identity: String,
}

pub async fn origin_of(git: &Git) -> RepoOrigin {
    let remote_url = origin_url(git).await;
    let identity = repo_identity(git, remote_url.as_deref()).await;
    RepoOrigin { remote_url, identity }
}

/// Identity of the repository behind a working copy: the normalized origin URL. Without a remote
/// there is nothing that ties two folders together safely: a shared root commit also holds for a
/// copied folder or an unrelated fork, so the git directory is part of the identity then, and a
/// lock on one never reaches the other. Linked worktrees share that directory.
pub async fn repo_identity(git: &Git, origin_url: Option<&str>) -> String {
    if let Some(url) = origin_url.filter(|u| !u.trim().is_empty()) {
        return remote_url::identity(url);
    }
    let common = git
        .out(&["rev-parse", "--path-format=absolute", "--git-common-dir"])
        .await
        .map(|c| path_key(c.trim()))
        .unwrap_or_else(|_| path_key(&git.dir().to_string_lossy()));
    match root_commit(git, &common).await {
        Some(root) => format!("root:{root}@{common}"),
        None => format!("path:{common}"),
    }
}

/// Only a found root is kept: a repository without commits gets one with its first commit.
async fn root_commit(git: &Git, common: &str) -> Option<String> {
    if let Some(root) = ROOTS.lock().unwrap_or_else(|p| p.into_inner()).get(common) {
        return Some(root.clone());
    }
    let out = git.out(&["rev-list", "--max-parents=0", "HEAD"]).await.ok()?;
    let root = out.lines().map(str::trim).filter(|l| !l.is_empty()).min()?.to_string();
    ROOTS.lock().unwrap_or_else(|p| p.into_inner()).insert(common.to_string(), root.clone());
    Some(root)
}

pub async fn origin_url(git: &Git) -> Option<String> {
    git.config_get("remote.origin.url").await.ok().flatten()
}

/// `origin_url` for a destructive step. A config git cannot read is an error here, not "no origin":
/// the identity would fall back to the folder, and a lock set on the repository would not apply.
pub async fn origin_url_checked(git: &Git) -> anyhow::Result<Option<String>> {
    let o = git.raw(&["config", "--get", "remote.origin.url"]).await?;
    match o.code {
        Some(0) => Ok(Some(o.stdout.trim().to_string())),
        // git's code for "no such key".
        Some(1) => Ok(None),
        _ => anyhow::bail!("git config --get remote.origin.url: {}", o.error_text()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn run(dir: &std::path::Path, args: &[&str]) {
        let o = std::process::Command::new("git").args(args).current_dir(dir).output().unwrap();
        assert!(o.status.success(), "{args:?}: {}", String::from_utf8_lossy(&o.stderr));
    }

    fn commit(dir: &std::path::Path, msg: &str) {
        run(dir, &["-c", "user.name=T", "-c", "user.email=t@x", "commit", "-q", "--no-gpg-sign", "--allow-empty", "-m", msg]);
    }

    #[tokio::test]
    async fn an_unreadable_config_is_no_missing_origin() {
        let dir = tempfile::tempdir().unwrap();
        run(dir.path(), &["init", "-q"]);
        let git = Git::new(dir.path());
        assert_eq!(origin_url_checked(&git).await.unwrap(), None);
        run(dir.path(), &["remote", "add", "origin", "https://example.com/r.git"]);
        assert_eq!(origin_url_checked(&git).await.unwrap().as_deref(), Some("https://example.com/r.git"));
        let config = dir.path().join(".git").join("config");
        let text = std::fs::read_to_string(&config).unwrap();
        std::fs::write(&config, format!("{text}\n[broken\n")).unwrap();
        assert!(origin_url_checked(&git).await.is_err());
        assert_eq!(origin_url(&git).await, None, "the lenient reader, for scans");
    }

    #[tokio::test]
    async fn an_identity_without_origin_is_found_once_and_stays() {
        let dir = tempfile::tempdir().unwrap();
        run(dir.path(), &["init", "-q"]);
        let git = Git::new(dir.path());
        assert!(repo_identity(&git, None).await.starts_with("path:"), "no commit yet: no root");
        commit(dir.path(), "first");
        let first = repo_identity(&git, None).await;
        assert!(first.starts_with("root:"), "{first}");
        // HEAD on an unrelated history: the walk would find another root; the identity must not move.
        run(dir.path(), &["checkout", "-q", "--orphan", "other"]);
        commit(dir.path(), "other root");
        assert_eq!(repo_identity(&git, None).await, first);
    }
}
