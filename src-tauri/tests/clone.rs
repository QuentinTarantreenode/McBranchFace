//! Cloning a repository the user names into a folder the user chose, including the refusals.
mod common;

use std::sync::{Arc, Mutex};

use common::*;
use mcbranchface_lib::gitops::clone;
use mcbranchface_lib::model::*;
use tokio::sync::Notify;

fn url(f: &Fixture) -> String {
    f.server.parent().unwrap().join("origin.git").to_string_lossy().into_owned()
}

/// The same repository as a URL: git copies a plain local path without transferring objects, so only a URL
/// shows the progress of a real clone.
fn file_url(f: &Fixture) -> String {
    let path = url(f).replace('\\', "/");
    if path.starts_with('/') { format!("file://{path}") } else { format!("file:///{path}") }
}

async fn clone_to(url: &str, target: &std::path::Path) -> Result<OpResult, OpFailure> {
    clone::clone_repo(url, &target.to_string_lossy(), Arc::new(Notify::new()), |_, _| {}).await
}

#[tokio::test]
async fn a_repository_is_cloned_into_a_new_folder_with_progress() {
    let f = Fixture::new();
    f.pushed_branch("feature/a", 1);
    let target = f._tmp.path().join("nested").join("deeper").join("copy");
    let seen = Arc::new(Mutex::new(Vec::new()));
    let sink = seen.clone();
    let r = clone::clone_repo(&file_url(&f), &target.to_string_lossy(), Arc::new(Notify::new()), move |phase, pct| sink.lock().unwrap().push((phase, pct))).await.unwrap();
    assert_eq!(r.sha.as_deref(), Some(git(&target, &["rev-parse", "HEAD"]).as_str()));
    assert_eq!(git(&target, &["rev-parse", "--abbrev-ref", "HEAD"]), "main");
    assert!(git(&target, &["branch", "-r"]).contains("origin/feature/a"));
    assert!(target.join("readme.txt").is_file());
    assert!(!seen.lock().unwrap().is_empty(), "git's progress lines reach the caller");
}

#[tokio::test]
async fn an_empty_existing_folder_is_used_and_a_taken_one_is_refused() {
    let f = Fixture::new();
    let empty = f._tmp.path().join("empty");
    std::fs::create_dir(&empty).unwrap();
    clone_to(&url(&f), &empty).await.unwrap();
    assert!(empty.join(".git").exists());

    let e = clone_to(&url(&f), &empty).await.unwrap_err();
    assert_eq!(e.kind, FailureKind::AlreadyExists);
    assert!(empty.join(".git").exists(), "what was there stays");
}

#[tokio::test]
async fn bad_input_is_refused_before_git_runs() {
    let f = Fixture::new();
    let target = f._tmp.path().join("copy");
    for bad in ["", "   ", "--upload-pack=calc", "-u"] {
        let e = clone_to(bad, &target).await.unwrap_err();
        assert_eq!(e.kind, FailureKind::InvalidName, "{bad:?}");
        assert!(!target.exists());
    }
    let e = clone_to(&url(&f), std::path::Path::new("relative/copy")).await.unwrap_err();
    assert_eq!(e.kind, FailureKind::InvalidName);
}

#[tokio::test]
async fn a_failed_clone_leaves_no_folder_behind() {
    let f = Fixture::new();
    let target = f._tmp.path().join("copy");
    let missing = f._tmp.path().join("no-such-repo.git");
    let e = clone_to(&missing.to_string_lossy(), &target).await.unwrap_err();
    assert_eq!(e.op, GitOp::Clone);
    assert!(!e.detail.is_empty());
    assert!(!target.exists());
}

#[tokio::test]
async fn a_cancelled_clone_leaves_no_folder_behind() {
    let f = Fixture::new();
    let target = f._tmp.path().join("copy");
    let cancel = Arc::new(Notify::new());
    // The permit is stored: the clone sees the cancel as soon as it listens.
    cancel.notify_one();
    let e = clone::clone_repo(&url(&f), &target.to_string_lossy(), cancel, |_, _| {}).await.unwrap_err();
    assert_eq!(e.kind, FailureKind::Cancelled);
    assert!(!target.exists());
}
