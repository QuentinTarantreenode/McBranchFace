//! Watches repositories so the UI follows branch switches and file edits made in other tools.

use std::collections::{HashMap, HashSet};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::Duration;

use anyhow::Result;
use notify_debouncer_mini::notify::{RecommendedWatcher, RecursiveMode};
use notify_debouncer_mini::{new_debouncer, DebounceEventResult, Debouncer};

use crate::model::{ChangeScope, RepoChanged};

const DEBOUNCE: Duration = Duration::from_millis(300);

/// Build output and dependency folders change constantly and say nothing about the repo state. Checked
/// first and without git: a build touches thousands of files there.
const IGNORED_DIRS: &[&str] = &["node_modules", "bin", "obj", "target", ".vs", ".idea", ".svelte-kit", "dist"];

#[derive(Debug, Clone)]
pub struct WatchedRepo {
    pub path: PathBuf,
    /// Common git dir (shared by all worktrees of the repo).
    pub git_dir: PathBuf,
    pub worktrees: Vec<PathBuf>,
}

pub struct RepoWatcher {
    _debouncer: Debouncer<RecommendedWatcher>,
    /// Folders that could not be watched; every other one is.
    pub failed: Vec<UnwatchedRoot>,
}

/// A folder of a repo the watcher could not observe, and why. Its changes reach the UI only with the
/// next scan.
#[derive(Debug, Clone)]
pub struct UnwatchedRoot {
    /// The repo as it was handed to `watch`.
    pub repo: String,
    pub root: String,
    pub detail: String,
}

fn norm(p: &Path) -> String {
    crate::paths::path_key(&p.to_string_lossy())
}

fn under(path: &str, root: &str) -> Option<String> {
    path.strip_prefix(root).filter(|r| r.is_empty() || r.starts_with('/')).map(|r| r.trim_start_matches('/').to_string())
}

/// Which part of the repo state a changed path affects; None means irrelevant noise.
pub fn classify(path: &Path, repo: &WatchedRepo) -> Option<ChangeScope> {
    place(path, repo).map(|(scope, _, _)| scope)
}

/// The roots of a repo in the form events are compared in, made once: a build sends thousands of events.
struct Roots {
    git_dir: String,
    worktrees: Vec<(PathBuf, String)>,
}

impl Roots {
    fn of(repo: &WatchedRepo) -> Self {
        Self { git_dir: norm(&repo.git_dir), worktrees: repo.worktrees.iter().map(|w| (w.clone(), norm(w))).collect() }
    }

    fn holds(&self, key: &str) -> bool {
        under(key, &self.git_dir).is_some() || self.worktrees.iter().any(|(_, w)| under(key, w).is_some())
    }
}

/// Files git writes beside the refs that change no branch: what a fetch, a merge message or a
/// housekeeping run leaves behind. Counted as a ref change, each one reassessed the whole repo.
const NOT_REFS: &[&str] = &["FETCH_HEAD", "ORIG_HEAD", "COMMIT_EDITMSG", "AUTO_MERGE", "MERGE_MSG", "SQUASH_MSG", "gc.log", "gc.pid", "description"];
const NOT_REF_DIRS: &[&str] = &["objects", "logs", "fsmonitor", "rr-cache", "hooks", "info", "lfs"];

/// The scope of a change and the working copy it is in. A change in the git directory names none: the
/// shared refs and indexes may concern every worktree. Worktrees often live inside the main one (agents'
/// worktrees under .claude/worktrees): a file belongs to the deepest worktree that holds it, never to
/// the one around it.
pub fn place(path: &Path, repo: &WatchedRepo) -> Option<(ChangeScope, Option<PathBuf>, String)> {
    place_key(&norm(path), &Roots::of(repo))
}

