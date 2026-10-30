//! User-defined commands on repositories and branches: rendering with safely quoted placeholders,
//! a script file per run, and a background runner with live output and cancel.
//!
//! Commands come only from the user's own settings (or an import they confirmed); the tool
//! allowlist for installers stays separate.

use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::Arc;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;
#[cfg(test)]
use ts_rs::TS;

use crate::process::ProcError;

pub const NAME_LIMIT: usize = 60;
pub const SCRIPT_LIMIT: usize = 20_000;
pub const TIMEOUT: Duration = Duration::from_secs(30 * 60);
/// Script files of terminal runs are read by the terminal after we return; older ones are removed.
const KEEP_FILES: Duration = Duration::from_secs(24 * 3600);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[cfg_attr(test, derive(TS))]
#[cfg_attr(test, ts(export))]
pub enum Shell {
    /// PowerShell on Windows, sh elsewhere.
    #[default]
    Default,
    Pwsh,
    Cmd,
    Bash,
    Sh,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[cfg_attr(test, derive(TS))]
#[cfg_attr(test, ts(export))]
pub enum RunMode {
    /// Visible and interactive; the output stays in the terminal.
    #[default]
    Terminal,
    /// Output streams into the app, with exit code and cancel.
    Background,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(test, derive(TS))]
#[serde(rename_all = "camelCase", default)]
#[cfg_attr(test, ts(export))]
pub struct CustomCommand {
    pub id: String,
    pub name: String,
    pub script: String,
    pub shell: Shell,
    pub mode: RunMode,
    /// Repository identities the command is offered for; empty = every repository.
    pub repos: Vec<String>,
    /// Also offered on branch rows (then {{branch}} is available).
    pub branches: bool,
    /// Ask before running.
    pub confirm: bool,
}

impl Default for CustomCommand {
    fn default() -> Self {
        Self {
            id: String::new(),
            name: String::new(),
            script: String::new(),
            shell: Shell::Default,
            mode: RunMode::Terminal,
            repos: Vec::new(),
            branches: false,
            confirm: false,
        }
    }
}

/// Values a command can use.
#[derive(Debug, Clone, Default)]
pub struct Context {
    pub path: String,
    pub repo: String,
    pub identity: String,
    pub branch: Option<String>,
    pub remote: String,
    pub default_branch: Option<String>,
}

pub const PLACEHOLDERS: &[&str] = &["path", "repo", "identity", "branch", "remote", "default"];

#[derive(Debug, Clone, PartialEq)]
pub enum RenderError {
    /// `{{name}}` that is no placeholder.
    Unknown(String),
    /// A placeholder without a value here, e.g. {{branch}} on a repository.
    Missing(String),
    /// A value that cannot be passed safely to this shell (a `"` for cmd).
    Unsafe(String),
    /// A script longer than `SCRIPT_LIMIT` characters (an edited or imported file): it does not run
    /// rather than run cut off.
    TooLong(usize),
}

impl std::fmt::Display for RenderError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            RenderError::Unknown(n) => write!(f, "{{{{{n}}}}}"),
            RenderError::Missing(n) => write!(f, "{{{{{n}}}}}"),
            RenderError::Unsafe(v) => write!(f, "{v}"),
            RenderError::TooLong(n) => write!(f, "the script has {n} characters, at most {SCRIPT_LIMIT} run"),
        }
    }
}

pub fn resolve(shell: Shell) -> Shell {
    match shell {
        Shell::Default if cfg!(windows) => Shell::Pwsh,
        Shell::Default => Shell::Sh,
        s => s,
    }
}

