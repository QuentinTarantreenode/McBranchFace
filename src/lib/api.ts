import { invoke } from "./invoke";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { AppError } from "./bindings/AppError";
import type { ProviderKind } from "./bindings/ProviderKind";
import type { CachedStatus } from "./bindings/CachedStatus";
import type { AppInfo } from "./bindings/AppInfo";
import type { TrayStatus } from "./bindings/TrayStatus";
import type { CommandDone } from "./bindings/CommandDone";
import type { CommandOutput } from "./bindings/CommandOutput";
import type { Shell } from "./bindings/Shell";
import type { WindowCapabilities } from "./bindings/WindowCapabilities";
import type { CopyKind } from "./bindings/CopyKind";
import type { CopyOutcome } from "./bindings/CopyOutcome";
import type { CopyTarget } from "./bindings/CopyTarget";
import type { TargetCheck } from "./bindings/TargetCheck";
import type { BranchCommits } from "./bindings/BranchCommits";
import type { BranchList } from "./bindings/BranchList";
import type { CarryMode } from "./bindings/CarryMode";
import type { CommitDetail } from "./bindings/CommitDetail";
import type { Config } from "./bindings/Config";
import type { DeletedEntry } from "./bindings/DeletedEntry";
import type { DeleteOutcome } from "./bindings/DeleteOutcome";
import type { DeleteRequest } from "./bindings/DeleteRequest";
import type { DiffSource } from "./bindings/DiffSource";
import type { DiffOptions } from "./bindings/DiffOptions";
import type { HunkPick } from "./bindings/HunkPick";
import type { ApplyAction } from "./bindings/ApplyAction";
import type { FileDiff } from "./bindings/FileDiff";
import type { GitOp } from "./bindings/GitOp";
import type { ImportPreview } from "./bindings/ImportPreview";
import type { LogEntry } from "./bindings/LogEntry";
import type { OnlineScanned } from "./bindings/OnlineScanned";
import type { OpProgress } from "./bindings/OpProgress";
import type { OpResult } from "./bindings/OpResult";
import type { RepoHits } from "./bindings/RepoHits";
import type { PrCommits } from "./bindings/PrCommits";
import type { PullRequestInfo } from "./bindings/PullRequestInfo";
import type { RemoteDeleteRequest } from "./bindings/RemoteDeleteRequest";
import type { RemoteDeleteResult } from "./bindings/RemoteDeleteResult";
import type { RepoChanged } from "./bindings/RepoChanged";
import type { RepoResult } from "./bindings/RepoResult";
import type { RepoStatus } from "./bindings/RepoStatus";
import type { ScanFinished } from "./bindings/ScanFinished";
import type { ScanStarted } from "./bindings/ScanStarted";
import type { ServerHeads } from "./bindings/ServerHeads";
import type { StartupIssue } from "./bindings/StartupIssue";
import type { ToolAction } from "./bindings/ToolAction";
import type { ToolId } from "./bindings/ToolId";
import type { ToolStatus } from "./bindings/ToolStatus";
import { i18n, t } from "./i18n/index.svelte";

