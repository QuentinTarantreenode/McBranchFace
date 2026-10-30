// The git state of every repo and worktree: branch, ahead and behind, changed files. Read when asked,
// landed once per frame, marked while it is still the last run's or could not be read.
import { SvelteMap, SvelteSet } from "svelte/reactivity";
import { api, explainError } from "$lib/api";
import type { RepoStatus } from "$lib/bindings/RepoStatus";
import { frame } from "$lib/frame";
import { mark } from "$lib/marks";
import { PROBED } from "$lib/probe";
import { t } from "$lib/i18n/index.svelte";
import { sameValue } from "$lib/same";
import { Throttle, Tickets } from "$lib/latest";
import { timers } from "$lib/timers";
import { activity } from "./activity.svelte";
import { scanResults } from "./scanResults.svelte";

class GitStatuses {
  /**
   * Live state per repo (current branch, ahead/behind, changed files), kept current by the watcher. A read
   * follows its own key only; the values are plain objects, replaced as a whole, never proxied.
   */
  statuses = new SvelteMap<string, RepoStatus>();

  resetForTests() {
    this.statuses.clear();
    this.statusFailed.clear();
    this.staleStatus.clear();
    this.refreshing.clear();
    this.watch = new Throttle(timers);
    this.pendingStatuses.clear();
    this.afterLand = null;
  }

  /** Per path: answers arrive in any order, only the one asked for last may land. */
  private tickets = new Tickets();

  /** Repos whose status could not be read: they show that, instead of loading for ever. */
  statusFailed = new SvelteSet<string>();
  /** Statuses from the last run, shown dimmed until the fresh one lands. */
  staleStatus = new SvelteSet<string>();
  /** Whether a path shows the state of the last run; a worktree goes by the repo that lists it. */
  isStale(path: string) {
    return this.staleStatus.has(path) || (!this.statuses.has(path) && this.staleStatus.has(this.ownerOf(path)));
  }

  /** The statuses of the last run, shown at once and marked stale until each fresh one lands. */
  seedFromCache(statuses: RepoStatus[]) {
    for (const st of statuses) {
      this.statuses.set(st.path, st);
      this.staleStatus.add(st.path);
    }
  }

  /** Paths whose fresh status is on its way: they keep showing what they have, marked as refreshing. */
  refreshing = new SvelteSet<string>();
  /** Shown content that a fresher one will replace: asked for right now, or the last run's. */
  isRefreshing(path: string) {
    return this.refreshing.has(path) || this.isStale(path);
  }

  // ---- the watcher: quiet and at most every few seconds ------------------------------------------
  // A build or an agent writes files every moment; each event would run git status and mark the repo as
  // refreshing. Watcher refreshes show nothing, run at most once per interval per path (the last event
  // wins), and an unchanged answer writes nothing.
  private watch = new Throttle(timers);
  static readonly WATCH_INTERVAL = 2000;

  /** The first change after a quiet spell is read at once; the ones that follow wait for the interval. */
  refreshFromWatcher(path: string) {
    this.watch.run(path, GitStatuses.WATCH_INTERVAL, () => void this.refreshStatus(path, { quiet: true }));
  }

  async refreshStatus(path: string, opts: { quiet?: boolean } = {}) {
    const latest = this.tickets.next(path);
    if (!opts.quiet) this.refreshing.add(path);
    const act = activity.begin(opts.quiet ? t.activity.watchStatus : t.activity.status, path);
    let st: RepoStatus | null;
    try {
      st = await api.repoStatus(path);
      activity.end(act);
    } catch (e) {
      st = null;
      activity.end(act, "failed", explainError(e).text);
    }
    if (latest()) await this.applyStatus(path, st);
  }

  /** Called after each batch of statuses landed: the start measurement marks when Git's repo is fresh. */
  afterLand: (() => void) | null = null;

  // Forty answers at the start arrive as forty events; written one by one, each would lay out the
  // sidebar again. Collected, they land together once per frame.
  private pendingStatuses = new Map<string, RepoStatus | null>();
  private statusFlush: Promise<void> | null = null;
  /** Statuses that arrived and wait for the next frame to land. */
  get landing() {
    return this.statusFlush !== null;
  }
  private applyStatus(path: string, st: RepoStatus | null): Promise<void> {
    this.pendingStatuses.set(path, st);
    return (this.statusFlush ??= new Promise<void>((done) =>
      frame.next(() => {
        this.statusFlush = null;
        for (const [p, s] of this.pendingStatuses) {
          this.staleStatus.delete(p);
          this.refreshing.delete(p);
          if (s) {
            // The same answer again (a watcher refresh with nothing new): no write, nothing redrawn.
            const had = this.statuses.get(p);
            if (!had || !sameValue(had, s)) this.statuses.set(p, s);
            this.statusFailed.delete(p);
          } else {
            this.statuses.delete(p);
            this.statusFailed.add(p);
          }
        }
        this.pendingStatuses.clear();
        // Start marks for the measurement (scripts/perf-start.mjs); a mark costs next to nothing.
        mark("first-status");
        this.afterLand?.();
        done();
      }),
    ));
  }

  /** A linked worktree belongs to the repo that lists it; the selection holds repos only. */
  ownerOf(path: string): string {
    if (scanResults.repoByPath.has(path)) return path;
    return this.worktreeOwners.get(path) ?? path;
  }

  // Built once per status change: every group row and count asks, and searching all statuses each
  // time made the arrival of statuses at the start drop frames.
  private worktreeOwners = $derived.by(() => {
    const owners = new Map<string, string>();
    // Only the status of a main worktree names the owner: a worktree's own status lists its siblings too.
    for (const [p, s] of this.statuses) {
      if (!s.worktrees.some((w) => w.isMain && w.path === p)) continue;
      for (const w of s.worktrees) if (w.path !== p && !owners.has(w.path)) owners.set(w.path, p);
    }
    for (const r of scanResults.repos) for (const w of this.statuses.get(r.info.path)?.worktrees ?? []) if (!owners.has(w.path)) owners.set(w.path, r.info.path);
    return owners;
  });
}

export const gitStatus = new GitStatuses();
if (PROBED) (globalThis as Record<string, unknown>).__mbfGitStatus = gitStatus;