/// `place` for a path already turned into its key: a build sends thousands of events, each compared
/// with every repo, and the key is made once per event.
fn place_key(p: &str, roots: &Roots) -> Option<(ChangeScope, Option<PathBuf>, String)> {
    if let Some(rel) = under(p, &roots.git_dir) {
        let name = rel.rsplit('/').next().unwrap_or(&rel);
        if NOT_REF_DIRS.iter().any(|d| rel.starts_with(d)) || rel.ends_with(".lock") || NOT_REFS.iter().any(|n| name.eq_ignore_ascii_case(n)) {
            return None;
        }
        // Each worktree keeps its own index under worktrees/<name>/index.
        let scope = if rel == "index" || rel.ends_with("/index") { ChangeScope::Files } else { ChangeScope::Refs };
        return Some((scope, None, format!(".git/{rel}")));
    }
    let owner = roots.worktrees.iter().filter_map(|(wt, n)| under(p, n).map(|rel| (wt, n.len(), rel))).max_by_key(|(_, len, _)| *len);
    let (wt, _, rel) = owner?;
    if rel == ".git" || rel.split('/').any(|seg| IGNORED_DIRS.iter().any(|d| d.eq_ignore_ascii_case(seg))) {
        return None;
    }
    Some((ChangeScope::Files, Some(wt.clone()), rel.to_string()))
}

const FILES_NAMED: usize = 5;

/// What git ignores never changes the status, yet logs, test results and tool folders of a working copy
/// change all the time: each change read the status again. Git answers by the repo's own rules (every
/// .gitignore, info/exclude, the global excludes); a tracked file is never reported, so its edits count.
/// The answers are kept per working copy until an ignore rule changes.
#[derive(Default)]
struct Ignored {
    known: HashMap<PathBuf, HashMap<String, bool>>,
}

const IGNORED_KEPT: usize = 20_000;

impl Ignored {
    fn forget(&mut self) {
        self.known.clear();
    }

    /// The files of `copy` that git ignores, asking only for those not known yet.
    fn of(&mut self, copy: &Path, files: &[String]) -> HashSet<String> {
        let known = self.known.entry(copy.to_path_buf()).or_default();
        if known.len() > IGNORED_KEPT {
            known.clear();
        }
        let ask: Vec<&String> = files.iter().filter(|f| !known.contains_key(*f)).collect::<HashSet<_>>().into_iter().collect();
        if !ask.is_empty() {
            // Unanswered (git missing, the copy gone) counts as not ignored: a status read too many, never one too few.
            let hits = check_ignore(copy, &ask).unwrap_or_default();
            for f in ask {
                known.insert(f.clone(), hits.contains(f));
            }
        }
        files.iter().filter(|f| known.get(*f) == Some(&true)).cloned().collect()
    }
}

/// A hanging git (a network drive, a held lock) must not stop the watcher; unanswered is not ignored.
const CHECK_IGNORE_TIMEOUT: Duration = Duration::from_secs(10);

fn check_ignore(copy: &Path, files: &[&String]) -> Option<HashSet<String>> {
    let mut cmd = crate::process::std_command("git");
    cmd.arg("-C").arg(copy).args(["check-ignore", "-z", "--stdin"]).envs(crate::git::runner::ENV.iter().copied());
    cmd.stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(crate::process::CREATE_NO_WINDOW);
    }
    let mut child = cmd.spawn().ok()?;
    let mut input = Vec::new();
    for f in files {
        input.extend_from_slice(f.as_bytes());
        input.push(0);
    }
    // Written and read at the same time: git answers while it reads, and with both pipes full each
    // side would wait for the other.
    let mut stdin = child.stdin.take()?;
    let writer = std::thread::spawn(move || stdin.write_all(&input));
    let mut stdout = child.stdout.take()?;
    let (tx, rx) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        let mut out = Vec::new();
        let _ = tx.send(std::io::Read::read_to_end(&mut stdout, &mut out).map(|_| out));
    });
    let Ok(Ok(out)) = rx.recv_timeout(CHECK_IGNORE_TIMEOUT) else {
        let _ = child.kill();
        let _ = child.wait();
        return None;
    };
    let status = child.wait().ok()?;
    writer.join().ok()?.ok()?;
    // 0: some are ignored, 1: none is; anything else is a failure.
    if !matches!(status.code(), Some(0 | 1)) {
        return None;
    }
    Some(out.split(|b| *b == 0).filter(|s| !s.is_empty()).map(|s| String::from_utf8_lossy(s).to_string()).collect())
}

/// A change to an ignore rule changes what git ignores.
fn is_ignore_rule(key: &str) -> bool {
    key.ends_with("/.gitignore") || key.ends_with("/info/exclude")
}

