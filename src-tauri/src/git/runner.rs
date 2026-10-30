use std::path::{Path, PathBuf};
use std::time::Duration;

use anyhow::{bail, Result};

use crate::process::{self, ProcOutput};

const DEFAULT_TIMEOUT: Duration = Duration::from_secs(60);
pub const FETCH_TIMEOUT: Duration = Duration::from_secs(300);

// Output is parsed, so it must not be localized; prompts would hang a GUI process without a terminal.
pub(crate) const ENV: &[(&str, &str)] = &[
    ("LC_ALL", "C"),
    ("LANG", "C"),
    ("LANGUAGE", "C"),
    ("GIT_TERMINAL_PROMPT", "0"),
    ("GIT_OPTIONAL_LOCKS", "0"),
];

const BASE_ARGS: &[&str] = &["-c", "core.quotepath=off", "-c", "color.ui=never", "--no-pager"];

/// A transfer slower than 1 KB/s for 30 s has stalled (a dead VPN, a server that stopped answering):
/// it ends there instead of at the fetch's time limit.
const STALL_ARGS: &[&str] = &["-c", "http.lowSpeedLimit=1000", "-c", "http.lowSpeedTime=30"];

/// Whether a call to the server may ask the user: a sign-in window of the credential manager, an ssh
/// passphrase or host key. Only what the user started may; a background scan with an expired token
/// would otherwise open one window per repository it fetches in parallel.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum Prompts {
    #[default]
    Never,
    Allowed,
}

/// ssh without any question; a failed sign-in fails the call.
const BATCH_SSH: &str = "ssh -o BatchMode=yes";

/// The variables a call to the server gets on top of `ENV`. An ssh command the user configured
/// (`core.sshCommand`, `GIT_SSH_COMMAND`, `GIT_SSH`) stays theirs: setting ours would replace it.
pub(crate) fn network_env(prompts: Prompts, ssh_configured: bool) -> Vec<(&'static str, &'static str)> {
    match prompts {
        Prompts::Allowed => Vec::new(),
        Prompts::Never if ssh_configured => vec![("GCM_INTERACTIVE", "never")],
        Prompts::Never => vec![("GCM_INTERACTIVE", "never"), ("GIT_SSH_COMMAND", BATCH_SSH)],
    }
}

#[derive(Debug, Clone)]
pub struct Git {
    dir: PathBuf,
}

impl Git {
    pub fn new(dir: impl Into<PathBuf>) -> Self {
        Self { dir: dir.into() }
    }

    pub fn dir(&self) -> &Path {
        &self.dir
    }

    pub async fn raw_with_timeout(&self, args: &[&str], timeout: Duration) -> Result<ProcOutput> {
        let all = BASE_ARGS.iter().chain(args.iter());
        Ok(process::run("git", all, Some(&self.dir), ENV, timeout).await?)
    }

    pub async fn raw(&self, args: &[&str]) -> Result<ProcOutput> {
        self.raw_with_timeout(args, DEFAULT_TIMEOUT).await
    }

    /// A call to the server (fetch, ls-remote). It never waits on a stalled transfer, and without
    /// `Prompts::Allowed` it never asks the user.
    pub async fn network(&self, args: &[&str], prompts: Prompts, timeout: Duration) -> Result<ProcOutput> {
        let ssh_configured = prompts == Prompts::Never && self.ssh_configured().await;
        let env: Vec<(&str, &str)> = ENV.iter().copied().chain(network_env(prompts, ssh_configured)).collect();
        let all = BASE_ARGS.iter().chain(STALL_ARGS).chain(args.iter());
        Ok(process::run("git", all, Some(&self.dir), &env, timeout).await?)
    }

    async fn ssh_configured(&self) -> bool {
        std::env::var_os("GIT_SSH_COMMAND").is_some() || std::env::var_os("GIT_SSH").is_some() || self.config_get("core.sshCommand").await.ok().flatten().is_some()
    }

    /// Long-running network commands: progress lines as they come, cancellable.
    pub async fn stream(
        &self,
        args: &[&str],
        timeout: Duration,
        cancel: std::sync::Arc<tokio::sync::Notify>,
        on_line: impl FnMut(&str) + Send,
    ) -> Result<ProcOutput, crate::process::ProcError> {
        let all = BASE_ARGS.iter().chain(args.iter());
        process::run_streaming("git", all, Some(&self.dir), ENV, timeout, cancel, on_line).await
    }

