use std::ffi::{OsStr, OsString};
use std::path::Path;
use std::process::Stdio;
use std::sync::RwLock;
use std::time::Duration;

use tokio::process::Command;

static SEARCH_PATH: RwLock<Option<OsString>> = RwLock::new(None);

/// PATH for every program the app starts. A tool installed while the app runs is only in the
/// registry's PATH; writing the process environment while other threads start programs is a data
/// race, so the fresh value goes to each command instead.
pub fn set_search_path(path: String) {
    *SEARCH_PATH.write().unwrap_or_else(|p| p.into_inner()) = Some(path.into());
}

/// The refreshed PATH, if there is one; otherwise the process's own.
pub fn search_path() -> Option<OsString> {
    SEARCH_PATH.read().unwrap_or_else(|p| p.into_inner()).clone().or_else(|| std::env::var_os("PATH"))
}

/// A command that finds programs on the refreshed PATH.
pub fn command(program: impl AsRef<OsStr>) -> Command {
    let mut c = Command::new(program);
    if let Some(p) = SEARCH_PATH.read().unwrap_or_else(|p| p.into_inner()).as_ref() {
        c.env("PATH", p);
    }
    c
}

/// `command` for programs that are started and left running (terminals, GitHub Desktop).
pub fn std_command(program: impl AsRef<OsStr>) -> std::process::Command {
    let mut c = std::process::Command::new(program);
    if let Some(p) = SEARCH_PATH.read().unwrap_or_else(|p| p.into_inner()).as_ref() {
        c.env("PATH", p);
    }
    c
}

#[derive(Debug, Clone)]
pub struct ProcOutput {
    pub code: Option<i32>,
    pub stdout: String,
    pub stderr: String,
}

impl ProcOutput {
    pub fn success(&self) -> bool {
        self.code == Some(0)
    }

    pub fn error_text(&self) -> String {
        let text = if self.stderr.trim().is_empty() { &self.stdout } else { &self.stderr };
        text.trim().to_string()
    }
}

#[derive(Debug)]
pub enum ProcError {
    NotFound(String),
    Timeout(String),
    Cancelled,
    Io(String),
}

impl std::fmt::Display for ProcError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ProcError::NotFound(p) => write!(f, "'{p}' not found"),
            ProcError::Timeout(p) => write!(f, "'{p}' timed out"),
            ProcError::Cancelled => write!(f, "cancelled"),
            ProcError::Io(m) => write!(f, "{m}"),
        }
    }
}

impl std::error::Error for ProcError {}

/// A child whose output is read (`run`, `run_streaming`): no input, both streams piped, killed with its
/// handle, and without a console window.
fn captured<I, S>(program: &str, args: I, cwd: Option<&Path>, envs: &[(&str, &str)]) -> Command
where
    I: IntoIterator<Item = S>,
    S: AsRef<OsStr>,
{
    let mut cmd = command(program);
    cmd.args(args).stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped()).kill_on_drop(true);
    if let Some(dir) = cwd {
        cmd.current_dir(dir);
    }
    for (k, v) in envs {
        cmd.env(k, v);
    }
    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);
    cmd
}

/// Suppresses the console window that would otherwise flash for every child process of a GUI app.
#[cfg(windows)]
pub const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// A started child and everything it starts in turn. Killing only the child leaves its children
/// running on Windows (az.cmd → python, git → git-remote-https, a user's script), holding pipes and
/// files open. Dropped without `release`, the whole tree ends; that covers timeout, cancel and a
/// dropped future alike.
pub struct ProcessTree {
    #[cfg(windows)]
    job: Option<job::Job>,
}

impl ProcessTree {
    pub fn of(child: &tokio::process::Child) -> Self {
        #[cfg(windows)]
        {
            Self { job: child.raw_handle().and_then(|h| job::Job::for_process(h as _)) }
        }
        #[cfg(not(windows))]
        {
            let _ = child;
            Self {}
        }
    }

    /// The child ended by itself: what it left running on purpose (git's background maintenance)
    /// stays. Programs it started before the job existed are not in it; that window is a few
    /// microseconds after the spawn.
    pub fn release(self) {
        #[cfg(windows)]
        if let Some(j) = &self.job {
            j.release();
        }
    }
}

#[cfg(windows)]
mod job {
    use windows_sys::Win32::Foundation::{CloseHandle, HANDLE};
    use windows_sys::Win32::System::JobObjects::{
        AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation, SetInformationJobObject,
        JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JOB_OBJECT_LIMIT, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
    };

    pub struct Job(HANDLE);

    // The handle is only used for kernel calls, which are thread-safe.
    unsafe impl Send for Job {}
    unsafe impl Sync for Job {}

