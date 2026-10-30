//! How an assessment lands in the state: only the newest of a repo, with the online part kept or
//! dropped by the rule of the full scan.

use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicU64, Ordering};

use crate::analysis::RepoScan;
use crate::model::*;

use super::{lock, under_roots, AppState};

/// Every assessment of a repo gets a number when it starts; a result lands only when no assessment
/// that started later has landed already. A rescan after a watcher event and a scan that started
/// before it run side by side, and the scan's older view must not overwrite the rescan's. The server
/// branches count apart from the local result: a late online job must not bring back the branches a
/// delete on the server just removed.
#[derive(Default)]
pub(crate) struct Generations {
    next: AtomicU64,
    pub(crate) local: Landed,
    pub(crate) online: Landed,
}

/// Which assessment of each repo landed last, for one kind of result.
#[derive(Default)]
pub(crate) struct Landed(std::sync::Mutex<HashMap<String, u64>>);

impl Landed {
    /// The guard is held while the result is written, so two results of one repo land one after the other.
    fn admit(&self, path: &str, generation: u64) -> Option<std::sync::MutexGuard<'_, HashMap<String, u64>>> {
        let mut landed = lock(&self.0);
        if landed.get(path).is_some_and(|&g| g > generation) {
            return None;
        }
        landed.insert(path.to_string(), generation);
        Some(landed)
    }

    pub(crate) fn retain(&self, keep: impl Fn(&str) -> bool) {
        lock(&self.0).retain(|p, _| keep(p));
    }

    fn of(&self, path: &str) -> Option<u64> {
        lock(&self.0).get(path).copied()
    }
}

impl Generations {
    pub fn begin(&self) -> u64 {
        self.next.fetch_add(1, Ordering::SeqCst) + 1
    }

    pub fn admit(&self, path: &str, generation: u64) -> Option<std::sync::MutexGuard<'_, HashMap<String, u64>>> {
        self.local.admit(path, generation)
    }

    /// Every online assessment of `path` that started before now comes too late.
    pub fn supersede_online(&self, path: &str) {
        let now = self.begin();
        self.online.admit(path, now);
    }
}

/// Whether the fetch before an online assessment reached the server: this assessment's own fetch when
/// it had one, otherwise the last known answer. Nothing known is "no", never "yes".
pub(crate) fn online_fetched(last: Option<bool>, fetched: Option<bool>) -> bool {
    fetched.or(last).unwrap_or(false)
}

/// Every map of the state is keyed by `path_key`: the watcher, discovery, the window and the cache
/// spell one folder in different ways, and an entry under another spelling is a second entry.
fn key(path: &str) -> String {
    crate::paths::path_key(path)
}

impl AppState {
    /// A local scan does not assess the server branches. For a copy that is still assessed the
    /// previous online result stays until the new one arrives; for one that is no longer assessed
    /// (another copy took over, or it was excluded) it is dropped, or it would be listed forever.
    fn remember(&self, r: &mut RepoResult, keep_online: bool) {
        let k = key(&r.repo.path);
        let mut map = lock(&self.results);
        if r.online.is_none() && keep_online {
            if let Some(old) = map.get(&k) {
                r.online = old.online.clone();
                r.online_at = old.online_at;
                r.online_fetched = old.online_fetched;
            }
        }
        map.insert(k, r.clone());
    }

    /// Stores an assessment unless one of the same repo that started later is stored already.
    pub(crate) fn land(&self, generation: u64, scan: &mut RepoScan, keep_online: bool) -> bool {
        let k = key(&scan.result.repo.path);
        let Some(_landed) = self.generations.admit(&k, generation) else { return false };
        if let Some((root, detail)) = lock(&self.unwatched).get(&k).cloned() {
            scan.result.warnings.push(RepoWarning::NotWatched { root, detail });
        }
        self.assessed(&k, scan.fingerprint);
        self.remember(&mut scan.result, keep_online);
        true
    }

    /// The stored result of a repo, e.g. the answer when a newer assessment landed first.
    pub(crate) fn result_of(&self, path: &str) -> Option<RepoResult> {
        lock(&self.results).get(&key(path)).cloned()
    }

    /// One branch of the stored result of a repo.
    pub(crate) fn branch_report(&self, path: &str, branch: &str) -> Option<BranchReport> {
        lock(&self.results).get(&key(path))?.branches.iter().find(|b| b.name == branch).cloned()
    }

