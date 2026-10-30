//! Golden files of what released versions wrote (tests/fixtures/compat): today's code must read every
//! one of them with the safety settings intact (locks, protected patterns, ignores) and restore what
//! their journals recorded. Each release adds its own pair, written from the samples below by
//! `write_current_shapes` (scripts/release.mjs runs it), so an old shape is never lost.
mod common;

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use common::*;
use mcbranchface_lib::actions;
use mcbranchface_lib::config::{self, Annotation, Config, Ignore, IgnoreScope, Lock, ObjectIdentity, RepoGroup, UiPrefs, WindowPrefs};
use mcbranchface_lib::custom::{CustomCommand, RunMode, Shell};
use mcbranchface_lib::journal::Journal;
use mcbranchface_lib::model::*;
use mcbranchface_lib::prompts::{PromptScope, PromptTemplate};

const SHOP: &str = "github.com/example/shop";
const PLATFORM: &str = "dev.azure.com/example/platform/_git/core";

/// Fields a released config had that today's code no longer knows. Removing one is a decision: list it
/// here, or the test fails because its value would only be carried along unread.
const DROPPED_FIELDS: &[&str] = &[];

fn fixtures() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/compat")
}

/// Fixture files of one kind, oldest version first.
fn released(prefix: &str, ext: &str) -> Vec<PathBuf> {
    let mut files: Vec<PathBuf> = std::fs::read_dir(fixtures())
        .unwrap()
        .flatten()
        .map(|e| e.path())
        .filter(|p| p.file_name().and_then(|n| n.to_str()).is_some_and(|n| n.starts_with(prefix) && n.ends_with(ext)))
        .collect();
    files.sort();
    assert!(!files.is_empty(), "no {prefix}*{ext} in {}", fixtures().display());
    files
}

fn sample_locks() -> Vec<Lock> {
    vec![Lock { identity: SHOP.into(), branch: Some("feature/payment".into()) }, Lock { identity: PLATFORM.into(), branch: None }]
}

fn sample_ignores() -> Vec<Ignore> {
    vec![
        Ignore { identity: SHOP.into(), branch: "spike/old-idea".into(), scope: IgnoreScope::Local, until: Some(1_893_456_000) },
        Ignore { identity: SHOP.into(), branch: "chore/cleanup".into(), scope: IgnoreScope::Both, until: None },
        Ignore { identity: PLATFORM.into(), branch: "experiment/cache".into(), scope: IgnoreScope::Online, until: None },
    ]
}

const EXTRA_PROTECTED: [&str; 2] = ["hotfix/*", "team/keep-*"];

/// A config as a user's would look after a while: every safety setting used, folders, notes, groups.
fn sample_config() -> Config {
    let mut protected = Config::default().protected_patterns;
    protected.extend(EXTRA_PROTECTED.map(String::from));
    Config {
        roots: vec!["C:/dev/workspace".into(), "D:/src".into()],
        scan_depth: 5,
        protected_patterns: protected,
        default_branch_overrides: BTreeMap::from([("C:/dev/workspace/platform".into(), "refs/remotes/origin/develop".into())]),
        my_emails: vec!["dev@example.com".into(), "dev@users.noreply.example.com".into()],
        concurrency: 8,
        locks: sample_locks(),
        stale_days: 45,
        online_excluded: vec!["dev.azure.com/example/platform/_git/monorepo".into()],
        ignores: sample_ignores(),
        annotations: BTreeMap::from([
            (SHOP.into(), Annotation { note: "Customer-facing shop".into(), tags: vec!["web".into()] }),
            (format!("{SHOP}::feature/payment"), Annotation { note: "Waits for the payment sandbox".into(), tags: vec!["blocked".into()] }),
        ]),
        window: WindowPrefs { close_to_tray: true, minimize_to_tray: true, ..WindowPrefs::default() },
        commands: vec![CustomCommand {
            id: "build".into(),
            name: "Build".into(),
            script: "npm run build".into(),
            shell: Shell::Pwsh,
            mode: RunMode::Background,
            repos: vec![SHOP.into()],
            branches: true,
            confirm: true,
        }],
        prompts: vec![PromptTemplate {
            id: "review".into(),
            name: "Review".into(),
            body: "Review {{branch}} against {{default}}.".into(),
            scope: PromptScope::Local,
            needs_own_commits: true,
            builtin: None,
        }],
        repo_groups: vec![RepoGroup { id: "g-shop".into(), name: "Shop".into(), paths: vec!["C:/dev/workspace/shop".into(), "C:/dev/workspace/shop-agent-1".into()] }],
        identities: BTreeMap::from([(format!("repo:{SHOP}"), ObjectIdentity { short: Some("SH".into()), color: Some("id-3".into()) })]),
        ui: UiPrefs { sidebar_collapsed: true, collapsed_roots: vec!["D:/src".into()], sidebar_width: 300, scale: 100, ..UiPrefs::default() },
        ..Config::default()
    }
}

