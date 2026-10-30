use std::collections::HashMap;
use std::path::Path;
use std::sync::{Arc, LazyLock, Mutex};
use std::time::Duration;

use anyhow::Result;
use serde::{Deserialize, Serialize};
use tokio::sync::OnceCell;

use super::runner::Git;
use super::snapshot::now;
use crate::model::{MergeEvidence, MergeKind, PrState, PullRequestInfo};

/// What was found for (tip, target). A target only grows, so a positive answer stays true when it
/// moves on; a negative one holds for the target commit it was computed against.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Entry {
    evidence: Option<MergeEvidence>,
    /// Target commit of a negative answer.
    target_sha: String,
    at: i64,
}

static CACHE: LazyLock<Mutex<HashMap<String, Entry>>> = LazyLock::new(Default::default);

/// The probe's answer for a tip and a target *commit*, whatever repository asked: it depends only on the
/// commits below the two, and those are the same in every clone that has them. The working copies of one
/// repository probe the same branches against the same target; with this, one of them does. Unlike
/// `CACHE` it is keyed by the target's commit, so a clone whose target is behind never sees another's
/// answer. Asked once: the copies of a repository scan side by side, and the second waits for the first.
static GRAPH: LazyLock<Mutex<HashMap<(String, String), Shared>>> = LazyLock::new(Default::default);
type Shared = Arc<OnceCell<Option<MergeKind>>>;
/// Answers kept for the life of the process; past this many they are probed again.
const GRAPH_CAP: usize = 50_000;

/// Negative answers of branches that were deleted long ago are the only thing that piles up.
const NEGATIVE_KEEP_SECS: i64 = 7 * 24 * 3600;
const MAX_ENTRIES: usize = 50_000;

pub fn load_cache(file: &Path) {
    if let Some(map) = std::fs::read_to_string(file).ok().and_then(|s| serde_json::from_str(&s).ok()) {
        *CACHE.lock().unwrap_or_else(|p| p.into_inner()) = rekey(map);
    }
}

/// Copied under the lock, serialized and written outside it: up to 50 000 entries would hold up every
/// merge question of a running scan. Written through a temporary file, so a crash leaves the old one.
pub fn save_cache(file: &Path) {
    let map = {
        let mut map = CACHE.lock().unwrap_or_else(|p| p.into_inner());
        prune(&mut map, now());
        map.clone()
    };
    if let (Ok(json), Some(dir)) = (serde_json::to_string(&map), file.parent()) {
        let _ = std::fs::create_dir_all(dir).and_then(|_| crate::config::write_atomic(file, json.as_bytes()));
    }
}

/// Drops old negatives and entries of the old, repo-less key; beyond the cap the oldest go,
/// negatives before positives.
fn prune(map: &mut HashMap<String, Entry>, now: i64) {
    map.retain(|k, e| k.contains(SEP) && (e.evidence.is_some() || now - e.at < NEGATIVE_KEEP_SECS));
    if map.len() > MAX_ENTRIES {
        let mut all: Vec<(bool, i64, String)> = map.iter().map(|(k, e)| (e.evidence.is_some(), e.at, k.clone())).collect();
        all.sort();
        let excess = map.len() - MAX_ENTRIES;
        for (_, _, k) in all.into_iter().take(excess) {
            map.remove(&k);
        }
    }
}

const SEP: char = '\u{1f}';

/// Working copy → the repository its answers are kept under (see `note_repo`).
static REPOS: LazyLock<Mutex<HashMap<String, String>>> = LazyLock::new(Default::default);

/// Records the git directory a working copy shares with its linked worktrees: they have the same refs,
/// so they share the answers. The main working copy keeps the key it always had, its own folder.
pub fn note_repo(git: &Git, common_dir: &str) {
    let common = crate::paths::path_key(common_dir);
    let repo = common.strip_suffix("/.git").unwrap_or(&common).to_string();
    REPOS.lock().unwrap_or_else(|p| p.into_inner()).insert(crate::paths::path_key(&git.dir().to_string_lossy()), repo);
}

/// Per repository: two clones can share a commit that only one of them has merged.
fn key(git: &Git, tip: &str, target: &str) -> String {
    let copy = crate::paths::path_key(&git.dir().to_string_lossy());
    let repo = REPOS.lock().unwrap_or_else(|p| p.into_inner()).get(&copy).cloned().unwrap_or(copy);
    format!("{repo}{SEP}{tip}{SEP}{target}")
}