    /// Stdout of a command that is expected to succeed.
    pub async fn out(&self, args: &[&str]) -> Result<String> {
        self.out_with_env(args, &[]).await
    }

    /// `out` with variables of its own on top of the fixed ones.
    pub async fn out_with_env(&self, args: &[&str], extra: &[(&str, &str)]) -> Result<String> {
        let env: Vec<(&str, &str)> = ENV.iter().chain(extra).copied().collect();
        let all = BASE_ARGS.iter().chain(args.iter());
        let o = process::run("git", all, Some(&self.dir), &env, DEFAULT_TIMEOUT).await?;
        if !o.success() {
            bail!("git {} failed: {}", args.join(" "), o.error_text());
        }
        Ok(o.stdout)
    }

    /// Commands like `merge-base --is-ancestor` answer with exit code 0/1; anything else is an error.
    pub async fn test(&self, args: &[&str]) -> Result<bool> {
        let o = self.raw(args).await?;
        match o.code {
            Some(0) => Ok(true),
            Some(1) => Ok(false),
            _ => bail!("git {} failed: {}", args.join(" "), o.error_text()),
        }
    }

    pub async fn is_ancestor(&self, ancestor: &str, descendant: &str) -> Result<bool> {
        self.test(&["merge-base", "--is-ancestor", ancestor, descendant]).await
    }

    pub async fn commit_exists(&self, sha: &str) -> Result<bool> {
        let spec = format!("{sha}^{{commit}}");
        self.test(&["rev-parse", "--verify", "--quiet", &spec]).await
    }

    pub async fn ref_exists(&self, full_ref: &str) -> Result<bool> {
        self.test(&["show-ref", "--verify", "--quiet", full_ref]).await
    }

    pub async fn merge_base(&self, a: &str, b: &str) -> Result<Option<String>> {
        let o = self.raw(&["merge-base", a, b]).await?;
        match o.code {
            Some(0) => Ok(Some(o.stdout.trim().to_string())),
            Some(1) => Ok(None),
            _ => bail!("git merge-base failed: {}", o.error_text()),
        }
    }

    pub async fn config_get(&self, key: &str) -> Result<Option<String>> {
        let o = self.raw(&["config", "--get", key]).await?;
        Ok(if o.success() { Some(o.stdout.trim().to_string()) } else { None })
    }
}

/// Splits NUL-separated fields of one `for-each-ref`/`log` line.
pub fn fields(line: &str) -> Vec<&str> {
    line.split('\0').collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn background_calls_never_ask_and_keep_the_users_ssh_command() {
        let names = |p, configured| network_env(p, configured).into_iter().map(|(k, v)| format!("{k}={v}")).collect::<Vec<_>>();
        assert_eq!(names(Prompts::Never, false), ["GCM_INTERACTIVE=never", "GIT_SSH_COMMAND=ssh -o BatchMode=yes"]);
        assert_eq!(names(Prompts::Never, true), ["GCM_INTERACTIVE=never"], "core.sshCommand or GIT_SSH_COMMAND of the user stays");
        assert!(names(Prompts::Allowed, false).is_empty(), "what the user started may ask");
        assert!(ENV.contains(&("GIT_TERMINAL_PROMPT", "0")), "never a terminal prompt, in any mode");
    }

    #[tokio::test]
    async fn an_ssh_command_the_user_configured_runs_in_a_background_call() {
        let dir = tempfile::tempdir().unwrap();
        let run = |args: &[&str]| assert!(std::process::Command::new("git").args(args).current_dir(dir.path()).status().unwrap().success());
        run(&["init", "-q"]);
        run(&["remote", "add", "origin", "ssh://git@example.invalid/repo.git"]);
        let marker = dir.path().join("ran").to_string_lossy().replace('\\', "/");
        run(&["config", "core.sshCommand", &format!("touch '{marker}'; false")]);
        let o = Git::new(dir.path()).network(&["ls-remote", "origin"], Prompts::Never, Duration::from_secs(30)).await.unwrap();
        assert!(!o.success());
        assert!(dir.path().join("ran").exists(), "the user's command ran, not ours");
    }
}
