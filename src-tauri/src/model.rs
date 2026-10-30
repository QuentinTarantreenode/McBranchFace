use serde::{Deserialize, Serialize};
#[cfg(test)]
use ts_rs::TS;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(test, derive(TS))]
#[cfg_attr(test, ts(export))]
pub enum ProviderKind {
    Azure,
    GitHub,
    None,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(test, derive(TS))]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, ts(export))]
pub struct RepoInfo {
    pub path: String,
    pub name: String,
    pub root: String,
    pub provider: ProviderKind,
    pub remote_url: Option<String>,
    pub default_branch: Option<String>,
    /// Same value for every working copy of one repository (normalized origin URL, else root commit).
    pub identity: String,
    pub links: Option<RepoLinks>,
}

/// Web pages of the repository at its provider.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(test, derive(TS))]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, ts(export))]
pub struct RepoLinks {
    pub home: String,
    pub pull_requests: String,
    /// Contains `{branch}` where the branch name goes.
    pub branch: String,
}

/// Non-fatal findings of a repository scan, as data (the UI words them).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(test, derive(TS))]
#[serde(tag = "code", content = "p")]
#[cfg_attr(test, ts(export))]
pub enum RepoWarning {
    NoDefaultBranch,
    PrListCapped { limit: u32 },
    /// The provider gave no list. `fallbackAt`: when the list the assessment used instead was read;
    /// None when there was none, and the assessment had no pull requests at all.
    PrQueryFailed {
        #[serde(default)]
        kind: ProviderFailure,
        detail: String,
        #[serde(default, rename = "fallbackAt")]
        #[cfg_attr(test, ts(type = "number | null"))]
        fallback_at: Option<i64>,
    },
    /// One entry of the provider's list could not be read; the others stand.
    PrUnreadable { id: Option<u32>, detail: String },
    BranchFailed { branch: String, detail: String },
    OnlineFailed { detail: String },
    /// Remotes besides `origin` that a fetch could not reach; `origin` itself was fetched.
    OtherRemotesFailed { remotes: Vec<String>, detail: String },
    /// A folder of the repo the file-system watcher could not observe: its changes show only with a scan.
    NotWatched { root: String, detail: String },
}

/// Why a provider's command line gave no pull requests, so the UI can say what helps.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[cfg_attr(test, derive(TS))]
#[cfg_attr(test, ts(export))]
pub enum ProviderFailure {
    /// Not signed in, or the sign-in expired or has no access.
    LoggedOut,
    /// The server refuses for now: too many requests.
    RateLimited,
    /// az with its DevOps extension, or gh, is not installed.
    ToolMissing,
    Timeout,
    /// The answer could not be read.
    Parse,
    #[default]
    Other,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(test, derive(TS))]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, ts(export))]
pub struct RepoResult {
    pub repo: RepoInfo,
    pub fetched: bool,
    pub fetch_error: Option<String>,
    pub fetch_error_kind: Option<FailureKind>,
    pub local_branch_count: u32,
    pub branches: Vec<BranchReport>,
    /// Every local branch with an upstream, so the UI can pair local and server branches.
    pub tracking: Vec<TrackingRef>,
    /// Branches on the server; only for the working copy that assesses them for its identity (see
    /// `scan::primary_copy`), None when not scanned.
    pub online: Option<Vec<RemoteBranchReport>>,
    /// When `online` was assessed, and whether the fetch before it reached the server.
    #[cfg_attr(test, ts(type = "number | null"))]
    #[serde(default)]
    pub online_at: Option<i64>,
    #[serde(default)]
    pub online_fetched: bool,
    pub warnings: Vec<RepoWarning>,
    pub error: Option<String>,
    pub error_kind: Option<FailureKind>,
    pub duration_ms: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(test, derive(TS))]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, ts(export))]
pub struct TrackingRef {
    pub branch: String,
    pub remote: String,
    /// Branch name on the server, without `refs/heads/`.
    pub remote_branch: String,
    pub gone: bool,
    pub ahead: u32,
    pub behind: u32,
    pub checked_out: bool,
}

