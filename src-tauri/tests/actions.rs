//! Restore, adopt, purge and checkout: every refusal is explained, nothing is restored half way.
mod common;

use common::*;
use mcbranchface_lib::actions::{self, Env};
use mcbranchface_lib::git::runner::Git;
use mcbranchface_lib::gitops::copies;
use mcbranchface_lib::config::Config;
use mcbranchface_lib::delete;
use mcbranchface_lib::journal::Journal;
use mcbranchface_lib::model::*;

fn code(e: anyhow::Error) -> ErrorCode {
    e.downcast::<AppError>().expect("an AppError").code
}

/// A gone branch deleted with force, so its journal entry carries a backup ref.
async fn deleted(f: &Fixture, name: &str) -> DeletedEntry {
    f.pushed_branch(name, 1);
    f.delete_remote(name);
    let r = f.scan(true).await;
    let (config, store, journal) = (f.config(), f.store(), f.journal());
    let env = Env { config: &config, snapshots: &store, journal: &journal, cached_prs: None };
    let req = DeleteRequest {
        repo_path: f.work.to_string_lossy().into(),
        branch: name.into(),
        expected_sha: find(&r, name).sha.clone(),
        force: true,
        drop_stashes: vec![],
        remove_worktree: false,
    };
    delete::delete(&env, &req).await.expect("delete").entry
}

#[tokio::test]
async fn restore_refuses_a_taken_name_and_a_missing_folder() {
    let f = Fixture::new();
    let e = deleted(&f, "feature/a").await;
    git(&f.work, &["branch", "feature/a", "main"]);
    assert_eq!(code(actions::restore(&f.journal(), &e.id).await.unwrap_err()), ErrorCode::BranchExists);
    assert!(f.journal().load().unwrap()[0].restored_at.is_none(), "a refused restore is not marked done");
    git(&f.work, &["branch", "-D", "feature/a"]);
    actions::restore(&f.journal(), &e.id).await.expect("restore");
    assert_eq!(git(&f.work, &["config", "branch.feature/a.remote"]), "origin");

    let unknown = actions::restore(&f.journal(), "no-such-id").await.unwrap_err();
    assert_eq!(code(unknown), ErrorCode::EntryNotFound);

    let e2 = deleted(&f, "feature/b").await;
    let moved = f.work.with_file_name("moved");
    std::fs::rename(&f.work, &moved).unwrap();
    assert_eq!(code(actions::restore(&f.journal(), &e2.id).await.unwrap_err()), ErrorCode::PathMissing);
}

fn online_entry(f: &Fixture, branch: &str, backup: &str) -> DeletedEntry {
    let sha = git(&f.work, &["rev-parse", "HEAD"]);
    DeletedEntry {
        id: format!("online-{branch}"),
        verdict: Verdict::Safe,
        remote: Some("origin".into()),
        ..DeletedEntry::new(&f.work.to_string_lossy(), branch, branch, &sha, backup, 1)
    }
}

#[tokio::test]
async fn online_restore_refuses_a_recreated_branch_and_reports_server_errors() {
    let f = Fixture::new();
    let journal = f.journal();
    git(&f.work, &["update-ref", "refs/mcbranchface/remote-backup/1/origin/x", "HEAD"]);

    // Someone pushed the name again in the meantime.
    f.pushed_branch("taken", 1);
    journal.append(&online_entry(&f, "taken", "refs/mcbranchface/remote-backup/1/origin/x")).unwrap();
    assert_eq!(code(actions::restore(&journal, "online-taken").await.unwrap_err()), ErrorCode::BranchExists);

    // The backup ref is gone: the push fails and the entry stays open.
    journal.append(&online_entry(&f, "lost", "refs/mcbranchface/remote-backup/9/origin/lost")).unwrap();
    assert!(actions::restore(&journal, "online-lost").await.is_err());
    assert!(journal.load().unwrap().iter().all(|e| e.restored_at.is_none()));

    // The server cannot be reached at all.
    let url = git(&f.work, &["remote", "get-url", "origin"]);
    git(&f.work, &["remote", "set-url", "origin", f.work.join("no-such-server").to_str().unwrap()]);
    journal.append(&online_entry(&f, "x", "refs/mcbranchface/remote-backup/1/origin/x")).unwrap();
    assert!(actions::restore(&journal, "online-x").await.is_err());
    git(&f.work, &["remote", "set-url", "origin", &url]);
    actions::restore(&journal, "online-x").await.expect("restore once reachable");
}