/// The folders handed to the watcher, each with the repos it belongs to. Every git directory has a
/// handle of its own, also where it lies inside a worktree: on Windows each handle reads changes
/// through a buffer of 16 KB, and a checkout or build that overflows it loses the batch silently. In
/// a handle of their own the few writes to refs and HEAD are not lost among thousands of file writes.
/// A worktree inside another one (agents' worktrees) is watched through the outer one.
fn watch_plan(repos: &[WatchedRepo]) -> Vec<(PathBuf, String, Vec<String>)> {
    let mut plan: Vec<(PathBuf, String, Vec<String>)> = Vec::new();
    let add = |plan: &mut Vec<(PathBuf, String, Vec<String>)>, root: &Path, repo: &str, nested_ok: bool| {
        let key = norm(root);
        if let Some((_, _, owners)) = plan.iter_mut().find(|(_, k, _)| *k == key) {
            if !owners.iter().any(|o| o == repo) {
                owners.push(repo.to_string());
            }
            return;
        }
        if !nested_ok && plan.iter().any(|(_, k, _)| under(&key, k).is_some()) {
            return;
        }
        plan.push((root.to_path_buf(), key, vec![repo.to_string()]));
    };
    // Outer folders first, so a worktree inside another one finds it planned already.
    let mut worktrees: Vec<(&PathBuf, String)> = repos.iter().flat_map(|r| r.worktrees.iter().map(|w| (w, r.path.to_string_lossy().to_string()))).collect();
    worktrees.sort_by_key(|(w, _)| norm(w).len());
    for (w, repo) in worktrees {
        add(&mut plan, w, &repo, false);
    }
    for repo in repos {
        add(&mut plan, &repo.git_dir, &repo.path.to_string_lossy(), true);
    }
    plan
}

/// Everything of a repo may have changed: an event on a folder the watcher was handed (renamed,
/// replaced, its attributes changed) or an error of the watcher. Its next assessment reads all again.
fn everything(repo: &str, why: &str) -> RepoChanged {
    RepoChanged { path: repo.to_string(), scopes: vec![ChangeScope::Refs, ChangeScope::Files], paths: Vec::new(), files: vec![why.to_string()] }
}

/// The path of `path` below `copy` as written on disk: git may match case-sensitively.
fn rel_on_disk(path: &Path, copy: &Path) -> Option<String> {
    let rel = path.strip_prefix(copy).ok()?;
    Some(rel.to_string_lossy().replace('\\', "/"))
}

/// What the watcher hands each batch to: the repos and their roots, made once.
struct Targets {
    repos: Vec<(String, Roots)>,
    /// Each folder handed to the watcher, by key, and the repos it belongs to.
    roots: HashMap<String, Vec<String>>,
}

impl Targets {
    fn of(repos: &[WatchedRepo], plan: &[(PathBuf, String, Vec<String>)]) -> Self {
        Self {
            repos: repos.iter().map(|r| (r.path.to_string_lossy().to_string(), Roots::of(r))).collect(),
            roots: plan.iter().map(|(_, k, owners)| (k.clone(), owners.clone())).collect(),
        }
    }

    /// A batch the watcher could not deliver: the repos it names, or all of them, are read again.
    fn lost(&self, paths: &[PathBuf]) -> Vec<RepoChanged> {
        let keys: Vec<String> = paths.iter().map(|p| norm(p)).collect();
        self.repos.iter().filter(|(_, roots)| keys.is_empty() || keys.iter().any(|k| roots.holds(k))).map(|(repo, _)| everything(repo, "watcher error")).collect()
    }

