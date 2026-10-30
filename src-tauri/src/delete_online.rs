//! Deleting branches on the server. Stronger checks than locally, because others may use them:
//! each server branch must still be exactly what the user saw, it must be merged unless forced,
//! and its tip is kept in a local backup ref so a restore can push it back.
//! Branches of one repository go to the server together: one `ls-remote`, one push.

use std::collections::{BTreeMap, HashMap};
use std::path::Path;
use std::time::Duration;

use crate::actions::Env;
use crate::backup_refs;
use crate::delete::{create_ref, discard, failure, from_network_err, from_network_output, short, warning, Step};
use crate::git::identity;
use crate::git::runner::Git;
use crate::git::snapshot::now;
use crate::git::{merged, refs};
use crate::model::*;

use DeleteStep as S;
use FailureKind as K;

/// Shorter than a fetch: these calls move no data, and a dead VPN must not block the dialog.
pub const TIMEOUT: Duration = Duration::from_secs(60);

/// The name comes from the UI and goes to git as an argument: only a remote the repo really has is
/// accepted, so a value like "--upload-pack=…" can never act as an option.
pub(crate) async fn is_remote(git: &Git, name: &str) -> bool {
    git.out(&["remote"]).await.is_ok_and(|out| out.lines().any(|l| l.trim() == name))
}

/// One branch, with the pull requests of `env` as those of its repository.
pub async fn delete(env: &Env<'_>, req: &RemoteDeleteRequest) -> Step<DeleteOutcome> {
    let prs: HashMap<String, Vec<PullRequestInfo>> = env.cached_prs.iter().map(|p| (req.repo_path.clone(), p.clone())).collect();
    let mut r = delete_many(env, std::slice::from_ref(req), &prs).await;
    let r = r.remove(0);
    match (r.outcome, r.failure) {
        (Some(o), _) => Ok(o),
        (None, Some(f)) => Err(f),
        (None, None) => Err(failure(K::Other, S::Branch, "no result")),
    }
}

/// One result per request, in request order. `prs` holds the pull requests per repository, keyed by
/// the repo path as the requests name it; `env.cached_prs` is not read here.
pub async fn delete_many(env: &Env<'_>, reqs: &[RemoteDeleteRequest], prs: &HashMap<String, Vec<PullRequestInfo>>) -> Vec<RemoteDeleteResult> {
    let mut groups: Vec<((String, &str), Vec<usize>)> = Vec::new();
    for (i, r) in reqs.iter().enumerate() {
        let key = (crate::paths::path_key(&r.repo_path), r.remote.as_str());
        match groups.iter_mut().find(|(k, _)| *k == key) {
            Some((_, list)) => list.push(i),
            None => groups.push((key, vec![i])),
        }
    }
    let mut results: Vec<Option<RemoteDeleteResult>> = vec![None; reqs.len()];
    for ((_, remote), idx) in groups {
        let group: Vec<&RemoteDeleteRequest> = idx.iter().map(|&i| &reqs[i]).collect();
        let repo = group[0].repo_path.as_str();
        let repo_prs = prs.get(repo).map(Vec::as_slice);
        for (i, r) in idx.iter().zip(delete_group(env, repo, remote, repo_prs, &group).await) {
            results[*i] = Some(r);
        }
    }
    results
        .into_iter()
        .zip(reqs)
        .map(|(r, req)| r.unwrap_or_else(|| failed(req, failure(K::Other, S::Verify, "no result"))))
        .collect()
}

fn failed(req: &RemoteDeleteRequest, f: DeleteFailure) -> RemoteDeleteResult {
    RemoteDeleteResult { repo_path: req.repo_path.clone(), branch: req.branch.clone(), outcome: None, failure: Some(f) }
}

struct Ready<'a> {
    slot: usize,
    req: &'a RemoteDeleteRequest,
    sha: String,
    backup_ref: String,
    merged: bool,
}