#[tokio::test]
async fn adopt_finds_local_and_server_backups_and_skips_missing_folders() {
    let f = Fixture::new();
    git(&f.work, &["update-ref", "refs/mcbranchface/backup/1700/feature/lost", "HEAD"]);
    git(&f.work, &["update-ref", "refs/mcbranchface/backup/not-a-time/x", "HEAD"]);
    let journal = f.journal();
    let repos = [f.work.to_string_lossy().to_string(), f.work.join("gone").to_string_lossy().to_string()];
    assert_eq!(actions::adopt_orphans(&journal, &repos).await.unwrap(), 1);
    let e = &journal.load().unwrap()[0];
    assert_eq!((e.branch.as_str(), e.deleted_at, e.remote.as_deref()), ("feature/lost", 1700, None));
    actions::restore(&journal, &e.id).await.expect("adopted entries restore like any other");
}

#[tokio::test]
async fn a_stash_dropped_in_the_git_view_is_journalled_restored_and_purged() {
    let f = Fixture::new();
    std::fs::write(f.work.join("readme.txt"), "work in progress\n").unwrap();
    git(&f.work, &["stash", "push", "-q", "-m", "half done"]);
    let sha = git(&f.work, &["rev-parse", "stash@{0}"]);
    let g = mcbranchface_lib::git::runner::Git::new(&f.work);
    let done = mcbranchface_lib::gitops::ops::stash_drop(&g, &sha).await.unwrap();
    let backup = done.summary.expect("the backup ref");
    let journal = f.journal();
    let repo = f.work.to_string_lossy().to_string();
    actions::journal_stash_drop(&journal, &repo, &backup).await.unwrap();
    let e = journal.load().unwrap().remove(0);
    assert_eq!((e.branch.as_str(), e.sha.as_str(), e.dropped_stashes.len()), ("", sha.as_str(), 1));
    assert!(e.dropped_stashes[0].message.contains("half done"), "{:?}", e.dropped_stashes);
    assert_eq!(actions::adopt_orphans(&journal, std::slice::from_ref(&repo)).await.unwrap(), 0, "known, not adopted again");

    actions::restore(&journal, &e.id).await.expect("the stash comes back");
    assert_eq!(git(&f.work, &["rev-parse", "stash@{0}"]), sha);
    assert!(git(&f.work, &["branch", "--list"]).lines().all(|l| !l.trim().is_empty()), "no branch was made");
    assert_eq!(actions::purge(&journal, &[e.id]).await.unwrap(), 1);
    assert!(git(&f.work, &["for-each-ref", "refs/mcbranchface"]).is_empty());
}

#[tokio::test]
async fn an_orphaned_stash_backup_is_adopted_and_a_remote_name_with_a_slash_is_kept_whole() {
    let f = Fixture::new();
    std::fs::write(f.work.join("readme.txt"), "lost work\n").unwrap();
    git(&f.work, &["stash", "push", "-q", "-m", "lost"]);
    let sha = git(&f.work, &["rev-parse", "stash@{0}"]);
    git(&f.work, &["update-ref", &format!("refs/mcbranchface/stash/1800/dropped/{}", &sha[..12]), &sha]);
    git(&f.work, &["stash", "drop", "-q"]);
    let url = git(&f.work, &["remote", "get-url", "origin"]);
    git(&f.work, &["remote", "add", "team/up", &url]);
    git(&f.work, &["update-ref", "refs/mcbranchface/remote-backup/1900/team/up/feature/y", "HEAD"]);
    let journal = f.journal();
    assert_eq!(actions::adopt_orphans(&journal, &[f.work.to_string_lossy().to_string()]).await.unwrap(), 2);
    let entries = journal.load().unwrap();
    let stash = entries.iter().find(|e| e.deleted_at == 1800).unwrap();
    assert_eq!((stash.branch.as_str(), stash.dropped_stashes.len()), ("", 1));
    let remote = entries.iter().find(|e| e.deleted_at == 1900).unwrap();
    assert_eq!((remote.remote.as_deref(), remote.branch.as_str()), (Some("team/up"), "feature/y"));
    actions::restore(&journal, &stash.id).await.unwrap();
    assert_eq!(git(&f.work, &["rev-parse", "stash@{0}"]), sha);
}