    /// The repository a working copy belongs to, as its last result named it.
    pub(crate) fn identity_of(&self, path: &str) -> Option<String> {
        lock(&self.results).get(&key(path)).map(|r| r.repo.identity.clone())
    }

    /// Stores the server branches unless an online assessment that started later, or a delete on the
    /// server, came first; then None. Otherwise whether the fetch before it reached the server.
    pub(crate) fn land_online(&self, generation: u64, path: &str, online: Vec<RemoteBranchReport>, at: i64, fetched: Option<bool>) -> Option<bool> {
        let _landed = self.generations.online.admit(&key(path), generation)?;
        Some(self.remember_online(path, online, at, fetched))
    }

    /// The server branches as stored now, when, and whether their fetch reached the server.
    pub(crate) fn online_of(&self, path: &str) -> (Vec<RemoteBranchReport>, i64, bool) {
        let map = lock(&self.results);
        let r = map.get(&key(path));
        (r.and_then(|r| r.online.clone()).unwrap_or_default(), r.and_then(|r| r.online_at).unwrap_or(0), r.is_some_and(|r| r.online_fetched))
    }

    /// Returns whether the fetch before the assessment reached the server (see `online_fetched`).
    fn remember_online(&self, path: &str, online: Vec<RemoteBranchReport>, at: i64, fetched: Option<bool>) -> bool {
        let mut map = lock(&self.results);
        let Some(r) = map.get_mut(&key(path)) else { return online_fetched(None, fetched) };
        r.online = Some(online);
        r.online_at = Some(at);
        r.online_fetched = online_fetched(Some(r.online_fetched), fetched);
        r.online_fetched
    }

    pub(crate) fn set_online_fetched(&self, path: &str, fetched: bool) {
        if let Some(r) = lock(&self.results).get_mut(&key(path)) {
            r.online_fetched = fetched;
        }
    }

    pub(crate) fn forget_online(&self, path: &str) {
        if let Some(r) = lock(&self.results).get_mut(&key(path)) {
            r.online = None;
            r.online_at = None;
        }
    }