/// A value as one literal argument for the shell. PowerShell and sh take single quotes with the
/// quote doubled or closed and reopened; cmd has no escape inside quotes, so `"` is refused and
/// `%` doubled (a batch file would expand it).
pub fn quote(shell: Shell, value: &str) -> Result<String, RenderError> {
    Ok(match resolve(shell) {
        // Every quote PowerShell ends a single-quoted string at is doubled, not only the ASCII one.
        Shell::Pwsh => {
            let mut s = String::with_capacity(value.len() + 2);
            s.push('\'');
            for c in value.chars() {
                if matches!(c, '\'' | '\u{2018}' | '\u{2019}' | '\u{201A}' | '\u{201B}') {
                    s.push(c);
                }
                s.push(c);
            }
            s.push('\'');
            s
        }
        Shell::Cmd => {
            if value.contains('"') {
                return Err(RenderError::Unsafe(value.to_string()));
            }
            format!("\"{}\"", value.replace('%', "%%"))
        }
        _ => format!("'{}'", value.replace('\'', "'\\''")),
    })
}

/// Replaces `{{name}}` by the quoted value. Everything else stays as written, so shell syntax
/// with braces (script blocks, `${var}`) is untouched.
pub fn render(template: &str, ctx: &Context, shell: Shell) -> Result<String, RenderError> {
    let length = template.chars().count();
    if length > SCRIPT_LIMIT {
        return Err(RenderError::TooLong(length));
    }
    let mut out = String::with_capacity(template.len());
    let mut rest = template;
    while let Some(start) = rest.find("{{") {
        out.push_str(&rest[..start]);
        let after = &rest[start + 2..];
        let Some(end) = after.find("}}") else {
            out.push_str(&rest[start..]);
            return Ok(out);
        };
        let name = after[..end].trim();
        let value = match name {
            "path" => Some(ctx.path.clone()),
            "repo" => Some(ctx.repo.clone()),
            "identity" => Some(ctx.identity.clone()),
            "remote" => Some(ctx.remote.clone()),
            "branch" => ctx.branch.clone(),
            "default" => ctx.default_branch.clone(),
            _ => return Err(RenderError::Unknown(name.to_string())),
        };
        let value = value.ok_or_else(|| RenderError::Missing(name.to_string()))?;
        out.push_str(&quote(shell, &value)?);
        rest = &after[end + 2..];
    }
    out.push_str(rest);
    Ok(out)
}

/// The script file: the working directory first, then the command, with the exit code of the
/// last program passed on. Windows shells get CRLF; PowerShell 5 needs a BOM to read UTF-8.
pub fn script_file(shell: Shell, cwd: &str, body: &str) -> Result<(String, Vec<u8>), RenderError> {
    let dir = quote(shell, cwd)?;
    Ok(match resolve(shell) {
        Shell::Pwsh => {
            let text = format!("Set-Location -LiteralPath {dir}\n{body}\nif ($LASTEXITCODE) {{ exit $LASTEXITCODE }}\n").replace('\n', "\r\n");
            ("ps1".into(), [&[0xEF, 0xBB, 0xBF][..], text.as_bytes()].concat())
        }
        Shell::Cmd => {
            let text = format!("@echo off\nchcp 65001 >nul\ncd /d {dir}\n{body}\nexit /b %errorlevel%\n").replace('\n', "\r\n");
            ("cmd".into(), text.into_bytes())
        }
        _ => ("sh".into(), format!("cd {dir} || exit 1\n{body}\n").into_bytes()),
    })
}

/// Program and arguments that run a script file.
pub fn invocation(shell: Shell, file: &Path) -> (String, Vec<String>) {
    let f = file.to_string_lossy().to_string();
    match resolve(shell) {
        Shell::Pwsh => (
            if cfg!(windows) { "powershell".into() } else { "pwsh".into() },
            vec!["-NoProfile".into(), "-NonInteractive".into(), "-ExecutionPolicy".into(), "Bypass".into(), "-File".into(), f],
        ),
        Shell::Cmd => ("cmd".into(), vec!["/d".into(), "/c".into(), f]),
        Shell::Bash => ("bash".into(), vec![f]),
        _ => ("sh".into(), vec![f]),
    }
}

/// The same, as one line for a terminal window. On Windows the terminal's cmd reads the line whatever
/// the script's shell, so every argument but a plain switch is quoted for cmd.
pub fn terminal_line(shell: Shell, file: &Path) -> String {
    let (program, args) = invocation(shell, file);
    let args: Vec<String> = args.into_iter().map(|a| terminal_arg(&a, cfg!(windows))).collect();
    format!("{program} {}", args.join(" "))
}

