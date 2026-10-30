//! The cache files of the app data folder: their names and versions, how an older version is cleaned
//! up, and how they are written off the async threads.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

use crate::git::merged;
use crate::model::*;

use super::{lock, AppState};

/// Bumped whenever a cache changes shape: an old cache is ignored instead of failing to parse, and
/// removed at the next start (see `remove_old_caches`).
pub(crate) const RESULTS_CACHE: &str = "last-scan-v5.json";
pub(crate) const MERGE_CACHE: &str = "merge-evidence-v2.json";
pub(crate) const STATUS_CACHE: &str = "status-v1.json";
/// v2: entries carry author names and reviewers; a start without fetch never asks for them again.
/// v3: each list carries when it was read, so a failed query can say how old the stand-in is.
/// v4: one list per repository identity instead of per working copy; v3 is carried over at start.
pub(crate) const PRS_CACHE: &str = "pull-requests-v4.json";
pub(crate) const PRS_CACHE_V3: &str = "pull-requests-v3.json";
/// v2: the fingerprints are FNV-1a over other inputs; v1 values never match them.
pub(crate) const ASSESSED_CACHE: &str = "assessed-v2.json";
const CACHE_FILES: [&str; 5] = [RESULTS_CACHE, MERGE_CACHE, STATUS_CACHE, PRS_CACHE, ASSESSED_CACHE];

/// Removes the files of older versions of the caches in `dir` (`last-scan-v4.json` beside
/// `last-scan-v5.json`, and their temporary files): nothing reads them any more, and some are
/// megabytes. Only names of exactly that pattern with a lower version go; returns what went.
pub(crate) fn remove_old_caches(dir: &Path) -> Vec<PathBuf> {
    let current: Vec<(&str, u32)> = CACHE_FILES.iter().filter_map(|f| versioned(f)).collect();
    let Ok(entries) = std::fs::read_dir(dir) else { return Vec::new() };
    let mut removed = Vec::new();
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        let Some((stem, version)) = versioned(name.strip_suffix(".tmp").unwrap_or(&name)) else { continue };
        let older = current.iter().any(|(s, v)| *s == stem && version < *v);
        if older && entry.file_type().is_ok_and(|t| t.is_file()) && std::fs::remove_file(entry.path()).is_ok() {
            removed.push(entry.path());
        }
    }
    removed
}

/// `last-scan-v5.json` → ("last-scan", 5).
fn versioned(name: &str) -> Option<(&str, u32)> {
    let (stem, version) = name.strip_suffix(".json")?.rsplit_once("-v")?;
    Some((stem, version.parse().ok()?))
}

/// A provider's list for one repo, and when it was read.
#[derive(Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CachedPrs {
    pub at: i64,
    pub list: Vec<PullRequestInfo>,
    /// The provider gave as many as it was asked for; read again from the cache, the list is just as
    /// incomplete as it was then.
    #[serde(default)]
    pub capped: bool,
}

/// The last results and when the last full scan finished. The time is part of the file, not its
/// modification time: other writes of the file must not make an old scan look new.
#[derive(Default, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ResultsCache {
    pub scanned_at: Option<i64>,
    pub results: Vec<RepoResult>,
}

#[derive(Clone, Copy, PartialEq)]
pub(crate) enum Cache {
    Results,
    Prs,
    Assessed,
    Statuses,
    MergeEvidence,
}

pub(crate) fn read_cache<T: serde::de::DeserializeOwned + Default>(path: &Path) -> T {
    std::fs::read_to_string(path).ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default()
}

/// Keys of older caches as the folder was spelled; one folder in two spellings counts once, and
/// where the two disagree neither is kept (a fingerprint that may be wrong only costs an assessment).
pub(crate) fn rekey<T: PartialEq>(map: HashMap<String, T>) -> HashMap<String, T> {
    let mut out: HashMap<String, T> = HashMap::with_capacity(map.len());
    let mut torn = Vec::new();
    for (k, v) in map {
        let k = crate::paths::path_key(&k);
        match out.get(&k) {
            Some(kept) if *kept != v => torn.push(k),
            Some(_) => {}
            None => {
                out.insert(k, v);
            }
        }
    }
    for k in torn {
        out.remove(&k);
    }
    out
}

/// The pull request lists of v3, one per working copy, as one per repository: the identity comes from
/// the copy's last result, and of several copies the list read last wins. Lists of copies no result
/// names any more are dropped.
pub(crate) fn prs_by_identity(per_copy: HashMap<String, CachedPrs>, results: &HashMap<String, RepoResult>) -> HashMap<String, CachedPrs> {
    let mut out: HashMap<String, CachedPrs> = HashMap::new();
    for (path, prs) in per_copy {
        let Some(id) = results.get(&crate::paths::path_key(&path)).map(|r| r.repo.identity.clone()) else { continue };
        if out.get(&id).is_none_or(|kept| kept.at < prs.at) {
            out.insert(id, prs);
        }
    }
    out
}

/// Cache files, written off the async threads. Each write carries the number of its snapshot, and an
/// older snapshot that is slower to write never replaces a newer one.
pub(crate) struct CacheFiles {
    pub dir: PathBuf,
    seq: AtomicU64,
    written: Arc<std::sync::Mutex<HashMap<&'static str, u64>>>,
}

impl CacheFiles {
    pub fn new(dir: PathBuf) -> Self {
        Self { dir, seq: AtomicU64::new(0), written: Default::default() }
    }

    /// Taken while the data is snapshotted, under the lock that guards it.
    fn next(&self) -> u64 {
        self.seq.fetch_add(1, Ordering::SeqCst) + 1
    }