    /// Server branches a delete removed must not be offered again from the stored online list, nor by
    /// an online assessment that started before the delete.
    pub(crate) fn drop_online_branches<'a>(&self, deleted: impl Iterator<Item = (&'a str, &'a str)>) {
        let deleted: Vec<(String, &str)> = deleted.map(|(repo, branch)| (key(repo), branch)).collect();
        // Before the results are locked: landing takes the generations first, then the results.
        for (repo, _) in &deleted {
            self.generations.supersede_online(repo);
        }
        let mut map = lock(&self.results);
        for (repo, branch) in deleted {
            if let Some(list) = map.get_mut(&repo).and_then(|x| x.online.as_mut()) {
                list.retain(|b| b.name != branch);
            }
        }
    }

    /// The working copies of an identity whose results are known, as the primary-copy rule reads them.
    pub(crate) fn copies_of(&self, identity: &str) -> Vec<String> {
        lock(&self.results).values().filter(|r| r.repo.identity == identity).map(|r| r.repo.path.clone()).collect()
    }

    /// The working copy whose result holds the server branches of an identity; of several (one went out
    /// of reach and another took over), the one assessed last.
    pub(crate) fn online_holder(&self, identity: &str) -> Option<String> {
        lock(&self.results)
            .values()
            .filter(|r| r.repo.identity == identity && r.online.is_some())
            .max_by_key(|r| r.online_at)
            .map(|r| r.repo.path.clone())
    }

    /// Drops what is known of repos a full scan no longer found. A repo below a folder that is missing
    /// right now (a network drive offline) keeps its entries: it is not gone, only out of reach. Which
    /// folders are there is asked before any lock is taken, off the async threads.
    pub(crate) async fn prune(&self, found: &HashSet<String>, roots: &[String]) {
        let mut missing: Vec<String> = Vec::new();
        for r in roots {
            if !self.reach.root(r).await {
                missing.push(r.clone());
            }
        }
        // Statuses are per worktree, and linked worktrees are not in `found`: one stays while its folder does.
        let worktrees: Vec<String> = lock(&self.statuses).values().map(|s| s.path.clone()).filter(|p| under_roots(p, roots) && !under_roots(p, &missing)).collect();
        let there = futures::future::join_all(worktrees.iter().map(|p| super::reach::is_dir(p))).await;
        let present: HashSet<String> = worktrees.iter().zip(there).filter(|(_, t)| *t).map(|(p, _)| key(p)).collect();
        let found: HashSet<String> = found.iter().map(|p| key(p)).collect();
        let keep = |k: &str| found.contains(k) || under_roots(k, &missing);
        let identities: HashSet<String> = {
            let mut results = lock(&self.results);
            results.retain(|k, _| keep(k));
            results.values().map(|r| r.repo.identity.clone()).collect()
        };
        lock(&self.assessed).retain(|k, _| keep(k));
        lock(&self.prs).retain(|id, _| identities.contains(id));
        self.generations.local.retain(keep);
        self.generations.online.retain(keep);
        lock(&self.statuses).retain(|_, s| under_roots(&s.path, &missing) || present.contains(&key(&s.path)));
    }

    /// The earlier assessment a scan may take over: only while the watcher reported nothing since.
    /// Asking clears the mark, so whatever happens from now on is seen by this assessment or the next.
    /// The flag says no watcher saw the repo since that assessment started: it comes from before the
    /// restart, or from before the watcher started (the start's first stage), and its worktrees' files
    /// must be checked first.
    pub(crate) fn previous(&self, path: &str) -> (Option<(u64, RepoResult)>, bool) {
        let k = key(path);
        let touched = lock(&self.touched).remove(&k);
        let since = lock(&self.watched_since).get(&k).copied();
        let seen = matches!((since, self.generations.local.of(&k)), (Some(since), Some(landed)) if landed > since);
        let fingerprint = lock(&self.assessed).get(&k).copied();
        let earlier = lock(&self.results).get(&k).cloned();
        match (fingerprint, earlier) {
            (Some(f), Some(e)) if !touched => (Some((f, e)), !seen),
            _ => (None, false),
        }
    }

    /// The watcher now covers `repos` except those named in `failed`. A repo watched before keeps its
    /// mark: the new watcher was running before the old one stopped.
    pub(crate) fn watching(&self, repos: &[String], failed: &[crate::watch::UnwatchedRoot]) {
        let since = self.generations.begin();
        let failed_keys: HashSet<String> = failed.iter().map(|f| key(&f.repo)).collect();
        let mut map = lock(&self.watched_since);
        let before = std::mem::take(&mut *map);
        for k in repos.iter().map(|r| key(r)).filter(|k| !failed_keys.contains(k)) {
            let at = before.get(&k).copied().unwrap_or(since);
            map.insert(k, at);
        }
        *lock(&self.unwatched) = failed.iter().map(|f| (key(&f.repo), (f.root.clone(), f.detail.clone()))).collect();
    }

    /// No fingerprint (failed, or an input unreadable): the next scan assesses again.
    fn assessed(&self, k: &str, fingerprint: Option<u64>) {
        let mut map = lock(&self.assessed);
        match fingerprint {
            Some(f) => map.insert(k.to_string(), f),
            None => map.remove(k),
        };
    }

    /// The watcher saw a change in the repo: its next assessment reads everything again.
    pub(crate) fn touch(&self, path: &str) {
        lock(&self.touched).insert(key(path));
    }

    pub(crate) fn untouch(&self, path: &str) {
        lock(&self.touched).remove(&key(path));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_result_lands_only_when_no_later_assessment_landed_first() {
        let g = Generations::default();
        let scan = g.begin();
        let rescan = g.begin();
        assert!(g.admit("C:/r", rescan).is_some(), "the rescan started later and lands");
        assert!(g.admit("C:/r", scan).is_none(), "the scan that started before it comes too late");
        assert!(g.admit("C:/other", scan).is_some(), "per repo");
        let next = g.begin();
        assert!(g.admit("C:/r", next).is_some(), "a newer one lands again");
    }

    #[test]
    fn an_online_assessment_from_before_a_delete_does_not_bring_the_branch_back() {
        let dir = tempfile::tempdir().unwrap();
        let state = AppState::with_dir(crate::config::Config::default(), Vec::new(), dir.path().to_path_buf());
        let branch = |name: &str| -> RemoteBranchReport {
            serde_json::from_value(serde_json::json!({
                "repoPath": "C:/r", "remote": "origin", "name": name, "sha": "a", "lastCommitAt": 0, "lastCommitSubject": "",
                "lastCommitAuthor": "", "isMine": false, "verdict": "Merged", "merged": true, "openPr": false,
                "mergeEvidence": null, "pullRequest": null, "ownCommitCount": 0, "locked": false
            }))
            .unwrap()
        };
        let result: RepoResult = serde_json::from_value(serde_json::json!({
            "repo": { "path": "C:/r", "name": "r", "root": "C:/", "provider": "None", "remoteUrl": null, "defaultBranch": null, "identity": "id", "links": null },
            "fetched": true, "fetchError": null, "fetchErrorKind": null, "localBranchCount": 0, "branches": [], "tracking": [],
            "online": null, "warnings": [], "error": null, "errorKind": null, "durationMs": 0
        }))
        .unwrap();
        lock(&state.results).insert(key("C:/r"), result);
        let both = || vec![branch("done/a"), branch("done/b")];
        assert_eq!(state.land_online(state.generations.begin(), "C:/r", both(), 1, Some(true)), Some(true));

        let late = state.generations.begin();
        state.drop_online_branches([("C:/r", "done/a")].into_iter());
        assert_eq!(state.land_online(late, "C:/r", both(), 2, Some(true)), None, "started before the delete");
        let (kept, at, _) = state.online_of("C:/r");
        assert_eq!(kept.iter().map(|b| b.name.as_str()).collect::<Vec<_>>(), ["done/b"]);
        assert_eq!(at, 1);
        assert!(state.land_online(state.generations.begin(), "C:/r", vec![branch("done/b")], 3, None).is_some(), "one after it lands");
    }

    #[test]
    fn an_assessment_from_before_the_watcher_started_is_taken_over_only_after_its_files_are_read() {
        let dir = tempfile::tempdir().unwrap();
        let state = AppState::with_dir(crate::config::Config::default(), Vec::new(), dir.path().to_path_buf());
        let result: RepoResult = serde_json::from_value(serde_json::json!({
            "repo": { "path": "C:/r", "name": "r", "root": "C:/", "provider": "None", "remoteUrl": null, "defaultBranch": null, "identity": "id", "links": null },
            "fetched": false, "fetchError": null, "fetchErrorKind": null, "localBranchCount": 0, "branches": [], "tracking": [],
            "online": null, "warnings": [], "error": null, "errorKind": null, "durationMs": 0
        }))
        .unwrap();
        let land = |state: &AppState| {
            let mut scan = RepoScan { result: result.clone(), prs: None, prs_asked_at: None, prs_capped: false, fingerprint: Some(7), default_ref: None };
            assert!(state.land(state.generations.begin(), &mut scan, false));
        };
        // The start's first stage: no watcher yet.
        land(&state);
        assert!(state.previous("C:/r").1, "nothing watched it: its files are read first");
        state.watching(&["C:/r".to_string()], &[]);
        assert!(state.previous("C:/r").1, "assessed before the watcher started: still read first");
        land(&state);
        assert!(!state.previous("C:/r").1, "assessed while watched: taken over as it is");
        state.watching(&["C:/r".to_string()], &[]);
        assert!(!state.previous("C:/r").1, "watched on without a gap");

        let failed = crate::watch::UnwatchedRoot { repo: "C:/r".into(), root: "C:/r/.git".into(), detail: "denied".into() };
        state.watching(&["C:/r".to_string()], std::slice::from_ref(&failed));
        assert!(state.previous("C:/r").1, "a folder of it is not watched");
        let mut scan = RepoScan { result: result.clone(), prs: None, prs_asked_at: None, prs_capped: false, fingerprint: Some(7), default_ref: None };
        state.land(state.generations.begin(), &mut scan, false);
        assert!(scan.result.warnings.iter().any(|w| matches!(w, RepoWarning::NotWatched { root, .. } if root == "C:/r/.git")));
    }

    #[test]
    fn the_server_counts_as_reached_only_when_a_fetch_said_so() {
        assert!(!online_fetched(None, None), "nothing known: not reached");
        assert!(!online_fetched(Some(false), None), "a local scan keeps the last answer");
        assert!(online_fetched(Some(true), None));
        assert!(!online_fetched(Some(true), Some(false)), "this fetch failed");
        assert!(online_fetched(None, Some(true)));
    }
}