fn terminal_arg(a: &str, cmd: bool) -> String {
    // cmd does not take its own switches quoted; elsewhere quoting is always fine.
    let switch = cmd && a.len() > 1 && a.starts_with(['-', '/']) && a[1..].chars().all(|c| c.is_ascii_alphabetic());
    if switch {
        a.to_string()
    } else if cmd {
        // Inside quotes `^` and `&` are literal, but cmd still expands `%NAME%` there: each `%` is
        // escaped outside the quotes. A `"` cannot occur in a Windows path.
        format!("\"{}\"", a.replace('%', "\"^%\""))
    } else {
        quote(Shell::Sh, a).unwrap_or_else(|_| a.to_string())
    }
}

/// Writes the script for one run and removes files of runs older than a day.
pub fn write_script(dir: &Path, run_id: &str, ext: &str, bytes: &[u8]) -> std::io::Result<PathBuf> {
    std::fs::create_dir_all(dir)?;
    if let Ok(entries) = std::fs::read_dir(dir) {
        for e in entries.flatten() {
            let old = e.metadata().and_then(|m| m.modified()).ok().and_then(|t| t.elapsed().ok()).is_some_and(|age| age > KEEP_FILES);
            if old {
                let _ = std::fs::remove_file(e.path());
            }
        }
    }
    let file = dir.join(format!("{run_id}.{ext}"));
    std::fs::write(&file, bytes)?;
    Ok(file)
}

#[derive(Debug, Clone, Serialize)]
#[cfg_attr(test, derive(TS))]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, ts(export))]
pub struct OutputLine {
    pub text: String,
    /// From stderr.
    pub err: bool,
}

/// Runs a program in `cwd`, delivering stdout and stderr lines in batches (at most every
/// 100 ms), until it ends, is cancelled or times out. Returns the exit code.
pub async fn run_background(
    program: &str,
    args: &[String],
    cwd: &Path,
    timeout: Duration,
    cancel: Arc<tokio::sync::Notify>,
    mut on_lines: impl FnMut(Vec<OutputLine>) + Send,
) -> Result<Option<i32>, ProcError> {
    let mut cmd = crate::process::command(program);
    cmd.args(args).current_dir(cwd).stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped()).kill_on_drop(true);
    #[cfg(windows)]
    cmd.creation_flags(crate::process::CREATE_NO_WINDOW);
    let started = crate::diagnostics::enabled().then(std::time::Instant::now);
    let result = pump(&mut cmd, program, timeout, cancel, &mut on_lines).await;
    if let Some(t) = started {
        let outcome = match &result {
            Ok(code) => code.map_or("signal".to_string(), |c| c.to_string()),
            Err(e) => e.to_string(),
        };
        crate::diagnostics::record(cmd.as_std(), t.elapsed(), &outcome);
    }
    result
}