/// Keys of older files named the folder as the caller spelled it: one repository could hold several
/// entries for one question. Rekeyed instead of dropped, positives win, so no answer is lost.
fn rekey(map: HashMap<String, Entry>) -> HashMap<String, Entry> {
    let mut out: HashMap<String, Entry> = HashMap::with_capacity(map.len());
    for (k, e) in map {
        let k = match k.split_once(SEP) {
            Some((repo, rest)) => format!("{}{SEP}{rest}", crate::paths::path_key(repo)),
            None => k,
        };
        let keeps = out.get(&k).is_some_and(|kept| kept.evidence.is_some() || (e.evidence.is_none() && kept.at >= e.at));
        if !keeps {
            out.insert(k, e);
        }
    }
    out
}

/// For deletes: the answer of this moment, never a stored one; a force-reset target or a stale
/// cache must not make a branch look merged.
pub async fn merged_into_fresh(git: &Git, tip: &str, target: &str) -> Result<Option<MergeEvidence>> {
    let target_sha = git.out(&["rev-parse", "--verify", "--end-of-options", target]).await?.trim().to_string();
    let answer = probe(git, tip, target).await?;
    CACHE.lock().unwrap_or_else(|p| p.into_inner()).insert(key(git, tip, target), Entry { evidence: answer.clone(), target_sha, at: now() });
    Ok(answer)
}

/// Checks whether the content of `tip` already is on `target`, strongest evidence first.
/// `git branch -d` only knows the first case; squash merges need the synthetic-commit test.
/// With `max_age`, a negative answer younger than that is reused even if the target moved: the
/// server-branch overview accepts being a few hours behind, a delete never passes it.
/// `target_sha`: the target's commit when the caller read it with the refs already; else git is asked.
pub async fn merged_into(git: &Git, tip: &str, target: &str, max_age: Option<Duration>, target_sha: Option<&str>) -> Result<Option<MergeEvidence>> {
    let key = key(git, tip, target);
    let cached = CACHE.lock().unwrap_or_else(|p| p.into_inner()).get(&key).cloned();
    if let Some(e) = &cached {
        if e.evidence.is_some() {
            return Ok(e.evidence.clone());
        }
        if max_age.is_some_and(|a| now() - e.at < a.as_secs() as i64) {
            return Ok(None);
        }
    }
    let target_sha = match target_sha {
        Some(sha) => sha.to_string(),
        None => git.out(&["rev-parse", "--verify", target]).await?.trim().to_string(),
    };
    if cached.as_ref().is_some_and(|e| e.target_sha == target_sha) {
        return Ok(None);
    }
    let answer = probe_shared(git, tip, target, &target_sha).await?;
    let entry = Entry { evidence: answer.clone(), target_sha, at: now() };
    CACHE.lock().unwrap_or_else(|p| p.into_inner()).insert(key, entry);
    Ok(answer)
}

/// `probe` through `GRAPH`, for a tip and target given as commit ids; other spellings are probed here.
async fn probe_shared(git: &Git, tip: &str, target: &str, target_sha: &str) -> Result<Option<MergeEvidence>> {
    if !is_object_id(tip) || !is_object_id(target_sha) {
        return probe(git, tip, target).await;
    }
    let cell = {
        let mut graph = GRAPH.lock().unwrap_or_else(|p| p.into_inner());
        if graph.len() >= GRAPH_CAP {
            graph.clear();
        }
        graph.entry((tip.to_ascii_lowercase(), target_sha.to_ascii_lowercase())).or_default().clone()
    };
    // Probed at the commit, not the name: the answer is kept for that commit, which the name may have left.
    let kind = cell.get_or_try_init(|| async { Ok::<_, anyhow::Error>(probe(git, tip, target_sha).await?.map(|e| e.kind)) }).await?;
    Ok(kind.map(|kind| MergeEvidence { kind, target: target.to_string() }))
}

