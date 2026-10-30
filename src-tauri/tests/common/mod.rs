#![allow(dead_code)]

use std::path::{Path, PathBuf};
use std::process::Command;

use mcbranchface_lib::analysis::{self, ScanOptions};
use mcbranchface_lib::config::Config;
use mcbranchface_lib::git::discovery::FoundRepo;
use mcbranchface_lib::git::snapshot::SnapshotStore;
use mcbranchface_lib::journal::Journal;
use mcbranchface_lib::model::*;

#[path = "../../src/test_env.rs"]
mod test_env;

pub const EMAIL: &str = "dev@example.com";

pub fn git(dir: &Path, args: &[&str]) -> String {
    let out = Command::new("git")
        .args(args)
        .current_dir(dir)
        .env("LC_ALL", "C")
        .env("GIT_AUTHOR_NAME", "Dev")
        .env("GIT_AUTHOR_EMAIL", EMAIL)
        .env("GIT_COMMITTER_NAME", "Dev")
        .env("GIT_COMMITTER_EMAIL", EMAIL)
        .output()
        .unwrap();
    assert!(out.status.success(), "git {args:?} in {}: {}", dir.display(), String::from_utf8_lossy(&out.stderr));
    String::from_utf8_lossy(&out.stdout).trim().to_string()
}

pub fn commit(dir: &Path, file: &str, content: &str, msg: &str) {
    std::fs::write(dir.join(file), content).unwrap();
    git(dir, &["add", file]);
    git(dir, &["commit", "-q", "-m", msg]);
}

pub struct Fixture {
    pub _tmp: tempfile::TempDir,
    pub work: PathBuf,
    pub server: PathBuf,
    pub data: PathBuf,
}

impl Fixture {
    pub fn new() -> Self {
        let tmp = tempfile::tempdir().unwrap();
        let base = tmp.path().to_path_buf();
        let origin = base.join("origin.git");
        std::fs::create_dir_all(&origin).unwrap();
        git(&origin, &["init", "-q", "--bare", "-b", "main"]);

        let work = base.join("work");
        git(&base, &["clone", "-q", origin.to_str().unwrap(), "work"]);
        for (k, v) in [("user.name", "Dev"), ("user.email", EMAIL), ("commit.gpgsign", "false")] {
            git(&work, &["config", k, v]);
        }
        commit(&work, "readme.txt", "base\n", "initial");
        git(&work, &["push", "-q", "-u", "origin", "main"]);
        git(&work, &["remote", "set-head", "origin", "main"]);

        let server = base.join("server");
        git(&base, &["clone", "-q", origin.to_str().unwrap(), "server"]);
        for (k, v) in [("user.name", "Server"), ("user.email", "server@example.com"), ("commit.gpgsign", "false")] {
            git(&server, &["config", k, v]);
        }
        Self { _tmp: tmp, work, server, data: base.join("appdata") }
    }

    /// Creates a branch in the work clone with one file per commit and pushes it with upstream.
    pub fn pushed_branch(&self, name: &str, commits: usize) {
        git(&self.work, &["switch", "-q", "-c", name, "main"]);
        for i in 0..commits {
            let file = format!("{}-{i}.txt", name.replace('/', "_"));
            commit(&self.work, &file, &format!("{name} {i}\n"), &format!("{name} commit {i}"));
        }
        git(&self.work, &["push", "-q", "-u", "origin", name]);
        git(&self.work, &["switch", "-q", "main"]);
    }

    pub fn on_server(&self, script: impl FnOnce(&Path)) {
        git(&self.server, &["fetch", "-q", "--prune"]);
        git(&self.server, &["switch", "-q", "main"]);
        git(&self.server, &["reset", "-q", "--hard", "origin/main"]);
        script(&self.server);
        git(&self.server, &["push", "-q", "origin", "main"]);
    }

    pub fn delete_remote(&self, name: &str) {
        git(&self.server, &["push", "-q", "origin", "--delete", name]);
    }

    pub fn config(&self) -> Config {
        Config { my_emails: vec![EMAIL.into()], ..Config::default() }
    }

    pub fn store(&self) -> SnapshotStore {
        SnapshotStore::new(self.data.join("snapshots"))
    }

    pub fn journal(&self) -> Journal {
        Journal::new(self.data.join("deleted.jsonl"))
    }

    pub async fn scan(&self, fetch: bool) -> RepoResult {
        let found = FoundRepo { path: self.work.clone(), root: String::new() };
        let opts = ScanOptions { fetch, providers: false, ..Default::default() };
        let r = analysis::scan_repo(&found, &self.config(), &self.store(), opts).await.result;
        assert!(r.error.is_none(), "scan error: {:?}", r.error);
        r
    }
}

pub fn find<'a>(r: &'a RepoResult, name: &str) -> &'a BranchReport {
    r.branches.iter().find(|b| b.name == name).unwrap_or_else(|| {
        panic!("{name} fehlt; gefunden: {:?}", r.branches.iter().map(|b| &b.name).collect::<Vec<_>>())
    })
}
