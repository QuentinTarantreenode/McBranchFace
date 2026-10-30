//! Everything that lives in the app data folder, run against a private folder: config, crash log,
//! diagnostics. One test function, because the folder is process-wide state.
use std::sync::Arc;
use std::time::Duration;

use mcbranchface_lib::config::{self, Config, StartupIssue};
use mcbranchface_lib::{diagnostics, process};

#[tokio::test]
async fn app_data_folder() {
    let tmp = tempfile::tempdir().unwrap();
    let dir = tmp.path().join("data");
    std::env::set_var("MCBRANCHFACE_DATA_DIR", &dir);
    assert_eq!(config::app_dir(), dir);

    // Config: first start without a file, then a round trip.
    let (c, issue) = config::load();
    assert!(issue.is_none());
    assert_eq!(c.roots, Vec::<String>::new());
    assert!(config::check_app_dir().is_none(), "creates and writes the folder");
    let saved = Config { roots: vec!["C:/ws".into()], server_check_minutes: 7, ..Config::default() };
    config::save(&saved).unwrap();
    assert_eq!(config::load().0.server_check_minutes, 7);

    // Crash log: a panic leaves one line, the next start reports it once.
    config::install_crash_log();
    let _ = std::thread::spawn(|| panic!("index out of bounds")).join();
    let _ = std::panic::take_hook();
    let Some(StartupIssue::LastCrash { message, log: kept }) = config::take_crash_report() else { panic!("no crash report") };
    assert!(message.starts_with("index out of bounds"), "{message}");
    assert!(config::take_crash_report().is_none());

    // Diagnostics: off by default, then one line per command with its outcome.
    assert!(!diagnostics::enabled());
    process::run("git", ["--version"], None, &[], Duration::from_secs(20)).await.unwrap();
    assert!(!diagnostics::log_path().exists(), "nothing is written while off");
    diagnostics::set(true);
    process::run("git", ["--version"], Some(tmp.path()), &[], Duration::from_secs(20)).await.unwrap();
    let missing = process::run("no-such-program-mbf", ["x"], None, &[], Duration::from_secs(5)).await;
    assert!(matches!(missing, Err(process::ProcError::NotFound(_))));
    let cancel = Arc::new(tokio::sync::Notify::new());
    process::run_streaming("git", ["--version"], None, &[], Duration::from_secs(20), cancel, |_| {}).await.unwrap();
    // A run whose future is dropped (a cancelled scan) still leaves its line.
    let (program, args) = if cfg!(windows) { ("ping", vec!["-n", "30", "127.0.0.1"]) } else { ("sleep", vec!["30"]) };
    tokio::select! {
        _ = process::run(program, args, None, &[], Duration::from_secs(60)) => panic!("ran to its end"),
        _ = tokio::time::sleep(Duration::from_millis(300)) => {}
    }
    diagnostics::set(false);
    let log = std::fs::read_to_string(diagnostics::log_path()).unwrap();
    let lines: Vec<&str> = log.lines().collect();
    assert_eq!(lines.len(), 4, "{log}");
    assert!(lines[0].contains(" 0 ") && lines[0].contains("git --version"));
    assert!(lines[1].contains("missing"));
    assert!(lines[3].contains("cancel") && lines[3].contains(program), "{log}");

    // About: version, folder, the kept crash log.
    let info = diagnostics::app_info();
    assert_eq!(info.version, env!("CARGO_PKG_VERSION"));
    assert_eq!(info.crash_logs, vec![kept]);
    assert!(info.built_at.is_some());

    // A folder that cannot be written is reported, the app keeps working with defaults.
    std::fs::remove_dir_all(&dir).unwrap();
    std::fs::write(&dir, "not a folder").unwrap();
    assert!(matches!(config::check_app_dir(), Some(StartupIssue::AppDirReadOnly { .. })));
    assert!(config::save(&saved).is_err());
    std::env::remove_var("MCBRANCHFACE_DATA_DIR");
}