    /// One batch of changed paths, per repo: what changed and in which working copies. Each path is
    /// made a key once; an event on a folder the watcher was handed counts as everything.
    fn changes(&self, paths: &[PathBuf], ignored: &mut Ignored) -> Vec<RepoChanged> {
        let keyed: Vec<(String, &PathBuf)> = paths.iter().map(|p| (norm(p), p)).collect();
        if keyed.iter().any(|(k, _)| is_ignore_rule(k)) {
            ignored.forget();
        }
        // Per working copy, the changed files git might ignore; asked once per copy and batch.
        let mut placed = Vec::new();
        let mut whole: Vec<String> = Vec::new();
        let mut asks: HashMap<PathBuf, Vec<String>> = HashMap::new();
        for (key, path) in &keyed {
            if let Some(owners) = self.roots.get(key) {
                for o in owners {
                    if !whole.contains(o) {
                        whole.push(o.clone());
                    }
                }
                continue;
            }
            for (repo, roots) in &self.repos {
                if let Some((scope, copy, file)) = place_key(key, roots) {
                    let disk = copy.as_ref().map(|c| rel_on_disk(path, c).unwrap_or_else(|| file.clone()));
                    if let (Some(c), Some(d)) = (&copy, &disk) {
                        asks.entry(c.clone()).or_default().push(d.clone());
                    }
                    placed.push((repo.clone(), scope, copy, file, disk));
                }
            }
        }
        let mut out: Vec<RepoChanged> = whole.iter().map(|repo| everything(repo, "watched folder")).collect();
        placed.retain(|(repo, ..)| !whole.contains(repo));
        let skip: HashMap<PathBuf, HashSet<String>> = asks
            .into_iter()
            .map(|(c, files)| {
                let hit = ignored.of(&c, &files);
                (c, hit)
            })
            .collect();
        // Per repo: what changed, and in which working copies; None among them means all of them.
        type Seen = (Vec<ChangeScope>, Vec<Option<PathBuf>>, Vec<String>);
        let mut changed: HashMap<String, Seen> = HashMap::new();
        for (repo, scope, copy, file, disk) in placed {
            if let (Some(c), Some(d)) = (&copy, &disk) {
                if skip.get(c).is_some_and(|s| s.contains(d)) {
                    continue;
                }
            }
            let (scopes, copies, files) = changed.entry(repo).or_default();
            if !scopes.contains(&scope) {
                scopes.push(scope);
            }
            if !copies.contains(&copy) {
                copies.push(copy);
            }
            // A few name the cause; a build touching thousands needs no list.
            if files.len() < FILES_NAMED && !files.contains(&file) {
                files.push(file);
            }
        }
        for (path, (scopes, copies, files)) in changed {
            let paths = if copies.iter().any(Option::is_none) { Vec::new() } else { copies.into_iter().flatten().map(|p| p.to_string_lossy().to_string()).collect() };
            out.push(RepoChanged { path, scopes, paths, files });
        }
        out
    }
}

/// Hands each folder of the plan to `watch_one`; one that fails is named and the others go on.
fn watch_roots(plan: Vec<(PathBuf, String, Vec<String>)>, mut watch_one: impl FnMut(&Path) -> std::result::Result<(), String>) -> Vec<UnwatchedRoot> {
    let mut failed = Vec::new();
    for (root, _, owners) in plan {
        // A worktree git still lists but whose folder is gone holds nothing to watch.
        if !root.is_dir() {
            continue;
        }
        if let Err(detail) = watch_one(&root) {
            let root = crate::paths::slashes(&root.to_string_lossy());
            failed.extend(owners.into_iter().map(|repo| UnwatchedRoot { repo, root: root.clone(), detail: detail.clone() }));
        }
    }
    failed
}