export const api = {
  getConfig: () => invoke<Config>("get_config"),
  /** What was saved: sanitized, with the autostart flag the system really has. */
  saveConfig: (config: Config) => invoke<Config>("save_config", { config }),
  startupIssues: () => invoke<StartupIssue[]>("startup_issues"),
  exportConfig: (path: string) => invoke<void>("export_config", { path }),
  importConfig: (path: string) => invoke<ImportPreview>("import_config", { path }),
  environmentStatus: () => invoke<ToolStatus[]>("environment_status"),
  runToolCommand: (tool: ToolId, action: ToolAction) => invoke<void>("run_tool_command", { tool, action }),
  /**
   * `changedOnly`: fetch only the repos whose server moved since their last fetch (the light check decides).
   * `interactive`: the user asked for it, so a sign-in may ask (once per server); background scans never ask.
   */
  scan: (fetch: boolean, changedOnly = false, interactive?: boolean) => invoke<ScanFinished>("scan", { fetch, changedOnly, interactive }),
  /** Stops the running scan; what landed stays and the scan resolves with `cancelled`. False when none runs. */
  cancelScan: () => invoke<boolean>("cancel_scan"),
  rescanRepo: (path: string, root: string) => invoke<RepoResult>("rescan_repo", { path, root }),
  /** The commit lists of one branch as its last assessment counted them; the results carry only the counts. */
  branchCommits: (path: string, branch: string) => invoke<BranchCommits>("branch_commits", { path, branch }),
  /** `interactive`: the user asked for the fetch, so a sign-in may ask. */
  refreshOnline: (path: string, fetch: boolean, interactive?: boolean) => invoke<OnlineScanned>("refresh_online", { path, fetch, interactive }),
  deleteBranch: (request: DeleteRequest) => invoke<DeleteOutcome>("delete_branch", { request }),
  deleteRemoteBranches: (requests: RemoteDeleteRequest[]) => invoke<RemoteDeleteResult[]>("delete_remote_branches", { requests }),
  pruneTracking: (path: string, remote: string, branch: string) => invoke<void>("prune_tracking", { path, remote, branch }),
  exportReport: (path: string, content: string) => invoke<void>("export_report", { path, content }),
  serverHeads: (paths: string[]) => invoke<ServerHeads[]>("server_heads", { paths }),
  fetchRepo: (path: string) => invoke<boolean>("fetch_repo", { path }),
  deletedEntries: () => invoke<DeletedEntry[]>("deleted_entries"),
  restoreBranch: (id: string) => invoke<DeletedEntry>("restore_branch", { id }),
  purgeBackups: (ids: string[]) => invoke<number>("purge_backups", { ids }),
  backupsSize: () => invoke<number>("backups_size"),
  checkoutDefault: (repo: string) => invoke<string>("checkout_default", { repo }),
  stashStat: (repo: string, sha: string) => invoke<string>("stash_stat", { repo, sha }),
  cachedResults: () => invoke<RepoResult[]>("cached_results"),
  repoStatus: (path: string) => invoke<RepoStatus>("repo_status", { path }),
  cachedStatus: () => invoke<CachedStatus>("cached_status"),
  watchRepos: (paths: string[]) => invoke<void>("watch_repos", { paths }),
  gitLog: (path: string, rev: string, skip: number, limit: number, query: string | null) =>
    invoke<LogEntry[]>("git_log", { path, rev, skip, limit, query }),
  commitDetail: (path: string, sha: string) => invoke<CommitDetail>("commit_detail", { path, sha }),
  branchList: (path: string) => invoke<BranchList>("branch_list", { path }),
  workingDiff: (path: string, file: string, source: DiffSource, options: DiffOptions, origPath: string | null = null) =>
    invoke<FileDiff>("working_diff", { path, file, source, options, origPath }),
  commitDiff: (path: string, sha: string, file: string, options: DiffOptions, origPath: string | null = null) => invoke<FileDiff>("commit_diff", { path, sha, file, options, origPath }),
  gitApplySelection: (path: string, file: string, source: DiffSource, context: number, picks: HunkPick[], action: ApplyAction) =>
    invoke<OpResult>("git_apply_selection", { path, file, source, context, picks, action }),
  gitSwitch: (path: string, target: string, remote: boolean, carry: CarryMode) => invoke<OpResult>("git_switch", { path, target, remote, carry }),
  gitSwitchNew: (path: string, name: string, start: string, carry: CarryMode) => invoke<OpResult>("git_switch_new", { path, name, start, carry }),
  forgetForeignWorktree: (path: string, worktree: string) => invoke<OpResult>("forget_foreign_worktree", { path, worktree }),
  prCommits: (path: string, pr: PullRequestInfo) => invoke<PrCommits>("pr_commits", { path, pr }),
  openPullRequests: (path: string, refresh: boolean) => invoke<PullRequestInfo[]>("open_pull_requests", { path, refresh }),
  folderKinds: (paths: string[]) => invoke<boolean[]>("folder_kinds", { paths }),
  findCommit: (paths: string[], query: string) => invoke<RepoHits[]>("find_commit", { paths, query }),
  gitFastForward: (path: string, branch: string) => invoke<OpResult>("git_fast_forward", { path, branch }),
  gitStashApply: (path: string, sha: string) => invoke<OpResult>("git_stash_apply", { path, sha }),
  gitStashDrop: (path: string, sha: string) => invoke<OpResult>("git_stash_drop", { path, sha }),
  gitCreateBranch: (path: string, name: string, start: string | null, sw: boolean) =>
    invoke<OpResult>("git_create_branch", { path, name, start, switch: sw }),
  gitStage: (path: string, paths: string[]) => invoke<OpResult>("git_stage", { path, paths }),
  gitUnstage: (path: string, paths: string[]) => invoke<OpResult>("git_unstage", { path, paths }),
  gitDiscard: (path: string, tracked: string[], untracked: string[]) => invoke<OpResult>("git_discard", { path, tracked, untracked }),
  gitCommit: (path: string, message: string, amend: boolean, allowPushed: boolean) =>
    invoke<OpResult>("git_commit", { path, message, amend, allowPushed }),
  /** `branch` for a push of a branch that is not checked out. */
  gitRemote: (path: string, op: GitOp, id: string, branch: string | null = null) => invoke<OpResult>("git_remote", { path, op, id, branch }),
  /** `target` is the new folder; it is removed again when the clone fails or is stopped. A sign-in may ask. */
  gitClone: (url: string, target: string, id: string) => invoke<OpResult>("git_clone", { url, target, id }),
  gitCancel: (id: string) => invoke<void>("git_cancel", { id }),
  freeCopyFolders: (path: string, label: string, count: number) => invoke<string[]>("free_copy_folders", { path, label, count }),
  checkCopyTargets: (path: string, kind: CopyKind, targets: CopyTarget[]) => invoke<TargetCheck[]>("check_copy_targets", { path, kind, targets }),
  createWorkingCopies: (path: string, kind: CopyKind, start: string, targets: CopyTarget[], id: string) =>
    invoke<CopyOutcome[]>("create_working_copies", { path, kind, start, targets, id }),
  removeWorktree: (path: string, worktree: string, force: boolean) => invoke<OpResult>("remove_worktree", { path, worktree, force }),
  openFolder: (path: string) => invoke<void>("open_folder", { path }),
  revealPath: (path: string) => invoke<void>("reveal_path", { path }),
  openFile: (path: string) => invoke<void>("open_file", { path }),
  appInfo: () => invoke<AppInfo>("app_info"),
  diagnosticsNote: (lines: string[]) => invoke<void>("diagnostics_note", { lines }),
  setActivityWatch: (on: boolean) => invoke<void>("set_activity_watch", { on }),
  providerIdentity: (kind: ProviderKind) => invoke<string | null>("provider_identity", { kind }),
  windowCapabilities: () => invoke<WindowCapabilities>("window_capabilities"),
  setTrayStatus: (status: TrayStatus) => invoke<void>("set_tray_status", { status }),
  runCustomCommand: (id: string, repoPath: string, branch: string | null) => invoke<string>("run_custom_command", { id, repoPath, branch }),
  cancelCustomCommand: (runId: string) => invoke<void>("cancel_custom_command", { runId }),
  previewCustomCommand: (script: string, shell: Shell, repoPath: string, branch: string | null) =>
    invoke<string>("preview_custom_command", { script, shell, repoPath, branch }),
  openUrl: (url: string) => invoke<void>("open_url", { url }),
  openTerminal: (path: string) => invoke<void>("open_terminal", { path }),
  githubDesktopAvailable: () => invoke<boolean>("github_desktop_available"),
  openGithubDesktop: (path: string) => invoke<void>("open_github_desktop", { path }),
};