#[tokio::test]
async fn purge_removes_stash_backups_and_tolerates_a_missing_folder() {
    let f = Fixture::new();
    let journal = Journal::new(f.data.join("deleted.jsonl"));
    git(&f.work, &["update-ref", "refs/mcbranchface/backup/1/x", "HEAD"]);
    git(&f.work, &["update-ref", "refs/mcbranchface/stash/1/s", "HEAD"]);
    let mut e = online_entry(&f, "x", "refs/mcbranchface/backup/1/x");
    e.remote = None;
    e.dropped_stashes = vec![DroppedStash { sha: "s".into(), message: "m".into(), backup_ref: "refs/mcbranchface/stash/1/s".into() }];
    let mut far = e.clone();
    far.id = "far".into();
    far.repo_path = f.work.join("gone").to_string_lossy().into();
    journal.append(&e).unwrap();
    journal.append(&far).unwrap();
    assert_eq!(actions::purge(&journal, &[e.id.clone(), far.id.clone()]).await.unwrap(), 2);
    assert!(git(&f.work, &["for-each-ref", "refs/mcbranchface"]).is_empty());
    assert!(journal.load().unwrap().is_empty());
}

#[tokio::test]
async fn checkout_default_switches_tracks_or_explains_why_not() {
    let f = Fixture::new();
    let repo = f.work.to_string_lossy().to_string();
    let config = f.config();
    git(&f.work, &["switch", "-q", "-c", "topic"]);

    // Tracked changes stop it; untracked files do not count.
    std::fs::write(f.work.join("readme.txt"), "changed\n").unwrap();
    assert_eq!(code(actions::checkout_default(&config, &repo).await.unwrap_err()), ErrorCode::WorkingTreeDirty);
    git(&f.work, &["checkout", "--", "readme.txt"]);

    assert_eq!(actions::checkout_default(&config, &repo).await.unwrap(), "main");
    assert_eq!(git(&f.work, &["branch", "--show-current"]), "main");

    // Without a local main it is created from origin/main.
    git(&f.work, &["switch", "-q", "topic"]);
    git(&f.work, &["branch", "-D", "main"]);
    assert_eq!(actions::checkout_default(&config, &repo).await.unwrap(), "main");
    assert_eq!(git(&f.work, &["rev-parse", "--abbrev-ref", "main@{u}"]), "origin/main");

    // An untracked file that main would overwrite: git refuses, and says why.
    git(&f.work, &["switch", "-q", "topic"]);
    f.on_server(|s| commit(s, "new.txt", "server\n", "adds new.txt"));
    git(&f.work, &["fetch", "-q"]);
    git(&f.work, &["branch", "-f", "main", "origin/main"]);
    std::fs::write(f.work.join("new.txt"), "local\n").unwrap();
    assert_eq!(code(actions::checkout_default(&config, &repo).await.unwrap_err()), ErrorCode::Other);
    std::fs::remove_file(f.work.join("new.txt")).unwrap();

    // No default branch anywhere.
    git(&f.work, &["remote", "set-head", "origin", "-d"]);
    let none = Config { default_branch_candidates: vec!["nope".into()], ..f.config() };
    assert_eq!(code(actions::checkout_default(&none, &repo).await.unwrap_err()), ErrorCode::NoDefaultBranch);
}

