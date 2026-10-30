pub mod remote_url;

use std::collections::HashMap;
use std::ffi::OsStr;
use std::future::Future;
use std::path::PathBuf;
use std::pin::Pin;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use anyhow::Result;
use serde::de::DeserializeOwned;
use serde::{Deserialize, Deserializer};
use serde_json::Value;

use crate::model::{CommitInfo, PrReviewer, PrState, ProviderFailure, ProviderKind, PullRequestInfo, ReviewState, ToolId, ToolState, ToolStatus};
use crate::process::{self, ProcError, ProcOutput};
use remote_url::Remote;

const LIST_TIMEOUT: Duration = Duration::from_secs(90);
/// Pull requests asked per repository; a list this long is reported as capped.
pub const PR_LIMIT: usize = 1000;

/// gh and az run without a terminal: no prompts, no update notices or extension installs that would
/// wait for an answer or write into the parsed output. az is Python, which writes into a pipe in the
/// ANSI code page; az's output layer then drops every non-ASCII character of the whole answer as soon
/// as one of them does not fit that page, and titles lose their umlauts.
pub const ENV: &[(&str, &str)] = &[
    ("GH_PROMPT_DISABLED", "1"),
    ("GH_NO_UPDATE_NOTIFIER", "1"),
    ("AZURE_CORE_ONLY_SHOW_ERRORS", "true"),
    ("AZURE_EXTENSION_USE_DYNAMIC_INSTALL", "no"),
    ("PYTHONUTF8", "1"),
    ("PYTHONIOENCODING", "utf-8"),
];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Tool {
    Az,
    Gh,
}

/// How a tool is started: the program, the arguments before the caller's own, extra variables.
struct Invocation {
    program: String,
    lead: Vec<&'static str>,
    env: Vec<(&'static str, &'static str)>,
}

fn invocation(tool: Tool) -> Invocation {
    let plain = |program: String| Invocation { program, lead: Vec::new(), env: Vec::new() };
    match tool {
        Tool::Gh => plain("gh".into()),
        Tool::Az => match process::search_path().filter(|_| cfg!(windows)).as_deref().and_then(bundled_python) {
            // What the installer's az.cmd runs, in UTF-8 mode: the shim starts Python isolated (-I),
            // and an isolated Python ignores PYTHONUTF8 and PYTHONIOENCODING.
            Some(python) => Invocation {
                program: python.to_string_lossy().into_owned(),
                lead: vec!["-X", "utf8", "-I", "-B", "-m", "azure.cli"],
                env: vec![("AZ_INSTALLER", "MSI")],
            },
            None => plain(process::shim_name("az", "cmd")),
        },
    }
}

/// The Python of the Windows installer: `python.exe` one folder above the first `az.cmd` on the PATH.
fn bundled_python(path: &OsStr) -> Option<PathBuf> {
    let shim = std::env::split_paths(path).map(|d| d.join("az.cmd")).find(|p| p.is_file())?;
    let python = shim.parent()?.parent()?.join("python.exe");
    python.is_file().then_some(python)
}

/// Runs az or gh with the provider environment. Every start of these tools goes through here, the
/// environment check included, so all of them see the same variables.
pub async fn run_tool(tool: Tool, args: &[&str], timeout: Duration) -> Result<ProcOutput, ProcError> {
    let inv = invocation(tool);
    let env: Vec<(&str, &str)> = ENV.iter().chain(&inv.env).copied().collect();
    process::run(&inv.program, inv.lead.iter().chain(args), None, &env, timeout).await
}

pub type CliFuture<'a> = Pin<Box<dyn Future<Output = Result<ProcOutput, ProcError>> + Send + 'a>>;

/// The seam to a provider's command line: the system one starts az or gh, tests answer with
/// prepared output.
pub trait Cli: Send + Sync {
    fn run<'a>(&'a self, tool: Tool, args: &'a [&'a str], timeout: Duration) -> CliFuture<'a>;

    /// Why the tool of `kind` is not worth calling right now; None when it is.
    fn gate(&self, _kind: ProviderKind) -> Option<PrError> {
        None
    }
}

pub struct SystemCli;

impl Cli for SystemCli {
    fn run<'a>(&'a self, tool: Tool, args: &'a [&'a str], timeout: Duration) -> CliFuture<'a> {
        Box::pin(run_tool(tool, args, timeout))
    }

    fn gate(&self, kind: ProviderKind) -> Option<PrError> {
        gated(&GATES.lock().unwrap_or_else(|p| p.into_inner()), kind, Instant::now())
    }
}

/// Why a provider gave no list.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PrError {
    pub kind: ProviderFailure,
    pub detail: String,
}

impl PrError {
    fn new(kind: ProviderFailure, detail: impl Into<String>) -> Self {
        Self { kind, detail: detail.into() }
    }
}

impl std::fmt::Display for PrError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.detail)
    }
}

impl std::error::Error for PrError {}