    impl Job {
        pub fn for_process(process: HANDLE) -> Option<Job> {
            // SAFETY: plain Win32 calls on handles owned here.
            let handle = unsafe { CreateJobObjectW(std::ptr::null(), std::ptr::null()) };
            if handle.is_null() {
                return None;
            }
            let job = Job(handle);
            // SAFETY: both handles are valid for the duration of the call.
            let assigned = job.set_limit(JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE) && unsafe { AssignProcessToJobObject(job.0, process) } != 0;
            assigned.then_some(job)
        }

        pub fn release(&self) {
            self.set_limit(0);
        }

        fn set_limit(&self, flags: JOB_OBJECT_LIMIT) -> bool {
            // SAFETY: an all-zero limit struct is valid; only the flags are set.
            let mut info: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = unsafe { std::mem::zeroed() };
            info.BasicLimitInformation.LimitFlags = flags;
            let size = std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32;
            // SAFETY: the pointer and size describe `info`, which outlives the call.
            unsafe { SetInformationJobObject(self.0, JobObjectExtendedLimitInformation, &info as *const _ as *const _, size) != 0 }
        }
    }

    impl Drop for Job {
        fn drop(&mut self) {
            // SAFETY: the handle was created by this value and is closed once.
            unsafe {
                CloseHandle(self.0);
            }
        }
    }
}

pub async fn run<I, S>(
    program: &str,
    args: I,
    cwd: Option<&Path>,
    envs: &[(&str, &str)],
    timeout: Duration,
) -> Result<ProcOutput, ProcError>
where
    I: IntoIterator<Item = S>,
    S: AsRef<OsStr>,
{
    let mut cmd = captured(program, args, cwd, envs);
    let watch = Watch::start(&cmd);
    let result = async {
        let child = spawn(&mut cmd, program)?;
        let tree = ProcessTree::of(&child);
        match tokio::time::timeout(timeout, child.wait_with_output()).await {
            Err(_) => Err(ProcError::Timeout(program.to_string())),
            Ok(Err(e)) => Err(ProcError::Io(format!("{program}: {e}"))),
            Ok(Ok(out)) => {
                tree.release();
                Ok(ProcOutput {
                    code: out.status.code(),
                    stdout: String::from_utf8_lossy(&out.stdout).into_owned(),
                    stderr: String::from_utf8_lossy(&out.stderr).into_owned(),
                })
            }
        }
    }
    .await;
    watch.end(&outcome(&result));
    result
}

/// A run as the activity display and the diagnostics log see it. Its end is reported also when the
/// future is dropped midway: a cancelled scan, or a `select!` that went another way, ends the process
/// (kill on drop, the job object), and the display must not show it running forever.
struct Watch {
    trace: Option<(std::time::Instant, crate::diagnostics::Run)>,
    shown: Option<u64>,
    ended: bool,
}

static STARTED: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

/// How many programs `run` and `run_streaming` started in this process: what a scan costs is mostly
/// its process count, and the headless scan reports it per pass.
pub fn started() -> u64 {
    STARTED.load(std::sync::atomic::Ordering::Relaxed)
}

impl Watch {
    fn start(cmd: &Command) -> Self {
        STARTED.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        let std = cmd.as_std();
        let trace = crate::diagnostics::enabled().then(|| (std::time::Instant::now(), crate::diagnostics::Run::of(std)));
        Self { trace, shown: crate::activity::started(std), ended: false }
    }

    fn end(mut self, outcome: &str) {
        self.report(outcome);
    }

    fn report(&mut self, outcome: &str) {
        if std::mem::replace(&mut self.ended, true) {
            return;
        }
        if let Some((at, run)) = &self.trace {
            crate::diagnostics::record_run(run, at.elapsed(), outcome);
        }
        if self.shown.is_some() {
            crate::activity::ended(self.shown, outcome);
        }
    }
}

impl Drop for Watch {
    fn drop(&mut self) {
        self.report(DROPPED);
    }
}

/// The outcome of a run whose future was dropped: it was stopped from outside.
const DROPPED: &str = "cancel";

pub fn spawn(cmd: &mut Command, program: &str) -> Result<tokio::process::Child, ProcError> {
    cmd.spawn().map_err(|e| match e.kind() {
        std::io::ErrorKind::NotFound => ProcError::NotFound(program.to_string()),
        _ => ProcError::Io(format!("{program}: {e}")),
    })
}

fn outcome(r: &Result<ProcOutput, ProcError>) -> String {
    match r {
        Ok(o) => o.code.map_or("signal".to_string(), |c| c.to_string()),
        Err(ProcError::Timeout(_)) => "timeout".into(),
        Err(ProcError::Cancelled) => "cancel".into(),
        Err(ProcError::NotFound(_)) => "missing".into(),
        Err(ProcError::Io(_)) => "io".into(),
    }
}