/// Assessment of a branch on the server.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(test, derive(TS))]
#[cfg_attr(test, ts(export))]
pub enum OnlineVerdict {
    /// Content is on the default branch (merge, rebase, squash) or a completed PR contains the tip.
    Merged,
    /// Not merged and no commit for `stale_days`, no open PR.
    Inactive,
    /// Recent commits or an open PR.
    Active,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(test, derive(TS))]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, ts(export))]
pub struct RemoteBranchReport {
    /// Working copy the branch was assessed in.
    pub repo_path: String,
    pub remote: String,
    pub name: String,
    pub sha: String,
    #[cfg_attr(test, ts(type = "number"))]
    pub last_commit_at: i64,
    pub last_commit_subject: String,
    pub last_commit_author: String,
    pub is_mine: bool,
    pub verdict: OnlineVerdict,
    /// Facts behind the verdict, so the UI can re-apply the age rule when the threshold changes.
    pub merged: bool,
    /// None: the pull requests are not known (the query failed or was not made yet); the branch may
    /// have an open one, so age alone never makes it inactive.
    pub open_pr: Option<bool>,
    pub merge_evidence: Option<MergeEvidence>,
    pub pull_request: Option<PullRequestInfo>,
    /// Commits not on the default branch.
    pub own_commit_count: u32,
    pub locked: bool,
    /// Ignored for alerts (bell, notification); still listed and deletable.
    #[serde(default)]
    pub ignored: bool,
}

/// Result per branch of a bulk delete on the server.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(test, derive(TS))]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, ts(export))]
pub struct RemoteDeleteResult {
    pub repo_path: String,
    pub branch: String,
    pub outcome: Option<DeleteOutcome>,
    pub failure: Option<DeleteFailure>,
}

/// Server branches of one repository, sent after the local results of a scan.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(test, derive(TS))]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, ts(export))]
pub struct OnlineScanned {
    pub path: String,
    pub branches: Vec<RemoteBranchReport>,
    /// Server branches that could not be assessed; the others are in `branches`.
    #[serde(default)]
    pub warnings: Vec<RepoWarning>,
    pub error: Option<String>,
    #[cfg_attr(test, ts(type = "number"))]
    pub at: i64,
    pub fetched: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(test, derive(TS))]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, ts(export))]
pub struct RemoteDeleteRequest {
    pub repo_path: String,
    pub remote: String,
    pub branch: String,
    /// Tip seen during the scan; the server branch must still point there.
    pub expected_sha: String,
    /// Deleting a branch without merge evidence; the UI asks for the typed name first.
    pub force: bool,
}

/// Failure of a command, as a code the UI explains plus the raw text for "technical details".
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(test, derive(TS))]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, ts(export))]
pub struct AppError {
    pub code: ErrorCode,
    pub detail: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(test, derive(TS))]
#[cfg_attr(test, ts(export))]
pub enum ErrorCode {
    ScanRunning,
    OnlyWebLinks,
    NoToolCommand,
    EntryNotFound,
    AlreadyRestored,
    BranchExists,
    WorkingTreeDirty,
    NoDefaultBranch,
    PathMissing,
    NoTerminal,
    GitHubDesktopMissing,
    Network,
    AuthRequired,
    Rejected,
    /// A {{name}} in a custom command that is no placeholder or has no value here.
    UnknownPlaceholder,
    /// A value a custom command cannot pass safely to its shell.
    UnsafeValue,
    /// The branch is not in the repository's last assessment any more (deleted or renamed since).
    BranchGone,
    Other,
}

impl AppError {
    pub fn new(code: ErrorCode, detail: impl Into<String>) -> Self {
        Self { code, detail: detail.into() }
    }
}

impl std::fmt::Display for AppError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{:?}: {}", self.code, self.detail)
    }
}

impl std::error::Error for AppError {}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(test, derive(TS))]
#[cfg_attr(test, ts(export))]
pub enum Verdict {
    Safe,
    Review,
    Unsafe,
    Blocked,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(test, derive(TS))]
#[cfg_attr(test, ts(export))]
pub enum CheckOutcome {
    Pass,
    Warn,
    Fail,
    Info,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(test, derive(TS))]
#[cfg_attr(test, ts(export))]
pub enum CheckKind {
    Merged,
    Pushed,
    Worktree,
    Stashes,
    PullRequest,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(test, derive(TS))]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, ts(export))]
pub struct Check {
    pub kind: CheckKind,
    pub outcome: CheckOutcome,
    pub code: CheckCode,
}