export const onScanStarted = (cb: (e: ScanStarted) => void): Promise<UnlistenFn> => listen<ScanStarted>("scan-started", (e) => cb(e.payload));
export const onScanRepo = (cb: (e: RepoResult) => void): Promise<UnlistenFn> => listen<RepoResult>("scan-repo", (e) => cb(e.payload));
export const onScanOnline = (cb: (e: OnlineScanned) => void): Promise<UnlistenFn> => listen<OnlineScanned>("scan-online", (e) => cb(e.payload));
export const onRepoChanged = (cb: (e: RepoChanged) => void): Promise<UnlistenFn> => listen<RepoChanged>("repo-changed", (e) => cb(e.payload));
export const onCommandOutput = (cb: (e: CommandOutput) => void): Promise<UnlistenFn> => listen<CommandOutput>("command-output", (e) => cb(e.payload));
export const onCommandDone = (cb: (e: CommandDone) => void): Promise<UnlistenFn> => listen<CommandDone>("command-done", (e) => cb(e.payload));
export const onOpProgress = (cb: (e: OpProgress) => void): Promise<UnlistenFn> => listen<OpProgress>("op-progress", (e) => cb(e.payload));

const isAppError = (e: unknown): e is AppError => !!e && typeof e === "object" && "code" in e && "detail" in e;

/** User-facing text of any command failure: the code's sentence, the raw detail separately. */
export function explainError(e: unknown): { text: string; detail?: string } {
  // Before the dictionary is loaded (start-up failure) the raw text is all there is.
  if (!i18n.dict) return { text: isAppError(e) ? `${e.code}: ${e.detail}` : e instanceof Error ? e.message : String(e) };
  if (isAppError(e)) {
    const m = t.errors[e.code];
    if (e.code === "Other") return { text: e.detail || m.title, detail: e.detail ? undefined : m.hint };
    return { text: m.title, detail: [m.hint, e.detail].filter(Boolean).join(" · ") };
  }
  // Structured failures (delete, git operations) that reached a generic handler.
  if (isFailure<{ kind: string; detail?: string }>(e) && e.kind in t.failure) {
    const f = t.failure[e.kind as keyof typeof t.failure];
    return { text: f.title, detail: [e.detail, f.hint].filter(Boolean).join(" · ") || undefined };
  }
  if (typeof e === "string") return { text: e };
  if (e instanceof Error) return { text: t.startup.unexpected, detail: e.message || undefined };
  return { text: t.startup.unexpected, detail: JSON.stringify(e) };
}

export const errorText = (e: unknown) => {
  const x = explainError(e);
  return x.detail ? `${x.text}: ${x.detail}` : x.text;
};

/** Structured failures from the backend (delete and git operations) carry a `kind`. */
export function isFailure<T extends { kind: string }>(e: unknown): e is T {
  return !!e && typeof e === "object" && "kind" in e;
}