/// A provider's answer for one repository.
#[derive(Debug, Clone, Default)]
pub struct PrList {
    pub prs: Vec<PullRequestInfo>,
    /// Entries the provider listed that could not be read; the others stand.
    pub unreadable: Vec<Unreadable>,
    /// The provider gave as many as were asked for: older ones are missing.
    pub capped: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Unreadable {
    pub id: Option<u32>,
    pub detail: String,
}

/// The provider tools' own wording; az and gh are not localized. Rate limits first: GitHub answers
/// them with 403, which otherwise reads like missing access.
pub fn classify(text: &str) -> ProviderFailure {
    let t = text.to_lowercase();
    let has = |needles: &[&str]| needles.iter().any(|n| t.contains(n));
    if has(&["rate limit", "too many requests", "http 429", "status code: 429", "tf400733"]) {
        ProviderFailure::RateLimited
    } else if has(&[
        "az login", "az devops login", "gh auth login", "not logged in", "authentication required", "authentication failed",
        "bad credentials", "http 401", "unauthorized", "tf400813", "aadsts", "token has expired", "requires user authentication",
    ]) {
        ProviderFailure::LoggedOut
    } else if has(&[
        "is misspelled or not recognized", "failed to load python executable", "is not recognized as an internal or external command",
        "no module named", "requires the extension",
    ]) {
        ProviderFailure::ToolMissing
    } else if has(&["timed out", "timeout"]) {
        ProviderFailure::Timeout
    } else {
        ProviderFailure::Other
    }
}

/// gh's exit code when it needs a sign-in, whatever it prints.
const GH_AUTH_REQUIRED: i32 = 4;

/// The output of a call that succeeded; otherwise why not.
fn answer(tool: Tool, o: Result<ProcOutput, ProcError>) -> Result<String, PrError> {
    match o {
        Ok(o) if o.success() => Ok(o.stdout),
        Ok(o) => {
            let text = o.error_text();
            let text = if text.is_empty() { format!("exit code {:?}", o.code) } else { text };
            let kind = match classify(&text) {
                ProviderFailure::Other if tool == Tool::Gh && o.code == Some(GH_AUTH_REQUIRED) => ProviderFailure::LoggedOut,
                kind => kind,
            };
            Err(PrError::new(kind, text))
        }
        Err(e @ ProcError::NotFound(_)) => Err(PrError::new(ProviderFailure::ToolMissing, e.to_string())),
        Err(e @ ProcError::Timeout(_)) => Err(PrError::new(ProviderFailure::Timeout, e.to_string())),
        Err(e) => Err(PrError::new(ProviderFailure::Other, e.to_string())),
    }
}

/// What the last environment check found: a provider tool that is missing or signed out, and when.
static GATES: Mutex<Vec<(ProviderKind, ProviderFailure, Instant)>> = Mutex::new(Vec::new());
/// The user may install or sign in from a terminal without checking again here: after this long the
/// tool is called again.
const GATE_TTL: Duration = Duration::from_secs(15 * 60);

fn gated(gates: &[(ProviderKind, ProviderFailure, Instant)], kind: ProviderKind, now: Instant) -> Option<PrError> {
    let (_, failure, _) = gates.iter().find(|(k, _, at)| *k == kind && now.saturating_duration_since(*at) < GATE_TTL)?;
    let detail = match failure {
        ProviderFailure::LoggedOut => "not called: the environment check found the tool signed out",
        _ => "not called: the environment check found the tool missing",
    };
    Some(PrError::new(*failure, detail))
}

/// Takes in an environment check: a provider tool it found missing or signed out is not called for a
/// while. The account may have changed as well, so who the user is gets asked again.
pub fn note_environment(tools: &[ToolStatus]) {
    let now = Instant::now();
    let gates = tools
        .iter()
        .filter_map(|t| {
            let kind = match t.id {
                ToolId::AzureCli => ProviderKind::Azure,
                ToolId::GitHubCli => ProviderKind::GitHub,
                _ => return None,
            };
            let failure = match t.state {
                ToolState::Missing | ToolState::ExtensionMissing => ProviderFailure::ToolMissing,
                ToolState::NotLoggedIn => ProviderFailure::LoggedOut,
                _ => return None,
            };
            Some((kind, failure, now))
        })
        .collect();
    *GATES.lock().unwrap_or_else(|p| p.into_inner()) = gates;
    KNOWN.lock().unwrap_or_else(|p| p.into_inner()).clear();
}

/// Which pull request of a branch counts. For a local branch, the merged one of exactly its tip,
/// then any merged one, then the newest; for a server branch an open one first, because deleting
/// the branch would close it.
#[derive(Debug, Clone, Copy)]
pub enum PrPick<'a> {
    MergedTip(&'a str),
    OpenFirst,
}

pub fn pick_pr<'a>(prs: &'a [PullRequestInfo], source_ref: &str, pick: PrPick) -> Option<&'a PullRequestInfo> {
    let mut matching: Vec<&PullRequestInfo> = prs.iter().filter(|p| p.source_ref == source_ref).collect();
    matching.sort_by_key(|p| std::cmp::Reverse(p.id));
    choose(&matching, pick)
}

/// The pull requests of one list by the branch they come from, newest first, made once per list:
/// picking from the whole list for every branch is a pass over a thousand PRs for each of hundreds of
/// branches.
pub struct PrIndex<'a> {
    by_source: HashMap<&'a str, Vec<&'a PullRequestInfo>>,
}

impl<'a> PrIndex<'a> {
    pub fn new(prs: &'a [PullRequestInfo]) -> Self {
        let mut by_source: HashMap<&'a str, Vec<&'a PullRequestInfo>> = HashMap::new();
        for p in prs {
            by_source.entry(p.source_ref.as_str()).or_default().push(p);
        }
        for list in by_source.values_mut() {
            list.sort_by_key(|p| std::cmp::Reverse(p.id));
        }
        Self { by_source }
    }

    /// `pick_pr` over the indexed list.
    pub fn pick(&self, source_ref: &str, pick: PrPick) -> Option<&'a PullRequestInfo> {
        choose(self.by_source.get(source_ref).map_or(&[], Vec::as_slice), pick)
    }
}

/// Of the pull requests of one branch, newest first, the one that says most about it.
fn choose<'a>(matching: &[&'a PullRequestInfo], pick: PrPick) -> Option<&'a PullRequestInfo> {
    let preferred = match pick {
        PrPick::MergedTip(tip) => matching
            .iter()
            .find(|p| p.state == PrState::Merged && p.source_sha.as_deref() == Some(tip))
            .or_else(|| matching.iter().find(|p| p.state == PrState::Merged)),
        PrPick::OpenFirst => matching.iter().find(|p| p.state == PrState::Open),
    };
    preferred.or_else(|| matching.first()).copied()
}

pub fn kind_of(remote: &Remote) -> ProviderKind {
    match remote {
        Remote::Azure { .. } => ProviderKind::Azure,
        Remote::GitHub { .. } => ProviderKind::GitHub,
        Remote::Other => ProviderKind::None,
    }
}

pub async fn pull_requests(remote: &Remote) -> Result<PrList, PrError> {
    pull_requests_with(&SystemCli, remote).await
}

pub async fn pull_requests_with(cli: &dyn Cli, remote: &Remote) -> Result<PrList, PrError> {
    if let Some(e) = cli.gate(kind_of(remote)) {
        return Err(e);
    }
    let limit = PR_LIMIT.to_string();
    match remote {
        Remote::Azure { org_url, project, repo, web_base } => {
            let args = [
                "repos", "pr", "list", "--organization", org_url, "--project", project, "--repository", repo,
                "--status", "all", "--top", &limit, "--detect", "false", "-o", "json",
            ];
            parse_azure(&answer(Tool::Az, cli.run(Tool::Az, &args, LIST_TIMEOUT).await)?, web_base)
        }
        Remote::GitHub { owner, repo } => {
            let full = format!("{owner}/{repo}");
            let args = [
                "pr", "list", "-R", &full, "--state", "all", "--limit", &limit, "--json",
                "number,title,state,headRefName,headRefOid,baseRefName,author,url,createdAt,closedAt,mergedAt,reviewRequests,latestReviews,isDraft,mergeable",
            ];
            parse_github(&answer(Tool::Gh, cli.run(Tool::Gh, &args, LIST_TIMEOUT).await)?)
        }
        Remote::Other => Ok(PrList::default()),
    }
}

type Answer = Arc<tokio::sync::OnceCell<Result<PrList, PrError>>>;

/// One scan's calls to the providers. Each repository is asked once for all its working copies; after
/// a failed sign-in, a rate limit or a missing tool, the same server is not asked again in this scan,
/// where every further call would fail alike. The next scan asks anew.
#[derive(Default)]
pub struct Session {
    answers: Mutex<HashMap<String, Answer>>,
    blocked: Mutex<HashMap<String, PrError>>,
}

