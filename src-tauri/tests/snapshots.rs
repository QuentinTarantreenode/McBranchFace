//! The push history on disk: one file per repository, never lost to a broken file or a similar name.
mod common;

use std::path::Path;

use common::*;
use mcbranchface_lib::git::runner::Git;

fn files(dir: &Path) -> Vec<String> {
    let mut names: Vec<String> = std::fs::read_dir(dir).unwrap().flatten().map(|e| e.file_name().to_string_lossy().into_owned()).collect();
    names.sort();
    names
}

#[tokio::test]
async fn a_broken_snapshot_is_kept_aside_and_a_new_one_written() {
    let f = Fixture::new();
    f.pushed_branch("feature/a", 1);
    let store = f.store();
    let dir = f.data.join("snapshots");
    store.record(&Git::new(&f.work)).await.unwrap();
    let [name] = files(&dir).try_into().unwrap();
    std::fs::write(dir.join(&name), "{ \"refs\": { broken").unwrap();

    // The disk is read once per run: the next start finds the broken file.
    let store = f.store();
    let snap = store.record(&Git::new(&f.work)).await.unwrap();
    assert!(snap.refs.contains_key("refs/remotes/origin/feature/a"));
    let all = files(&dir);
    let aside = all.iter().find(|n| n.contains(".corrupt-")).unwrap_or_else(|| panic!("not kept: {all:?}"));
    assert_eq!(std::fs::read_to_string(dir.join(aside)).unwrap(), "{ \"refs\": { broken", "the broken record is untouched");
    assert!(store.load(&f.work).refs.contains_key("refs/remotes/origin/feature/a"));
}

#[tokio::test]
async fn two_folders_whose_names_differ_only_in_punctuation_keep_their_own_history() {
    let f = Fixture::new();
    let base = f.work.parent().unwrap();
    let origin = base.join("origin.git");
    git(base, &["clone", "-q", origin.to_str().unwrap(), "a-b"]);
    git(base, &["clone", "-q", origin.to_str().unwrap(), "a_b"]);
    f.pushed_branch("only-in-a-b", 1);
    git(&base.join("a-b"), &["fetch", "-q"]);
    let store = f.store();
    store.record(&Git::new(base.join("a-b"))).await.unwrap();
    let other = store.record(&Git::new(base.join("a_b"))).await.unwrap();
    assert!(!other.refs.contains_key("refs/remotes/origin/only-in-a-b"), "history of another folder");
    assert!(store.load(&base.join("a-b")).refs.contains_key("refs/remotes/origin/only-in-a-b"));
}

#[tokio::test]
async fn a_snapshot_under_the_old_file_name_is_read_and_carried_over() {
    let f = Fixture::new();
    let dir = f.data.join("snapshots");
    std::fs::create_dir_all(&dir).unwrap();
    let old: String = f.work.to_string_lossy().to_lowercase().chars().map(|c| if c.is_ascii_alphanumeric() { c } else { '_' }).collect();
    let pruned = r#"{"refs":{"refs/remotes/origin/pruned":{"sha":"abc","firstSeen":1,"lastSeen":9999999999}}}"#;
    std::fs::write(dir.join(format!("{old}.json")), pruned).unwrap();
    let store = f.store();
    assert!(store.load(&f.work).refs.contains_key("refs/remotes/origin/pruned"), "read from the old name");
    store.record(&Git::new(&f.work)).await.unwrap();
    let names = files(&dir);
    assert_eq!(names.len(), 1, "the old file is not kept beside the new one: {names:?}");
    assert!(store.load(&f.work).refs.contains_key("refs/remotes/origin/pruned"), "carried over to the new name");

    // An old file that cannot be read is the only trace of its history: it stays for the user.
    std::fs::write(dir.join(format!("{old}.json")), "{ broken").unwrap();
    store.record(&Git::new(&f.work)).await.unwrap();
    assert!(dir.join(format!("{old}.json")).exists());
}