/// A local entry for `branch` whose backup ref and stash backups exist; the stashes as a delete
/// records them, newest first.
fn local_entry_with_stashes(f: &Fixture, branch: &str) -> (DeletedEntry, Vec<String>) {
    git(&f.work, &["update-ref", &format!("refs/mcbranchface/backup/1/{branch}"), "HEAD"]);
    let mut dropped = Vec::new();
    for n in 1..=2 {
        std::fs::write(f.work.join("readme.txt"), format!("wip {n}\n")).unwrap();
        git(&f.work, &["stash", "push", "-q", "-m", &format!("wip {n}")]);
    }
    let order = git(&f.work, &["stash", "list", "--format=%s"]).lines().map(str::to_string).collect::<Vec<_>>();
    for (i, msg) in order.iter().enumerate() {
        let sha = git(&f.work, &["rev-parse", &format!("stash@{{{i}}}")]);
        let r = format!("refs/mcbranchface/stash/1/{branch}/{i}");
        git(&f.work, &["update-ref", &r, &sha]);
        dropped.push(DroppedStash { sha, message: msg.clone(), backup_ref: r });
    }
    git(&f.work, &["stash", "clear"]);
    let mut e = online_entry(f, branch, &format!("refs/mcbranchface/backup/1/{branch}"));
    e.id = format!("local-{branch}");
    e.remote = None;
    e.dropped_stashes = dropped;
    (e, order)
}

#[tokio::test]
async fn restored_stashes_come_back_in_their_old_order() {
    let f = Fixture::new();
    let journal = f.journal();
    let (e, order) = local_entry_with_stashes(&f, "feature/s");
    journal.append(&e).unwrap();
    actions::restore(&journal, &e.id).await.expect("restore");
    let now: Vec<String> = git(&f.work, &["stash", "list", "--format=%s"]).lines().map(str::to_string).collect();
    assert_eq!(now, order);
}

#[tokio::test]
async fn a_restore_that_stopped_half_way_can_be_retried() {
    let f = Fixture::new();
    let journal = f.journal();
    let (mut e, _) = local_entry_with_stashes(&f, "feature/h");
    // The second stash backup is missing: the branch is created, then `stash store` fails.
    let missing = e.dropped_stashes[1].backup_ref.clone();
    let sha = e.dropped_stashes[1].sha.clone();
    git(&f.work, &["update-ref", "-d", &missing]);
    e.dropped_stashes[1].sha = "0".repeat(40);
    journal.append(&e).unwrap();
    assert!(actions::restore(&journal, &e.id).await.is_err());
    assert!(!git(&f.work, &["rev-parse", "--verify", "refs/heads/feature/h"]).is_empty(), "the branch step went through");

    // Fixed up, the retry finishes: the branch it made itself is no obstacle, a stash is not stored twice.
    git(&f.work, &["update-ref", &missing, &sha]);
    let mut entries = journal.load().unwrap();
    entries[0].dropped_stashes[1].sha = sha;
    journal.replace_all(&entries).unwrap();
    actions::restore(&journal, &e.id).await.expect("retry");
    assert_eq!(git(&f.work, &["stash", "list"]).lines().count(), 2);

    // A branch of that name pointing elsewhere is still refused.
    let (other, _) = local_entry_with_stashes(&f, "feature/o");
    git(&f.work, &["commit", "-q", "--allow-empty", "-m", "moved on"]);
    git(&f.work, &["branch", "feature/o", "HEAD"]);
    journal.append(&other).unwrap();
    assert_eq!(code(actions::restore(&journal, &other.id).await.unwrap_err()), ErrorCode::BranchExists);
}

#[tokio::test]
async fn purge_keeps_an_entry_whose_backup_ref_could_not_be_removed() {
    let f = Fixture::new();
    let journal = Journal::new(f.data.join("deleted.jsonl"));
    let r = "refs/mcbranchface/backup/1/locked";
    git(&f.work, &["update-ref", r, "HEAD"]);
    // Another git process holds the ref: the delete fails.
    std::fs::write(f.work.join(".git").join(format!("{r}.lock")), "").unwrap();
    let mut e = online_entry(&f, "locked", r);
    e.remote = None;
    journal.append(&e).unwrap();
    assert_eq!(actions::purge(&journal, &[e.id.clone()]).await.unwrap(), 0);
    assert_eq!(journal.load().unwrap().len(), 1, "the entry stays, or its backup would come back as an orphan");
}

#[tokio::test]
async fn an_online_restore_whose_answer_was_lost_counts_as_done() {
    let f = Fixture::new();
    let journal = f.journal();
    f.pushed_branch("back", 1);
    let sha = git(&f.work, &["rev-parse", "back"]);
    git(&f.work, &["update-ref", "refs/mcbranchface/remote-backup/1/origin/back", &sha]);
    let mut e = online_entry(&f, "back", "refs/mcbranchface/remote-backup/1/origin/back");
    e.sha = sha;
    journal.append(&e).unwrap();
    // The push went through, its answer did not: the branch is on the server at the saved tip.
    actions::restore(&journal, &e.id).await.expect("already back counts as restored");
    assert!(journal.load().unwrap()[0].restored_at.is_some());
}

