//! Finding repositories below the roots.
mod common;

use common::*;
use mcbranchface_lib::git::discovery::discover;

#[tokio::test]
async fn finds_repos_to_the_depth_skips_build_folders_and_counts_worktrees_once() {
    let f = Fixture::new();
    let root = f.work.parent().unwrap().join("root");
    // A removed worktree waiting next to its old place, on a volume without the backups.
    for p in ["a", "deep/er/still/x", "node_modules/pkg", "team/b", ".mcbranchface-trash/1-old"] {
        let d = root.join(p);
        std::fs::create_dir_all(&d).unwrap();
        git(&d, &["init", "-q"]);
    }
    git(&f.work, &["worktree", "add", "-q", root.join("team/wt").to_str().unwrap(), "-b", "wt"]);
    std::fs::write(root.join("file.txt"), "not a folder").unwrap();

    let roots = vec![root.to_string_lossy().to_string(), root.join("missing").to_string_lossy().to_string()];
    let found = discover(&roots, 2).await;
    let names: Vec<String> = found.iter().map(|r| r.path.strip_prefix(&root).unwrap().to_string_lossy().replace(std::path::MAIN_SEPARATOR, "/")).collect();
    assert_eq!(names, ["a", "team/b", "team/wt"]);
    assert!(found.iter().all(|r| r.root == roots[0]));

    // The main repository and its linked worktree: listed once, as the main one.
    let both = vec![f.work.to_string_lossy().to_string(), root.join("team").to_string_lossy().to_string()];
    let found = discover(&both, 1).await;
    assert!(found.iter().any(|r| r.path == f.work));
    assert!(!found.iter().any(|r| r.path.ends_with("wt")));
}