async fn pump(
    cmd: &mut Command,
    program: &str,
    timeout: Duration,
    cancel: Arc<tokio::sync::Notify>,
    on_lines: &mut (impl FnMut(Vec<OutputLine>) + Send),
) -> Result<Option<i32>, ProcError> {
    let mut child = crate::process::spawn(cmd, program)?;
    let tree = crate::process::ProcessTree::of(&child);
    let (Some(stdout), Some(stderr)) = (child.stdout.take(), child.stderr.take()) else {
        return Err(ProcError::Io(format!("{program}: no output pipes")));
    };
    // Bytes, not text: one line in another encoding must not end the reading, or the child blocks
    // on a full pipe until the timeout.
    let (mut out, mut err) = (BufReader::new(stdout), BufReader::new(stderr));
    let (mut out_line, mut err_line) = (Vec::new(), Vec::new());
    let (mut out_open, mut err_open) = (true, true);
    let mut batch = Vec::new();
    let deadline = tokio::time::sleep(timeout);
    tokio::pin!(deadline);
    let mut tick = tokio::time::interval(Duration::from_millis(100));
    while out_open || err_open {
        tokio::select! {
            n = out.read_until(b'\n', &mut out_line), if out_open => out_open = take_line(n, &mut out_line, false, &mut batch),
            n = err.read_until(b'\n', &mut err_line), if err_open => err_open = take_line(n, &mut err_line, true, &mut batch),
            _ = tick.tick() => {
                if !batch.is_empty() {
                    on_lines(std::mem::take(&mut batch));
                }
            }
            _ = cancel.notified() => {
                let _ = child.kill().await;
                on_lines(std::mem::take(&mut batch));
                return Err(ProcError::Cancelled);
            }
            _ = &mut deadline => {
                let _ = child.kill().await;
                on_lines(std::mem::take(&mut batch));
                return Err(ProcError::Timeout(program.to_string()));
            }
        }
        if batch.len() >= 200 {
            on_lines(std::mem::take(&mut batch));
        }
    }
    if !batch.is_empty() {
        on_lines(batch);
    }
    let status = tokio::select! {
        s = child.wait() => s.map_err(|e| ProcError::Io(format!("{program}: {e}")))?,
        _ = cancel.notified() => {
            let _ = child.kill().await;
            return Err(ProcError::Cancelled);
        }
        _ = &mut deadline => {
            let _ = child.kill().await;
            return Err(ProcError::Timeout(program.to_string()));
        }
    };
    tree.release();
    Ok(status.code())
}

/// Hands a finished line (`read_until` keeps a partial one in `line` across calls) to the batch.
/// Returns whether the stream stays open: false at its end, and after a read error, which is
/// reported as a line of its own.
fn take_line(read: std::io::Result<usize>, line: &mut Vec<u8>, err: bool, batch: &mut Vec<OutputLine>) -> bool {
    let open = match read {
        Ok(0) => false,
        Ok(_) if line.last() != Some(&b'\n') => return true,
        Ok(_) => true,
        Err(e) => {
            batch.push(OutputLine { text: format!("[read error: {e}]"), err: true });
            false
        }
    };
    if !line.is_empty() {
        let text = String::from_utf8_lossy(line);
        batch.push(OutputLine { text: text.trim_end_matches(['\n', '\r']).to_string(), err });
        line.clear();
    }
    open
}

