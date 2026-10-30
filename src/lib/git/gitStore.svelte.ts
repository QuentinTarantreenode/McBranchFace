import { api, errorText, isFailure, onOpProgress, onRepoChanged, explainError } from "$lib/api";
import { sameFolder } from "$lib/roots";
import type { BranchList } from "$lib/bindings/BranchList";
import type { CarryMode } from "$lib/bindings/CarryMode";
import type { CommitDetail } from "$lib/bindings/CommitDetail";
import type { DiffSource } from "$lib/bindings/DiffSource";
import type { FileDiff } from "$lib/bindings/FileDiff";
import type { GitOp } from "$lib/bindings/GitOp";
import type { LogEntry } from "$lib/bindings/LogEntry";
import type { OpFailure } from "$lib/bindings/OpFailure";
import type { OpResult } from "$lib/bindings/OpResult";
import type { ApplyAction } from "$lib/bindings/ApplyAction";
import type { HunkPick } from "$lib/bindings/HunkPick";
import type { Whitespace } from "$lib/bindings/Whitespace";
import type { RepoChanged } from "$lib/bindings/RepoChanged";
import { t } from "$lib/i18n/index.svelte";
import { Lru } from "./changes";
import { gitStatus } from "$lib/stores/gitStatus.svelte";
import { gitClaims } from "$lib/stores/gitClaims.svelte";
import { activity } from "$lib/stores/activity.svelte";
import { Latest } from "$lib/latest";
import { toasts } from "$lib/stores/toasts.svelte";
import { PROBED } from "$lib/probe";

export type GitTab = "changes" | "history" | "branches";

/** A question the Git view asks before it acts; rendered by GitDialogs. */
export interface ConfirmRequest {
  title: string;
  text: string;
  items: string[];
  action: string;
  danger: boolean;
  run: () => unknown;
  alt?: { label: string; run: () => unknown };
}
export interface FileSelection {
  path: string;
  source: DiffSource;
}

/** What the Git view loads on its own; each keeps its own error, shown where it is shown. */
export type GitResource = "diff" | "log" | "detail" | "commitDiff" | "branches";

interface CommitDraft {
  message: string;
  amend: boolean;
}

const PAGE = 200;

/** A commit never changes, so its details and diffs are cached across repo and tab switches. */
const details = new Lru<CommitDetail>(300);
const commitDiffs = new Lru<FileDiff>(300);

/** State of the Git perspective for one selected repo. Responses for an older selection are dropped. */
class GitStore {
  repo = $state<string | null>(null);
  tab = $state<GitTab>("changes");
  /** A failed load per resource; it ends when that resource loads again, or with another repo. */
  errors = $state.raw<Partial<Record<GitResource, string>>>({});

  // Raw: replaced as a whole, never written in place; a deep proxy over a large diff or log costs on
  // every read. The selection is raw too, so `diffFor === selectedFile` compares the objects handed in.
  selectedFile = $state.raw<FileSelection | null>(null);
  diff = $state.raw<FileDiff | null>(null);
  /** The selection `diff` belongs to: until the answer for a new selection lands, it is the previous one. */
  diffFor = $state.raw<FileSelection | null>(null);
  diffLoading = $state(false);

  log = $state.raw<LogEntry[]>([]);
  logDone = $state(false);
  logLoading = $state(false);
  logQuery = $state("");
  selectedSha = $state<string | null>(null);
  /** What the history shows: HEAD, a branch, or a range such as `origin/main..feature/x`. */
  rev = $state("HEAD");
  detail = $state.raw<CommitDetail | null>(null);
  commitFile = $state<string | null>(null);
  commitFileDiff = $state.raw<FileDiff | null>(null);

  branches = $state.raw<BranchList | null>(null);

  /** Drawn only when the repo changes: every answer for the old repo is dropped. */
  private repoLine = new Latest();
  /**
   * One per resource, bumped when that resource is asked for anew: the log starts over, another diff,
   * another branch list. A new log query leaves a diff on its way alone.
   */
  private logLine = new Latest();
  private diffLine = new Latest();
  private branchesLine = new Latest();
  private listening = false;

  // ---- writing operations ------------------------------------------------------------------

  busy = $state<GitOp | null>(null);