impl Session {
    pub async fn pull_requests(&self, cli: &dyn Cli, repo: &str, remote: &Remote) -> Result<PrList, PrError> {
        let cell = self.answers.lock().unwrap_or_else(|p| p.into_inner()).entry(repo.to_string()).or_default().clone();
        let answer = cell
            .get_or_init(|| async {
                let server = remote.server();
                if let Some(e) = self.blocked.lock().unwrap_or_else(|p| p.into_inner()).get(&server) {
                    return Err(e.clone());
                }
                let answer = pull_requests_with(cli, remote).await;
                if let Err(e) = &answer {
                    if matches!(e.kind, ProviderFailure::LoggedOut | ProviderFailure::RateLimited | ProviderFailure::ToolMissing) {
                        let skipped = PrError::new(e.kind, format!("not asked again in this scan after: {}", e.detail));
                        self.blocked.lock().unwrap_or_else(|p| p.into_inner()).insert(server, skipped);
                    }
                }
                answer
            })
            .await;
        answer.clone()
    }
}

const COMMITS_TIMEOUT: Duration = Duration::from_secs(30);

/// The commits of one PR, asked of the provider when they are not in the local repository. On
/// demand only, never during a scan.
pub async fn pr_commits(remote: &Remote, id: u32) -> Result<Vec<CommitInfo>> {
    let cli = SystemCli;
    if let Some(e) = cli.gate(kind_of(remote)) {
        return Err(e.into());
    }
    let id = id.to_string();
    match remote {
        Remote::GitHub { owner, repo } => {
            let full = format!("{owner}/{repo}");
            let args = ["pr", "view", &id, "-R", &full, "--json", "commits"];
            parse_github_commits(&answer(Tool::Gh, cli.run(Tool::Gh, &args, COMMITS_TIMEOUT).await)?)
        }
        Remote::Azure { org_url, project, repo, .. } => {
            let (p, r, n) = (format!("project={project}"), format!("repositoryId={repo}"), format!("pullRequestId={id}"));
            let args = [
                "devops", "invoke", "--area", "git", "--resource", "pullRequestCommits", "--route-parameters", &p, &r, &n,
                "--org", org_url, "--api-version", "7.1", "-o", "json",
            ];
            parse_azure_commits(&answer(Tool::Az, cli.run(Tool::Az, &args, COMMITS_TIMEOUT).await)?)
        }
        Remote::Other => Ok(Vec::new()),
    }
}

/// Reads null like a missing field. az writes `"isRequired": null` and the like; one such value must
/// not cost an entry, let alone the list.
fn nullable<'de, D: Deserializer<'de>, T: Deserialize<'de> + Default>(d: D) -> Result<T, D::Error> {
    Ok(Option::<T>::deserialize(d)?.unwrap_or_default())
}

/// The JSON list in a tool's output. A line printed before it (a notice the environment could not
/// silence) or after it does not cost the list; a list that was cut off is an error, never a shorter list.
fn json_list(out: &str) -> Result<Vec<Value>, PrError> {
    let unreadable = |detail: String| PrError::new(ProviderFailure::Parse, detail);
    let mut first_error = None;
    let mut offset = 0;
    for line in out.split_inclusive('\n') {
        let at = offset + (line.len() - line.trim_start().len());
        offset += line.len();
        if !line.trim_start().starts_with('[') {
            continue;
        }
        match serde_json::Deserializer::from_str(&out[at..]).into_iter::<Vec<Value>>().next() {
            Some(Ok(list)) => return Ok(list),
            Some(Err(e)) if e.is_eof() => return Err(unreadable(format!("answer cut off: {e}"))),
            Some(Err(e)) => {
                first_error.get_or_insert_with(|| e.to_string());
            }
            None => {}
        }
    }
    Err(unreadable(first_error.unwrap_or_else(|| "no JSON list in the answer".to_string())))
}

/// Each entry on its own: one that cannot be read becomes a note with its id, the others stand. When
/// not a single entry can be read, the answer as a whole is unreadable (the tool changed its format):
/// that is a failed query, for which the last list stands in, not an empty list.
fn read_each<T: DeserializeOwned>(items: Vec<Value>, id_field: &str, map: impl Fn(T) -> PullRequestInfo) -> Result<PrList, PrError> {
    let mut list = PrList { capped: items.len() >= PR_LIMIT, ..PrList::default() };
    for item in items {
        let id = item.get(id_field).and_then(Value::as_u64).and_then(|n| u32::try_from(n).ok());
        match serde_json::from_value::<T>(item) {
            Ok(p) => list.prs.push(map(p)),
            Err(e) => list.unreadable.push(Unreadable { id, detail: e.to_string() }),
        }
    }
    match list.unreadable.first() {
        Some(first) if list.prs.is_empty() => Err(PrError::new(ProviderFailure::Parse, format!("no entry readable: {}", first.detail))),
        _ => Ok(list),
    }
}

