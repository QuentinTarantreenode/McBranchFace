//! Whether folders are there, asked off the async threads. On a network drive that went away a single
//! `is_dir` blocks for many seconds; asked on an async thread, or while a lock is held, it stalls
//! everything else. Each configured root is probed once and the answer kept for a while: a repo below
//! a root out of reach is out of reach too, without asking the drive again.

use std::collections::HashMap;
use std::path::Path;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

/// How long the answer for a root stands.
const FRESH: Duration = Duration::from_secs(30);

/// Whether the root was there, and when that was asked.
type Answer = (bool, Instant);

#[derive(Default)]
pub struct Reach {
    roots: Mutex<HashMap<String, Arc<tokio::sync::Mutex<Option<Answer>>>>>,
}

/// `Path::is_dir` on a blocking thread.
pub async fn is_dir(path: &str) -> bool {
    let path = path.to_string();
    tokio::task::spawn_blocking(move || Path::new(&path).is_dir()).await.unwrap_or(false)
}

impl Reach {
    /// Whether the root folder is there; one probe at a time per root, the others wait for its answer.
    pub async fn root(&self, root: &str) -> bool {
        let slot = self.roots.lock().unwrap_or_else(|p| p.into_inner()).entry(crate::paths::path_key(root)).or_default().clone();
        let mut known = slot.lock().await;
        if let Some((there, at)) = *known {
            if at.elapsed() < FRESH {
                return there;
            }
        }
        let there = is_dir(root).await;
        *known = Some((there, Instant::now()));
        there
    }

    /// Whether the folder is there: false at once when the root it lies in is out of reach.
    pub async fn folder(&self, path: &str, roots: &[String]) -> bool {
        if let Some(root) = roots.iter().find(|r| crate::paths::is_under(path, r)) {
            if !self.root(root).await {
                return false;
            }
        }
        is_dir(path).await
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn a_root_out_of_reach_answers_for_the_folders_below_it() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("root");
        let repo = root.join("repo");
        std::fs::create_dir_all(&repo).unwrap();
        let (root_s, repo_s) = (root.to_string_lossy().to_string(), repo.to_string_lossy().to_string());
        let reach = Reach::default();
        let roots = vec![root_s.clone()];
        assert!(reach.folder(&repo_s, &roots).await);
        std::fs::remove_dir_all(&root).unwrap();
        assert!(reach.root(&root_s).await, "the answer stands for a while");
        assert!(!is_dir(&repo_s).await);
        assert!(!reach.folder(&dir.path().join("elsewhere").to_string_lossy(), &roots).await, "a folder outside every root is asked itself");
    }
}