/// What a check found, as data; the UI turns it into sentences (single source of wording).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(test, derive(TS))]
#[serde(tag = "code", content = "p")]
#[cfg_attr(test, ts(export))]
pub enum CheckCode {
    Merged { kind: MergeKind, target: String },
    NoDefaultBranch,
    NoMergeEvidence { own: u32, base: String },
    PushUnknown,
    PushStateMissing { sha: String, source: PushSource },
    AllPushed { upstream: String, sha: String, source: PushSource },
    CommitsAfterPush { count: u32, upstream: String, merged: bool },
    /// No upstream of its own: `count` commits are on no remote at all.
    NeverPushed { count: u32, merged: bool },
    NotCheckedOut,
    Dirty { count: u32, path: String },
    CurrentBranch { path: String },
    LinkedWorktree { path: String },
    NoStashes,
    Stashes { count: u32 },
    Pr { id: u32, state: PrState, title: String, target: String },
    NoPr { remote: String },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(test, derive(TS))]
#[cfg_attr(test, ts(export))]
pub enum MergeKind {
    /// Tip is reachable from the target: merge commit or fast-forward.
    Ancestor,
    /// Every own commit has a patch-equivalent commit on the target: rebase or cherry-pick.
    PatchEquivalent,
    /// The combined diff of the branch equals one commit on the target.
    Squash,
    /// Tip is still reachable from another remote branch.
    ContainedInRemote,
    /// A completed pull request contains the tip.
    PullRequest,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(test, derive(TS))]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, ts(export))]
pub struct MergeEvidence {
    pub kind: MergeKind,
    pub target: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(test, derive(TS))]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, ts(export))]
pub struct CommitInfo {
    pub sha: String,
    pub subject: String,
    pub author_email: String,
    #[cfg_attr(test, ts(type = "number"))]
    pub authored_at: i64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(test, derive(TS))]
#[cfg_attr(test, ts(export))]
pub enum PushSource {
    Snapshot,
    PullRequest,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(test, derive(TS))]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, ts(export))]
pub struct PushState {
    /// Last commit known to have been on the remote branch.
    pub sha: String,
    pub source: PushSource,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(test, derive(TS))]
#[cfg_attr(test, ts(export))]
pub enum FileChangeKind {
    Staged,
    Unstaged,
    StagedAndUnstaged,
    Untracked,
    Conflicted,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(test, derive(TS))]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, ts(export))]
pub struct FileChange {
    pub path: String,
    pub kind: FileChangeKind,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(test, derive(TS))]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, ts(export))]
pub struct WorktreeState {
    pub path: String,
    pub is_main: bool,
    pub files: Vec<FileChange>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(test, derive(TS))]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, ts(export))]
pub struct StashInfo {
    pub sha: String,
    pub selector: String,
    pub message: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(test, derive(TS))]
#[cfg_attr(test, ts(export))]
pub enum PrState {
    Open,
    Merged,
    Closed,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(test, derive(TS))]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, ts(export))]
pub struct PullRequestInfo {
    pub id: u32,
    pub title: String,
    pub state: PrState,
    pub url: String,
    /// The id the provider knows the author by (GitHub login, Azure unique name): what "mine" compares.
    pub author: String,
    /// The name people read; None when the provider gave none.
    #[serde(default)]
    pub author_name: Option<String>,
    pub source_ref: String,
    pub target_ref: String,
    pub source_sha: Option<String>,
    /// Unix seconds; None when the provider did not say.
    #[cfg_attr(test, ts(type = "number | null"))]
    pub created_at: Option<i64>,
    /// When it was completed or closed; None while open.
    #[cfg_attr(test, ts(type = "number | null"))]
    pub closed_at: Option<i64>,
    /// The target commit the provider last merged against (Azure), for the commits of the PR.
    pub target_sha: Option<String>,
    /// Who is asked to review and where each stands. Older caches have none.
    #[serde(default)]
    pub reviewers: Vec<PrReviewer>,
    #[serde(default)]
    pub is_draft: bool,
    /// The provider says the source cannot be merged into the target without resolving conflicts.
    #[serde(default)]
    pub has_conflicts: bool,
}