#[derive(Deserialize)]
struct GhCommits {
    commits: Vec<GhCommit>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct GhCommit {
    oid: String,
    #[serde(default, deserialize_with = "nullable")]
    message_headline: String,
    #[serde(default, deserialize_with = "nullable")]
    authors: Vec<GhCommitAuthor>,
    authored_date: Option<String>,
}

#[derive(Deserialize)]
struct GhCommitAuthor {
    email: Option<String>,
}

fn parse_github_commits(json: &str) -> Result<Vec<CommitInfo>> {
    let c: GhCommits = serde_json::from_str(json)?;
    Ok(c.commits
        .into_iter()
        .map(|c| CommitInfo {
            sha: c.oid,
            subject: c.message_headline,
            author_email: c.authors.into_iter().find_map(|a| a.email).unwrap_or_default(),
            authored_at: c.authored_date.as_deref().and_then(iso_to_unix).unwrap_or(0),
        })
        .collect())
}

#[derive(Deserialize)]
struct AzCommits {
    value: Vec<AzPrCommit>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct AzPrCommit {
    commit_id: String,
    #[serde(default, deserialize_with = "nullable")]
    comment: String,
    author: Option<AzCommitAuthor>,
}

#[derive(Deserialize)]
struct AzCommitAuthor {
    email: Option<String>,
    date: Option<String>,
}

fn parse_azure_commits(json: &str) -> Result<Vec<CommitInfo>> {
    let c: AzCommits = serde_json::from_str(json)?;
    Ok(c.value
        .into_iter()
        .map(|c| CommitInfo {
            sha: c.commit_id,
            // The first line, as git shows a subject.
            subject: c.comment.lines().next().unwrap_or_default().to_string(),
            author_email: c.author.as_ref().and_then(|a| a.email.clone()).unwrap_or_default(),
            authored_at: c.author.and_then(|a| a.date).as_deref().and_then(iso_to_unix).unwrap_or(0),
        })
        .collect())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct AzPr {
    pull_request_id: u32,
    #[serde(default, deserialize_with = "nullable")]
    title: String,
    status: String,
    source_ref_name: String,
    target_ref_name: String,
    last_merge_source_commit: Option<AzCommit>,
    last_merge_target_commit: Option<AzCommit>,
    created_by: Option<AzIdentity>,
    creation_date: Option<String>,
    closed_date: Option<String>,
    #[serde(default, deserialize_with = "nullable")]
    reviewers: Vec<AzReviewer>,
    #[serde(default, deserialize_with = "nullable")]
    is_draft: bool,
    merge_status: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct AzReviewer {
    unique_name: Option<String>,
    #[serde(default, deserialize_with = "nullable")]
    vote: i32,
    #[serde(default, deserialize_with = "nullable")]
    is_required: bool,
}

/// Azure votes: 10 approved, 5 approved with suggestions, 0 none yet, -5 waiting for the author, -10 rejected.
fn azure_review(vote: i32) -> ReviewState {
    match vote {
        v if v > 0 => ReviewState::Approved,
        0 => ReviewState::Pending,
        -5 => ReviewState::Commented,
        _ => ReviewState::Changes,
    }
}

/// `2026-05-08T12:34:56.123Z` or with `+02:00` → Unix seconds. Dates up to the epoch count as
/// missing: Azure writes `0001-01-01T00:00:00` for "not closed yet".
fn iso_to_unix(s: &str) -> Option<i64> {
    let (date, rest) = s.split_once('T')?;
    let mut d = date.split('-').map(|x| x.parse::<i64>().ok());
    let (y, m, day) = (d.next()??, d.next()??, d.next()??);
    let (clock, offset) = match rest.find(['Z', '+', '-']) {
        Some(i) => (&rest[..i], &rest[i..]),
        None => (rest, ""),
    };
    let clock = clock.split('.').next()?;
    let mut c = clock.split(':').map(|x| x.parse::<i64>().ok());
    let (h, min, sec) = (c.next()??, c.next()??, c.next().flatten().unwrap_or(0));
    let offset_secs = match offset.chars().next() {
        Some(sign @ ('+' | '-')) => {
            let (oh, om) = offset[1..].split_once(':').unwrap_or((&offset[1..], "0"));
            let v = oh.parse::<i64>().ok()? * 3600 + om.parse::<i64>().ok()? * 60;
            if sign == '+' { v } else { -v }
        }
        _ => 0,
    };
    // Days since 1970-01-01 from a civil date (Howard Hinnant's algorithm).
    let y = if m <= 2 { y - 1 } else { y };
    let era = y.div_euclid(400);
    let yoe = y - era * 400;
    let doy = (153 * ((m + 9) % 12) + 2) / 5 + day - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    let days = era * 146_097 + doe - 719_468;
    let t = days * 86_400 + h * 3600 + min * 60 + sec - offset_secs;
    (t > 0).then_some(t)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct AzCommit {
    commit_id: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct AzIdentity {
    display_name: Option<String>,
    unique_name: Option<String>,
}

/// The JSON of `az repos pr list`, separated from the call so every field mapping is tested.
fn parse_azure(json: &str, web_base: &str) -> Result<PrList, PrError> {
    read_each(json_list(json)?, "pullRequestId", |p: AzPr| PullRequestInfo {
        id: p.pull_request_id,
        url: format!("{web_base}/pullrequest/{}", p.pull_request_id),
        title: p.title,
        // Any other state, also one this version does not know, counts as open: never as merged.
        state: match p.status.as_str() {
            "completed" => PrState::Merged,
            "abandoned" => PrState::Closed,
            _ => PrState::Open,
        },
        author_name: p.created_by.as_ref().and_then(|c| c.display_name.clone()),
        author: p.created_by.and_then(|c| c.unique_name.or(c.display_name)).unwrap_or_default(),
        source_ref: p.source_ref_name,
        target_ref: p.target_ref_name,
        source_sha: p.last_merge_source_commit.and_then(|c| c.commit_id),
        created_at: p.creation_date.as_deref().and_then(iso_to_unix),
        closed_at: p.closed_date.as_deref().and_then(iso_to_unix),
        target_sha: p.last_merge_target_commit.and_then(|c| c.commit_id),
        reviewers: p
            .reviewers
            .into_iter()
            .filter_map(|r| Some(PrReviewer { id: r.unique_name?, state: azure_review(r.vote), required: r.is_required }))
            .collect(),
        is_draft: p.is_draft,
        has_conflicts: p.merge_status.as_deref() == Some("conflicts"),
    })
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct GhPr {
    number: u32,
    #[serde(default, deserialize_with = "nullable")]
    title: String,
    state: String,
    head_ref_name: String,
    head_ref_oid: Option<String>,
    base_ref_name: String,
    author: Option<GhAuthor>,
    #[serde(default, deserialize_with = "nullable")]
    url: String,
    created_at: Option<String>,
    closed_at: Option<String>,
    merged_at: Option<String>,
    #[serde(default, deserialize_with = "nullable")]
    review_requests: Vec<GhRequested>,
    #[serde(default, deserialize_with = "nullable")]
    latest_reviews: Vec<GhReview>,
    #[serde(default, deserialize_with = "nullable")]
    is_draft: bool,
    mergeable: Option<String>,
}

#[derive(Deserialize)]
struct GhAuthor {
    #[serde(default, deserialize_with = "nullable")]
    login: String,
    #[serde(default)]
    name: Option<String>,
}

/// A user (login) or a team (slug, name) asked for a review.
#[derive(Deserialize)]
struct GhRequested {
    login: Option<String>,
    slug: Option<String>,
}

#[derive(Deserialize)]
struct GhReview {
    author: Option<GhAuthor>,
    #[serde(default, deserialize_with = "nullable")]
    state: String,
}

/// Who was asked and has not answered, then who answered with what.
fn github_reviewers(requested: Vec<GhRequested>, reviews: Vec<GhReview>) -> Vec<PrReviewer> {
    let mut out: Vec<PrReviewer> = requested
        .into_iter()
        .filter_map(|r| r.login.or(r.slug))
        .map(|id| PrReviewer { id, state: ReviewState::Pending, required: false })
        .collect();
    for r in reviews {
        let Some(id) = r.author.map(|a| a.login).filter(|l| !l.is_empty()) else { continue };
        let state = match r.state.as_str() {
            "APPROVED" => ReviewState::Approved,
            "CHANGES_REQUESTED" => ReviewState::Changes,
            _ => ReviewState::Commented,
        };
        // A new request after a review asks again: the pending entry stands.
        if !out.iter().any(|x| x.id == id) {
            out.push(PrReviewer { id, state, required: false });
        }
    }
    out
}

/// The JSON of `gh pr list --json …`.
fn parse_github(json: &str) -> Result<PrList, PrError> {
    read_each(json_list(json)?, "number", |p: GhPr| PullRequestInfo {
        id: p.number,
        title: p.title,
        // As for Azure: an unknown state is never merged.
        state: match p.state.as_str() {
            "MERGED" => PrState::Merged,
            "CLOSED" => PrState::Closed,
            _ => PrState::Open,
        },
        url: p.url,
        author_name: p.author.as_ref().and_then(|a| a.name.clone()).filter(|n| !n.is_empty()),
        author: p.author.map(|a| a.login).unwrap_or_default(),
        source_ref: format!("refs/heads/{}", p.head_ref_name),
        target_ref: format!("refs/heads/{}", p.base_ref_name),
        source_sha: p.head_ref_oid,
        created_at: p.created_at.as_deref().and_then(iso_to_unix),
        closed_at: p.merged_at.or(p.closed_at).as_deref().and_then(iso_to_unix),
        target_sha: None,
        reviewers: github_reviewers(p.review_requests, p.latest_reviews),
        is_draft: p.is_draft,
        has_conflicts: p.mergeable.as_deref() == Some("CONFLICTING"),
    })
}

const IDENTITY_TIMEOUT: Duration = Duration::from_secs(20);

/// Who each provider's command line was found signed in as; kept until the next environment check.
static KNOWN: Mutex<Vec<(ProviderKind, String)>> = Mutex::new(Vec::new());

/// Who the provider's command line is signed in as: the id pull requests name authors and reviewers by.
/// None where the tool is missing or signed out; the app never signs in itself.
pub async fn identity(kind: ProviderKind) -> Option<String> {
    // A missing one is asked again: the user may sign in meanwhile.
    if let Some((_, id)) = KNOWN.lock().unwrap_or_else(|p| p.into_inner()).iter().find(|(k, _)| *k == kind) {
        return Some(id.clone());
    }
    if SystemCli.gate(kind).is_some() {
        return None;
    }
    let id = ask_identity(kind).await?;
    KNOWN.lock().unwrap_or_else(|p| p.into_inner()).push((kind, id.clone()));
    Some(id)
}

async fn ask_identity(kind: ProviderKind) -> Option<String> {
    let o = match kind {
        ProviderKind::GitHub => run_tool(Tool::Gh, &["api", "user", "--jq", ".login"], IDENTITY_TIMEOUT).await.ok()?,
        ProviderKind::Azure => run_tool(Tool::Az, &["account", "show", "--query", "user.name", "-o", "tsv"], IDENTITY_TIMEOUT).await.ok()?,
        _ => return None,
    };
    let id = o.stdout.trim();
    (o.success() && !id.is_empty()).then(|| id.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    /// Answers every call with the same prepared output and counts the calls.
    struct Fake {
        answer: Box<dyn Fn() -> Result<ProcOutput, ProcError> + Send + Sync>,
        calls: AtomicUsize,
        gate: Option<PrError>,
    }

    impl Fake {
        fn new(answer: impl Fn() -> Result<ProcOutput, ProcError> + Send + Sync + 'static) -> Self {
            Fake { answer: Box::new(answer), calls: AtomicUsize::new(0), gate: None }
        }

        fn output(code: i32, stdout: &str, stderr: &str) -> Self {
            let (stdout, stderr) = (stdout.to_string(), stderr.to_string());
            Self::new(move || Ok(ProcOutput { code: Some(code), stdout: stdout.clone(), stderr: stderr.clone() }))
        }

        fn calls(&self) -> usize {
            self.calls.load(Ordering::SeqCst)
        }
    }

    impl Cli for Fake {
        fn run<'a>(&'a self, _tool: Tool, _args: &'a [&'a str], _timeout: Duration) -> CliFuture<'a> {
            self.calls.fetch_add(1, Ordering::SeqCst);
            let answer = (self.answer)();
            Box::pin(async move { answer })
        }

        fn gate(&self, _kind: ProviderKind) -> Option<PrError> {
            self.gate.clone()
        }
    }

    fn azure() -> Remote {
        Remote::Azure { org_url: "https://dev.azure.com/Org".into(), project: "P".into(), repo: "R".into(), web_base: "w".into() }
    }

    fn github() -> Remote {
        Remote::GitHub { owner: "o".into(), repo: "r".into() }
    }

    /// One entry as `az repos pr list -o json` writes it, with the nulls az writes for unset values.
    fn az_entry(id: u32, status: &str) -> String {
        format!(
            r#"{{
    "artifactId": "vstfs:///Git/PullRequestId/x%2f{id}",
    "autoCompleteSetBy": null,
    "closedBy": null,
    "closedDate": null,
    "codeReviewId": {id},
    "commits": null,
    "completionOptions": null,
    "createdBy": {{ "displayName": "Dev", "id": "1", "imageUrl": null, "uniqueName": "dev@corp.example" }},
    "creationDate": "2026-05-01T08:00:00.123456+00:00",
    "description": null,
    "forkSource": null,
    "hasMultipleMergeBases": null,
    "isDraft": false,
    "labels": null,
    "lastMergeCommit": null,
    "lastMergeSourceCommit": {{ "commitId": "abc{id}", "url": null }},
    "lastMergeTargetCommit": null,
    "mergeFailureMessage": null,
    "mergeStatus": "succeeded",
    "pullRequestId": {id},
    "reviewers": [
      {{
        "displayName": "[P]\\Team",
        "hasDeclined": null,
        "id": "2",
        "isContainer": true,
        "isFlagged": null,
        "isRequired": null,
        "uniqueName": "vstfs:///Classification/TeamProject/2\\Team",
        "vote": 0
      }}
    ],
    "sourceRefName": "refs/heads/feature/{id}",
    "status": "{status}",
    "targetRefName": "refs/heads/main",
    "title": "Vorgänge über Schlüssel {id}",
    "workItemRefs": null
  }}"#
        )
    }

    fn az_list(entries: &[String]) -> String {
        format!("[\n  {}\n]\n", entries.join(",\n  "))
    }

    #[test]
    fn the_provider_environment_asks_python_for_utf8() {
        assert!(ENV.contains(&("PYTHONUTF8", "1")));
        assert!(ENV.contains(&("PYTHONIOENCODING", "utf-8")));
    }

    #[test]
    fn the_installers_python_is_found_beside_its_shim() {
        let dir = tempfile::tempdir().unwrap();
        let (wbin, empty) = (dir.path().join("CLI2").join("wbin"), dir.path().join("empty"));
        std::fs::create_dir_all(&wbin).unwrap();
        std::fs::create_dir_all(&empty).unwrap();
        std::fs::write(wbin.join("az.cmd"), "@echo off").unwrap();
        let path = std::env::join_paths([&empty, &wbin]).unwrap();
        assert_eq!(bundled_python(&path), None, "a shim without the installer's Python is started as it is");
        std::fs::write(dir.path().join("CLI2").join("python.exe"), "").unwrap();
        assert_eq!(bundled_python(&path), Some(dir.path().join("CLI2").join("python.exe")));
        assert_eq!(bundled_python(std::env::join_paths([&empty]).unwrap().as_os_str()), None);
    }

    #[test]
    fn nulls_from_az_do_not_cost_the_list() {
        let list = parse_azure(&az_list(&[az_entry(1, "active"), az_entry(2, "completed")]), "w").unwrap();
        assert_eq!(list.prs.len(), 2, "{:?}", list.unreadable);
        assert!(list.unreadable.is_empty());
        let p = &list.prs[0];
        assert_eq!((p.title.as_str(), p.state, p.closed_at), ("Vorgänge über Schlüssel 1", PrState::Open, None));
        assert!(!p.reviewers[0].required, "isRequired null is not required");
        let nulls = r#"[{"pullRequestId": 9, "status": "active", "sourceRefName": "refs/heads/f", "targetRefName": "refs/heads/main", "isDraft": null,
            "title": null, "reviewers": null, "createdBy": null, "lastMergeSourceCommit": {"commitId": null}}]"#;
        let p = &parse_azure(nulls, "w").unwrap().prs[0];
        assert!(!p.is_draft && p.reviewers.is_empty() && p.title.is_empty() && p.source_sha.is_none());
    }