/// Normalises commands on load and save: names within limits, no empty entries, unique ids.
pub fn sanitize(commands: &mut Vec<CustomCommand>) -> bool {
    let before = commands.clone();
    commands.retain(|c| !c.name.trim().is_empty() && !c.script.trim().is_empty());
    let mut seen = std::collections::HashSet::new();
    for (n, c) in commands.iter_mut().enumerate() {
        c.name = c.name.trim().chars().take(NAME_LIMIT).collect();
        // A script over the limit stays as written: cut off it could still run and do something else.
        // `render` refuses it, and the editor shows why.
        if c.id.trim().is_empty() || !seen.insert(c.id.clone()) {
            c.id = format!("cmd-{n}-{}", crate::git::snapshot::now());
            seen.insert(c.id.clone());
        }
    }
    *commands != before
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ctx(branch: Option<&str>) -> Context {
        Context {
            path: "C:/w s/it's".into(),
            repo: "Core".into(),
            identity: "dev.azure.com/o/p/core".into(),
            branch: branch.map(String::from),
            remote: "origin".into(),
            default_branch: Some("origin/main".into()),
        }
    }

    #[test]
    fn placeholders_are_quoted_for_each_shell() {
        let c = ctx(Some("feat/a&b;$(rm -rf x)'q"));
        assert_eq!(render("git log {{branch}}", &c, Shell::Pwsh).unwrap(), "git log 'feat/a&b;$(rm -rf x)''q'");
        assert_eq!(render("git log {{branch}}", &c, Shell::Sh).unwrap(), "git log 'feat/a&b;$(rm -rf x)'\\''q'");
        assert_eq!(render("git log {{ branch }}", &c, Shell::Bash).unwrap(), "git log 'feat/a&b;$(rm -rf x)'\\''q'");
        assert_eq!(render("dir {{path}}", &ctx(None), Shell::Cmd).unwrap(), "dir \"C:/w s/it's\"");
        let pct = Context { path: "C:/100%".into(), ..ctx(None) };
        assert_eq!(render("dir {{path}}", &pct, Shell::Cmd).unwrap(), "dir \"C:/100%%\"");
        let q = ctx(Some("a\"b"));
        assert_eq!(render("echo {{branch}}", &q, Shell::Cmd), Err(RenderError::Unsafe("a\"b".into())));
        assert_eq!(render("{{repo}} {{identity}} {{remote}} {{default}}", &c, Shell::Sh).unwrap(), "'Core' 'dev.azure.com/o/p/core' 'origin' 'origin/main'");
        // PowerShell also ends a single-quoted string at the typographic quotes U+2018–U+201B.
        let typo = ctx(Some("x\u{2019};calc;\u{2018}\u{201A}\u{201B}"));
        assert_eq!(render("echo {{branch}}", &typo, Shell::Pwsh).unwrap(), "echo 'x\u{2019}\u{2019};calc;\u{2018}\u{2018}\u{201A}\u{201A}\u{201B}\u{201B}'");
    }

    #[test]
    fn braces_of_the_shell_stay_and_unknown_or_missing_placeholders_stop() {
        let script = "Get-ChildItem | ForEach-Object { $_.Name }; echo ${HOME}; echo {{path}}";
        assert_eq!(render(script, &ctx(None), Shell::Pwsh).unwrap(), "Get-ChildItem | ForEach-Object { $_.Name }; echo ${HOME}; echo 'C:/w s/it''s'");
        assert_eq!(render("echo {{nope}}", &ctx(None), Shell::Sh), Err(RenderError::Unknown("nope".into())));
        assert_eq!(render("echo {{branch}}", &ctx(None), Shell::Sh), Err(RenderError::Missing("branch".into())));
        assert_eq!(render("echo {{path", &ctx(None), Shell::Sh).unwrap(), "echo {{path");
        assert_eq!(RenderError::Unknown("x".into()).to_string(), "{{x}}");
        assert_eq!(RenderError::Unsafe("v".into()).to_string(), "v");
        assert_eq!(RenderError::Missing("b".into()).to_string(), "{{b}}");
    }

    #[test]
    fn script_files_start_in_the_repo_and_pass_the_exit_code_on() {
        let (ext, bytes) = script_file(Shell::Pwsh, "C:/r", "git status").unwrap();
        assert_eq!(ext, "ps1");
        assert_eq!(&bytes[..3], &[0xEF, 0xBB, 0xBF]);
        let text = String::from_utf8_lossy(&bytes[3..]).to_string();
        assert!(text.starts_with("Set-Location -LiteralPath 'C:/r'\r\ngit status\r\n") && text.contains("exit $LASTEXITCODE"));
        let (ext, bytes) = script_file(Shell::Cmd, "C:/r", "dir").unwrap();
        assert_eq!(ext, "cmd");
        assert!(String::from_utf8(bytes).unwrap().contains("cd /d \"C:/r\"\r\ndir\r\nexit /b %errorlevel%"));
        let (ext, bytes) = script_file(Shell::Sh, "/r", "ls").unwrap();
        assert_eq!((ext.as_str(), String::from_utf8(bytes).unwrap()), ("sh", "cd '/r' || exit 1\nls\n".to_string()));
        assert!(script_file(Shell::Cmd, "C:/a\"b", "x").is_err());
    }

    #[test]
    fn invocations_and_terminal_lines() {
        let f = Path::new("C:/data/commands/r 1.ps1");
        let (p, a) = invocation(Shell::Pwsh, f);
        assert!(p == "powershell" || p == "pwsh");
        assert_eq!(a.last().unwrap(), "C:/data/commands/r 1.ps1");
        let line = terminal_line(Shell::Pwsh, f);
        if cfg!(windows) {
            assert!(line.ends_with("-File \"C:/data/commands/r 1.ps1\""), "{line}");
        } else {
            assert!(line.ends_with("'-File' 'C:/data/commands/r 1.ps1'"), "{line}");
        }
        assert_eq!(invocation(Shell::Cmd, Path::new("x.cmd")), ("cmd".to_string(), vec!["/d".into(), "/c".into(), "x.cmd".into()]));
        assert_eq!(invocation(Shell::Bash, Path::new("x.sh")).0, "bash");
        assert_eq!(invocation(Shell::Sh, Path::new("x.sh")).0, "sh");
        assert_eq!(resolve(Shell::Default), if cfg!(windows) { Shell::Pwsh } else { Shell::Sh });
    }

    #[test]
    fn script_files_are_written_and_old_ones_removed() {
        let dir = tempfile::tempdir().unwrap();
        let old = dir.path().join("old.sh");
        std::fs::write(&old, "x").unwrap();
        let f = std::fs::File::options().write(true).open(&old).unwrap();
        f.set_modified(std::time::SystemTime::now() - Duration::from_secs(3 * 24 * 3600)).unwrap();
        drop(f);
        let file = write_script(&dir.path().join("sub"), "run1", "sh", b"ls").unwrap();
        assert!(file.exists());
        write_script(dir.path(), "run2", "sh", b"ls").unwrap();
        assert!(!old.exists(), "a day old script of a terminal run is removed");
    }

    #[test]
    fn sanitize_drops_empty_limits_and_makes_ids_unique() {
        let mut list = vec![
            CustomCommand { id: "a".into(), name: "  Build  ".into(), script: "make".into(), ..Default::default() },
            CustomCommand { id: "a".into(), name: "x".repeat(100), script: "y".repeat(SCRIPT_LIMIT + 5), ..Default::default() },
            CustomCommand { id: "b".into(), name: "".into(), script: "ls".into(), ..Default::default() },
            CustomCommand { id: "".into(), name: "No script".into(), script: "  ".into(), ..Default::default() },
        ];
        assert!(sanitize(&mut list));
        assert_eq!(list.len(), 2);
        assert_eq!(list[0].name, "Build");
        assert_eq!(list[1].name.chars().count(), NAME_LIMIT);
        assert_eq!(list[1].script.chars().count(), SCRIPT_LIMIT + 5, "a long script is not cut off");
        assert_eq!(render(&list[1].script, &ctx(None), Shell::Sh), Err(RenderError::TooLong(SCRIPT_LIMIT + 5)), "it does not run either");
        assert_ne!(list[0].id, list[1].id);
        assert!(!sanitize(&mut list), "stable once clean");
    }

    fn git_args(args: &[&str]) -> Vec<String> {
        args.iter().map(|s| s.to_string()).collect()
    }

    #[tokio::test]
    async fn background_runs_stream_both_outputs_and_report_the_exit_code() {
        let dir = tempfile::tempdir().unwrap();
        let cancel = Arc::new(tokio::sync::Notify::new());
        let mut lines = Vec::new();
        let code = run_background("git", &git_args(&["--version"]), dir.path(), Duration::from_secs(20), cancel.clone(), |b| lines.extend(b))
            .await
            .unwrap();
        assert_eq!(code, Some(0));
        assert!(lines.iter().any(|l| !l.err && l.text.starts_with("git version")));
        let mut lines = Vec::new();
        let code = run_background("git", &git_args(&["no-such-subcommand-mbf"]), dir.path(), Duration::from_secs(20), cancel, |b| lines.extend(b))
            .await
            .unwrap();
        assert_ne!(code, Some(0));
        assert!(lines.iter().any(|l| l.err));
    }

    #[tokio::test]
    async fn background_runs_stop_on_cancel_timeout_and_name_a_missing_program() {
        let dir = tempfile::tempdir().unwrap();
        let (program, args): (&str, Vec<String>) =
            if cfg!(windows) { ("ping", git_args(&["-n", "30", "127.0.0.1"])) } else { ("sleep", git_args(&["30"])) };
        let r = run_background(program, &args, dir.path(), Duration::from_millis(300), Arc::new(tokio::sync::Notify::new()), |_| {}).await;
        assert!(matches!(r, Err(ProcError::Timeout(_))), "{r:?}");
        let cancel = Arc::new(tokio::sync::Notify::new());
        let trigger = cancel.clone();
        tokio::spawn(async move {
            tokio::time::sleep(Duration::from_millis(300)).await;
            trigger.notify_one();
        });
        let r = run_background(program, &args, dir.path(), Duration::from_secs(60), cancel, |_| {}).await;
        assert!(matches!(r, Err(ProcError::Cancelled)), "{r:?}");
        let r = run_background("no-such-program-mbf", &[], dir.path(), Duration::from_secs(5), Arc::new(tokio::sync::Notify::new()), |_| {}).await;
        assert!(matches!(r, Err(ProcError::NotFound(_))));
    }

    #[tokio::test]
    async fn a_line_that_is_not_utf8_does_not_end_the_reading() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("mixed.txt");
        std::fs::write(&file, [&b"before\n"[..], &[0xFF, 0xFE, b'x', b'\n'][..], &b"after\n"[..]].concat()).unwrap();
        let f = file.to_string_lossy().to_string();
        let (program, args) = if cfg!(windows) { ("cmd", git_args(&["/d", "/c", "type", &f])) } else { ("cat", git_args(&[&f])) };
        let mut lines = Vec::new();
        let code = run_background(program, &args, dir.path(), Duration::from_secs(20), Arc::new(tokio::sync::Notify::new()), |b| lines.extend(b))
            .await
            .unwrap();
        assert_eq!(code, Some(0));
        let texts: Vec<&str> = lines.iter().filter(|l| !l.err).map(|l| l.text.as_str()).collect();
        assert_eq!(texts.len(), 3, "{texts:?}");
        assert_eq!((texts[0], texts[2]), ("before", "after"));
        assert!(texts[1].ends_with('x'), "the broken bytes are replaced, the rest stays: {texts:?}");
    }

    #[test]
    fn terminal_arguments_are_quoted_for_cmd_with_percent_signs_escaped() {
        assert_eq!(terminal_arg("C:/Users/a b/run.ps1", true), "\"C:/Users/a b/run.ps1\"");
        assert_eq!(terminal_arg("C:/x/run.cmd", true), "\"C:/x/run.cmd\"", "quoted even without spaces");
        assert_eq!(terminal_arg("C:/100%PATH%/r.cmd", true), "\"C:/100\"^%\"PATH\"^%\"/r.cmd\"");
        assert_eq!(terminal_arg("C:/a^b&c/r.cmd", true), "\"C:/a^b&c/r.cmd\"", "literal inside quotes");
        assert_eq!(terminal_arg("-NoProfile", true), "-NoProfile");
        assert_eq!(terminal_arg("/d", true), "/d");
        assert_eq!(terminal_arg("/x/it's", false), "'/x/it'\\''s'");
    }

    #[tokio::test]
    async fn a_rendered_script_file_runs_in_the_repo() {
        let dir = tempfile::tempdir().unwrap();
        let shell = if cfg!(windows) { Shell::Cmd } else { Shell::Sh };
        let body = render("echo {{repo}}", &Context { repo: "Core".into(), ..Default::default() }, shell).unwrap();
        let (ext, bytes) = script_file(shell, &dir.path().to_string_lossy(), &body).unwrap();
        let file = write_script(&dir.path().join("cmds"), "r", &ext, &bytes).unwrap();
        let (program, args) = invocation(shell, &file);
        let mut lines = Vec::new();
        let code = run_background(&program, &args, dir.path(), Duration::from_secs(20), Arc::new(tokio::sync::Notify::new()), |b| lines.extend(b))
            .await
            .unwrap();
        assert_eq!(code, Some(0));
        assert!(lines.iter().any(|l| l.text.contains("Core")), "{lines:?}");
    }
}
