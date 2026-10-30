//! Opt-in trace of every external command with its duration, for slow or failing repositories.
//! Off by default; while off, the only cost per command is one relaxed atomic load.

use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc;
use std::sync::OnceLock;
use std::time::Duration;

use serde::Serialize;
#[cfg(test)]
use ts_rs::TS;

static ON: AtomicBool = AtomicBool::new(false);
const LOG: &str = "diagnostics.log";
const MAX_BYTES: u64 = 5 * 1024 * 1024;

/// Switching off waits until every line written so far is in the file.
pub fn set(on: bool) {
    ON.store(on, Ordering::Relaxed);
    flush();
}

pub fn enabled() -> bool {
    ON.load(Ordering::Relaxed)
}

pub fn log_path() -> PathBuf {
    crate::config::app_dir().join(LOG)
}

/// One line per command: time, duration, exit code or error, program, arguments, folder. The log
/// is meant to be shared: credentials in URLs are masked and messages shortened.
pub fn format_line(at: i64, program: &str, args: &[String], cwd: Option<&Path>, took: Duration, outcome: &str) -> String {
    let dir = cwd.map(|d| d.to_string_lossy().to_string()).unwrap_or_default();
    format!("{at} {:>6}ms {outcome:<8} {program} {} [{dir}]\n", took.as_millis(), shown_args(args).join(" "))
}

const MESSAGE_SHOWN: usize = 24;

fn shown_args(args: &[String]) -> Vec<String> {
    let mut out = Vec::with_capacity(args.len());
    let mut message_next = false;
    for a in args {
        let a = mask_credentials(a);
        if message_next {
            out.push(shorten(&a));
        } else if let Some(m) = a.strip_prefix("--message=") {
            out.push(format!("--message={}", shorten(m)));
        } else {
            out.push(a.replace(['\r', '\n'], " "));
        }
        message_next = a == "-m" || a == "--message";
    }
    out
}

fn shorten(text: &str) -> String {
    let flat = text.replace(['\r', '\n'], " ");
    match flat.char_indices().nth(MESSAGE_SHOWN) {
        Some((i, _)) => format!("{}… ({} chars)", &flat[..i], flat.chars().count()),
        None => flat,
    }
}

/// `https://user:token@host/…` → `https://***@host/…`; a URL without credentials stays.
fn mask_credentials(arg: &str) -> String {
    let mut out = String::with_capacity(arg.len());
    let mut rest = arg;
    while let Some(i) = rest.find("://") {
        let (head, tail) = rest.split_at(i + 3);
        out.push_str(head);
        let end = tail.find(['/', ' ', '?', '#']).unwrap_or(tail.len());
        match tail[..end].rfind('@') {
            Some(at) => {
                out.push_str("***");
                out.push_str(&tail[at..end]);
            }
            None => out.push_str(&tail[..end]),
        }
        rest = &tail[end..];
    }
    out.push_str(rest);
    out
}

/// A command as the log names it, taken when it starts: its end may come after the command is gone.
pub struct Run {
    program: String,
    args: Vec<String>,
    cwd: Option<PathBuf>,
}

impl Run {
    pub fn of(cmd: &std::process::Command) -> Self {
        Self {
            program: cmd.get_program().to_string_lossy().to_string(),
            args: cmd.get_args().map(|a| a.to_string_lossy().to_string()).collect(),
            cwd: cmd.get_current_dir().map(Path::to_path_buf),
        }
    }
}

pub fn record(cmd: &std::process::Command, took: Duration, outcome: &str) {
    record_run(&Run::of(cmd), took, outcome);
}

pub fn record_run(run: &Run, took: Duration, outcome: &str) {
    write(log_path(), vec![run_line(run, took, outcome)]);
}

fn run_line(run: &Run, took: Duration, outcome: &str) -> String {
    format_line(crate::git::snapshot::now(), &run.program, &run.args, run.cwd.as_deref(), took, outcome)
}

/// Lines the app writes about its own work (what it reloads, how long it took), into the same log as
/// the commands it runs, so both read as one timeline. Written only while the log is on.
pub fn note(lines: &[String]) {
    if enabled() {
        write(log_path(), note_lines(lines));
    }
}

fn note_lines(lines: &[String]) -> Vec<String> {
    lines.iter().map(|line| format!("{} {}\n", crate::git::snapshot::now(), line.replace(['\r', '\n'], " "))).collect()
}

enum Job {
    Lines(PathBuf, Vec<String>),
    Flush(mpsc::Sender<()>),
}

/// Lines go to a thread of their own that appends them in batches: with the log on, every git call of
/// a scan opened, wrote and closed the file on the async thread that ran it.
fn writer() -> &'static mpsc::Sender<Job> {
    static WRITER: OnceLock<mpsc::Sender<Job>> = OnceLock::new();
    WRITER.get_or_init(|| {
        let (tx, rx) = mpsc::channel::<Job>();
        let _ = std::thread::Builder::new().name("diagnostics".into()).spawn(move || {
            while let Ok(first) = rx.recv() {
                let mut batch: Vec<(PathBuf, Vec<String>)> = Vec::new();
                let mut done = Vec::new();
                for job in std::iter::once(first).chain(rx.try_iter()) {
                    match job {
                        Job::Lines(path, lines) => match batch.iter_mut().find(|(p, _)| *p == path) {
                            Some((_, all)) => all.extend(lines),
                            None => batch.push((path, lines)),
                        },
                        Job::Flush(reply) => done.push(reply),
                    }
                }
                for (path, lines) in batch {
                    append(&path, &lines);
                }
                for reply in done {
                    let _ = reply.send(());
                }
            }
        });
        tx
    })
}

