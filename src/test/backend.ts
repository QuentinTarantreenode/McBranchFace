// Simulated Tauri backend for store and component tests: every command answers from `handlers`,
// every call is recorded, and events go through Tauri's own event mock.
import { clearMocks, mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import type { BranchCommits } from "$lib/bindings/BranchCommits";
import type { BranchReport } from "$lib/bindings/BranchReport";
import type { BranchRow } from "$lib/bindings/BranchRow";
import type { CommitInfo } from "$lib/bindings/CommitInfo";
import type { Config } from "$lib/bindings/Config";
import type { DeletedEntry } from "$lib/bindings/DeletedEntry";
import type { DeleteOutcome } from "$lib/bindings/DeleteOutcome";
import type { FileDiff } from "$lib/bindings/FileDiff";
import type { HeadInfo } from "$lib/bindings/HeadInfo";
import type { LogEntry } from "$lib/bindings/LogEntry";
import type { OnlineScanned } from "$lib/bindings/OnlineScanned";
import type { OpResult } from "$lib/bindings/OpResult";
import type { PullRequestInfo } from "$lib/bindings/PullRequestInfo";
import type { RemoteBranchReport } from "$lib/bindings/RemoteBranchReport";
import type { RepoInfo } from "$lib/bindings/RepoInfo";
import type { RepoResult } from "$lib/bindings/RepoResult";
import type { RepoStatus } from "$lib/bindings/RepoStatus";
import type { StatusEntry } from "$lib/bindings/StatusEntry";
import type { ToolStatus } from "$lib/bindings/ToolStatus";
import type { WorktreeInfo } from "$lib/bindings/WorktreeInfo";

export type Handler = (args: Record<string, unknown>) => unknown;

export function config(over: Partial<Config> = {}): Config {
  return {
    roots: ["C:/ws"],
    scanDepth: 4,
    protectedPatterns: ["main"],
    protectedDefaultsKnown: [],
    defaultBranchOverrides: {},
    defaultBranchCandidates: ["main"],
    myEmails: ["me@example.com"],
    fetchOnScan: true,
    useProviders: false,
    concurrency: 4,
    theme: "Dark",
    ui: { perspective: "Cleanup", sidebarCollapsed: false, detailCollapsed: false, sidebarWidth: 248, detailWidth: 380, alwaysOnTop: false, cleanupScope: "Local", collapsedRoots: [], tableGroup: "None", collapsedGroups: [], tableLayout: { local: [], online: [], branches: [] }, dialogSizes: {}, scale: 115, diffSplit: false, orphanedOnly: true, collapsedRepoGroups: [], groupSplit: 50, gitChangesAll: false, gitChangesByFolder: false, collapsed: {}, gitChangesTree: false, gitBranchGroup: "None", motion: "on", activityShown: false, dashboardPrs: "mine", dashboardDismissed: {}, watchFiles: true, watchRefs: true, refsGapSeconds: 30 },
    autoFetchMinutes: 30,
    language: "De",
    locks: [],
    alerts: { enabled: true, notify: true, localSafe: true, localReview: false, onlineMerged: true, onlineInactive: false, localForgotten: false },
    staleDays: 30,
    scanOnline: true,
    onlineExcluded: [],
    ignores: [],
    annotations: {},
    serverCheckMinutes: 5,
    diagnostics: false,
    window: { closeToTray: true, minimizeToTray: false, autostart: false, startHidden: true },
    commands: [],
    prompts: [],
    repoColors: {},
    identities: {},
    repoGroups: [],
    ...over,
  };
}

export function repo(path: string, over: Partial<RepoInfo> = {}): RepoInfo {
  return {
    path,
    name: path.split("/").pop()!,
    root: "C:/ws",
    provider: "None",
    remoteUrl: null,
    defaultBranch: "main",
    identity: `id:${path.split("/").pop()}`,
    links: null,
    ...over,
  } as RepoInfo;
}

/**
 * The commit lists of the branches built by `branch`, by repo and name: the backend answers
 * `branch_commits` with them, as the app reads them on demand (the scan result has only the counts).
 */
const commitLists = new Map<string, BranchCommits>();

/** A branch's fields, and its commit lists for `branch_commits`. */
export type BranchOver = Partial<BranchReport> & { ownCommits?: CommitInfo[]; unpushedCommits?: CommitInfo[] };

export function branch(repoPath: string, name: string, over: BranchOver = {}): BranchReport {
  const { ownCommits = [], unpushedCommits = [], ...fields } = over;
  const b = branchReport(repoPath, name, fields, unpushedCommits.length);
  commitLists.set(`${repoPath}::${name}`, { sha: b.sha, own: ownCommits, unpushed: unpushedCommits });
  return b;
}

function branchReport(repoPath: string, name: string, over: Partial<BranchReport>, unpushed: number): BranchReport {
  return {
    repoPath,
    name,
    sha: `${name}-sha`,
    upstream: `refs/remotes/origin/${name}`,
    upstreamState: "Gone",
    remoteRef: `refs/heads/${name}`,
    lastCommitAt: 1_000,
    lastCommitSubject: `work on ${name}`,
    lastCommitAuthor: "me@example.com",
    authors: ["me@example.com"],
    isMine: true,
    verdict: "Safe",
    checks: [],
    mergeEvidence: null,
    ownCommitCount: 0,
    pushState: null,
    worktree: null,
    stashes: [],
    pullRequest: null,
    locked: false,
    ignored: false,
    ...over,
    unpushedCommitCount: over.unpushedCommitCount ?? unpushed,
    behind: over.behind ?? 0,
  } as BranchReport;
}

export function remote(repoPath: string, name: string, over: Partial<RemoteBranchReport> = {}): RemoteBranchReport {
  return {
    repoPath,
    remote: "origin",
    name,
    sha: `${name}-rsha`,
    lastCommitAt: 1_000,
    lastCommitSubject: `server ${name}`,
    lastCommitAuthor: "me@example.com",
    isMine: true,
    verdict: "Merged",
    merged: true,
    openPr: false,
    mergeEvidence: null,
    pullRequest: null,
    ownCommitCount: 0,
    locked: false,
    ignored: false,
    ...over,
  };
}

export function result(info: RepoInfo, branches: BranchReport[] = [], online: RemoteBranchReport[] | null = null, over: Partial<RepoResult> = {}): RepoResult {
  return {
    repo: info,
    fetched: true,
    fetchError: null,
    fetchErrorKind: null,
    localBranchCount: branches.length,
    branches,
    tracking: branches.map((b) => ({ branch: b.name, remote: "origin", remoteBranch: b.name, gone: true, ahead: 0, behind: 0, checkedOut: false })),
    online,
    onlineAt: online ? 1_000 : null,
    onlineFetched: true,
    warnings: [],
    error: null,
    errorKind: null,
    durationMs: 5,
    ...over,
  } as RepoResult;
}

export function entry(b: { repoPath: string; name: string }, over: Partial<DeletedEntry> = {}): DeletedEntry {
  return {
    id: `e-${b.name}`,
    repoPath: b.repoPath,
    branch: b.name,
    sha: "s",
    upstreamRemote: null,
    upstreamMerge: null,
    backupRef: `refs/mcbranchface/backup/1/${b.name}`,
    deletedAt: 1,
    forced: false,
    verdict: "Safe",
    droppedStashes: [],
    removedWorktree: null,
    restoredAt: null,
    remote: null,
    filesBackup: null,
    worktreeBackup: null,
    worktreeBranch: null,
    branchConfig: [],
    ...over,
  };
}

export const outcome = (b: { repoPath: string; name: string }, over: Partial<DeletedEntry> = {}): DeleteOutcome => ({
  entry: entry(b, over),
  usedForceFlag: false,
  warnings: [],
  filesBackup: null,
});

export interface Backend {
  calls: { cmd: string; args: Record<string, unknown> }[];
  handlers: Record<string, Handler>;
  /** Commands called so far, by name. */
  called(cmd: string): Record<string, unknown>[];
  /** Whether something listens to the event: a view registers its listeners after it mounted. */
  listens(event: string): boolean;
}

/** Installs the fake backend; unknown commands answer null, like fire-and-forget calls. */
export function installBackend(handlers: Record<string, Handler> = {}): Backend {
  const backend: Backend = {
    calls: [],
    handlers: {
      get_config: () => config(),
      // The backend answers with what it saved; the arguments arrive as JSON, as over IPC.
      save_config: (a) => JSON.parse(JSON.stringify(a.config)),
      cached_results: () => [],
      cached_status: () => ({ statuses: [], scannedAt: null }),
      startup_issues: () => [],
      environment_status: () => [],
      deleted_entries: () => [],
      github_desktop_available: () => false,
      scan: () => ({ durationMs: 10, repoCount: 1 }),
      window_capabilities: () => ({ tray: true, autostart: true, startedHidden: false, home: null }),
      repo_status: () => ({ path: "", head: { branch: "main", oid: null, upstream: null, ahead: 0, behind: 0 }, entries: [], worktrees: [] }),
      branch_commits: (a) => commitLists.get(`${a.path}::${a.branch}`) ?? { sha: "", own: [], unpushed: [] },
      ...handlers,
    },
    called: (cmd) => backend.calls.filter((c) => c.cmd === cmd).map((c) => c.args),
    listens: (event) => (listeners.get(event)?.size ?? 0) > 0,
  };
  const listeners = new Map<string, Set<unknown>>();
  mockWindows("main");
  mockIPC(
    (cmd, args) => {
      const a = (args ?? {}) as Record<string, unknown>;
      backend.calls.push({ cmd, args: a });
      const h = backend.handlers[cmd];
      return h ? h(a) : null;
    },
    { shouldMockEvents: true },
  );
  // Tauri's mock answers the event commands itself, past the handlers above: the listeners are counted here.
  const internals = (window as unknown as { __TAURI_INTERNALS__: { invoke: (cmd: string, args?: Record<string, unknown>, options?: unknown) => Promise<unknown> } }).__TAURI_INTERNALS__;
  const send = internals.invoke;
  internals.invoke = async (cmd, args, options) => {
    const answer = await send(cmd, args, options);
    const event = String(args?.event);
    if (cmd === "plugin:event|listen") listeners.set(event, (listeners.get(event) ?? new Set()).add(answer));
    else if (cmd === "plugin:event|unlisten") listeners.get(event)?.delete(args?.eventId);
    return answer;
  };
  return backend;
}

export { clearMocks };

/**
 * Lets pending promise chains settle; setImmediate, because tests fake setTimeout. Only for "and then
 * nothing more happens": a test that waits for a result waits for that result (src/test/wait.ts).
 */
export const flush = async (rounds = 8) => {
  const later = (globalThis as unknown as { setImmediate: (cb: () => void) => void }).setImmediate;
  for (let i = 0; i < rounds; i++) await new Promise<void>((r) => later(r));
};

// ---- what the commands answer, each with defaults and the fields a test cares about as overrides ----

export function pullRequest(id: number, over: Partial<PullRequestInfo> = {}): PullRequestInfo {
  return {
    id,
    title: `PR ${id}`,
    state: "Open",
    url: `https://x/${id}`,
    author: "me",
    authorName: null,
    sourceRef: "refs/heads/feature",
    targetRef: "refs/heads/main",
    sourceSha: null,
    createdAt: 1,
    closedAt: null,
    targetSha: null,
    reviewers: [],
    isDraft: false,
    hasConflicts: false,
    ...over,
  };
}

export const commit = (sha: string, over: Partial<CommitInfo> = {}): CommitInfo => ({ sha, subject: `commit ${sha}`, authorEmail: "me@example.com", authoredAt: 1, ...over });

/** A line of `git log`. */
export const logEntry = (sha: string, over: Partial<LogEntry> = {}): LogEntry => ({ sha, parents: [], author: "me", email: "me@x", time: 1, subject: `s ${sha}`, refs: [], ...over });

/** A changed file of a status; unstaged and modified unless said otherwise. */
export const statusEntry = (path: string, over: Partial<StatusEntry> = {}): StatusEntry => ({ path, origPath: null, staged: null, unstaged: "Modified", conflicted: false, untracked: false, ...over });

export const worktree = (path: string, over: Partial<WorktreeInfo> = {}): WorktreeInfo => ({ path, branch: "main", head: "o", isMain: false, detached: false, foreign: false, unreferenced: 0, ...over });

/** A repo's status: clean on main, no worktrees, unless said otherwise. */
export function repoStatus(path: string, over: Partial<Omit<RepoStatus, "head">> & { head?: Partial<HeadInfo> } = {}): RepoStatus {
  const { head, ...rest } = over;
  return { path, head: { branch: "main", oid: "o", upstream: null, ahead: 0, behind: 0, unreferenced: 0, ...head }, entries: [], worktrees: [], stashes: 0, ...rest };
}

/** What a git write answers when it went through. */
export const opResult = (over: Partial<OpResult> = {}): OpResult => ({ sha: null, backupDir: null, stashed: false, warning: null, summary: null, ...over });

/** A branch of the Git view's branch list. */
export const branchRow = (name: string, over: Partial<BranchRow> = {}): BranchRow => ({
  name,
  fullRef: `refs/heads/${name}`,
  sha: "s",
  upstream: `origin/${name}`,
  ahead: 0,
  behind: 0,
  gone: false,
  isHead: false,
  worktreePath: null,
  committedAt: 1,
  subject: `on ${name}`,
  author: "me",
  isMine: false,
  ...over,
});

export const fileDiff = (path: string, over: Partial<FileDiff> = {}): FileDiff => ({ path, oldPath: null, similarity: null, oldMode: null, newMode: null, binary: false, truncated: false, added: 0, removed: 0, hunks: [], conflict: false, ...over });

/** A tool of the environment check, ready unless said otherwise. */
export const tool = (id: ToolStatus["id"], over: Partial<ToolStatus> = {}): ToolStatus => ({ id, required: false, state: "Ready", version: null, minVersion: null, account: null, detail: null, downloadUrl: "", commands: [], ...over });

/** The server's answer for one repo, as the scan-online event and refresh_online carry it. */
export const onlineScanned = (path: string, branches: RemoteBranchReport[] = [], over: Partial<OnlineScanned> = {}): OnlineScanned => ({ path, branches, warnings: [], error: null, at: 9, fetched: true, ...over });