async fn probe(git: &Git, tip: &str, target: &str) -> Result<Option<MergeEvidence>> {
    let evidence = |kind| Ok(Some(MergeEvidence { kind, target: target.to_string() }));

    let Some(base) = git.merge_base(target, tip).await? else {
        return Ok(None);
    };
    // The tip is the merge base exactly when it is an ancestor of the target: no second call to ask.
    // A tip that is not a commit id is asked as it was given.
    let ancestor = match is_object_id(tip) {
        true => base.eq_ignore_ascii_case(tip),
        false => git.is_ancestor(tip, target).await?,
    };
    if ancestor {
        return evidence(MergeKind::Ancestor);
    }

    let cherry = git.out(&["cherry", target, tip]).await?;
    let lines: Vec<&str> = cherry.lines().filter(|l| !l.trim().is_empty()).collect();
    if !lines.is_empty() && lines.iter().all(|l| l.starts_with('-')) {
        return evidence(MergeKind::PatchEquivalent);
    }

    let squashed = squash_probe(git, tip, &base).await?;
    let cherry = git.out(&["cherry", target, &squashed]).await?;
    if cherry.lines().next().is_some_and(|l| l.starts_with('-')) {
        return evidence(MergeKind::Squash);
    }
    Ok(None)
}

fn is_object_id(s: &str) -> bool {
    matches!(s.len(), 40 | 64) && s.bytes().all(|b| b.is_ascii_hexdigit())
}

/// The tree of `tip` as one commit on `base`. The object stays unreferenced and is collected by the
/// next gc; identity, dates and signing are fixed, so the same probe is the same object every time
/// instead of a new loose one per scan, whatever the user's commit configuration.
async fn squash_probe(git: &Git, tip: &str, base: &str) -> Result<String> {
    let tree = format!("{tip}^{{tree}}");
    const DATE: &str = "1000000000 +0000";
    let env = [("GIT_AUTHOR_DATE", DATE), ("GIT_COMMITTER_DATE", DATE)];
    let args = [
        "-c", "user.name=McBranchFace", "-c", "user.email=probe@mcbranchface.invalid",
        "commit-tree", "--no-gpg-sign", &tree, "-p", base, "-m", "mcbranchface squash probe",
    ];
    Ok(git.out_with_env(&args, &env).await?.trim().to_string())
}

/// A merged pull request takes in a tip it was made from, or one below it.
pub async fn pr_evidence(git: &Git, pr: &PullRequestInfo, tip: &str) -> Result<Option<MergeEvidence>> {
    if pr.state != PrState::Merged {
        return Ok(None);
    }
    let Some(src) = &pr.source_sha else { return Ok(None) };
    let holds = src == tip || (git.commit_exists(src).await? && git.is_ancestor(tip, src).await?);
    Ok(holds.then(|| MergeEvidence { kind: MergeKind::PullRequest, target: format!("#{}", pr.id) }))
}