    async fn write<T: serde::Serialize + Send + 'static>(&self, name: &'static str, seq: u64, value: T) {
        let (dir, written) = (self.dir.clone(), self.written.clone());
        let _ = tokio::task::spawn_blocking(move || {
            let Ok(json) = serde_json::to_string(&value) else { return };
            let mut last = written.lock().unwrap_or_else(|p| p.into_inner());
            if last.get(name).is_some_and(|&s| s > seq) {
                return;
            }
            let tmp = dir.join(format!("{name}.tmp"));
            if std::fs::create_dir_all(&dir).and_then(|_| std::fs::write(&tmp, json)).and_then(|_| std::fs::rename(&tmp, dir.join(name))).is_ok() {
                last.insert(name, seq);
            }
        })
        .await;
    }
}

impl AppState {
    /// Writes the chosen caches; the data is copied under its lock, serialized and written outside.
    pub(crate) async fn persist(&self, which: &[Cache]) {
        for cache in which {
            match cache {
                Cache::Results => {
                    let (seq, value) = {
                        let map = lock(&self.results);
                        let scanned_at = *lock(&self.scanned_at);
                        (self.caches.next(), ResultsCache { scanned_at, results: map.values().cloned().collect() })
                    };
                    self.caches.write(RESULTS_CACHE, seq, value).await;
                }
                Cache::Prs => {
                    let (seq, value) = {
                        let map = lock(&self.prs);
                        (self.caches.next(), map.clone())
                    };
                    self.caches.write(PRS_CACHE, seq, value).await;
                }
                Cache::Assessed => {
                    let (seq, value) = {
                        let map = lock(&self.assessed);
                        (self.caches.next(), map.clone())
                    };
                    self.caches.write(ASSESSED_CACHE, seq, value).await;
                }
                Cache::Statuses => {
                    let (seq, value) = {
                        let map = lock(&self.statuses);
                        (self.caches.next(), map.values().cloned().collect::<Vec<RepoStatus>>())
                    };
                    self.caches.write(STATUS_CACHE, seq, value).await;
                }
                Cache::MergeEvidence => {
                    let file = self.caches.dir.join(MERGE_CACHE);
                    let _ = tokio::task::spawn_blocking(move || merged::save_cache(&file)).await;
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn caches_of_older_versions_are_removed_and_nothing_else() {
        let dir = tempfile::tempdir().unwrap();
        let keep = ["last-scan-v5.json", "pull-requests-v4.json", "assessed-v2.json", "merge-evidence-v2.json", "status-v1.json", "notes.json", "last-scan-v9.json", "other-v1.json"];
        let gone = ["last-scan-v4.json", "last-scan-v4.json.tmp", "pull-requests-v1.json", "pull-requests-v2.json", "pull-requests-v3.json", "assessed-v1.json", "merge-evidence-v1.json"];
        for f in keep.iter().chain(&gone) {
            std::fs::write(dir.path().join(f), "{}").unwrap();
        }
        std::fs::create_dir(dir.path().join("status-v0.json")).unwrap();
        let mut removed: Vec<String> = remove_old_caches(dir.path()).iter().map(|p| p.file_name().unwrap().to_string_lossy().into_owned()).collect();
        removed.sort();
        let mut expected: Vec<String> = gone.iter().map(|s| s.to_string()).collect();
        expected.sort();
        assert_eq!(removed, expected);
        for f in keep {
            assert!(dir.path().join(f).exists(), "{f}");
        }
        assert!(dir.path().join("status-v0.json").is_dir(), "only files");
        assert!(remove_old_caches(&dir.path().join("missing")).is_empty());
    }

    #[test]
    fn old_caches_keyed_by_folder_spelling_come_back_under_one_key() {
        let old = HashMap::from([("C:\\ws\\a".to_string(), 7u64), ("C:/ws/a/".to_string(), 7), ("C:/ws/b".to_string(), 1), ("c:/ws/B/".to_string(), 2)]);
        let new = rekey(old);
        assert_eq!(new.get(&crate::paths::path_key("C:/ws/a")), Some(&7));
        if cfg!(windows) {
            assert!(!new.contains_key(&crate::paths::path_key("C:/ws/b")), "two spellings that disagree: neither stands");
        }
    }

    #[test]
    fn pull_requests_of_the_copies_of_one_repository_become_one_list() {
        let result = |path: &str, id: &str| -> RepoResult {
            serde_json::from_value(serde_json::json!({
                "repo": { "path": path, "name": "r", "root": "C:/", "provider": "None", "remoteUrl": null, "defaultBranch": null, "identity": id, "links": null },
                "fetched": false, "fetchError": null, "fetchErrorKind": null, "localBranchCount": 0, "branches": [], "tracking": [],
                "online": null, "warnings": [], "error": null, "errorKind": null, "durationMs": 0
            }))
            .unwrap()
        };
        let results: HashMap<String, RepoResult> = [result("C:/ws/a", "shop"), result("C:/ws/a-2", "shop"), result("C:/ws/c", "core")]
            .into_iter()
            .map(|r| (crate::paths::path_key(&r.repo.path), r))
            .collect();
        let per_copy = HashMap::from([
            ("C:\\ws\\a".to_string(), CachedPrs { at: 5, list: Vec::new(), capped: false }),
            ("C:/ws/a-2".to_string(), CachedPrs { at: 9, list: Vec::new(), capped: false }),
            ("C:/ws/gone".to_string(), CachedPrs { at: 9, list: Vec::new(), capped: false }),
        ]);
        let by_id = prs_by_identity(per_copy, &results);
        assert_eq!(by_id.len(), 1);
        assert_eq!(by_id["shop"].at, 9, "the list read last");
    }
}