/// Batch-file shims (az.cmd, github.bat) are not resolved by `Command::new` on Windows unless named explicitly.
pub fn shim_name(base: &str, windows_ext: &str) -> String {
    if cfg!(windows) {
        format!("{base}.{windows_ext}")
    } else {
        base.to_string()
    }
}

/// Like `run`, but delivers stderr line by line while the process runs (git writes progress there,
/// redrawing with `\r`), and stops the process when `cancel` is notified.
pub async fn run_streaming<I, S>(
    program: &str,
    args: I,
    cwd: Option<&Path>,
    envs: &[(&str, &str)],
    timeout: Duration,
    cancel: std::sync::Arc<tokio::sync::Notify>,
    mut on_line: impl FnMut(&str) + Send,
) -> Result<ProcOutput, ProcError>
where
    I: IntoIterator<Item = S>,
    S: AsRef<OsStr>,
{
    let mut cmd = captured(program, args, cwd, envs);
    let watch = Watch::start(&cmd);
    let result = stream(&mut cmd, program, timeout, cancel, &mut on_line).await;
    watch.end(&outcome(&result));
    result
}

async fn stream(
    cmd: &mut Command,
    program: &str,
    timeout: Duration,
    cancel: std::sync::Arc<tokio::sync::Notify>,
    on_line: &mut (impl FnMut(&str) + Send),
) -> Result<ProcOutput, ProcError> {
    use tokio::io::AsyncReadExt;

    let mut child = spawn(cmd, program)?;
    let tree = ProcessTree::of(&child);
    let mut stdout = child.stdout.take().expect("piped stdout");
    let mut stderr = child.stderr.take().expect("piped stderr");
    let mut out_task = tokio::spawn(async move {
        let mut v = Vec::new();
        let _ = stdout.read_to_end(&mut v).await;
        v
    });

    let deadline = tokio::time::sleep(timeout);
    tokio::pin!(deadline);
    let (mut all, mut line, mut buf) = (Vec::new(), Vec::new(), [0u8; 4096]);
    loop {
        tokio::select! {
            n = stderr.read(&mut buf) => match n {
                Ok(0) => break,
                Ok(n) => {
                    all.extend_from_slice(&buf[..n]);
                    for &b in &buf[..n] {
                        if b == b'\r' || b == b'\n' {
                            if !line.is_empty() {
                                on_line(&String::from_utf8_lossy(&line));
                                line.clear();
                            }
                        } else {
                            line.push(b);
                        }
                    }
                }
                Err(e) => return Err(ProcError::Io(format!("{program}: {e}"))),
            },
            _ = cancel.notified() => {
                let _ = child.kill().await;
                return Err(ProcError::Cancelled);
            }
            _ = &mut deadline => {
                let _ = child.kill().await;
                return Err(ProcError::Timeout(program.to_string()));
            }
        }
    }
    if !line.is_empty() {
        on_line(&String::from_utf8_lossy(&line));
    }
    // stderr closed, but the child may still run, and a program it started may hold stdout open:
    // the deadline and cancel apply until both are done.
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
    let stdout = tokio::select! {
        v = &mut out_task => v.unwrap_or_default(),
        _ = &mut deadline => {
            out_task.abort();
            return Err(ProcError::Timeout(program.to_string()));
        }
    };
    tree.release();
    Ok(ProcOutput {
        code: status.code(),
        stdout: String::from_utf8_lossy(&stdout).into_owned(),
        stderr: String::from_utf8_lossy(&all).into_owned(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_refreshed_path_goes_to_every_command_not_to_the_process() {
        // The real PATH plus a marker: other tests in this binary still find git.
        let marked = format!("{};C:\\mbf-path-marker", std::env::var("PATH").unwrap_or_default());
        let before = std::env::var_os("PATH");
        set_search_path(marked.clone());
        let path_of = |c: &std::process::Command| c.get_envs().find(|(k, _)| k.eq_ignore_ascii_case("PATH")).and_then(|(_, v)| v.map(|v| v.to_os_string()));
        assert_eq!(path_of(&std_command("x")), Some(marked.clone().into()));
        assert_eq!(path_of(command("x").as_std()), Some(marked.clone().into()));
        assert_eq!(search_path(), Some(marked.into()));
        assert_eq!(std::env::var_os("PATH"), before, "the process environment stays untouched");
    }
    use std::sync::Arc;
    use std::time::Instant;

    /// A long-running child must stop promptly when the user cancels.
    #[tokio::test]
    async fn streaming_run_can_be_cancelled() {
        let cancel = Arc::new(tokio::sync::Notify::new());
        let trigger = cancel.clone();
        tokio::spawn(async move {
            tokio::time::sleep(Duration::from_millis(300)).await;
            trigger.notify_one();
        });
        let (program, args): (&str, Vec<&str>) =
            if cfg!(windows) { ("ping", vec!["-n", "30", "127.0.0.1"]) } else { ("sleep", vec!["30"]) };
        let start = Instant::now();
        let mut lines = 0;
        let r = run_streaming(program, args, None, &[], Duration::from_secs(60), cancel, |_| lines += 1).await;
        assert!(matches!(r, Err(ProcError::Cancelled)), "{r:?}");
        assert!(start.elapsed() < Duration::from_secs(5), "took {:?}", start.elapsed());
    }

    #[tokio::test]
    async fn streaming_run_splits_carriage_return_progress() {
        let cancel = Arc::new(tokio::sync::Notify::new());
        let mut seen = Vec::new();
        // git's progress redraws one line with \r; each redraw must arrive as its own line.
        let o = run_streaming("git", ["-c", "core.pager=cat", "definitely-not-a-command"], None, &[("LC_ALL", "C")], Duration::from_secs(20), cancel, |l| seen.push(l.to_string()))
            .await
            .unwrap();
        assert!(!o.success());
        assert!(seen.iter().any(|l| l.contains("definitely-not-a-command")), "{seen:?}");
    }

    fn long() -> (&'static str, Vec<&'static str>) {
        if cfg!(windows) { ("ping", vec!["-n", "30", "127.0.0.1"]) } else { ("sleep", vec!["30"]) }
    }

    #[tokio::test]
    async fn both_runs_stop_at_their_timeout() {
        let (program, args) = long();
        let r = run(program, args.clone(), None, &[], Duration::from_millis(200)).await;
        assert!(matches!(r, Err(ProcError::Timeout(_))), "{r:?}");
        let cancel = Arc::new(tokio::sync::Notify::new());
        let r = run_streaming(program, args, None, &[], Duration::from_millis(200), cancel, |_| {}).await;
        assert!(matches!(r, Err(ProcError::Timeout(_))), "{r:?}");
    }

    /// cmd starts ping and waits for it, as az.cmd starts python: killing only cmd left ping running.
    #[cfg(windows)]
    #[tokio::test]
    async fn a_timeout_ends_the_programs_the_child_started_too() {
        let marker = "127.0.0.37";
        let running = || {
            let filter = format!("@(Get-CimInstance Win32_Process -Filter \"Name='PING.EXE'\" | Where-Object {{ $_.CommandLine -like '*{marker}*' }}).Count");
            let o = std::process::Command::new("powershell").args(["-NoProfile", "-NonInteractive", "-Command", &filter]).output().unwrap();
            String::from_utf8_lossy(&o.stdout).trim().parse::<u32>().unwrap()
        };
        let r = run("cmd", ["/d", "/c", "ping", "-n", "30", marker], None, &[], Duration::from_millis(800)).await;
        assert!(matches!(r, Err(ProcError::Timeout(_))), "{r:?}");
        tokio::time::sleep(Duration::from_millis(300)).await;
        assert_eq!(running(), 0, "the grandchild was ended with the child");

        let cancel = Arc::new(tokio::sync::Notify::new());
        let trigger = cancel.clone();
        tokio::spawn(async move {
            tokio::time::sleep(Duration::from_millis(800)).await;
            trigger.notify_one();
        });
        let r = run_streaming("cmd", ["/d", "/c", "ping", "-n", "30", marker], None, &[], Duration::from_secs(60), cancel, |_| {}).await;
        assert!(matches!(r, Err(ProcError::Cancelled)), "{r:?}");
        tokio::time::sleep(Duration::from_millis(300)).await;
        assert_eq!(running(), 0, "also on cancel");
    }

    #[tokio::test]
    async fn a_missing_program_is_named() {
        let cancel = Arc::new(tokio::sync::Notify::new());
        let r = run_streaming("no-such-program-mbf", ["x"], None, &[], Duration::from_secs(5), cancel, |_| {}).await;
        assert!(matches!(r, Err(ProcError::NotFound(ref p)) if p == "no-such-program-mbf"));
    }

    #[test]
    fn errors_and_outcomes_have_words() {
        let all = [ProcError::NotFound("git".into()), ProcError::Timeout("git".into()), ProcError::Cancelled, ProcError::Io("disk".into())];
        let texts: Vec<String> = all.iter().map(|e| e.to_string()).collect();
        assert_eq!(texts, ["'git' not found", "'git' timed out", "cancelled", "disk"]);
        let outcomes: Vec<String> = all.into_iter().map(|e| outcome(&Err(e))).collect();
        assert_eq!(outcomes, ["missing", "timeout", "cancel", "io"]);
        assert_eq!(outcome(&Ok(ProcOutput { code: None, stdout: String::new(), stderr: String::new() })), "signal");
        assert_eq!(shim_name("az", "cmd"), if cfg!(windows) { "az.cmd" } else { "az" });
        let o = ProcOutput { code: Some(1), stdout: "out".into(), stderr: "  ".into() };
        assert_eq!(o.error_text(), "out");
    }
}