#[tokio::test]
async fn a_backup_whose_branch_still_points_there_is_no_orphan() {
    let f = Fixture::new();
    f.pushed_branch("feature/kept", 1);
    let sha = git(&f.work, &["rev-parse", "feature/kept"]);
    // Left by deletes that stopped before the branch went: long ago, and one under way right now.
    git(&f.work, &["update-ref", "refs/mcbranchface/backup/1700/feature/kept", &sha]);
    let fresh = format!("refs/mcbranchface/backup/{}/feature/kept", mcbranchface_lib::git::snapshot::now());
    git(&f.work, &["update-ref", &fresh, &sha]);
    let journal = f.journal();
    assert_eq!(actions::adopt_orphans(&journal, &[f.work.to_string_lossy().to_string()]).await.unwrap(), 0);
    assert!(journal.load().unwrap().is_empty());
    let left = git(&f.work, &["for-each-ref", "--format=%(refname)", "refs/mcbranchface"]);
    assert_eq!(left, fresh, "the old phantom is removed, a fresh one may belong to a delete under way");
}

#[tokio::test]
async fn a_backup_of_another_clone_under_the_same_name_is_adopted_there() {
    let f = Fixture::new();
    let base = f.work.parent().unwrap().to_path_buf();
    git(&base, &["clone", "-q", f.work.to_str().unwrap(), "other"]);
    let other = base.join("other");
    let name = "refs/mcbranchface/backup/1700/feature/lost";
    git(&f.work, &["update-ref", name, "HEAD"]);
    git(&other, &["update-ref", name, "HEAD"]);
    let journal = f.journal();
    let sha = git(&f.work, &["rev-parse", "HEAD"]);
    // The journal knows the backup of the first clone only.
    journal.append(&DeletedEntry::new(&f.work.to_string_lossy(), "feature/lost", "feature/lost", &sha, name, 1700)).unwrap();
    let repos = [f.work.to_string_lossy().to_string(), other.to_string_lossy().to_string()];
    assert_eq!(actions::adopt_orphans(&journal, &repos).await.unwrap(), 1);
    let entries = journal.load().unwrap();
    assert_eq!(entries.len(), 2);
    assert!(entries.iter().any(|e| e.repo_path == other.to_string_lossy()), "{entries:?}");
}

#[tokio::test]
async fn the_stash_backups_of_a_branch_delete_join_its_adopted_entry() {
    let f = Fixture::new();
    let journal = f.journal();
    let repo = f.work.to_string_lossy().to_string();
    std::fs::write(f.work.join("readme.txt"), "wip\n").unwrap();
    git(&f.work, &["stash", "push", "-q", "-m", "wip on lost"]);
    let stash = git(&f.work, &["rev-parse", "stash@{0}"]);
    git(&f.work, &["update-ref", "refs/mcbranchface/backup/1700/feature/lost", "HEAD"]);
    git(&f.work, &["update-ref", "refs/mcbranchface/stash/1700/feature/lost/0", &stash]);
    git(&f.work, &["stash", "drop", "-q"]);
    assert_eq!(actions::adopt_orphans(&journal, std::slice::from_ref(&repo)).await.unwrap(), 1);
    let e = journal.load().unwrap().remove(0);
    assert_eq!((e.branch.as_str(), e.dropped_stashes.len()), ("feature/lost", 1));
    actions::restore(&journal, &e.id).await.unwrap();
    assert_eq!(git(&f.work, &["rev-parse", "stash@{0}"]), stash);
    assert_eq!(actions::adopt_orphans(&journal, std::slice::from_ref(&repo)).await.unwrap(), 0, "known now, the stash backup too");
}

fn read(p: std::path::PathBuf) -> String {
    std::fs::read_to_string(p).unwrap().replace("\r\n", "\n")
}