  /**
   * What runs in this repo from elsewhere (a group pull, a switch from the sidebar), as the tip of the
   * controls that wait for it; null while the repo is free or this view runs the operation itself.
   */
  get elsewhere(): string | null {
    return !this.busy && this.repo ? gitClaims.gitRunning(this.repo) : null;
  }
  /** Writing controls wait: for an operation of this view, or one started elsewhere in this repo. */
  get locked(): boolean {
    return !!this.busy || !!this.elsewhere;
  }
  progress = $state<{ phase: string; percent: number | null } | null>(null);
  private opId: string | null = null;
  confirm = $state<ConfirmRequest | null>(null);
  createOpen = $state(false);
  /** The draft of the open repo; another repo's draft waits in `drafts` until it is opened again. */
  commitMessage = $state("");
  amend = $state(false);
  private drafts = new Map<string, CommitDraft>();

  /** Called by the view on mount; the store follows watcher events from then on. */
  attach() {
    if (this.listening) return;
    this.listening = true;
    onRepoChanged((e) => this.onRepoChanged(e));
    onOpProgress((p) => {
      if (p.id === this.opId) this.progress = { phase: p.phase, percent: p.percent };
    });
  }

  /** Common wrapper: one operation at a time, state refreshed afterwards, failures explained. */
  private async run(
    op: GitOp,
    fn: (repo: string) => Promise<OpResult>,
    opts: { quiet?: boolean; onFail?: (f: OpFailure) => boolean; onStart?: () => void } = {},
  ): Promise<OpResult | null> {
    const repo = this.repo;
    if (!repo || this.busy) return null;
    let result: OpResult | null = null;
    const ran = await gitClaims.withClaim([repo], t.git.op[op].label, async () => {
      this.busy = op;
      // Only now, with the repo claimed: a refused start must leave the progress of nothing behind.
      opts.onStart?.();
      // The Git view shows its own progress; the activity is for the display and the log.
      const act = activity.begin(t.git.op[op].label, repo);
      try {
        result = await fn(repo);
        activity.end(act);
        if (!opts.quiet) this.announce(op, result);
      } catch (e) {
        activity.end(act, "failed", explainError(e).text);
        if (isFailure<OpFailure>(e)) {
          if (!opts.onFail?.(e)) this.explain(e);
        } else {
          toasts.fail(e);
        }
      } finally {
        this.busy = null;
        this.progress = null;
        this.opId = null;
      }
    });
    if (!ran) return null;
    await this.refresh(repo);
    return result;
  }

  private announce(op: GitOp, r: OpResult) {
    if (op === "Switch" && r.warning === "LocalChanges") {
      toasts.toast("info", t.git.switchedWithConflicts);
      return;
    }
    const extra = r.backupDir ? t.git.backupAt(r.backupDir) : r.warning ? t.git.stashKept(t.failure[r.warning].title) : r.summary ?? undefined;
    toasts.toast(r.warning ? "info" : "success", `${t.git.op[op].done}.`, { detail: extra });
  }

  private explain(f: OpFailure) {
    // In Git, "changed" only comes from a partial patch: the file moved on under the shown diff.
    const k = f.kind === "Changed" ? t.git.diffChanged : t.failure[f.kind];
    const repo = this.repo;
    const terminal = (f.kind === "AuthRequired" || f.kind === "Diverged" || f.kind === "Other") && repo;
    const text = `${t.git.op[f.op].label}: ${k.title}. ${k.hint}${f.changed ? ` ${t.git.alreadyChanged}` : ""}`;
    toasts.toast("error", text, {
      detail: f.path ?? (f.kind === "Other" ? f.detail : undefined),
      action: terminal ? { label: t.git.openTerminal, run: () => toasts.safely(() => api.openTerminal(repo)) } : undefined,
    });
  }

  private async refresh(repo: string) {
    await gitStatus.refreshStatus(repo);
    if (repo !== this.repo) return;
    if (this.selectedFile) this.selectFile(this.selectedFile);
    if (this.branches) this.loadBranches();
    this.resetLog();
  }

  stage(paths: string[]) {
    return this.run("Stage", (r) => api.gitStage(r, paths), { quiet: true });
  }

  unstage(paths: string[]) {
    return this.run("Unstage", (r) => api.gitUnstage(r, paths), { quiet: true });
  }

