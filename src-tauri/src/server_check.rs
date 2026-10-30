//! The light check: has anything changed on the server since the last fetch? One `ls-remote` per
//! repository, no objects transferred. Only a "yes" leads to a fetch and a new assessment.

use std::collections::BTreeMap;
use std::time::Duration;

use serde::{Deserialize, Serialize};
#[cfg(test)]
use ts_rs::TS;

use crate::failure;
use crate::git::runner::{fields, Git, Prompts};
use crate::model::FailureKind;
use crate::online::REMOTE;

const TIMEOUT: Duration = Duration::from_secs(30);

#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(test, derive(TS))]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, ts(export))]
pub struct ServerHeads {
    pub path: String,
    /// The server has branches (or tips) the last fetch did not bring.
    pub changed: bool,
    pub error_kind: Option<FailureKind>,
}

/// Branch name → sha as the server reports it.
pub fn parse_server(out: &str) -> BTreeMap<String, String> {
    out.lines()
        .filter_map(|l| {
            let (sha, r) = l.split_once('\t')?;
            Some((r.trim().strip_prefix("refs/heads/")?.to_string(), sha.trim().to_string()))
        })
        .collect()
}

/// Branch name → sha as the last fetch left it in `refs/remotes/<remote>/`.
pub fn parse_local(out: &str, remote: &str) -> BTreeMap<String, String> {
    let prefix = format!("refs/remotes/{remote}/");
    out.lines()
        .filter_map(|l| {
            let f = fields(l);
            let name = f.first()?.strip_prefix(&prefix)?;
            let sha = f.get(1)?;
            (name != "HEAD").then(|| (name.to_string(), sha.to_string()))
        })
        .collect()
}

/// Branch name → sha.
pub type Heads = BTreeMap<String, String>;

/// Why the server's branches could not be read: the kind, and git's own words for the user.
#[derive(Debug, Clone)]
pub struct Unreached {
    pub kind: FailureKind,
    pub detail: String,
}

impl Unreached {
    fn of(text: String) -> Self {
        Self { kind: failure::classify(&text), detail: text }
    }
}

/// The server's branches, asked from the working copy `git`: one `ls-remote`, no objects.
pub async fn server_branches(git: &Git, prompts: Prompts) -> Result<Heads, Unreached> {
    match git.network(&["ls-remote", "--heads", REMOTE], prompts, TIMEOUT).await {
        Ok(o) if o.success() => Ok(parse_server(&o.stdout)),
        Ok(o) => Err(Unreached::of(o.error_text())),
        Err(e) => Err(Unreached::of(format!("{e:#}"))),
    }
}

/// Whether the last fetch of the working copy `path` left its remote-tracking refs at `server`. The
/// working copies of one repository compare with one answer of the server.
pub async fn compare(path: &str, server: &Heads) -> ServerHeads {
    let result = |changed, error_kind| ServerHeads { path: path.to_string(), changed, error_kind };
    let prefix = format!("refs/remotes/{REMOTE}/");
    match Git::new(path).out(&["for-each-ref", "--format=%(refname)%00%(objectname)", &prefix]).await {
        Ok(out) => result(*server != parse_local(&out, REMOTE), None),
        Err(e) => result(false, Some(failure::classify(&format!("{e:#}")))),
    }
}

/// The check for one working copy on its own; it runs in the background and never asks the user.
pub async fn check(path: &str) -> ServerHeads {
    if !crate::state::reach::is_dir(path).await {
        return ServerHeads { path: path.to_string(), changed: false, error_kind: Some(FailureKind::RepoMissing) };
    }
    match server_branches(&Git::new(path), Prompts::Never).await {
        Ok(server) => compare(path, &server).await,
        Err(u) => ServerHeads { path: path.to_string(), changed: false, error_kind: Some(u.kind) },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn compares_server_and_last_fetch() {
        let server = parse_server("a1\trefs/heads/main\nb2\trefs/heads/feature/x\n");
        let local = parse_local("refs/remotes/origin/HEAD\0a1\nrefs/remotes/origin/main\0a1\nrefs/remotes/origin/feature/x\0b2\n", "origin");
        assert_eq!(server, local, "HEAD is not a branch");
        let moved = parse_server("a1\trefs/heads/main\nc3\trefs/heads/feature/x\n");
        assert_ne!(moved, local);
        let gone = parse_server("a1\trefs/heads/main\n");
        assert_ne!(gone, local, "a branch deleted on the server is a change too");
    }
}