#[tokio::test]
async fn a_removed_worktree_comes_back_as_it_was_and_purge_takes_its_backup() {
    let f = Fixture::new();
    let journal = f.journal();
    let wt = f.work.with_file_name("wt-back");
    git(&f.work, &["worktree", "add", "-q", "-b", "agent/back", wt.to_str().unwrap()]);
    commit(&wt, ".gitignore", ".env\n", "ignore the environment");
    std::fs::write(wt.join(".env"), "SECRET=1\n").unwrap();
    std::fs::write(wt.join("readme.txt"), "staged\n").unwrap();
    git(&wt, &["add", "readme.txt"]);
    std::fs::write(wt.join("readme.txt"), "staged\nand more\n").unwrap();
    std::fs::write(wt.join("new.txt"), "untracked\n").unwrap();
    let before = git(&wt, &["status", "--porcelain"]);
    let staged = git(&wt, &["diff", "--cached"]);
    copies::remove_worktree(&Git::new(&f.work), &wt.to_string_lossy(), true, &journal).await.unwrap();
    assert!(!wt.exists());
    assert!(actions::backups_size(&journal) > 0, "the moved folder counts");

    let e = journal.load().unwrap().remove(0);
    assert!(e.is_worktree_only(), "{e:?}");
    actions::restore(&journal, &e.id).await.expect("restore");
    assert_eq!(git(&wt, &["rev-parse", "--abbrev-ref", "HEAD"]), "agent/back");
    assert_eq!(git(&wt, &["status", "--porcelain"]), before, "staged, changed and new files as they were");
    assert_eq!(git(&wt, &["diff", "--cached"]), staged);
    assert_eq!(read(wt.join(".env")), "SECRET=1\n");
    assert!(git(&f.work, &["worktree", "list", "--porcelain"]).contains("wt-back"));
    assert_eq!(code(actions::restore(&journal, &e.id).await.unwrap_err()), ErrorCode::AlreadyRestored);

    // Purged after the restore: the backup folder goes, the worktree stays.
    let backup = std::path::PathBuf::from(e.files_backup.clone().unwrap());
    assert!(backup.join(copies::STAGED_PATCH).exists());
    assert_eq!(actions::purge(&journal, &[e.id]).await.unwrap(), 1);
    assert!(!backup.exists());
    assert!(wt.join(".env").exists());
}

#[tokio::test]
async fn purge_deletes_a_moved_worktree_with_a_nested_repository() {
    let f = Fixture::new();
    let journal = f.journal();
    let wt = f.work.with_file_name("wt-gone");
    git(&f.work, &["worktree", "add", "-q", "-b", "agent/gone", wt.to_str().unwrap()]);
    let nested = wt.join("nested");
    std::fs::create_dir_all(&nested).unwrap();
    git(&nested, &["init", "-q"]);
    commit(&nested, "n.txt", "n\n", "nested history");
    let r = copies::remove_worktree(&Git::new(&f.work), &wt.to_string_lossy(), true, &journal).await.unwrap();
    let moved = std::path::PathBuf::from(r.backup_dir.unwrap());
    assert!(moved.join("nested").join(".git").join("objects").is_dir());
    let e = journal.load().unwrap().remove(0);
    // git keeps its objects read-only: the purge must remove them all the same.
    assert_eq!(actions::purge(&journal, &[e.id]).await.unwrap(), 1);
    assert!(!moved.exists());
    assert!(journal.load().unwrap().is_empty());
    assert_eq!(actions::backups_size(&journal), 0);
}

#[tokio::test]
async fn a_journal_that_cannot_be_read_stops_restore_purge_and_adoption() {
    let f = Fixture::new();
    git(&f.work, &["update-ref", "refs/mcbranchface/backup/1700/feature/lost", "HEAD"]);
    // A folder where the journal file should be: present, but not readable as one.
    std::fs::create_dir_all(f.data.join("deleted.jsonl")).unwrap();
    let journal = f.journal();
    assert!(journal.load().is_err());
    assert!(actions::restore(&journal, "x").await.is_err());
    assert!(actions::purge(&journal, &["x".to_string()]).await.is_err());
    assert!(actions::adopt_orphans(&journal, &[f.work.to_string_lossy().to_string()]).await.is_err());
    assert!(f.data.join("deleted.jsonl").is_dir(), "nothing written over it");
}