    #[test]
    fn an_unreadable_entry_is_reported_with_its_id_and_the_others_stand() {
        let broken = r#"{"pullRequestId": 7, "status": "active", "sourceRefName": null, "targetRefName": "refs/heads/main"}"#.to_string();
        let list = parse_azure(&az_list(&[az_entry(1, "active"), broken, r#"{"status": "active"}"#.into()]), "w").unwrap();
        assert_eq!(list.prs.iter().map(|p| p.id).collect::<Vec<_>>(), [1]);
        assert_eq!(list.unreadable.iter().map(|u| u.id).collect::<Vec<_>>(), [Some(7), None]);
        assert!(list.unreadable[0].detail.contains("null"), "{:?}", list.unreadable[0]);

        let gh = r#"[{"number": 1, "state": "OPEN", "headRefName": "f", "baseRefName": "main", "url": null, "title": null, "isDraft": null,
                      "author": {"login": null}, "reviewRequests": null, "latestReviews": [{"author": null, "state": null}]},
                     {"number": 2, "state": "OPEN", "headRefName": null, "baseRefName": "main"}]"#;
        let list = parse_github(gh).unwrap();
        assert_eq!(list.prs.len(), 1);
        assert_eq!((list.prs[0].author.as_str(), list.prs[0].reviewers.len()), ("", 0));
        assert_eq!(list.unreadable[0].id, Some(2));

        // Not one entry readable: the format changed, which is a failed query, never "no PRs".
        let e = parse_github(r#"[{"number": 1, "state": 5}, {"number": 2}]"#).unwrap_err();
        assert_eq!(e.kind, ProviderFailure::Parse, "{e:?}");
    }

    #[test]
    fn text_around_the_json_is_skipped_and_a_cut_off_list_is_an_error() {
        let noisy = format!("WARNING: something az could not keep quiet\n[notice] another one\n{}\nA trailing hint\n", az_list(&[az_entry(3, "active")]));
        assert_eq!(parse_azure(&noisy, "w").unwrap().prs[0].id, 3);
        let full = az_list(&[az_entry(3, "active"), az_entry(4, "active")]);
        let cut = &full[..full.len() / 2];
        let e = parse_azure(cut, "w").unwrap_err();
        assert_eq!(e.kind, ProviderFailure::Parse, "{e:?}");
        assert_eq!(parse_github("{}").unwrap_err().kind, ProviderFailure::Parse);
        assert_eq!(parse_azure("not json", "").unwrap_err().kind, ProviderFailure::Parse);
        assert!(parse_github("[]").unwrap().prs.is_empty());
    }

    #[test]
    fn an_unknown_state_never_counts_as_merged() {
        let p = &parse_azure(&az_list(&[az_entry(5, "notSet"), az_entry(6, "somethingNew")]), "w").unwrap().prs;
        assert!(p.iter().all(|p| p.state == PrState::Open), "{:?}", p.iter().map(|p| p.state).collect::<Vec<_>>());
        let gh = r#"[{"number": 1, "state": "QUEUED", "headRefName": "f", "baseRefName": "main", "url": "u"}]"#;
        assert_eq!(parse_github(gh).unwrap().prs[0].state, PrState::Open);
    }

    #[tokio::test]
    async fn a_failing_call_is_classified() {
        let cases: Vec<(Fake, ProviderFailure)> = vec![
            (Fake::output(1, "", "ERROR: Before you can run Azure DevOps commands, you need to run the login command (az login if using AAD/MSA identity else az devops login if using PAT token) to setup credentials."), ProviderFailure::LoggedOut),
            (Fake::output(1, "", "ERROR: TF400813: The user 'x' is not authorized to access this resource."), ProviderFailure::LoggedOut),
            (Fake::output(4, "", "To get started with GitHub CLI, please run:  gh auth login"), ProviderFailure::LoggedOut),
            (Fake::output(1, "", "HTTP 403: API rate limit exceeded for user ID 1. (https://api.github.com/graphql)"), ProviderFailure::RateLimited),
            (Fake::output(1, "", "ERROR: TF400733: The request has been canceled: Request was blocked due to exceeding usage of resource."), ProviderFailure::RateLimited),
            (Fake::output(2, "", "ERROR: 'repos' is misspelled or not recognized by the system."), ProviderFailure::ToolMissing),
            (Fake::output(1, "", "ERROR: The server is on fire"), ProviderFailure::Other),
            (Fake::output(1, "", ""), ProviderFailure::Other),
            (Fake::new(|| Err(ProcError::Timeout("az".into()))), ProviderFailure::Timeout),
            (Fake::new(|| Err(ProcError::NotFound("gh".into()))), ProviderFailure::ToolMissing),
            (Fake::output(0, "Sorry, no JSON today", ""), ProviderFailure::Parse),
        ];
        for (fake, kind) in cases {
            let e = pull_requests_with(&fake, &azure()).await.unwrap_err();
            assert_eq!(e.kind, kind, "{e:?}");
            assert!(!e.detail.is_empty());
        }
        // gh says "sign in" by its exit code, whatever the text.
        let e = pull_requests_with(&Fake::output(4, "", "something new"), &github()).await.unwrap_err();
        assert_eq!(e.kind, ProviderFailure::LoggedOut);
        let e = pull_requests_with(&Fake::output(4, "", "something new"), &azure()).await.unwrap_err();
        assert_eq!(e.kind, ProviderFailure::Other, "az uses no such code");
    }

    #[tokio::test]
    async fn a_list_as_long_as_asked_for_is_capped() {
        let entries: Vec<String> = (1..=PR_LIMIT as u32).map(|i| format!(r#"{{"number": {i}, "state": "OPEN", "headRefName": "b{i}", "baseRefName": "main", "url": "u"}}"#)).collect();
        let full = format!("[{}]", entries.join(","));
        let list = pull_requests_with(&Fake::output(0, &full, ""), &github()).await.unwrap();
        assert!(list.capped && list.prs.len() == PR_LIMIT);
        let short = format!("[{}]", entries[..3].join(","));
        assert!(!pull_requests_with(&Fake::output(0, &short, ""), &github()).await.unwrap().capped);
    }

    #[tokio::test]
    async fn a_gated_tool_is_not_called() {
        let mut fake = Fake::output(0, "[]", "");
        fake.gate = Some(PrError::new(ProviderFailure::LoggedOut, "signed out"));
        assert_eq!(pull_requests_with(&fake, &azure()).await.unwrap_err().kind, ProviderFailure::LoggedOut);
        assert_eq!(fake.calls(), 0);

        let now = Instant::now();
        let gates = [(ProviderKind::Azure, ProviderFailure::LoggedOut, now)];
        assert_eq!(gated(&gates, ProviderKind::Azure, now).map(|e| e.kind), Some(ProviderFailure::LoggedOut));
        assert_eq!(gated(&gates, ProviderKind::GitHub, now), None, "per provider");
        assert_eq!(gated(&gates, ProviderKind::Azure, now + GATE_TTL), None, "asked again after a while");
    }

    #[test]
    fn an_environment_check_forgets_who_the_user_was() {
        KNOWN.lock().unwrap().push((ProviderKind::Azure, "old@corp.example".into()));
        note_environment(&[]);
        assert!(KNOWN.lock().unwrap().iter().all(|(_, id)| id != "old@corp.example"));
    }

    #[tokio::test]
    async fn after_a_sign_in_or_rate_limit_failure_the_same_server_is_not_asked_again_in_the_scan() {
        let limited = Fake::output(1, "", "HTTP 429: Too Many Requests");
        let session = Session::default();
        let other_repo = Remote::Azure { org_url: "https://dev.azure.com/org".into(), project: "P".into(), repo: "S".into(), web_base: "w".into() };
        assert_eq!(session.pull_requests(&limited, "a", &azure()).await.unwrap_err().kind, ProviderFailure::RateLimited);
        assert_eq!(session.pull_requests(&limited, "a", &azure()).await.unwrap_err().kind, ProviderFailure::RateLimited, "one answer per repository");
        let skipped = session.pull_requests(&limited, "b", &other_repo).await.unwrap_err();
        assert_eq!((skipped.kind, limited.calls()), (ProviderFailure::RateLimited, 1), "the same organization is not asked again");

        let session = Session::default();
        let broken = Fake::output(1, "", "ERROR: The server is on fire");
        session.pull_requests(&broken, "a", &azure()).await.unwrap_err();
        session.pull_requests(&broken, "b", &other_repo).await.unwrap_err();
        assert_eq!(broken.calls(), 2, "another failure says nothing about the next repository");
        let fine = Fake::output(0, "[]", "");
        Session::default().pull_requests(&fine, "c", &github()).await.unwrap();
        assert_eq!(fine.calls(), 1);
    }

    #[test]
    fn reviewers_and_drafts_come_from_both_providers() {
        let az = r#"[{"pullRequestId": 9, "status": "active", "sourceRefName": "refs/heads/f", "targetRefName": "refs/heads/main", "isDraft": true, "mergeStatus": "conflicts",
            "createdBy": {"uniqueName": "me@corp.example", "displayName": "Me Myself"},
            "reviewers": [{"uniqueName": "anna@corp.example", "vote": 10, "isRequired": true}, {"uniqueName": "me@corp.example", "vote": 0},
                          {"uniqueName": "bob@corp.example", "vote": -10}, {"displayName": "[Project] Team", "vote": 0}]}]"#;
        let p = &parse_azure(az, "w").unwrap().prs[0];
        assert!(p.is_draft && p.has_conflicts);
        assert_eq!((p.author.as_str(), p.author_name.as_deref()), ("me@corp.example", Some("Me Myself")));
        let states: Vec<(&str, ReviewState, bool)> = p.reviewers.iter().map(|r| (r.id.as_str(), r.state, r.required)).collect();
        assert_eq!(states, vec![("anna@corp.example", ReviewState::Approved, true), ("me@corp.example", ReviewState::Pending, false), ("bob@corp.example", ReviewState::Changes, false)]);
        let gh = r#"[{"number": 3, "state": "OPEN", "headRefName": "f", "baseRefName": "main", "url": "u", "author": {"login": "anna", "name": "Anna A."}, "mergeable": "MERGEABLE",
            "reviewRequests": [{"login": "me"}, {"slug": "core-team", "name": "Core"}],
            "latestReviews": [{"author": {"login": "bob"}, "state": "CHANGES_REQUESTED"}, {"author": {"login": "me"}, "state": "COMMENTED"}]}]"#;
        let p = &parse_github(gh).unwrap().prs[0];
        let states: Vec<(&str, ReviewState)> = p.reviewers.iter().map(|r| (r.id.as_str(), r.state)).collect();
        assert_eq!(states, vec![("me", ReviewState::Pending), ("core-team", ReviewState::Pending), ("bob", ReviewState::Changes)]);
        assert!(!p.is_draft && !p.has_conflicts);
        assert_eq!((p.author.as_str(), p.author_name.as_deref()), ("anna", Some("Anna A.")));
    }