async fn delete_group(env: &Env<'_>, repo: &str, remote: &str, prs: Option<&[PullRequestInfo]>, reqs: &[&RemoteDeleteRequest]) -> Vec<RemoteDeleteResult> {
    let fail_all = |f: DeleteFailure| reqs.iter().map(|r| failed(r, f.clone())).collect::<Vec<_>>();
    if !Path::new(repo).is_dir() {
        return fail_all(failure(K::RepoMissing, S::Verify, repo));
    }
    let git = Git::new(repo);
    if !is_remote(&git, remote).await {
        return fail_all(failure(K::InvalidName, S::Verify, format!("'{remote}' is not a remote of this repo")));
    }
    let url = match identity::origin_url_checked(&git).await {
        Ok(url) => url,
        Err(e) => return fail_all(failure(K::ConfigUnreadable, S::Verify, format!("{e:#}"))),
    };
    let id = identity::repo_identity(&git, url.as_deref()).await;

    // --- verify against the server itself, not the last fetch: one call for all branches.
    let server = match git.raw_with_timeout(&["ls-remote", "--heads", remote], TIMEOUT).await {
        Ok(o) if o.success() => crate::server_check::parse_server(&o.stdout),
        Ok(o) => return fail_all(from_network_output(S::Verify, &o)),
        Err(e) => return fail_all(from_network_err(S::Verify, e)),
    };

    let ts = now();
    let default = refs::default_branch(&git, env.config, repo).await.ok().flatten();
    let mut results: Vec<Option<RemoteDeleteResult>> = vec![None; reqs.len()];
    let mut ready = Vec::new();
    for (slot, req) in reqs.iter().enumerate() {
        match check(env, &git, &id, &server, default.as_deref(), prs, req).await {
            Err(f) => results[slot] = Some(failed(req, f)),
            Ok((sha, merged)) => {
                let second = backup_refs::free_second(&git, ts, |s| vec![backup_refs::remote(s, remote, &req.branch)]).await;
                let backup_ref = backup_refs::remote(second, remote, &req.branch);
                match create_ref(&git, &backup_ref, &sha).await {
                    Ok(()) => ready.push(Ready { slot, req, sha, backup_ref, merged }),
                    Err(f) => results[slot] = Some(failed(req, f)),
                }
            }
        }
    }

    if !ready.is_empty() {
        // --- the one destructive step, for all verified branches at once. Each delete carries the
        // tip that was verified: a commit pushed since the check makes the server refuse that one.
        let targets: Vec<String> = ready.iter().map(|r| format!("refs/heads/{}", r.req.branch)).collect();
        let leases: Vec<String> = ready.iter().zip(&targets).map(|(r, t)| format!("--force-with-lease={t}:{}", r.sha)).collect();
        let mut args = vec!["push", "--porcelain"];
        args.extend(leases.iter().map(String::as_str));
        args.extend([remote, "--delete"]);
        args.extend(targets.iter().map(String::as_str));
        let pushed = git.raw_with_timeout(&args, TIMEOUT).await;
        let (lines, whole) = match &pushed {
            Ok(o) => (parse_push(&o.stdout), (!o.success()).then(|| from_network_output(S::Branch, o))),
            Err(e) => (HashMap::new(), Some(from_network_err(S::Branch, anyhow::anyhow!("{e:#}")))),
        };
        let whole = whole.unwrap_or_else(|| failure(K::Other, S::Branch, "no push result"));
        let mut unclear = Vec::new();
        for r in ready {
            let target = format!("refs/heads/{}", r.req.branch);
            match lines.get(&target) {
                Some(PushLine { flag: '-', .. }) => results[r.slot] = Some(journal(env, &r, remote, ts, None)),
                Some(PushLine { summary, .. }) => {
                    discard(&git, std::slice::from_ref(&r.backup_ref)).await;
                    results[r.slot] = Some(failed(r.req, failure(push_refusal(summary), S::Branch, summary.clone())));
                }
                // A timeout or a connection that broke off: the server may have deleted it all the same.
                None => unclear.push(r),
            }
        }
        if !unclear.is_empty() {
            // Asked again, so a backup is never discarded for a branch that is gone.
            let now = match git.raw_with_timeout(&["ls-remote", "--heads", remote], TIMEOUT).await {
                Ok(o) if o.success() => Some(crate::server_check::parse_server(&o.stdout)),
                _ => None,
            };
            for r in unclear {
                let result = match settle(&r.sha, now.as_ref().map(|s| s.get(&r.req.branch))) {
                    Settled::Gone => journal(env, &r, remote, ts, Some(warning(whole.kind, S::Branch, whole.detail.clone(), None))),
                    Settled::Kept => {
                        discard(&git, std::slice::from_ref(&r.backup_ref)).await;
                        failed(r.req, whole.clone())
                    }
                    Settled::Moved => {
                        discard(&git, std::slice::from_ref(&r.backup_ref)).await;
                        failed(r.req, failure(K::Changed, S::Branch, format!("{}; the branch moved on the server", whole.detail)))
                    }
                    // The backup ref stays: "Recently deleted" adopts it, and its restore sees what is true.
                    Settled::Unknown => failed(r.req, DeleteFailure { path: Some(r.backup_ref.clone()), ..failure(K::OutcomeUnknown, S::Branch, whole.detail.clone()) }),
                };
                results[r.slot] = Some(result);
            }
        }
    }
    results
        .into_iter()
        .zip(reqs)
        .map(|(r, req)| r.unwrap_or_else(|| failed(req, failure(K::Other, S::Branch, "no result"))))
        .collect()
}