const SHA_A: &str = "1111111111111111111111111111111111111111";
const SHA_B: &str = "2222222222222222222222222222222222222222";
const SHA_C: &str = "3333333333333333333333333333333333333333";
const SHA_D: &str = "4444444444444444444444444444444444444444";

/// What the journal holds after a while: a plain delete, one that dropped stashes and removed a
/// worktree, a stash dropped on its own, a branch deleted on the server and one already restored.
fn sample_journal() -> Vec<DeletedEntry> {
    let repo = "C:/dev/workspace/shop";
    let entry = |id: &str, branch: &str, sha: &str, backup: &str, ts: i64| DeletedEntry { id: id.into(), ..DeletedEntry::new(repo, branch, branch, sha, backup, ts) };
    let stash = |sha: &str, message: &str, ts: i64| DroppedStash { sha: sha.into(), message: message.into(), backup_ref: format!("refs/mcbranchface/stash/{ts}/dropped/{}", &sha[..12]) };
    vec![
        DeletedEntry {
            upstream_remote: Some("origin".into()),
            upstream_merge: Some("refs/heads/feature/payment-v1".into()),
            verdict: Verdict::Safe,
            ..entry("1760000000-1-feature/payment-v1", "feature/payment-v1", SHA_A, "refs/mcbranchface/backup/1760000000/feature/payment-v1", 1_760_000_000)
        },
        DeletedEntry {
            upstream_remote: Some("origin".into()),
            upstream_merge: Some("refs/heads/bugfix/login".into()),
            forced: true,
            verdict: Verdict::Unsafe,
            dropped_stashes: vec![stash(SHA_C, "On bugfix/login: half done", 1_760_000_100)],
            removed_worktree: Some("C:/dev/workspace/shop-bugfix".into()),
            ..entry("1760000100-2-bugfix/login", "bugfix/login", SHA_B, "refs/mcbranchface/backup/1760000100/bugfix/login", 1_760_000_100)
        },
        DeletedEntry {
            dropped_stashes: vec![stash(SHA_D, "On main: experiment", 1_760_000_200)],
            ..entry("1760000200-3-stash", "", SHA_D, &format!("refs/mcbranchface/stash/1760000200/dropped/{}", &SHA_D[..12]), 1_760_000_200)
        },
        DeletedEntry {
            remote: Some("origin".into()),
            ..entry("1760000300-4-feature/old-api", "feature/old-api", SHA_A, "refs/mcbranchface/remote-backup/1760000300/origin/feature/old-api", 1_760_000_300)
        },
        DeletedEntry {
            restored_at: Some(1_760_000_500),
            ..entry("1760000400-5-feature/back-again", "feature/back-again", SHA_A, "refs/mcbranchface/backup/1760000400/feature/back-again", 1_760_000_400)
        },
    ]
}

/// Writes the current shapes as the golden files of a release:
/// `MBF_COMPAT_VERSION=1.2.7 cargo test --test compat -- --ignored --exact write_current_shapes`.
#[test]
#[ignore = "writes fixtures; run by scripts/release.mjs"]
fn write_current_shapes() {
    let version = std::env::var("MBF_COMPAT_VERSION").expect("MBF_COMPAT_VERSION=<version>");
    let config = serde_json::to_string_pretty(&sample_config()).unwrap() + "\n";
    std::fs::write(fixtures().join(format!("config-{version}.json")), config).unwrap();
    let lines: String = sample_journal().iter().map(|e| serde_json::to_string(e).unwrap() + "\n").collect();
    std::fs::write(fixtures().join(format!("deleted-{version}.jsonl")), lines).unwrap();
}