/// One reviewer of a pull request, by the id the provider knows them by (GitHub login, Azure unique name).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[cfg_attr(test, derive(TS))]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, ts(export))]
pub struct PrReviewer {
    pub id: String,
    pub state: ReviewState,
    pub required: bool,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[cfg_attr(test, derive(TS))]
#[cfg_attr(test, ts(export))]
pub enum ReviewState {
    /// Asked, no answer yet.
    Pending,
    Approved,
    /// Changes asked for, or rejected.
    Changes,
    /// Commented or "waiting for author" without a verdict.
    Commented,
}

/// Where a local branch stands on the server.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(test, derive(TS))]
#[cfg_attr(test, ts(export))]
pub enum UpstreamState {
    /// Its upstream was deleted on the server: the branch is orphaned.
    Gone,
    /// Its upstream still exists.
    Live,
    /// No upstream of its own: none, a local one, or the integration line it was cut from.
    None,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(test, derive(TS))]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, ts(export))]
pub struct BranchReport {
    pub repo_path: String,
    pub name: String,
    pub sha: String,
    pub upstream: String,
    pub upstream_state: UpstreamState,
    pub remote_ref: String,
    #[cfg_attr(test, ts(type = "number"))]
    pub last_commit_at: i64,
    pub last_commit_subject: String,
    pub last_commit_author: String,
    pub authors: Vec<String>,
    pub is_mine: bool,
    pub verdict: Verdict,
    pub checks: Vec<Check>,
    pub merge_evidence: Option<MergeEvidence>,
    /// Commits not on the default branch (without one: on no remote). The commits themselves are not
    /// part of the result: every scan event and the results cache carried up to 2 × 200 per branch,
    /// which the window shows for one branch at a time (see `BranchCommits`).
    pub own_commit_count: u32,
    /// Commits after the last known push; 0 where that push is not known here.
    pub unpushed_commit_count: u32,
    /// Commits the live upstream has and the branch lacks; 0 for a gone upstream or none.
    pub behind: u32,
    pub push_state: Option<PushState>,
    pub worktree: Option<WorktreeState>,
    pub stashes: Vec<StashInfo>,
    pub pull_request: Option<PullRequestInfo>,
    /// Locked in the settings: shown apart, never deleted.
    pub locked: bool,
    /// Ignored for alerts (bell, notification); still listed and deletable.
    #[serde(default)]
    pub ignored: bool,
}

/// The commits of one branch, read when the window shows them (detail, commit list, delete dialog,
/// prompt): the same ranges the assessment counts, each list at most `analysis::COMMIT_LIST_LIMIT`.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[cfg_attr(test, derive(TS))]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, ts(export))]
pub struct BranchCommits {
    /// The tip the lists belong to.
    pub sha: String,
    /// Not on the default branch, newest first.
    pub own: Vec<CommitInfo>,
    /// After the last known push; empty where that push is not known here.
    pub unpushed: Vec<CommitInfo>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(test, derive(TS))]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, ts(export))]
pub struct ToolStatus {
    pub id: ToolId,
    pub required: bool,
    pub state: ToolState,
    pub version: Option<String>,
    pub min_version: Option<String>,
    pub account: Option<String>,
    /// Raw output when detection failed unexpectedly.
    pub detail: Option<String>,
    pub download_url: String,
    /// Commands the user can copy or run in a terminal for the current state.
    pub commands: Vec<ToolCommand>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(test, derive(TS))]
#[cfg_attr(test, ts(export))]
pub enum ToolId {
    Git,
    AzureCli,
    GitHubCli,
    GitHubDesktop,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(test, derive(TS))]
#[cfg_attr(test, ts(export))]
pub enum ToolState {
    Ready,
    Missing,
    Outdated,
    NotLoggedIn,
    ExtensionMissing,
    Unknown,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(test, derive(TS))]
#[cfg_attr(test, ts(export))]
pub enum ToolAction {
    Install,
    Login,
    AddExtension,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(test, derive(TS))]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, ts(export))]
pub struct ToolCommand {
    pub action: ToolAction,
    pub command: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(test, derive(TS))]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, ts(export))]
pub struct ScanStarted {
    pub repos: Vec<RepoInfo>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(test, derive(TS))]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, ts(export))]