/// Watches the repos; a folder that cannot be watched is skipped and named in `failed`, the others are
/// watched all the same. An error only when the watcher itself cannot start.
pub fn watch(repos: Vec<WatchedRepo>, emit: impl Fn(RepoChanged) + Send + 'static) -> Result<RepoWatcher> {
    let plan = watch_plan(&repos);
    let targets = Targets::of(&repos, &plan);
    let mut ignored = Ignored::default();
    let mut debouncer = new_debouncer(DEBOUNCE, move |res: DebounceEventResult| {
        let changes = match res {
            Ok(events) => targets.changes(&events.into_iter().map(|e| e.path).collect::<Vec<_>>(), &mut ignored),
            Err(e) => targets.lost(&e.paths),
        };
        for c in changes {
            emit(c);
        }
    })?;
    let failed = watch_roots(plan, |root| debouncer.watcher().watch(root, RecursiveMode::Recursive).map_err(|e| e.to_string()));
    Ok(RepoWatcher { _debouncer: debouncer, failed })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn repo() -> WatchedRepo {
        WatchedRepo {
            path: "C:/ws/core".into(),
            git_dir: "C:/ws/core/.git".into(),
            worktrees: vec!["C:/ws/core".into(), "C:/ws/core-wt".into()],
        }
    }

    #[test]
    fn classifies_changes() {
        let r = repo();
        let c = |p: &str| classify(Path::new(p), &r);
        assert_eq!(c("C:/ws/core/.git/HEAD"), Some(ChangeScope::Refs));
        assert_eq!(c("C:/ws/core/.git/refs/heads/feature/x"), Some(ChangeScope::Refs));
        assert_eq!(c("C:/ws/core/.git/packed-refs"), Some(ChangeScope::Refs));
        assert_eq!(c("C:/ws/core/.git/index"), Some(ChangeScope::Files));
        assert_eq!(c("C:/ws/core/.git/worktrees/core-wt/index"), Some(ChangeScope::Files));
        assert_eq!(c("C:/ws/core/.git/worktrees/core-wt/HEAD"), Some(ChangeScope::Refs));
        assert_eq!(c("C:/ws/core/.git/objects/ab/cdef"), None);
        assert_eq!(c("C:/ws/core/.git/index.lock"), None);
        // What a fetch, a merge or housekeeping leaves beside the refs changes no branch.
        assert_eq!(c("C:/ws/core/.git/FETCH_HEAD"), None);
        assert_eq!(c("C:/ws/core/.git/worktrees/core-wt/ORIG_HEAD"), None);
        assert_eq!(c("C:/ws/core/.git/gc.log"), None);
        assert_eq!(c("C:/ws/core/.git/hooks/pre-commit"), None);
        assert_eq!(c("C:/ws/core/src/main.rs"), Some(ChangeScope::Files));
        assert_eq!(c("C:/ws/core/src/bin/Debug/app.dll"), None);
        assert_eq!(c("C:/ws/core-wt/readme.md"), Some(ChangeScope::Files));
        assert_eq!(c("C:/ws/core-other/readme.md"), None, "prefix of another folder is not inside");
        assert_eq!(c(r"C:\WS\Core\Src\Main.rs"), if cfg!(windows) { Some(ChangeScope::Files) } else { None });
    }

    #[test]
    fn what_git_ignores_is_known_and_a_tracked_file_is_not() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        let git = |args: &[&str]| assert!(std::process::Command::new("git").arg("-C").arg(root).args(args).status().unwrap().success());
        git(&["init", "-q"]);
        std::fs::write(root.join(".gitignore"), "TestResults/
*.log
").unwrap();
        std::fs::write(root.join("kept.log"), "").unwrap();
        git(&["add", "-f", "kept.log"]);
        let files: Vec<String> = ["TestResults/run/a.trx", "build.log", "kept.log", "src/a.rs"].map(String::from).to_vec();
        let mut ignored = Ignored::default();
        let hit = ignored.of(root, &files);
        assert_eq!(hit, ["TestResults/run/a.trx", "build.log"].map(String::from).into_iter().collect());
        // Known now: a missing git would change nothing until a rule changes.
        assert_eq!(ignored.known[root].len(), 4);
        ignored.forget();
        assert!(ignored.known.is_empty());
        assert!(is_ignore_rule(&norm(Path::new("C:/ws/core/sub/.gitignore"))));
        assert!(is_ignore_rule(&norm(Path::new("C:/ws/core/.git/info/exclude"))));
        assert!(!is_ignore_rule(&norm(Path::new("C:/ws/core/src/gitignore.rs"))));
    }

    #[test]
    fn thousands_of_ignored_files_are_answered_without_blocking() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().to_path_buf();
        assert!(std::process::Command::new("git").arg("-C").arg(&root).args(["init", "-q"]).status().unwrap().success());
        std::fs::write(root.join(".gitignore"), "TestResults/\n").unwrap();
        // More answer than a pipe holds: git blocks on its output while the input is still being written.
        let files: Vec<String> = (0..20_000).map(|i| format!("TestResults/run-{i:05}/result-file-with-a-long-name.trx")).collect();
        let (tx, rx) = std::sync::mpsc::channel();
        std::thread::spawn(move || {
            let mut ignored = Ignored::default();
            let _ = tx.send(ignored.of(&root, &files).len());
        });
        let hits = rx.recv_timeout(Duration::from_secs(60)).expect("check-ignore hung");
        assert_eq!(hits, 20_000);
    }

    #[test]
    fn a_folder_that_cannot_be_watched_is_named_and_the_others_are_watched() {
        let dir = tempfile::tempdir().unwrap();
        let (a, b) = (dir.path().join("a"), dir.path().join("b"));
        std::fs::create_dir_all(a.join(".git")).unwrap();
        std::fs::create_dir_all(b.join(".git")).unwrap();
        let repos: Vec<WatchedRepo> = [&a, &b].iter().map(|p| WatchedRepo { path: p.to_path_buf(), git_dir: p.join(".git"), worktrees: vec![p.to_path_buf()] }).collect();
        let mut tried = Vec::new();
        let failed = watch_roots(watch_plan(&repos), |root| {
            tried.push(root.to_path_buf());
            if root == a.join(".git") { Err("no access".into()) } else { Ok(()) }
        });
        assert_eq!(tried.len(), 4, "every folder is tried: {tried:?}");
        assert_eq!(failed.len(), 1);
        assert_eq!((failed[0].repo.as_str(), failed[0].detail.as_str()), (a.to_string_lossy().as_ref(), "no access"));
    }

    #[test]
    fn an_event_on_a_watched_folder_itself_reads_everything_again() {
        let r = repo();
        let targets = Targets::of(std::slice::from_ref(&r), &watch_plan(std::slice::from_ref(&r)));
        let mut ignored = Ignored::default();
        let all = targets.changes(&[PathBuf::from("C:/ws/core/.git")], &mut ignored);
        assert_eq!(all.len(), 1);
        assert_eq!(all[0].scopes, [ChangeScope::Refs, ChangeScope::Files]);
        assert!(all[0].paths.is_empty(), "every working copy");
        let lost = targets.lost(&[]);
        assert_eq!(lost.len(), 1, "a lost batch without paths concerns every repo");
        assert!(targets.lost(&[PathBuf::from("D:/elsewhere/x")]).is_empty());
        let refs = targets.changes(&[PathBuf::from("C:/ws/core/.git/refs/heads/x")], &mut ignored);
        assert_eq!(refs[0].scopes, [ChangeScope::Refs], "inside the folder as before");
    }

    #[test]
    fn every_git_directory_gets_a_handle_of_its_own_and_nested_worktrees_none() {
        let main = WatchedRepo {
            path: "C:/ws/core".into(),
            git_dir: "C:/ws/core/.git".into(),
            worktrees: vec!["C:/ws/core".into(), "C:/ws/core/.claude/worktrees/agent-1".into(), "C:/ws/core-wt".into()],
        };
        let other = WatchedRepo { path: "C:/ws/shop".into(), git_dir: "C:/ws/shop/.git".into(), worktrees: vec!["C:/ws/shop".into()] };
        let plan: Vec<(String, Vec<String>)> = watch_plan(&[main, other]).into_iter().map(|(_, k, o)| (k, o)).collect();
        let keys: Vec<&str> = plan.iter().map(|(k, _)| k.as_str()).collect();
        let k = |p: &str| crate::paths::path_key(p);
        assert_eq!(keys, [k("C:/ws/core"), k("C:/ws/shop"), k("C:/ws/core-wt"), k("C:/ws/core/.git"), k("C:/ws/shop/.git")]);
        assert_eq!(plan[3].1, ["C:/ws/core"], "the git directory belongs to its repo");
    }

    #[test]
    fn a_file_belongs_to_the_deepest_worktree() {
        let r = WatchedRepo {
            path: "C:/ws/core".into(),
            git_dir: "C:/ws/core/.git".into(),
            worktrees: vec!["C:/ws/core".into(), "C:/ws/core/.claude/worktrees/agent-1".into()],
        };
        let at = |p: &str| place(Path::new(p), &r).and_then(|(_, w, _)| w).map(|w| w.to_string_lossy().to_string());
        assert_eq!(at("C:/ws/core/.claude/worktrees/agent-1/src/a.rs").as_deref(), Some("C:/ws/core/.claude/worktrees/agent-1"));
        assert_eq!(at("C:/ws/core/src/a.rs").as_deref(), Some("C:/ws/core"));
        assert_eq!(place(Path::new("C:/ws/core/.git/HEAD"), &r).map(|(_, w, _)| w), Some(None), "the git directory concerns all");
    }
}