#[test]
fn every_released_config_keeps_its_safety_settings() {
    for file in released("config-", ".json") {
        let name = file.file_name().unwrap().to_string_lossy().into_owned();
        // A file that cannot be read is moved aside by the loader: it works on a copy.
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("config.json");
        std::fs::copy(&file, &path).unwrap();
        let (c, issue) = config::load_from(&path);
        assert!(issue.is_none(), "{name}: {issue:?}");
        assert!(path.exists(), "{name} was moved aside as unreadable");

        assert_eq!(c.locks, sample_locks(), "{name}: locks");
        assert!(c.is_locked(SHOP, "feature/payment") && !c.is_locked(SHOP, "feature/other"), "{name}: branch lock");
        assert!(c.is_locked(PLATFORM, "anything"), "{name}: a repository lock covers every branch");
        for p in Config::default().protected_patterns.iter().map(String::as_str).chain(EXTRA_PROTECTED) {
            assert!(c.protected_patterns.iter().any(|q| q == p), "{name}: protected pattern {p} lost");
        }
        assert!(c.is_protected("hotfix/1.2") && c.is_protected("team/keep-this") && c.is_protected("main"), "{name}: protection");
        assert_eq!(c.ignores, sample_ignores(), "{name}: ignores");
        assert_eq!(c.my_emails, sample_config().my_emails, "{name}: own addresses decide what is someone else's work");
        assert_eq!(c.online_excluded, sample_config().online_excluded, "{name}: excluded repositories");
        assert_eq!(c.roots, sample_config().roots, "{name}: roots");
        assert_eq!(c.annotations, sample_config().annotations, "{name}: annotations");
        assert_eq!(c.commands.len(), 1, "{name}: custom commands");
        assert!(c.ui.sidebar_collapsed && c.ui.collapsed_roots == ["D:/src"], "{name}: ui");
        let unknown: Vec<&String> = c.extra.keys().filter(|k| !DROPPED_FIELDS.contains(&k.as_str())).collect();
        assert!(unknown.is_empty(), "{name}: fields today's code does not read: {unknown:?}");
    }
}

/// The results cache as the app wrote it while every branch carried its commit lists (up to 2 × 200):
/// it still loads with the counts intact, and the lists are not carried along, neither to the window
/// nor into the next cache file.
#[test]
fn a_results_cache_with_commit_lists_still_loads() {
    let dir = tempfile::tempdir().unwrap();
    let cache = dir.path().join("cache");
    std::fs::create_dir_all(&cache).unwrap();
    // The cache file's name of that time; a later version of the name would not be read at all.
    std::fs::copy(fixtures().join("last-scan-v5.json"), cache.join("last-scan-v5.json")).unwrap();
    let state = mcbranchface_lib::state::AppState::with_dir(Config::default(), Vec::new(), dir.path().to_path_buf());
    let results = state.results();
    assert_eq!(results.len(), 1, "the cached repository is back");
    let counts = |name: &str| {
        let b = results[0].branches.iter().find(|b| b.name == name).unwrap_or_else(|| panic!("{name} is back"));
        (b.verdict, b.own_commit_count, b.unpushed_commit_count)
    };
    assert_eq!(counts("feature/active/a0"), (Verdict::Unsafe, 4, 1));
    assert_eq!(counts("local/wip1"), (Verdict::Unsafe, 2, 2));
    assert_eq!(counts("feature/merged/m2"), (Verdict::Safe, 0, 0));
    assert!(results[0].online.as_ref().is_some_and(|o| o.len() == 2), "the server branches too");
    let written = serde_json::to_string(&results).unwrap();
    assert!(!written.contains("\"ownCommits\"") && !written.contains("\"unpushedCommits\""), "the lists stay behind");
}

