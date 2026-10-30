//! A repository the user names, cloned into a folder the user chose. The only operation here that
//! starts from nothing: no repository exists yet, so no repo lock applies.

use std::path::Path;
use std::sync::Arc;
use std::time::Duration;

use tokio::sync::Notify;

use crate::failure;
use crate::git::runner::{Git, Prompts};
use crate::model::*;
use crate::process::ProcError;

use super::ops::{fail, parse_progress, Op};

/// A large repository over a slow line takes long; a stalled transfer ends earlier on its own.
const CLONE_TIMEOUT: Duration = Duration::from_secs(1800);

/// `url` is whatever `git clone` accepts (a link or a path), `target` the absolute folder that becomes
/// the working copy; it may exist if it is empty. A half-made clone is removed, also after a cancel.
/// The user started it, so a sign-in may ask.
pub async fn clone_repo(url: &str, target: &str, cancel: Arc<Notify>, mut on_progress: impl FnMut(String, Option<u32>) + Send) -> Op<OpResult> {
    let op = GitOp::Clone;
    let url = url.trim();
    // A leading dash would be read as an option, `--upload-pack=…` among them.
    if url.is_empty() || url.starts_with('-') {
        return Err(fail(op, FailureKind::InvalidName, format!("'{url}' is not a repository address")));
    }
    let path = Path::new(target);
    if !path.is_absolute() {
        return Err(fail(op, FailureKind::InvalidName, format!("'{target}' is not an absolute path")));
    }
    let taken = path.exists() && std::fs::read_dir(path).map(|mut d| d.next().is_some()).unwrap_or(true);
    if taken {
        return Err(OpFailure { path: Some(crate::paths::slashes(target)), ..fail(op, FailureKind::AlreadyExists, format!("{target} exists and is not empty")) });
    }
    let parent = path.parent().unwrap_or(path);
    std::fs::create_dir_all(parent).map_err(|e| OpFailure { path: Some(crate::paths::slashes(&parent.to_string_lossy())), ..fail(op, failure::classify_local(&e.to_string()), e.to_string()) })?;

    let out = Git::new(parent)
        .stream_network(&["clone", "--progress", "--", url, target], Prompts::Allowed, CLONE_TIMEOUT, cancel, |line| {
            if let Some((phase, pct)) = parse_progress(line) {
                on_progress(phase, pct);
            }
        })
        .await;
    let failed = match out {
        Err(ProcError::Cancelled) => Some(fail(op, FailureKind::Cancelled, "cancelled")),
        Err(e) => Some(OpFailure { kind: failure::classify(&e.to_string()), ..fail(op, FailureKind::Other, e.to_string()) }),
        Ok(o) if !o.success() => {
            let text = o.error_text();
            Some(OpFailure { kind: failure::classify(&text), path: failure::lock_path(&text), ..fail(op, FailureKind::Other, text) })
        }
        Ok(_) => None,
    };
    if let Some(f) = failed {
        // Only what this call made goes: the folder was missing or empty before.
        let _ = std::fs::remove_dir_all(path);
        return Err(f);
    }
    let sha = Git::new(path).out(&["rev-parse", "HEAD"]).await.ok().map(|s| s.trim().to_string());
    Ok(OpResult { sha, ..Default::default() })
}