pub struct ScanFinished {
    pub duration_ms: u32,
    pub repo_count: u32,
    /// Stopped by `cancel_scan`: the results that landed until then stay, the others are as before.
    #[serde(default)]
    pub cancelled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(test, derive(TS))]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, ts(export))]
pub struct DeleteRequest {
    pub repo_path: String,
    pub branch: String,
    /// Tip seen during the scan; deletion is refused when the branch moved since.
    pub expected_sha: String,
    pub force: bool,
    pub drop_stashes: Vec<String>,
    pub remove_worktree: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(test, derive(TS))]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, ts(export))]
pub struct DroppedStash {
    pub sha: String,
    pub message: String,
    pub backup_ref: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(test, derive(TS))]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, ts(export))]
pub struct DeletedEntry {
    pub id: String,
    pub repo_path: String,
    pub branch: String,
    pub sha: String,
    pub upstream_remote: Option<String>,
    pub upstream_merge: Option<String>,
    pub backup_ref: String,
    #[cfg_attr(test, ts(type = "number"))]
    pub deleted_at: i64,
    pub forced: bool,
    pub verdict: Verdict,
    pub dropped_stashes: Vec<DroppedStash>,
    pub removed_worktree: Option<String>,
    #[cfg_attr(test, ts(type = "number | null"))]
    pub restored_at: Option<i64>,
    /// Set for a branch deleted on the server: the remote it was pushed back to on restore.
    #[serde(default)]
    pub remote: Option<String>,
    /// The backup folder of this delete (the staged changes of a removed worktree, and the worktree
    /// folder itself where it could be moved there); purging removes it.
    #[serde(default)]
    pub files_backup: Option<String>,
    /// Where the folder of the removed worktree is now. A restore moves it back.
    #[serde(default)]
    pub worktree_backup: Option<String>,
    /// The branch the removed worktree had checked out; a restore checks it out there again where
    /// it still exists and is free, else the worktree comes back detached at `sha`.
    #[serde(default)]
    pub worktree_branch: Option<String>,
    /// The whole `branch.<name>.*` section (upstream, rebase, push remote, description …) as
    /// `(variable, value)` pairs; `upstream_remote` and `upstream_merge` are kept for older readers.
    #[serde(default)]
    pub branch_config: Vec<(String, String)>,
}

impl DeletedEntry {
    /// The journal record of what a backup ref keeps; callers set what only they know. `id_name`
    /// makes the id readable (branch, `remote-branch`, `stash`).
    pub fn new(repo_path: &str, branch: &str, id_name: &str, sha: &str, backup_ref: &str, ts: i64) -> Self {
        Self {
            id: crate::journal::entry_id(ts, id_name),
            repo_path: repo_path.to_string(),
            branch: branch.to_string(),
            sha: sha.to_string(),
            upstream_remote: None,
            upstream_merge: None,
            backup_ref: backup_ref.to_string(),
            deleted_at: ts,
            forced: false,
            verdict: Verdict::Review,
            dropped_stashes: Vec::new(),
            removed_worktree: None,
            restored_at: None,
            remote: None,
            files_backup: None,
            worktree_backup: None,
            worktree_branch: None,
            branch_config: Vec::new(),
        }
    }

