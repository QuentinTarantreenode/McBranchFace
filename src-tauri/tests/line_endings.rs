//! The tests run without the machine's git config (src/test_env.rs). Many Windows machines convert
//! line endings (core.autocrlf=true): these repos turn it on themselves, and partial staging,
//! unstaging and discarding must still change exactly the chosen lines, in the file's own endings.
mod common;

use common::*;
use mcbranchface_lib::git::runner::Git;
use mcbranchface_lib::gitops::{diff, ops};
use mcbranchface_lib::model::*;

#[test]
fn the_machine_git_config_does_not_reach_the_tests() {
    let dir = tempfile::tempdir().unwrap();
    git(dir.path(), &["init", "-q"]);
    assert_eq!(git(dir.path(), &["config", "--get", "core.autocrlf"]), "false");
    assert_eq!(git(dir.path(), &["symbolic-ref", "--short", "HEAD"]), "main");
    let origin = git(dir.path(), &["config", "--show-origin", "--get", "user.email"]);
    assert!(origin.contains("tests/fixtures/gitconfig"), "{origin}");
}

/// Twelve committed lines, checked out as Windows does with autocrlf, then two edits far apart.
fn crlf_two_hunks(f: &Fixture) -> Git {
    git(&f.work, &["config", "core.autocrlf", "true"]);
    let body: String = (1..=12).map(|i| format!("line {i}\n")).collect();
    commit(&f.work, "list.txt", &body, "twelve lines");
    std::fs::remove_file(f.work.join("list.txt")).unwrap();
    git(&f.work, &["checkout", "--", "list.txt"]);
    assert!(std::fs::read_to_string(f.work.join("list.txt")).unwrap().contains("line 1\r\n"), "the checkout converted the endings");
    let edited = body.replace("line 2\n", "line two\n").replace("line 11\n", "line eleven\nline 11b\n").replace('\n', "\r\n");
    std::fs::write(f.work.join("list.txt"), edited).unwrap();
    Git::new(&f.work)
}

async fn file_diff(g: &Git, source: DiffSource) -> FileDiff {
    diff::working_diff(g, "list.txt", source, &DiffOptions::default(), None).await.unwrap()
}

fn pick(d: &FileDiff, hunk: usize, lines: Option<Vec<u32>>) -> HunkPick {
    HunkPick { hunk: hunk as u32, header: d.hunks[hunk].header.clone(), lines }
}

/// The staged file as stored: the index keeps LF whatever the working tree has.
fn index_bytes(f: &Fixture) -> String {
    let out = std::process::Command::new("git").args(["show", ":list.txt"]).current_dir(&f.work).output().unwrap();
    assert!(out.status.success());
    String::from_utf8(out.stdout).unwrap()
}

/// Every line of the working file ends with CRLF: no line was rewritten with other endings.
fn work_text(f: &Fixture) -> String {
    let text = std::fs::read_to_string(f.work.join("list.txt")).unwrap();
    assert!(!text.replace("\r\n", "").contains('\n'), "mixed line endings: {text:?}");
    text
}

#[tokio::test]
async fn stages_one_hunk_of_a_crlf_file() {
    let f = Fixture::new();
    let g = crlf_two_hunks(&f);
    let d = file_diff(&g, DiffSource::Unstaged).await;
    assert_eq!(d.hunks.len(), 2, "endings alone make no change: {:?}", d.hunks.iter().map(|h| &h.header).collect::<Vec<_>>());
    let backups = f.data.join("backups");
    ops::apply_selection(&g, "list.txt", DiffSource::Unstaged, 3, &[pick(&d, 0, None)], ApplyAction::Stage, &backups).await.unwrap();
    let staged = index_bytes(&f);
    assert!(staged.contains("line two\n") && !staged.contains("line eleven"), "{staged:?}");
    assert!(!staged.contains('\r'), "the index stays LF: {staged:?}");
    assert_eq!(file_diff(&g, DiffSource::Unstaged).await.hunks.len(), 1, "the second hunk is still unstaged");
    work_text(&f);
}

#[tokio::test]
async fn stages_a_single_line_of_a_crlf_file() {
    let f = Fixture::new();
    let g = crlf_two_hunks(&f);
    let d = file_diff(&g, DiffSource::Unstaged).await;
    let only = d.hunks[1].lines.iter().position(|l| l.text == "line 11b").unwrap() as u32;
    let backups = f.data.join("backups");
    ops::apply_selection(&g, "list.txt", DiffSource::Unstaged, 3, &[pick(&d, 1, Some(vec![only]))], ApplyAction::Stage, &backups).await.unwrap();
    let staged = index_bytes(&f);
    assert!(staged.contains("line 11\nline 11b\nline 12\n"), "{staged:?}");
    assert!(!staged.contains("line eleven") && !staged.contains('\r'), "{staged:?}");
}

#[tokio::test]
async fn unstages_part_of_a_crlf_file() {
    let f = Fixture::new();
    let g = crlf_two_hunks(&f);
    git(&f.work, &["add", "list.txt"]);
    let d = file_diff(&g, DiffSource::Staged).await;
    let backups = f.data.join("backups");
    ops::apply_selection(&g, "list.txt", DiffSource::Staged, 3, &[pick(&d, 0, None)], ApplyAction::Unstage, &backups).await.unwrap();
    let staged = index_bytes(&f);
    assert!(staged.contains("line 2\n") && staged.contains("line eleven\n") && !staged.contains('\r'), "{staged:?}");
    assert!(work_text(&f).contains("line two\r\n"), "the working tree is untouched");
}

#[tokio::test]
async fn discards_part_of_a_crlf_file_and_keeps_its_endings() {
    let f = Fixture::new();
    let g = crlf_two_hunks(&f);
    let d = file_diff(&g, DiffSource::Unstaged).await;
    let backups = f.data.join("backups");
    let r = ops::apply_selection(&g, "list.txt", DiffSource::Unstaged, 3, &[pick(&d, 0, None)], ApplyAction::Discard, &backups).await.unwrap();
    let work = work_text(&f);
    assert!(work.contains("line 2\r\n") && work.contains("line eleven\r\nline 11b\r\n"), "{work:?}");
    let backup = std::fs::read(std::path::PathBuf::from(r.backup_dir.unwrap()).join("list.txt")).unwrap();
    assert!(String::from_utf8(backup).unwrap().contains("line two\r\n"), "the backup is the file byte for byte");
}