    #[test]
    fn provider_commit_lists_map_sha_subject_author_and_time() {
        let gh = r#"{"commits": [{"oid": "a1", "messageHeadline": "Fix it", "authors": [{"email": "dev@x", "name": "Dev"}], "authoredDate": "2026-05-08T12:34:56Z"},
            {"oid": "b2", "authors": null, "messageHeadline": null}]}"#;
        let c = parse_github_commits(gh).unwrap();
        assert_eq!((c[0].sha.as_str(), c[0].subject.as_str(), c[0].author_email.as_str(), c[0].authored_at), ("a1", "Fix it", "dev@x", 1778243696));
        assert_eq!((c[1].author_email.as_str(), c[1].authored_at), ("", 0));
        let az = r#"{"count": 1, "value": [{"commitId": "c3", "comment": "First line\n\nBody", "author": {"name": "Dev", "email": "dev@x", "date": "2026-05-08T12:34:56Z"}}]}"#;
        let c = parse_azure_commits(az).unwrap();
        assert_eq!((c[0].sha.as_str(), c[0].subject.as_str(), c[0].authored_at), ("c3", "First line", 1778243696));
        assert!(parse_github_commits("[]").is_err() && parse_azure_commits("{}").is_err());
    }

    #[test]
    fn iso_times_become_unix_seconds() {
        assert_eq!(iso_to_unix("1970-01-01T00:00:00Z"), None, "the epoch and before is the providers' empty date");
        assert_eq!(iso_to_unix("2026-05-08T12:34:56Z"), Some(1778243696));
        assert_eq!(iso_to_unix("2026-05-08T12:34:56.1234567Z"), Some(1778243696), "fractions are dropped");
        assert_eq!(iso_to_unix("2026-05-08T14:34:56+02:00"), Some(1778243696), "offsets count");
        assert_eq!(iso_to_unix("2024-02-29T00:00:00Z"), Some(1709164800), "leap day");
        assert_eq!(iso_to_unix("0001-01-01T00:00:00"), None);
        assert_eq!(iso_to_unix("yesterday"), None);
    }

    #[test]
    fn pull_requests_carry_their_dates_and_target_commit() {
        let az = r#"[{"pullRequestId": 7, "status": "completed", "sourceRefName": "refs/heads/f", "targetRefName": "refs/heads/main",
            "creationDate": "2026-05-01T08:00:00.5Z", "closedDate": "2026-05-08T12:34:56Z", "lastMergeTargetCommit": {"commitId": "t1"}},
            {"pullRequestId": 8, "status": "active", "sourceRefName": "refs/heads/g", "targetRefName": "refs/heads/main",
            "creationDate": "2026-05-02T08:00:00Z", "closedDate": "0001-01-01T00:00:00"}]"#;
        let prs = parse_azure(az, "w").unwrap().prs;
        assert_eq!((prs[0].created_at, prs[0].closed_at, prs[0].target_sha.as_deref()), (Some(1777622400), Some(1778243696), Some("t1")));
        assert_eq!(prs[1].closed_at, None, "an open PR has no closing date");
        let gh = r#"[{"number": 1, "state": "MERGED", "headRefName": "f", "baseRefName": "main", "url": "u",
            "createdAt": "2026-05-01T08:00:00Z", "closedAt": "2026-05-08T12:34:56Z", "mergedAt": "2026-05-08T12:34:56Z"},
            {"number": 2, "state": "OPEN", "headRefName": "g", "baseRefName": "main", "url": "u", "createdAt": "2026-05-02T08:00:00Z", "closedAt": null}]"#;
        let prs = parse_github(gh).unwrap().prs;
        assert_eq!((prs[0].created_at, prs[0].closed_at), (Some(1777622400), Some(1778243696)));
        assert_eq!(prs[1].closed_at, None);
    }

    #[test]
    fn azure_pull_requests_map_state_author_and_link() {
        let json = r#"[
            {"pullRequestId": 7, "title": "Fix", "status": "completed", "sourceRefName": "refs/heads/f", "targetRefName": "refs/heads/main",
             "lastMergeSourceCommit": {"commitId": "abc"}, "createdBy": {"displayName": "Dev", "uniqueName": "dev@x"}},
            {"pullRequestId": 8, "status": "abandoned", "sourceRefName": "refs/heads/g", "targetRefName": "refs/heads/main",
             "createdBy": {"displayName": "Only Name"}},
            {"pullRequestId": 9, "status": "active", "sourceRefName": "refs/heads/h", "targetRefName": "refs/heads/main"}
        ]"#;
        let prs = parse_azure(json, "https://dev.azure.com/o/p/_git/r").unwrap().prs;
        assert_eq!(prs.iter().map(|p| p.state).collect::<Vec<_>>(), [PrState::Merged, PrState::Closed, PrState::Open]);
        assert_eq!(prs[0].url, "https://dev.azure.com/o/p/_git/r/pullrequest/7");
        assert_eq!(prs[0].author, "dev@x");
        assert_eq!(prs[0].source_sha.as_deref(), Some("abc"));
        assert_eq!(prs[1].author, "Only Name");
        assert_eq!(prs[2].author, "");
    }

    #[test]
    fn github_pull_requests_map_state_and_refs() {
        let json = r#"[
            {"number": 1, "title": "A", "state": "MERGED", "headRefName": "f", "headRefOid": "abc", "baseRefName": "main", "author": {"login": "dev"}, "url": "u1"},
            {"number": 2, "state": "CLOSED", "headRefName": "g", "baseRefName": "main", "url": "u2"},
            {"number": 3, "state": "OPEN", "headRefName": "h", "baseRefName": "dev", "url": "u3"}
        ]"#;
        let prs = parse_github(json).unwrap().prs;
        assert_eq!(prs.iter().map(|p| p.state).collect::<Vec<_>>(), [PrState::Merged, PrState::Closed, PrState::Open]);
        assert_eq!((prs[0].source_ref.as_str(), prs[2].target_ref.as_str()), ("refs/heads/f", "refs/heads/dev"));
        assert_eq!(prs[1].author, "");
    }

    #[test]
    fn the_pull_request_of_a_branch_is_picked_by_one_rule_per_side() {
        let pr = |id: u32, state: PrState, sha: Option<&str>| PullRequestInfo {
            id,
            title: String::new(),
            state,
            url: String::new(),
            author: String::new(),
            author_name: None,
            source_ref: "refs/heads/f".into(),
            target_ref: "refs/heads/main".into(),
            source_sha: sha.map(String::from),
            created_at: None,
            closed_at: None,
            target_sha: None,
            reviewers: Vec::new(),
            is_draft: false,
            has_conflicts: false,
        };
        let prs = [pr(1, PrState::Merged, Some("tip")), pr(2, PrState::Merged, Some("old")), pr(3, PrState::Open, None), pr(4, PrState::Closed, None)];
        let id = |p: Option<&PullRequestInfo>| p.map(|p| p.id);
        assert_eq!(id(pick_pr(&prs, "refs/heads/f", PrPick::MergedTip("tip"))), Some(1), "the merged PR of exactly this tip");
        assert_eq!(id(pick_pr(&prs, "refs/heads/f", PrPick::MergedTip("new"))), Some(2), "else the newest merged one");
        assert_eq!(id(pick_pr(&prs, "refs/heads/f", PrPick::OpenFirst)), Some(3), "an open PR keeps a server branch alive");
        assert_eq!(id(pick_pr(&prs[3..], "refs/heads/f", PrPick::OpenFirst)), Some(4), "else the newest");
        assert_eq!(id(pick_pr(&prs, "refs/heads/g", PrPick::OpenFirst)), None);
        let index = PrIndex::new(&prs);
        for pick in [PrPick::MergedTip("tip"), PrPick::MergedTip("new"), PrPick::OpenFirst] {
            assert_eq!(id(index.pick("refs/heads/f", pick)), id(pick_pr(&prs, "refs/heads/f", pick)), "the index picks as the list does");
        }
        assert_eq!(id(index.pick("refs/heads/g", PrPick::OpenFirst)), None);
    }

    #[tokio::test]
    async fn other_remotes_have_no_pull_requests() {
        assert!(pull_requests(&Remote::Other).await.unwrap().prs.is_empty());
        assert_eq!(kind_of(&Remote::Other), ProviderKind::None);
        assert_eq!(kind_of(&github()), ProviderKind::GitHub);
    }
}
