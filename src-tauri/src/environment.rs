//! Which external tools are available, in which version, and how the user gets the missing ones.
//! Install and login commands live only here: the UI can ask to run one by id, never pass a command.

use std::time::Duration;

use crate::desktop;
use crate::model::*;
use crate::process::{self, ProcError};
use crate::providers::{self, run_tool, Tool};

const TIMEOUT: Duration = Duration::from_secs(30);
/// `--path-format` of `git rev-parse` exists since 2.31.
const GIT_MIN: (u32, u32) = (2, 31);

pub async fn status_all() -> Vec<ToolStatus> {
    refresh_path().await;
    let (git, az, gh) = tokio::join!(git_status(), azure_status(), github_status());
    let all = vec![git, az, gh, desktop_status()];
    providers::note_environment(&all);
    all
}

/// The command for a tool and action, if one exists on this platform.
pub fn command_for(id: ToolId, action: ToolAction) -> Option<&'static str> {
    match (id, action) {
        (_, ToolAction::Install) => install_command(id),
        (ToolId::AzureCli, ToolAction::Login) => Some("az login"),
        (ToolId::GitHubCli, ToolAction::Login) => Some("gh auth login"),
        (ToolId::AzureCli, ToolAction::AddExtension) => Some("az extension add --name azure-devops"),
        _ => None,
    }
}

#[cfg(windows)]
fn install_command(id: ToolId) -> Option<&'static str> {
    Some(match id {
        ToolId::Git => "winget install --id Git.Git -e",
        ToolId::AzureCli => "winget install --id Microsoft.AzureCLI -e",
        ToolId::GitHubCli => "winget install --id GitHub.cli -e",
        ToolId::GitHubDesktop => "winget install --id GitHub.GitHubDesktop -e",
    })
}

#[cfg(target_os = "macos")]
fn install_command(id: ToolId) -> Option<&'static str> {
    Some(match id {
        ToolId::Git => "brew install git",
        ToolId::AzureCli => "brew install azure-cli",
        ToolId::GitHubCli => "brew install gh",
        ToolId::GitHubDesktop => "brew install --cask github",
    })
}

#[cfg(all(unix, not(target_os = "macos")))]
fn install_command(id: ToolId) -> Option<&'static str> {
    // Distributions differ; beyond git the official pages describe the right repository setup.
    match id {
        ToolId::Git => Some("sudo apt install git"),
        _ => None,
    }
}

fn download_url(id: ToolId) -> &'static str {
    match id {
        ToolId::Git => "https://git-scm.com/downloads",
        ToolId::AzureCli => "https://learn.microsoft.com/cli/azure/install-azure-cli",
        ToolId::GitHubCli => "https://cli.github.com/",
        ToolId::GitHubDesktop => "https://desktop.github.com/",
    }
}

fn status(id: ToolId, required: bool, state: ToolState) -> ToolStatus {
    let mut s = ToolStatus {
        id,
        required,
        state,
        version: None,
        min_version: None,
        account: None,
        detail: None,
        download_url: download_url(id).to_string(),
        commands: Vec::new(),
    };
    s.commands = commands_for_state(id, state);
    s
}

fn commands_for_state(id: ToolId, state: ToolState) -> Vec<ToolCommand> {
    let action = match state {
        ToolState::Missing | ToolState::Outdated => ToolAction::Install,
        ToolState::NotLoggedIn => ToolAction::Login,
        ToolState::ExtensionMissing => ToolAction::AddExtension,
        ToolState::Ready | ToolState::Unknown => return Vec::new(),
    };
    command_for(id, action).map(|c| ToolCommand { action, command: c.to_string() }).into_iter().collect()
}

fn with_state(mut s: ToolStatus, state: ToolState) -> ToolStatus {
    s.state = state;
    s.commands = commands_for_state(s.id, state);
    s
}

/// First `major.minor[.patch]` in a version banner such as "git version 2.54.0.windows.1".
pub fn parse_version(text: &str) -> Option<(u32, u32, u32)> {
    text.split(|c: char| c.is_whitespace() || c == '(' || c == ')').find_map(|w| {
        let mut parts = w.split('.').map(|p| p.parse::<u32>());
        match (parts.next(), parts.next()) {
            (Some(Ok(a)), Some(Ok(b))) => Some((a, b, parts.next().and_then(|p| p.ok()).unwrap_or(0))),
            _ => None,
        }
    })
}

fn format_version(v: (u32, u32, u32)) -> String {
    format!("{}.{}.{}", v.0, v.1, v.2)
}