    /// A worktree removed on its own, without a branch delete: it keeps no branch, only the folder.
    pub fn is_worktree_only(&self) -> bool {
        self.branch.is_empty() && self.remote.is_none() && self.removed_worktree.is_some()
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(test, derive(TS))]
#[cfg_attr(test, ts(export))]
pub enum FailureKind {
    /// Tip moved since the scan.
    Changed,
    /// Branch was deleted, renamed or became protected since the scan.
    NoLongerCandidate,
    /// Re-check found the branch no longer safe; only force delete is possible.
    NoLongerSafe,
    /// Checked out in the main worktree; git cannot delete it.
    CurrentBranch,
    /// Checked out in a linked worktree whose removal was not confirmed.
    WorktreeNotConfirmed,
    /// A `.lock` file of another git process (or a stale one) blocks the ref update.
    Lock,
    /// Files are held open by another program.
    FileInUse,
    RepoMissing,
    /// Uncommitted changes would be overwritten (switch, pull).
    LocalChanges,
    InvalidName,
    AlreadyExists,
    NothingToCommit,
    /// Local and remote branch both have new commits; a fast-forward is not possible.
    Diverged,
    /// The remote refused the push (usually: it has commits the local branch lacks).
    Rejected,
    /// No usable credentials; git must not prompt, so the user signs in once in a terminal.
    AuthRequired,
    Network,
    /// A command ran longer than its time limit and was stopped, local or over the network.
    Timeout,
    Cancelled,
    /// Amending would rewrite a commit that is already on the server.
    AlreadyPushed,
    /// The branch tracks a branch of another name; a push would write onto that one.
    UpstreamMismatch,
    /// Locked in the settings.
    Locked,
    /// The branch is checked out in another worktree; git allows it in one place only.
    CheckedOut,
    /// A rebase, merge, cherry-pick, revert or bisect is under way in the worktree.
    OperationInProgress,
    /// The server was asked to delete, but whether it did is not known; the backup ref stays.
    OutcomeUnknown,
    /// git could not read the repository's configuration, so its identity (and its locks) is unknown.
    ConfigUnreadable,
    Other,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(test, derive(TS))]
#[cfg_attr(test, ts(export))]
pub enum DeleteStep {
    Verify,
    Preflight,
    Backup,
    Worktree,
    Branch,
    Stash,
    Journal,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(test, derive(TS))]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, ts(export))]
pub struct DeleteFailure {
    pub kind: FailureKind,
    pub step: DeleteStep,
    /// Raw message of git or the OS; the UI explains the kind, this is for the curious.
    pub detail: String,
    pub path: Option<String>,
    /// Something was already modified before the failure (e.g. a partially removed worktree).
    pub changed: bool,
    /// Where the changed files of the worktree were copied before the failure: it may be gone already.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(test, ts(optional))]
    pub files_backup: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(test, derive(TS))]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, ts(export))]
pub struct DeleteWarning {
    pub kind: FailureKind,
    pub step: DeleteStep,
    pub detail: String,
    pub path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(test, derive(TS))]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, ts(export))]
pub struct DeleteOutcome {
    pub entry: DeletedEntry,
    /// `git branch -d` refused (e.g. squash merge) and `-D` was used on the tool's own evidence.
    pub used_force_flag: bool,
    pub warnings: Vec<DeleteWarning>,
    /// Where the changed files of a removed worktree were copied before it went.
    pub files_backup: Option<String>,
}

// ---- Git perspective ----------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(test, derive(TS))]
#[cfg_attr(test, ts(export))]
pub enum ChangeType {
    Added,
    Modified,
    Deleted,
    Renamed,
    Copied,
    TypeChanged,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(test, derive(TS))]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, ts(export))]
pub struct StatusEntry {
    pub path: String,
    pub orig_path: Option<String>,
    /// Change recorded in the index (what a commit would contain).
    pub staged: Option<ChangeType>,
    /// Change in the working tree that is not staged yet.
    pub unstaged: Option<ChangeType>,
    pub conflicted: bool,
    pub untracked: bool,
}

impl StatusEntry {
    pub fn untracked(path: &str) -> Self {
        Self { path: path.to_string(), orig_path: None, staged: None, unstaged: None, conflicted: false, untracked: true }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(test, derive(TS))]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, ts(export))]
pub struct HeadInfo {
    /// None when HEAD is detached.
    pub branch: Option<String>,
    pub oid: Option<String>,
    pub upstream: Option<String>,
    pub ahead: u32,
    pub behind: u32,
    /// Detached only: commits reachable from HEAD but from no branch; switching away strands them.
    pub unreferenced: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(test, derive(TS))]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, ts(export))]
pub struct WorktreeInfo {
    pub path: String,
    pub branch: Option<String>,
    pub head: Option<String>,
    pub is_main: bool,
    pub detached: bool,
    /// Registered here, but the worktree points to another repository's git directory: a
    /// registration that came along when the repository folder was copied.
    pub foreign: bool,
    /// Detached only: commits on no branch, as for `HeadInfo`.
    pub unreferenced: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(test, derive(TS))]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, ts(export))]
pub struct RepoStatus {
    pub path: String,
    pub head: HeadInfo,
    pub entries: Vec<StatusEntry>,
    pub worktrees: Vec<WorktreeInfo>,
    /// Entries of the stash, shared by every worktree of the repository.
    pub stashes: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(test, derive(TS))]