  /**
   * Chosen hunks or lines of the selected file into or out of the index, or out of the working tree.
   * Discarding asks first; the backend keeps a copy of the file and names it in the message.
   */
  applySelection(picks: HunkPick[], action: ApplyAction) {
    // The picks index the diff on screen: while the answer for a newer selection is on its way, that
    // is still the previous file's, and its hunks must not be applied to the new one.
    const sel = this.diffFor;
    if (!sel || sel !== this.selectedFile || !picks.length) return;
    const context = this.diffOptions.context;
    const go = () => this.run(action, (r) => api.gitApplySelection(r, sel.path, sel.source, context, picks, action), { quiet: action !== "Discard" });
    if (action !== "Discard") return go();
    const lines = picks.reduce((n, p) => n + (p.lines?.length ?? 0), 0);
    this.confirm = {
      title: lines ? t.git.discardLinesTitle(lines) : t.git.discardHunksTitle(picks.length),
      text: t.git.discardPartText,
      items: [sel.path],
      action: t.git.discardAction,
      danger: true,
      run: go,
    };
  }

  requestDiscard(tracked: string[], untracked: string[]) {
    const files = [...tracked, ...untracked];
    this.confirm = {
      title: files.length === 1 ? t.git.discardTitleOne : t.git.discardTitleMany(files.length),
      text: t.git.discardText,
      items: files,
      action: t.git.discardAction,
      danger: true,
      run: () => this.run("Discard", (r) => api.gitDiscard(r, tracked, untracked)),
    };
  }

  async commit(allowPushed = false) {
    const [repo, message, amend] = [this.repo, this.commitMessage.trim(), this.amend];
    const r = await this.run("Commit", (path) => api.gitCommit(path, message, amend, allowPushed), {
      onFail: (f) => {
        if (f.kind !== "AlreadyPushed") return false;
        this.confirm = {
          title: t.git.amendPushedTitle,
          text: t.git.amendPushedText(t.failure.AlreadyPushed.hint, f.detail),
          items: [],
          action: t.git.amendAnyway,
          danger: true,
          run: () => this.commit(true),
        };
        return true;
      },
    });
    if (!r || !repo) return;
    // The draft that was committed goes; another repo opened meanwhile keeps its own.
    if (repo === this.repo) {
      this.commitMessage = "";
      this.amend = false;
    } else this.drafts.delete(repo);
  }

  /** Amend edits the last commit, so its message is the natural starting point. */
  async setAmend(on: boolean) {
    this.amend = on;
    if (!on || this.commitMessage.trim() || !this.repo) return;
    const repo = this.repo;
    try {
      const d = await api.commitDetail(repo, "HEAD");
      // Only if the answer still fits: same repo, amend still on, nothing typed meanwhile.
      if (this.repo !== repo || !this.amend || this.commitMessage.trim()) return;
      this.commitMessage = d.body ? `${d.entry.subject}\n\n${d.body}` : d.entry.subject;
    } catch {
      /* an empty repo has no HEAD: nothing to prefill */
    }
  }

  switchTo(target: string, remote: boolean, carry: CarryMode = "Keep") {
    return this.run("Switch", (r) => api.gitSwitch(r, target, remote, carry), {
      onFail: (f) => {
        if (f.kind !== "LocalChanges" || carry !== "Keep") return false;
        this.confirm = {
          title: t.git.localChangesTitle,
          text: t.git.localChangesText(target),
          items: [],
          action: t.git.bring,
          alt: { label: t.git.stashOnly, run: () => this.switchTo(target, remote, "Stash") },
          danger: false,
          run: () => this.switchTo(target, remote, "Bring"),
        };
        return true;
      },
    });
  }

  async createBranch(name: string, start: string | null, switchTo: boolean) {
    const r = await this.run("CreateBranch", (repo) => api.gitCreateBranch(repo, name, start, switchTo));
    if (r) this.createOpen = false;
    return r;
  }

  remote(op: "Fetch" | "Pull" | "Push") {
    // Set once the operation really starts: a second click while something runs must not take over the
    // progress and cancel id of the first, and a refused one must not leave its own behind.
    const id = crypto.randomUUID();
    const onStart = () => {
      this.opId = id;
      this.progress = { phase: t.git.op[op].label, percent: null };
    };
    return this.run(op, (r) => api.gitRemote(r, op, id), { onStart });
  }