async fn git_status() -> ToolStatus {
    let base = status(ToolId::Git, true, ToolState::Ready);
    let mut s = ToolStatus { min_version: Some(format!("{}.{}", GIT_MIN.0, GIT_MIN.1)), ..base };
    match process::run("git", ["--version"], None, &[("LC_ALL", "C")], TIMEOUT).await {
        Err(ProcError::NotFound(_)) => with_state(s, ToolState::Missing),
        Err(e) => ToolStatus { detail: Some(e.to_string()), ..with_state(s, ToolState::Unknown) },
        Ok(o) => match parse_version(&o.stdout) {
            Some(v) => {
                s.version = Some(format_version(v));
                if (v.0, v.1) < GIT_MIN { with_state(s, ToolState::Outdated) } else { s }
            }
            None => ToolStatus { detail: Some(o.error_text()), ..with_state(s, ToolState::Unknown) },
        },
    }
}

async fn azure_status() -> ToolStatus {
    let s = status(ToolId::AzureCli, false, ToolState::Ready);
    // One call yields the CLI version and the installed extensions.
    let version = match run_tool(Tool::Az, &["version", "-o", "json"], TIMEOUT).await {
        Err(ProcError::NotFound(_)) => return with_state(s, ToolState::Missing),
        Err(e) => return ToolStatus { detail: Some(e.to_string()), ..with_state(s, ToolState::Unknown) },
        Ok(o) => o,
    };
    let account = run_tool(Tool::Az, &["account", "show", "-o", "json"], TIMEOUT).await;
    let account = account.ok().filter(|o| o.success()).map(|o| o.stdout);
    azure_from(s, &version.stdout, account.as_deref())
}

/// State from the answers of `az version` and `az account show` (None: not signed in).
fn azure_from(s: ToolStatus, version_json: &str, account_json: Option<&str>) -> ToolStatus {
    let json: serde_json::Value = serde_json::from_str(version_json).unwrap_or_default();
    let mut s = ToolStatus { version: json["azure-cli"].as_str().map(String::from), ..s };
    let Some(account) = account_json else { return with_state(s, ToolState::NotLoggedIn) };
    s.account = serde_json::from_str::<serde_json::Value>(account).ok().and_then(|v| v["user"]["name"].as_str().map(String::from));
    if json["extensions"]["azure-devops"].is_null() {
        return with_state(s, ToolState::ExtensionMissing);
    }
    s
}

async fn github_status() -> ToolStatus {
    let s = status(ToolId::GitHubCli, false, ToolState::Ready);
    let version = match run_tool(Tool::Gh, &["--version"], TIMEOUT).await {
        Err(ProcError::NotFound(_)) => return with_state(s, ToolState::Missing),
        Err(e) => return ToolStatus { detail: Some(e.to_string()), ..with_state(s, ToolState::Unknown) },
        Ok(o) => o,
    };
    let mut s = ToolStatus { version: parse_version(&version.stdout).map(format_version), ..s };
    match run_tool(Tool::Gh, &["auth", "status", "--active"], TIMEOUT).await {
        Ok(o) if o.success() => {
            s.account = github_account(&format!("{}\n{}", o.stdout, o.stderr));
            s
        }
        _ => with_state(s, ToolState::NotLoggedIn),
    }
}

/// "✓ Logged in to github.com account octocat (keyring)" → octocat.
fn github_account(text: &str) -> Option<String> {
    text.split_once(" account ").and_then(|(_, r)| r.split_whitespace().next()).map(String::from)
}

fn desktop_status() -> ToolStatus {
    let state = if desktop::github_desktop().is_some() { ToolState::Ready } else { ToolState::Missing };
    status(ToolId::GitHubDesktop, false, state)
}

/// A tool installed while the app runs lands in the registry PATH, not in this process's PATH.
/// Re-reading it makes "check again" work without restarting the app.
#[cfg(windows)]
async fn refresh_path() {
    // Through `process::run`: a registry that does not answer must not hang the check.
    let read = |key: &'static str| async move {
        let o = process::run("reg", ["query", key, "/v", "Path"], None, &[], Duration::from_secs(10)).await.ok()?;
        let line = o.stdout.lines().find(|l| l.trim_start().starts_with("Path"))?.to_string();
        let value = line.split_once("REG_").and_then(|(_, r)| r.split_once(char::is_whitespace)).map(|(_, v)| v.trim())?;
        Some(expand_env(value))
    };
    let (machine, user) = tokio::join!(read(r"HKLM\SYSTEM\CurrentControlSet\Control\Session Manager\Environment"), read(r"HKCU\Environment"));
    let current = std::env::var("PATH").unwrap_or_default();
    let mut parts: Vec<String> = Vec::new();
    // The process's own PATH first, as for any program it starts; the registry only adds what was
    // installed since, so a tool on the PATH the app was given is not shadowed by another copy.
    for p in [Some(current), machine, user].into_iter().flatten() {
        for entry in p.split(';').map(str::trim).filter(|e| !e.is_empty()) {
            if !parts.iter().any(|x| x.eq_ignore_ascii_case(entry)) {
                parts.push(entry.to_string());
            }
        }
    }
    crate::process::set_search_path(parts.join(";"));
}