async fn check(
    env: &Env<'_>,
    git: &Git,
    id: &str,
    server: &BTreeMap<String, String>,
    default: Option<&str>,
    prs: Option<&[PullRequestInfo]>,
    req: &RemoteDeleteRequest,
) -> Step<(String, bool)> {
    if env.config.is_locked(id, &req.branch) {
        return Err(failure(K::Locked, S::Verify, format!("{id} {}", req.branch)));
    }
    // The settings of now, not those of the scan: a pattern added since protects the branch already.
    if env.config.is_protected(&req.branch) {
        return Err(failure(K::NoLongerCandidate, S::Verify, format!("{} is protected", req.branch)));
    }
    if default == Some(format!("refs/remotes/{}/{}", req.remote, req.branch).as_str()) {
        return Err(failure(K::NoLongerCandidate, S::Verify, format!("{} is the default branch", req.branch)));
    }
    let Some(sha) = server.get(&req.branch).cloned() else {
        return Err(failure(K::NoLongerCandidate, S::Verify, format!("{} not on {}", req.branch, req.remote)));
    };
    if sha != req.expected_sha {
        return Err(failure(K::Changed, S::Verify, format!("{} -> {}", short(&req.expected_sha), short(&sha))));
    }
    // The backup needs the commit locally; after a fresh fetch it always is.
    if !git.commit_exists(&sha).await.unwrap_or(false) {
        return Err(failure(K::Changed, S::Verify, format!("{} not available locally", short(&sha))));
    }
    // The rule of the online assessment: an open pull request keeps its branch alive, and deleting the
    // branch would close it.
    let source = format!("refs/heads/{}", req.branch);
    if !req.force && prs.unwrap_or_default().iter().any(|p| p.state == PrState::Open && p.source_ref == source) {
        return Err(failure(K::NoLongerSafe, S::Verify, "an open pull request uses it"));
    }
    let merged = evidence(git, default, prs, &req.branch, &sha).await;
    if !req.force && !merged {
        return Err(failure(K::NoLongerSafe, S::Verify, "no merge evidence"));
    }
    Ok((sha, merged))
}

/// What a push without an answer for a branch did, by what the server shows now.
#[derive(Debug, PartialEq)]
enum Settled {
    /// Gone: the delete went through.
    Gone,
    /// Still at the tip that was verified: nothing happened.
    Kept,
    /// At another tip: someone pushed meanwhile, and the delete did not happen.
    Moved,
    /// The server could not be asked.
    Unknown,
}

/// `now`: the branch's tip on the server, None inside when it is not there; None when not asked.
fn settle(sha: &str, now: Option<Option<&String>>) -> Settled {
    match now {
        None => Settled::Unknown,
        Some(None) => Settled::Gone,
        Some(Some(s)) if s == sha => Settled::Kept,
        Some(Some(_)) => Settled::Moved,
    }
}