  cancel() {
    if (this.opId) api.gitCancel(this.opId).catch((e) => toasts.fail(e));
  }

  setRepo(path: string | null) {
    if (path === this.repo) return;
    this.keepDraft(path);
    this.repo = path;
    this.repoLine.next();
    // What was loading belongs to the old repo; its answers are dropped, so nothing would end these.
    this.logLine.next();
    this.logLoading = false;
    this.diffLoading = false;
    this.commitDiffLoading = false;
    this.selectedFile = null;
    this.diff = null;
    this.diffFor = null;
    this.log = [];
    this.logDone = false;
    this.logQuery = "";
    this.rev = "HEAD";
    this.selectedSha = null;
    this.detail = null;
    this.commitFile = null;
    this.commitFileDiff = null;
    this.branches = null;
    this.errors = {};
    // A linked worktree has no status of its own until asked; the repos get theirs from the scan.
    if (path) void gitStatus.refreshStatus(path);
    this.loadTab();
  }

  /**
   * The message and amend belong to the repo they were written for: Ctrl+Enter in another repo must
   * not commit or amend there with them. Parked on leaving, restored on coming back.
   */
  private keepDraft(next: string | null) {
    if (this.repo) {
      if (this.commitMessage.trim() || this.amend) this.drafts.set(this.repo, { message: this.commitMessage, amend: this.amend });
      else this.drafts.delete(this.repo);
    }
    const d = next ? this.drafts.get(next) : undefined;
    this.commitMessage = d?.message ?? "";
    this.amend = d?.amend ?? false;
  }

  clearError(resource: GitResource) {
    const { [resource]: _, ...rest } = this.errors;
    this.errors = rest;
  }

  private setError(resource: GitResource, e: unknown | null) {
    if (e === null) {
      if (resource in this.errors) this.clearError(resource);
    } else this.errors = { ...this.errors, [resource]: errorText(e) };
  }

  setTab(tab: GitTab) {
    this.tab = tab;
    this.loadTab();
  }

  private loadTab() {
    if (!this.repo) return;
    if (this.tab === "history" && this.log.length === 0) this.loadMoreLog();
    if (this.tab === "branches" && !this.branches) this.loadBranches();
  }

  /**
   * Runs `fn` and applies its result only while the repo and, if given, the request are still current;
   * the answer also ends or sets the resource's error.
   */
  private async guarded<T>(resource: GitResource, fn: () => Promise<T>, apply: (v: T) => void, current: () => boolean = () => true) {
    const sameRepo = this.repoLine.now();
    const fits = () => sameRepo() && current();
    try {
      const v = await fn();
      if (!fits()) return;
      apply(v);
      this.setError(resource, null);
    } catch (e) {
      if (fits()) this.setError(resource, e);
    }
  }

  /** How diffs are shown: context lines and whitespace, for the working tree and for commits alike. */
  commitDiffLoading = $state(false);
  diffOptions = $state<{ context: number; whitespace: Whitespace }>({ context: 3, whitespace: "Keep" });

  setDiffOptions(next: Partial<{ context: number; whitespace: Whitespace }>) {
    this.diffOptions = { ...this.diffOptions, ...next };
    if (this.selectedFile) this.selectFile(this.selectedFile);
    if (this.commitFile) this.selectCommitFile(this.commitFile);
  }

  async selectFile(sel: FileSelection | null, full = false) {
    this.selectedFile = sel;
    if (!sel || !this.repo) {
      this.diffLine.next();
      this.diff = null;
      this.diffFor = null;
      this.diffLoading = false;
      this.setError("diff", null);
      return;
    }
    const repo = this.repo;
    const isCurrent = this.diffLine.next();
    this.diffLoading = true;
    // The old path of a rename, so git pairs the two instead of showing an added file.
    const orig = gitStatus.statuses.get(repo)?.entries.find((e) => e.path === sel.path)?.origPath ?? null;
    await this.guarded(
      "diff",
      () => api.workingDiff(repo, sel.path, sel.source, { ...this.diffOptions, full }, orig),
      (d) => {
        this.diff = d;
        this.diffFor = sel;
      },
      isCurrent,
    );
    if (isCurrent()) this.diffLoading = false;
  }

  /** Entries the first page of a reload asks for: as many as were shown, after a refs change. */
  private firstPage = PAGE;