#[cfg(not(windows))]
async fn refresh_path() {}

#[cfg(windows)]
fn expand_env(value: &str) -> String {
    let mut out = String::new();
    let mut rest = value;
    while let Some(start) = rest.find('%') {
        out.push_str(&rest[..start]);
        let after = &rest[start + 1..];
        match after.find('%') {
            Some(end) => {
                let name = &after[..end];
                out.push_str(&std::env::var(name).unwrap_or_else(|_| format!("%{name}%")));
                rest = &after[end + 1..];
            }
            None => {
                out.push_str(&rest[start..]);
                rest = "";
            }
        }
    }
    out.push_str(rest);
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_version_banners() {
        assert_eq!(parse_version("git version 2.54.0.windows.1"), Some((2, 54, 0)));
        assert_eq!(parse_version("git version 2.30.2"), Some((2, 30, 2)));
        assert_eq!(parse_version("gh version 2.83.0 (2026-08-01)\nhttps://github.com/cli/cli"), Some((2, 83, 0)));
        assert_eq!(parse_version("no version here"), None);
    }

    #[test]
    fn commands_come_from_the_allowlist_only() {
        assert_eq!(command_for(ToolId::AzureCli, ToolAction::Login), Some("az login"));
        assert_eq!(command_for(ToolId::Git, ToolAction::Login), None);
        assert!(commands_for_state(ToolId::GitHubCli, ToolState::Ready).is_empty());
        let s = commands_for_state(ToolId::AzureCli, ToolState::ExtensionMissing);
        assert_eq!(s[0].command, "az extension add --name azure-devops");
    }

    #[test]
    fn azure_state_follows_version_account_and_extension() {
        let base = || status(ToolId::AzureCli, false, ToolState::Ready);
        let with_ext = r#"{"azure-cli": "2.60.0", "extensions": {"azure-devops": "1.0.1"}}"#;
        let ready = azure_from(base(), with_ext, Some(r#"{"user": {"name": "dev@x"}}"#));
        assert_eq!((ready.state, ready.version.as_deref(), ready.account.as_deref()), (ToolState::Ready, Some("2.60.0"), Some("dev@x")));
        assert_eq!(azure_from(base(), with_ext, None).state, ToolState::NotLoggedIn);
        let no_ext = azure_from(base(), r#"{"azure-cli": "2.60.0", "extensions": {}}"#, Some("{}"));
        assert_eq!(no_ext.state, ToolState::ExtensionMissing);
        assert_eq!(no_ext.commands.len(), 1);
        assert_eq!(azure_from(base(), "garbage", Some("{}")).version, None);
    }

    /// The provider tools see the one provider environment (no prompts, UTF-8 output) here as well.
    #[test]
    fn az_and_gh_start_only_through_the_provider_runner() {
        let source = include_str!("environment.rs");
        let code = &source[..source.find("#[cfg(test)]").unwrap()];
        for direct in ["shim_name(", "process::run(\"gh\"", "process::run(&az"] {
            assert!(!code.contains(direct), "{direct}");
        }
        assert!(code.contains("run_tool(Tool::Az") && code.contains("run_tool(Tool::Gh"));
    }

    #[test]
    fn github_account_is_read_from_the_status_text() {
        assert_eq!(github_account("github.com\n  ✓ Logged in to github.com account octocat (keyring)").as_deref(), Some("octocat"));
        assert_eq!(github_account("not logged in"), None);
    }

    #[test]
    fn every_tool_has_a_download_page_and_install_or_login_where_it_applies() {
        for id in [ToolId::Git, ToolId::AzureCli, ToolId::GitHubCli, ToolId::GitHubDesktop] {
            assert!(status(id, false, ToolState::Missing).download_url.starts_with("https://"));
            let _ = command_for(id, ToolAction::Install);
        }
        assert_eq!(with_state(status(ToolId::GitHubCli, false, ToolState::Ready), ToolState::NotLoggedIn).commands[0].action, ToolAction::Login);
        assert_eq!(format_version((2, 5, 1)), "2.5.1");
    }

    /// Reads the real system: only version and sign-in queries, nothing is installed or changed.
    #[tokio::test]
    async fn the_environment_check_reports_every_tool_with_git_ready() {
        let all = status_all().await;
        assert_eq!(all.len(), 4);
        let git = all.iter().find(|t| t.id == ToolId::Git).unwrap();
        assert!(matches!(git.state, ToolState::Ready | ToolState::Outdated), "{git:?}");
        assert!(git.version.is_some());
    }

    #[cfg(windows)]
    #[test]
    fn expands_registry_variables() {
        std::env::set_var("MBF_TEST_DIR", r"C:\x");
        assert_eq!(expand_env(r"%MBF_TEST_DIR%\bin;%NOPE_UNSET%;C:\y"), r"C:\x\bin;%NOPE_UNSET%;C:\y");
    }
}