/// Branches under `prefix` (`refs/remotes/origin/`) that contain the tip.
pub async fn containing_remotes(git: &Git, tip: &str, prefix: &str) -> Result<Vec<String>> {
    let out = git
        .out(&["for-each-ref", "--contains", tip, "--format=%(refname)", prefix])
        .await?;
    Ok(out
        .lines()
        .map(str::trim)
        .filter(|r| !r.is_empty() && !r.ends_with("/HEAD"))
        .map(String::from)
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(positive: bool, at: i64) -> Entry {
        let evidence = positive.then(|| MergeEvidence { kind: MergeKind::Ancestor, target: "t".into() });
        Entry { evidence, target_sha: "s".into(), at }
    }

    /// A key as `key()` builds it, without a repository.
    fn k(name: &str) -> String {
        format!("repo{SEP}{name}{SEP}t")
    }

    #[test]
    fn pruning_keeps_positives_and_drops_old_negatives_and_old_keys() {
        let now = 10 * NEGATIVE_KEEP_SECS;
        let mut m = HashMap::new();
        m.insert(k("old-pos"), entry(true, 0));
        m.insert(k("old-neg"), entry(false, 0));
        m.insert(k("new-neg"), entry(false, now - 10));
        // Written before keys named the repository: its answer may belong to another clone.
        m.insert("tip:target".to_string(), entry(true, now));
        prune(&mut m, now);
        let mut keys: Vec<_> = m.keys().cloned().collect();
        keys.sort();
        assert_eq!(keys, [k("new-neg"), k("old-pos")]);
    }

    #[test]
    fn older_keys_of_one_repo_in_other_spellings_merge_into_one_and_keep_the_positive() {
        let mut m = HashMap::new();
        m.insert(format!("C:\\Ws\\R{SEP}tip{SEP}t"), entry(true, 1));
        m.insert(format!("C:/Ws/R/{SEP}tip{SEP}t"), entry(false, 5));
        m.insert(format!("C:/Ws/R{SEP}other{SEP}t"), entry(false, 3));
        let m = rekey(m);
        let wanted = format!("{}{SEP}tip{SEP}t", crate::paths::path_key("C:/Ws/R"));
        assert!(m.get(&wanted).is_some_and(|e| e.evidence.is_some()), "the positive answer survives: {:?}", m.keys().collect::<Vec<_>>());
        assert_eq!(m.len(), 2);
        let git = Git::new("C:\\Ws\\R\\");
        assert_eq!(key(&git, "tip", "t"), wanted, "lookups use the same key");
    }

    #[test]
    fn linked_worktrees_share_the_answers_of_their_repository_and_the_main_copy_keeps_its_key() {
        let (main, linked, clone) = (Git::new("C:\\Ws\\Shared"), Git::new("C:\\Ws\\Shared-wt"), Git::new("C:\\Ws\\Shared-clone"));
        note_repo(&main, "C:/Ws/Shared/.git");
        note_repo(&linked, "C:/Ws/Shared/.git");
        note_repo(&clone, "C:/Ws/Shared-clone/.git");
        assert_eq!(key(&linked, "tip", "t"), key(&main, "tip", "t"));
        let before = format!("{}{SEP}tip{SEP}t", crate::paths::path_key("C:\\Ws\\Shared"));
        assert_eq!(key(&main, "tip", "t"), before, "answers stored before stay found");
        assert_ne!(key(&clone, "tip", "t"), key(&main, "tip", "t"), "another clone has refs of its own");
    }

    #[test]
    fn the_cap_drops_the_oldest_negatives_first_then_the_oldest_positives() {
        let mut m = HashMap::new();
        for i in 0..MAX_ENTRIES + 2 {
            m.insert(k(&format!("n{i}")), entry(false, i as i64));
        }
        m.insert(k("pos"), entry(true, 0));
        prune(&mut m, MAX_ENTRIES as i64);
        assert_eq!(m.len(), MAX_ENTRIES);
        assert!(m.contains_key(&k("pos")) && !m.contains_key(&k("n0")) && !m.contains_key(&k("n2")));

        let mut p = HashMap::new();
        for i in 0..MAX_ENTRIES + 1 {
            p.insert(k(&format!("p{i}")), entry(true, i as i64));
        }
        prune(&mut p, 0);
        assert_eq!(p.len(), MAX_ENTRIES);
        assert!(!p.contains_key(&k("p0")), "positives are capped too");
    }

    #[tokio::test]
    async fn the_squash_probe_is_the_same_object_every_time() {
        let dir = tempfile::tempdir().unwrap();
        // The test's own commits carry an old fixed date: a probe dated by the clock stands out from them.
        const OLD: &str = "1500000000 +0000";
        let run = |args: &[&str]| {
            let o = std::process::Command::new("git").args(args).current_dir(dir.path()).env("GIT_AUTHOR_DATE", OLD).env("GIT_COMMITTER_DATE", OLD).output().unwrap();
            assert!(o.status.success(), "{args:?}: {}", String::from_utf8_lossy(&o.stderr));
            String::from_utf8_lossy(&o.stdout).trim().to_string()
        };
        run(&["init", "-q"]);
        for (i, f) in ["a", "b"].iter().enumerate() {
            std::fs::write(dir.path().join(f), f).unwrap();
            run(&["add", f]);
            run(&["-c", "user.name=T", "-c", "user.email=t@x", "commit", "-q", "--no-gpg-sign", "-m", &format!("c{i}")]);
        }
        let git = Git::new(dir.path());
        let (tip, base) = (run(&["rev-parse", "HEAD"]), run(&["rev-parse", "HEAD~1"]));
        let first = squash_probe(&git, &tip, &base).await.unwrap();
        let objects = run(&["count-objects"]);
        assert_eq!(squash_probe(&git, &tip, &base).await.unwrap(), first, "asked again, the same commit");
        assert_eq!(run(&["count-objects"]), objects, "no new loose object");
        // Content, parent, names and message are fixed; so are its dates, instead of the time it was made:
        // a probe made a second, a day or a year later is the same commit.
        let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_secs();
        let dates = run(&["show", "-s", "--format=%at %ct", &first]);
        for at in dates.split(' ').map(|d| d.parse::<u64>().unwrap()) {
            assert!(now.abs_diff(at) > 86_400, "the probe is dated {dates}, the time it was made");
        }
    }

    #[tokio::test]
    async fn the_merge_base_alone_tells_an_ancestor() {
        let dir = tempfile::tempdir().unwrap();
        let run = |args: &[&str]| {
            let o = std::process::Command::new("git").args(args).current_dir(dir.path()).output().unwrap();
            assert!(o.status.success(), "{args:?}: {}", String::from_utf8_lossy(&o.stderr));
            String::from_utf8_lossy(&o.stdout).trim().to_string()
        };
        let commit = |msg: &str| run(&["-c", "user.name=T", "-c", "user.email=t@x", "commit", "-q", "--no-gpg-sign", "--allow-empty", "-m", msg]);
        run(&["init", "-q", "-b", "main"]);
        commit("a");
        let old = run(&["rev-parse", "HEAD"]);
        commit("b");
        run(&["switch", "-q", "-c", "side", &old]);
        commit("own");
        let side = run(&["rev-parse", "HEAD"]);
        let git = Git::new(dir.path());
        let kind = |tip: &str| {
            let git = git.clone();
            let tip = tip.to_string();
            async move { probe(&git, &tip, "main").await.unwrap().map(|e| e.kind) }
        };
        assert_eq!(kind(&old).await, Some(MergeKind::Ancestor));
        assert_eq!(kind(&old.to_uppercase()).await, Some(MergeKind::Ancestor), "however the id is spelled");
        assert_eq!(kind("side~1").await, Some(MergeKind::Ancestor), "a name is asked as it is");
        assert_ne!(kind(&side).await, Some(MergeKind::Ancestor), "a commit of its own");
    }

    #[tokio::test]
    async fn a_clone_takes_the_answer_another_found_for_the_same_commits() {
        let dir = tempfile::tempdir().unwrap();
        let run = |args: &[&str]| {
            let o = std::process::Command::new("git").args(args).current_dir(dir.path()).output().unwrap();
            assert!(o.status.success(), "{args:?}: {}", String::from_utf8_lossy(&o.stderr));
            String::from_utf8_lossy(&o.stdout).trim().to_string()
        };
        run(&["init", "-q", "-b", "main"]);
        std::fs::write(dir.path().join("a"), "a").unwrap();
        run(&["add", "a"]);
        run(&["-c", "user.name=T", "-c", "user.email=t@x", "commit", "-q", "--no-gpg-sign", "-m", "a"]);
        let tip = run(&["rev-parse", "HEAD"]);
        run(&["-c", "user.name=T", "-c", "user.email=t@x", "commit", "-q", "--no-gpg-sign", "--allow-empty", "-m", "b"]);
        let target_sha = run(&["rev-parse", "HEAD"]);
        let found = merged_into(&Git::new(dir.path()), &tip, "main", None, Some(&target_sha)).await.unwrap();
        assert_eq!(found.map(|e| e.kind), Some(MergeKind::Ancestor));
        // Another working copy with the same commits: answered without a git call (there is no repository
        // here to ask), for the target name it asked about.
        let other = tempfile::tempdir().unwrap();
        let shared = merged_into(&Git::new(other.path()), &tip, "refs/remotes/origin/main", None, Some(&target_sha)).await.unwrap();
        assert_eq!(shared.map(|e| (e.kind, e.target)), Some((MergeKind::Ancestor, "refs/remotes/origin/main".to_string())));
        // A target at another commit is asked anew, here of a folder that is no repository: the answer
        // may differ there.
        assert!(merged_into(&Git::new(other.path()), &tip, "refs/remotes/origin/release", None, Some(&tip)).await.is_err());
    }

    #[test]
    fn the_cache_survives_a_restart() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("sub").join("merge-evidence.json");
        CACHE.lock().unwrap().insert(k("tip"), entry(true, now()));
        save_cache(&file);
        load_cache(&file);
        assert!(CACHE.lock().unwrap().get(&k("tip")).is_some_and(|e| e.evidence.is_some()));
        load_cache(&dir.path().join("missing.json"));
        assert!(CACHE.lock().unwrap().contains_key(&k("tip")), "a missing file changes nothing");
    }
}