  /** `keepDepth`: the same history, only newer (a refs change), so the selected commit stays listed. */
  private resetLog(keepDepth = false) {
    // The backend answers at most 1000 per call.
    this.firstPage = keepDepth ? Math.min(1000, Math.max(PAGE, this.log.length)) : PAGE;
    this.logLine.next();
    this.logLoading = false;
    this.log = [];
    this.logDone = false;
    if (this.tab === "history") this.loadMoreLog();
  }

  setRev(rev: string) {
    if (rev === this.rev) return;
    this.rev = rev;
    this.resetLog();
  }

  setLogQuery(q: string) {
    if (q === this.logQuery) return;
    this.logQuery = q;
    this.resetLog();
  }

  async loadMoreLog() {
    if (!this.repo || this.logLoading || this.logDone) return;
    const repo = this.repo;
    const query = this.logQuery.trim() || null;
    const isCurrent = this.logLine.now();
    const n = this.log.length === 0 ? this.firstPage : PAGE;
    this.logLoading = true;
    await this.guarded(
      "log",
      () => api.gitLog(repo, this.rev, this.log.length, n, query),
      (page) => {
        this.log = [...this.log, ...page];
        this.logDone = page.length < n;
      },
      isCurrent,
    );
    if (isCurrent()) this.logLoading = false;
  }

  async selectCommit(sha: string) {
    if (!this.repo) return;
    const repo = this.repo;
    this.selectedSha = sha;
    this.commitFile = null;
    this.commitFileDiff = null;
    const apply = (d: CommitDetail) => {
      if (this.selectedSha !== sha) return;
      this.detail = d;
      if (d.files.length) this.selectCommitFile(d.files[0].path);
    };
    const cached = details.get(`${repo}|${sha}`);
    if (cached) {
      this.setError("detail", null);
      return apply(cached);
    }
    await this.guarded(
      "detail",
      () => api.commitDetail(repo, sha),
      (d) => {
        details.set(`${repo}|${sha}`, d);
        apply(d);
      },
      () => this.selectedSha === sha,
    );
  }

  async selectCommitFile(path: string, full = false) {
    if (!this.repo || !this.selectedSha) return;
    const [repo, sha] = [this.repo, this.selectedSha];
    this.commitFile = path;
    const o = this.diffOptions;
    const key = `${repo}|${sha}|${path}|${full}|${o.context}|${o.whitespace}`;
    const cached = commitDiffs.get(key);
    if (cached) {
      this.commitFileDiff = cached;
      this.setError("commitDiff", null);
      return;
    }
    this.commitDiffLoading = true;
    await this.guarded(
      "commitDiff",
      () => api.commitDiff(repo, sha, path, { ...o, full }, this.detail?.files.find((f) => f.path === path)?.origPath ?? null),
      (d) => {
        commitDiffs.set(key, d);
        this.commitFileDiff = d;
      },
      () => this.commitFile === path && this.selectedSha === sha,
    );
    if (this.commitFile === path) this.commitDiffLoading = false;
  }

  async loadBranches() {
    if (!this.repo) return;
    const repo = this.repo;
    const isCurrent = this.branchesLine.next();
    await this.guarded(
      "branches",
      () => api.branchList(repo),
      (b) => (this.branches = b),
      isCurrent,
    );
  }

  /** Watcher events for the selected repo keep the open views current without a click. */
  onRepoChanged(e: RepoChanged) {
    // The watcher names the repo whose git directory changed; an open worktree belongs to it.
    if (!this.repo || (e.path !== this.repo && gitStatus.ownerOf(this.repo) !== e.path)) return;
    // Files of another working copy of the same repo changed: the open one is untouched.
    const here = !e.paths?.length || e.paths.some((p) => sameFolder(p, this.repo!));
    if (e.path !== this.repo && here) gitStatus.refreshFromWatcher(this.repo);
    if (e.scopes.includes("Files") && here && this.selectedFile) this.selectFile(this.selectedFile);
    if (e.scopes.includes("Refs")) {
      this.resetLog(true);
      if (this.branches || this.tab === "branches") this.loadBranches();
    }
  }
}

export const gitStore = new GitStore();

// Handle for CDP-driven UI tests; removed from release builds (PROBED is false there).
if (PROBED) (globalThis as Record<string, unknown>).__mbfGit = gitStore;