#[cfg_attr(test, ts(export))]
pub enum ChangeScope {
    /// HEAD, refs or packed-refs: branch switched, created, deleted, fetched.
    Refs,
    /// Index or working-tree files.
    Files,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(test, derive(TS))]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, ts(export))]
pub struct RepoChanged {
    pub path: String,
    pub scopes: Vec<ChangeScope>,
    /// The working copies the change is in; empty when it may concern all of them (the git directory).
    pub paths: Vec<String>,
    /// A few of the files that changed, relative to the repo or its git directory: why it fired.
    pub files: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(test, derive(TS))]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, ts(export))]
pub struct LogEntry {
    pub sha: String,
    pub parents: Vec<String>,
    pub author: String,
    pub email: String,
    #[cfg_attr(test, ts(type = "number"))]
    pub time: i64,
    pub subject: String,
    /// Branch and tag names pointing at this commit.
    pub refs: Vec<String>,
}

/// A commit found by message, author or SHA, with every branch that contains it.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(test, derive(TS))]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, ts(export))]
pub struct CommitHit {
    pub commit: LogEntry,
    /// Local branch names.
    pub local: Vec<String>,
    /// Remote-tracking names like `origin/main`.
    pub remote: Vec<String>,
}

/// The hits in one working copy; `error` when it could not be searched.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(test, derive(TS))]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, ts(export))]
pub struct RepoHits {
    pub repo_path: String,
    pub hits: Vec<CommitHit>,
    /// The search found more than it lists.
    pub capped: bool,
    pub error: Option<String>,
}

/// The commits of a pull request and where they came from.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(test, derive(TS))]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, ts(export))]
pub struct PrCommits {
    pub commits: Vec<CommitInfo>,
    /// Asked of the provider, because the PR's commits were not in the local repository.
    pub from_provider: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(test, derive(TS))]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, ts(export))]
pub struct CommitDetail {
    pub entry: LogEntry,
    pub body: String,
    pub files: Vec<FileRef>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(test, derive(TS))]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, ts(export))]
pub struct FileRef {
    pub path: String,
    pub orig_path: Option<String>,
    pub change: ChangeType,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(test, derive(TS))]
#[cfg_attr(test, ts(export))]
pub enum LineKind {
    Context,
    Add,
    Del,
    /// "\ No newline at end of file" and similar markers.
    Meta,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(test, derive(TS))]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, ts(export))]
pub struct DiffLine {
    pub kind: LineKind,
    pub old_no: Option<u32>,
    pub new_no: Option<u32>,
    pub text: String,
    /// Changed ranges [start, end) within `text` in UTF-16 units, word by word, for intraline highlighting.
    pub changed: Vec<(u32, u32)>,
    /// Paired with a line of the same text that differs only in its line ending.
    pub eol: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(test, derive(TS))]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, ts(export))]
pub struct Hunk {
    /// The raw `@@ … @@` line; it identifies the hunk when a part of it is staged.
    pub header: String,
    /// The function or section git names after the ranges.
    pub section: String,
    pub old_start: u32,
    pub old_lines: u32,
    pub new_start: u32,
    pub new_lines: u32,
    pub lines: Vec<DiffLine>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(test, derive(TS))]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, ts(export))]
pub struct FileDiff {
    pub path: String,
    /// Where the file came from, for a rename or copy.
    pub old_path: Option<String>,
    /// Similarity of a rename or copy, in percent.
    pub similarity: Option<u32>,
    pub old_mode: Option<String>,
    pub new_mode: Option<String>,
    pub binary: bool,
    /// Cut at the line limit; the UI offers to load the rest.
    pub truncated: bool,
    pub added: u32,
    pub removed: u32,
    pub hunks: Vec<Hunk>,
    /// Working copy of an unmerged file: Del lines are "ours", Add lines are "theirs".
    pub conflict: bool,
}

/// How whitespace counts in a diff.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[cfg_attr(test, derive(TS))]
#[cfg_attr(test, ts(export))]
pub enum Whitespace {
    #[default]
    Keep,
    /// Changes in the amount of whitespace do not count (`-b`).
    IgnoreChange,
    /// No whitespace counts (`-w`).
    IgnoreAll,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(test, derive(TS))]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, ts(export))]