fn write(path: PathBuf, lines: Vec<String>) {
    let _ = writer().send(Job::Lines(path, lines));
}

/// Waits until the lines sent so far are written.
pub fn flush() {
    let (tx, rx) = mpsc::channel();
    if writer().send(Job::Flush(tx)).is_ok() {
        let _ = rx.recv_timeout(Duration::from_secs(5));
    }
}

fn append(path: &Path, lines: &[String]) {
    rotate(path);
    if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(path) {
        let _ = f.write_all(lines.concat().as_bytes());
    }
}

/// A full log is kept once as .old, so the trace never grows without bound.
fn rotate(path: &Path) {
    if std::fs::metadata(path).map(|m| m.len() > MAX_BYTES).unwrap_or(false) {
        let _ = std::fs::rename(path, path.with_extension("old.log"));
    }
}

/// What the About tab shows.
#[derive(Debug, Clone, Serialize)]
#[cfg_attr(test, derive(TS))]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, ts(export))]
pub struct AppInfo {
    pub version: String,
    /// Modification time of the executable, as a stand-in for the build date.
    #[cfg_attr(test, ts(type = "number | null"))]
    pub built_at: Option<i64>,
    pub app_dir: String,
    pub crash_logs: Vec<String>,
    pub diagnostics_log: String,
}

pub fn app_info() -> AppInfo {
    let dir = crate::config::app_dir();
    let built_at = std::env::current_exe()
        .and_then(std::fs::metadata)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_secs() as i64);
    AppInfo {
        version: env!("CARGO_PKG_VERSION").to_string(),
        built_at,
        app_dir: dir.to_string_lossy().to_string(),
        crash_logs: crash_logs_in(&dir),
        diagnostics_log: log_path().to_string_lossy().to_string(),
    }
}

fn crash_logs_in(dir: &Path) -> Vec<String> {
    let mut logs: Vec<String> = std::fs::read_dir(dir)
        .map(|it| {
            it.filter_map(|e| e.ok())
                .map(|e| e.path())
                .filter(|p| p.file_name().and_then(|n| n.to_str()).is_some_and(|n| n.starts_with("crash") && n.ends_with(".log")))
                .map(|p| p.to_string_lossy().to_string())
                .collect()
        })
        .unwrap_or_default();
    logs.sort();
    logs.reverse();
    logs
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_line_names_duration_outcome_command_and_folder() {
        let l = format_line(1700, "git", &["fetch".into(), "--prune".into()], Some(Path::new("C:/r")), Duration::from_millis(42), "0");
        assert_eq!(l, "1700     42ms 0        git fetch --prune [C:/r]\n");
    }

    #[test]
    fn credentials_in_urls_are_masked_and_messages_shortened() {
        let args: Vec<String> = [
            "push", "https://dev:ghp_secret123@github.com/o/r.git", "x", "commit", "-m",
            "A long commit message that tells a lot about the change\nwith a body", "--message=short",
        ]
        .iter()
        .map(|s| s.to_string())
        .collect();
        let l = format_line(1, "git", &args, None, Duration::from_millis(1), "0");
        assert!(!l.contains("ghp_secret123") && !l.contains("dev:"), "{l}");
        assert!(l.contains("https://***@github.com/o/r.git"), "{l}");
        assert!(l.contains("-m A long commit message th… (67 chars)"), "{l}");
        assert!(l.contains("--message=short"), "{l}");
        assert_eq!(l.lines().count(), 1);
        assert_eq!(mask_credentials("https://dev.azure.com/o/p/_git/r"), "https://dev.azure.com/o/p/_git/r");
        assert_eq!(mask_credentials("url=https://u@h/x and http://a:b@c"), "url=https://***@h/x and http://***@c");
    }

    #[test]
    fn records_append_and_rotate() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join(LOG);
        let mut cmd = std::process::Command::new("git");
        cmd.arg("status").current_dir(dir.path());
        append(&path, &[run_line(&Run::of(&cmd), Duration::from_millis(3), "0")]);
        write(path.clone(), vec![run_line(&Run::of(&cmd), Duration::from_millis(4), "1")]);
        flush();
        let text = std::fs::read_to_string(&path).unwrap();
        assert_eq!(text.lines().count(), 2);
        assert!(text.contains("git status"));
        std::fs::write(&path, vec![b'x'; (MAX_BYTES + 1) as usize]).unwrap();
        append(&path, &[run_line(&Run::of(&cmd), Duration::from_millis(5), "0")]);
        assert!(path.with_extension("old.log").exists());
        assert_eq!(std::fs::read_to_string(&path).unwrap().lines().count(), 1);
    }

    #[test]
    fn notes_land_one_per_line_and_stay_on_their_line() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join(LOG);
        append(&path, &note_lines(&["activity 12ms ok Status [C:/r]".into(), "two\nlines".into()]));
        let text = std::fs::read_to_string(&path).unwrap();
        assert_eq!(text.lines().count(), 2);
        assert!(text.lines().next().unwrap().ends_with("activity 12ms ok Status [C:/r]"));
        assert!(text.lines().nth(1).unwrap().ends_with("two lines"));
    }

    // Never switched on in tests: it would write into the real app folder.
    #[test]
    fn switch_defaults_to_off() {
        assert!(!enabled());
    }

    #[test]
    fn lists_crash_logs_newest_first() {
        let dir = tempfile::tempdir().unwrap();
        for n in ["crash-1.log", "crash-2.log", "other.log"] {
            std::fs::write(dir.path().join(n), "x").unwrap();
        }
        let logs = crash_logs_in(dir.path());
        assert_eq!(logs.len(), 2);
        assert!(logs[0].ends_with("crash-2.log"));
    }
}