/// The commit a backup ref of the fixture points to, made in the test repo.
fn backup_commit(f: &Fixture, backup_ref: &str, file: &str) {
    git(&f.work, &["switch", "-q", "--detach", "main"]);
    commit(&f.work, file, &format!("{backup_ref}\n"), "kept by a backup ref");
    git(&f.work, &["update-ref", backup_ref, "HEAD"]);
    git(&f.work, &["switch", "-q", "main"]);
}

/// A real stash behind the backup ref, then dropped: what `git stash store` needs to bring it back.
fn backup_stash(f: &Fixture, backup_ref: &str) -> String {
    std::fs::write(f.work.join("readme.txt"), format!("{backup_ref}\n")).unwrap();
    git(&f.work, &["stash", "push", "-q", "-m", "work in progress"]);
    let sha = git(&f.work, &["rev-parse", "stash@{0}"]);
    git(&f.work, &["update-ref", backup_ref, &sha]);
    git(&f.work, &["stash", "drop", "-q"]);
    sha
}

#[tokio::test]
async fn every_released_journal_reads_completely_and_restores() {
    for file in released("deleted-", ".jsonl") {
        let name = file.file_name().unwrap().to_string_lossy().into_owned();
        let text = std::fs::read_to_string(&file).unwrap();
        let f = Fixture::new();
        let journal = Journal::new(f.data.join("deleted.jsonl"));
        std::fs::create_dir_all(&f.data).unwrap();
        std::fs::write(f.data.join("deleted.jsonl"), &text).unwrap();
        // The journal skips lines it cannot read: every released line must still count.
        let mut entries = journal.load().expect("journal readable");
        assert_eq!(entries.len(), text.lines().filter(|l| !l.trim().is_empty()).count(), "{name}: unreadable lines");
        assert!(entries.iter().any(|e| !e.branch.is_empty() && !e.dropped_stashes.is_empty()), "{name}: a delete with stashes");
        assert!(entries.iter().any(|e| e.branch.is_empty() && !e.dropped_stashes.is_empty()), "{name}: a stash on its own");

        let work = f.work.to_string_lossy().into_owned();
        let mut stashes = Vec::new();
        for (i, e) in entries.iter_mut().enumerate() {
            e.repo_path = work.clone();
            if e.restored_at.is_some() {
                continue;
            }
            if !e.branch.is_empty() {
                backup_commit(&f, &e.backup_ref, &format!("kept-{i}.txt"));
            }
            for s in &e.dropped_stashes {
                stashes.push((backup_stash(&f, &s.backup_ref), s.message.clone()));
            }
        }
        journal.replace_all(&entries).unwrap();

        for e in &entries {
            let result = actions::restore(&journal, &e.id).await;
            if e.restored_at.is_some() {
                let code = result.unwrap_err().downcast::<AppError>().expect("an AppError").code;
                assert_eq!(code, ErrorCode::AlreadyRestored, "{name}: {} was restored before", e.id);
                continue;
            }
            result.unwrap_or_else(|err| panic!("{name}: {} does not restore: {err:#}", e.id));
            let tip = git(&f.work, &["rev-parse", &e.backup_ref]);
            match (&e.remote, e.branch.is_empty()) {
                (_, true) => {}
                (Some(remote), false) => {
                    let heads = git(&f.work, &["ls-remote", "--heads", remote, &format!("refs/heads/{}", e.branch)]);
                    assert!(heads.starts_with(&tip), "{name}: {} is back on the server", e.branch);
                }
                (None, false) => {
                    assert_eq!(git(&f.work, &["rev-parse", &format!("refs/heads/{}", e.branch)]), tip, "{name}: {} is back", e.branch);
                    if let Some(remote) = &e.upstream_remote {
                        assert_eq!(&git(&f.work, &["config", &format!("branch.{}.remote", e.branch)]), remote, "{name}: upstream of {}", e.branch);
                    }
                }
            }
        }
        let list = git(&f.work, &["stash", "list", "--format=%H %gs"]);
        for (sha, message) in &stashes {
            assert!(list.contains(&format!("{sha} {message}")), "{name}: stash {message} is back: {list}");
        }
        assert!(journal.load().expect("journal readable").iter().all(|e| e.restored_at.is_some()), "{name}: every entry is marked restored");
    }
}