pub struct DiffOptions {
    /// Unchanged lines around each change.
    pub context: u32,
    pub whitespace: Whitespace,
    /// Without the line limit.
    pub full: bool,
}

impl Default for DiffOptions {
    fn default() -> Self {
        Self { context: 3, whitespace: Whitespace::Keep, full: false }
    }
}

/// Part of a hunk to stage, unstage or discard. `header` must still be the hunk's header, so a
/// file that changed since it was shown is refused instead of patched at the wrong lines.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(test, derive(TS))]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, ts(export))]
pub struct HunkPick {
    pub hunk: u32,
    pub header: String,
    /// Indexes into the hunk's lines; none means the whole hunk.
    pub lines: Option<Vec<u32>>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(test, derive(TS))]
#[cfg_attr(test, ts(export))]
pub enum ApplyAction {
    /// Into the index, from the unstaged diff.
    Stage,
    /// Out of the index, from the staged diff.
    Unstage,
    /// Out of the working tree, from the unstaged diff, after a backup of the file.
    Discard,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(test, derive(TS))]
#[cfg_attr(test, ts(export))]
pub enum DiffSource {
    /// Working tree against the index.
    Unstaged,
    /// Index against HEAD.
    Staged,
    Untracked,
    /// Unmerged file: its working copy with the conflict markers, sides highlighted.
    Conflict,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(test, derive(TS))]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, ts(export))]
pub struct BranchRow {
    pub name: String,
    pub full_ref: String,
    pub sha: String,
    pub upstream: Option<String>,
    pub ahead: u32,
    pub behind: u32,
    pub gone: bool,
    pub is_head: bool,
    pub worktree_path: Option<String>,
    #[cfg_attr(test, ts(type = "number"))]
    pub committed_at: i64,
    pub subject: String,
    pub author: String,
    pub is_mine: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(test, derive(TS))]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, ts(export))]
pub struct BranchList {
    pub local: Vec<BranchRow>,
    pub remote: Vec<BranchRow>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(test, derive(TS))]
#[cfg_attr(test, ts(export))]
pub enum GitOp {
    Switch,
    CreateBranch,
    Stage,
    Unstage,
    Discard,
    Commit,
    Fetch,
    Pull,
    Push,
    AddWorktree,
    Clone,
    RemoveWorktree,
    /// A local branch brought up to its upstream, without merging anything of its own.
    FastForward,
    /// A stash applied to a worktree; the stash stays.
    StashApply,
    /// A stash dropped after a backup ref was set on it.
    StashDrop,
}

/// What happens to uncommitted changes when switching branches.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(test, derive(TS))]
#[cfg_attr(test, ts(export))]
pub enum CarryMode {
    /// Let git decide; it refuses when changes would be overwritten.
    Keep,
    /// Stash them and leave them stashed.
    Stash,
    /// Stash, switch, and re-apply them on the new branch.
    Bring,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(test, derive(TS))]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, ts(export))]
pub struct OpFailure {
    pub kind: FailureKind,
    pub op: GitOp,
    pub detail: String,
    pub path: Option<String>,
    /// Something already changed before the failure (e.g. changes stashed, but re-applying conflicted).
    pub changed: bool,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[cfg_attr(test, derive(TS))]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, ts(export))]
pub struct OpResult {
    /// New HEAD after commit, switch or pull.
    pub sha: Option<String>,
    /// Where discarded files were copied before they were thrown away.
    pub backup_dir: Option<String>,
    /// A stash was created (and, with Bring, re-applied).
    pub stashed: bool,
    /// Non-fatal note, e.g. re-applying the stash conflicted and the stash was kept.
    pub warning: Option<FailureKind>,
    pub summary: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(test, derive(TS))]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, ts(export))]
pub struct OpProgress {
    pub id: String,
    pub op: GitOp,
    pub phase: String,
    pub percent: Option<u32>,
}

/// What the previous run left, shown before any git call: the git state per path and when the last
/// full scan finished.
#[derive(Debug, Clone, Serialize)]
#[cfg_attr(test, derive(TS))]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, ts(export))]
pub struct CachedStatus {
    pub statuses: Vec<RepoStatus>,
    #[cfg_attr(test, ts(type = "number | null"))]
    pub scanned_at: Option<i64>,
}