fn journal(env: &Env<'_>, r: &Ready<'_>, remote: &str, ts: i64, note: Option<DeleteWarning>) -> RemoteDeleteResult {
    let id_name = format!("{remote}-{}", r.req.branch);
    let entry = DeletedEntry {
        forced: r.req.force,
        verdict: if r.merged { Verdict::Safe } else { Verdict::Review },
        remote: Some(remote.to_string()),
        ..DeletedEntry::new(&r.req.repo_path, &r.req.branch, &id_name, &r.sha, &r.backup_ref, ts)
    };
    let mut warnings: Vec<DeleteWarning> = note.into_iter().collect();
    if let Err(e) = env.journal.append(&entry) {
        warnings.push(warning(K::Other, S::Journal, format!("{e:#}"), Some(entry.backup_ref.clone())));
    }
    RemoteDeleteResult {
        repo_path: r.req.repo_path.clone(),
        branch: r.req.branch.clone(),
        outcome: Some(DeleteOutcome { entry, used_force_flag: false, warnings, files_backup: None }),
        failure: None,
    }
}

/// Same evidence as the online assessment: content on the default branch, or a completed PR
/// that contains the tip. Always checked fresh, never from a shortcut of the cache.
async fn evidence(git: &Git, default: Option<&str>, prs: Option<&[PullRequestInfo]>, branch: &str, sha: &str) -> bool {
    if let Some(default) = default {
        if let Ok(Some(_)) = merged::merged_into_fresh(git, sha, default).await {
            return true;
        }
    }
    let source = format!("refs/heads/{branch}");
    for p in prs.unwrap_or_default().iter().filter(|p| p.source_ref == source && p.state == PrState::Merged) {
        if let Some(src) = &p.source_sha {
            if src == sha || git.is_ancestor(sha, src).await.unwrap_or(false) {
                return true;
            }
        }
    }
    false
}

#[derive(Debug, Clone, PartialEq)]
struct PushLine {
    flag: char,
    summary: String,
}

/// `git push --porcelain`: `<flag>\t<from>:<to>\t<summary>` per ref; `-` deleted, `!` rejected.
fn parse_push(out: &str) -> HashMap<String, PushLine> {
    out.lines()
        .filter_map(|l| {
            let mut parts = l.splitn(3, '\t');
            let flag = parts.next()?.chars().next()?;
            let spec = parts.next()?;
            let to = spec.rsplit_once(':').map(|(_, t)| t).unwrap_or(spec).to_string();
            Some((to, PushLine { flag, summary: parts.next().unwrap_or("").to_string() }))
        })
        .filter(|(to, _)| to.starts_with("refs/"))
        .collect()
}

/// Why the server kept a ref. "stale info" is the lease: the branch moved after the check.
fn push_refusal(summary: &str) -> FailureKind {
    if summary.contains("stale info") {
        return K::Changed;
    }
    match crate::failure::classify(summary) {
        K::Other => K::Rejected,
        k => k,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_failed_lease_means_the_branch_moved() {
        let p = parse_push("!\t(delete):refs/heads/b\t[rejected] (stale info)\n");
        assert_eq!(push_refusal(&p["refs/heads/b"].summary), K::Changed);
        assert_eq!(push_refusal("[remote rejected] (pre-receive hook declined)"), K::Rejected);
        assert_eq!(push_refusal("something odd"), K::Rejected);
    }

    #[test]
    fn porcelain_push_per_ref() {
        let out = "To C:/o.git\n-\t:refs/heads/a\t[deleted]\n!\t:refs/heads/b\t[remote rejected] (pre-receive hook declined)\nDone\n";
        let p = parse_push(out);
        assert_eq!(p["refs/heads/a"].flag, '-');
        assert_eq!(p["refs/heads/b"].flag, '!');
        assert!(p["refs/heads/b"].summary.contains("pre-receive"));
        assert_eq!(p.len(), 2);
    }

    #[test]
    fn a_push_without_an_answer_is_settled_by_what_the_server_shows() {
        let tip = "a".repeat(40);
        let other = "b".repeat(40);
        assert_eq!(settle(&tip, Some(None)), Settled::Gone, "deleted after all: journalled, the backup stays");
        assert_eq!(settle(&tip, Some(Some(&tip))), Settled::Kept);
        assert_eq!(settle(&tip, Some(Some(&other))), Settled::Moved);
        assert_eq!(settle(&tip, None), Settled::Unknown, "not asked: the backup stays");
    }

    #[test]
    fn a_timeout_counts_as_network() {
        assert_eq!(crate::failure::classify("'git' timed out"), K::Network);
    }
}
