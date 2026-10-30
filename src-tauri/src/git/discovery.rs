use std::collections::HashSet;
use std::path::{Path, PathBuf};

use super::runner::Git;

const SKIP_DIRS: &[&str] = &[
    "node_modules", "bin", "obj", ".vs", ".idea", ".git", "target", "packages", ".svelte-kit", "dist",
    // Removed worktrees on another volume than the backups wait here; they are no repositories to list.
    crate::gitops::copies::TRASH,
];

const COMMON_DIR_PARALLEL: usize = 8;

pub struct FoundRepo {
    pub path: PathBuf,
    pub root: String,
}

/// Finds repositories below the roots. Linked worktrees share branches with their main repository,
/// so repositories are deduplicated by their common git dir.
pub async fn discover(roots: &[String], max_depth: u32) -> Vec<FoundRepo> {
    discover_keyed(roots, max_depth).await.into_iter().map(|(r, _)| r).collect()
}

/// `discover`, with the common git dir of each repository as git names it; None where git could not say.
pub async fn discover_keyed(roots: &[String], max_depth: u32) -> Vec<(FoundRepo, Option<String>)> {
    // The walk is plain file system work, slow on a network drive: off the async threads.
    let roots = roots.to_vec();
    let mut candidates = tokio::task::spawn_blocking(move || {
        let mut candidates = Vec::new();
        for root in &roots {
            let root_path = PathBuf::from(root);
            if root_path.is_dir() {
                walk(&root_path, 0, max_depth, root, &mut candidates);
            }
        }
        // Main worktrees (".git" is a directory) win over linked worktrees of the same repository.
        candidates.sort_by_key(|(p, _): &(PathBuf, String)| !p.join(".git").is_dir());
        candidates
    })
    .await
    .unwrap_or_default();

    let paths: Vec<PathBuf> = candidates.iter().map(|(p, _)| p.clone()).collect();
    let commons = crate::bounded::bounded(paths, COMMON_DIR_PARALLEL, |p| async move { common_dir(&p).await }).await;
    let mut seen = HashSet::new();
    let mut found = Vec::new();
    for ((path, root), common) in candidates.drain(..).zip(commons) {
        let unique = common.as_ref().map_or_else(|| path.clone(), |(_, canonical)| canonical.clone());
        if seen.insert(unique) {
            found.push((FoundRepo { path, root }, common.map(|(raw, _)| raw)));
        }
    }
    found.sort_by(|a, b| a.0.path.cmp(&b.0.path));
    found
}

fn walk(dir: &Path, depth: u32, max_depth: u32, root: &str, out: &mut Vec<(PathBuf, String)>) {
    if dir.join(".git").exists() {
        out.push((dir.to_path_buf(), root.to_string()));
        return;
    }
    if depth >= max_depth {
        return;
    }
    let Ok(entries) = std::fs::read_dir(dir) else { return };
    for entry in entries.flatten() {
        let Ok(ft) = entry.file_type() else { continue };
        if !ft.is_dir() || ft.is_symlink() {
            continue;
        }
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if SKIP_DIRS.iter().any(|s| s.eq_ignore_ascii_case(&name)) {
            continue;
        }
        walk(&entry.path(), depth + 1, max_depth, root, out);
    }
}

/// As git prints it, and canonical for comparing: two spellings of one folder are one repository.
async fn common_dir(path: &Path) -> Option<(String, PathBuf)> {
    let out = Git::new(path)
        .out(&["rev-parse", "--path-format=absolute", "--git-common-dir"])
        .await
        .ok()?;
    let raw = out.trim().to_string();
    let p = PathBuf::from(&raw);
    Some((raw, std::fs::canonicalize(&p).unwrap_or(p)))
}
