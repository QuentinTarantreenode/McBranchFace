// Assessing the repos: the scan (in two stages at the start), reassessing one repo when its refs changed,
// the light server check and the automatic fetch, and the statuses and the watcher after each scan. Answers
// arrive in any order; tickets decide which may land, and scan results land in batches.
import { api, explainError } from "$lib/api";
import type { OnlineScanned } from "$lib/bindings/OnlineScanned";
import type { RepoChanged } from "$lib/bindings/RepoChanged";
import type { RepoResult } from "$lib/bindings/RepoResult";
import type { ScanStarted } from "$lib/bindings/ScanStarted";
import { t } from "$lib/i18n/index.svelte";
import { Throttle, Tickets } from "$lib/latest";
import { mark } from "$lib/marks";
import { staleStatuses, statusFingerprint, statusOrder } from "$lib/monitor";
import { pooled } from "$lib/pool";
import { folderKey, sameFolder } from "$lib/roots";
import { due } from "$lib/schedule";
import { activity } from "$lib/stores/activity.svelte";
import { cleanupView } from "$lib/stores/cleanupView.svelte";
import { deletes } from "$lib/stores/deletes.svelte";
import { fold } from "$lib/stores/fold.svelte";
import { gitClaims } from "$lib/stores/gitClaims.svelte";
import { gitStatus } from "$lib/stores/gitStatus.svelte";
import { lenses } from "$lib/stores/lenses.svelte";
import { pullRequests } from "$lib/stores/pullRequests.svelte";
import { repoSelection } from "$lib/stores/repoSelection.svelte";
import { scanResults } from "$lib/stores/scanResults.svelte";
import { settings } from "$lib/stores/settings.svelte";
import { toasts } from "$lib/stores/toasts.svelte";
import { triggers, type TriggerKind } from "$lib/stores/triggers.svelte";
import { timers, type TimerHandle } from "$lib/timers";

/** Scan results arriving within this time land together (see flushResults). */
const RESULT_BATCH_MS = 120;
/**
 * The automatic fetch asks the server first and fetches only the repos it moved for; every this many
 * runs it fetches all, since pull requests change without the branches moving (a review, an approval).
 */
const FULL_AUTO_FETCH_EVERY = 4;
/** Refs changes in a row (a fetch writes many) lead to one reassessment of the server branches. */
const ONLINE_AFTER_REFS_MS = 3000;

class Scanner {
  scanning = $state(false);
  /** Which of the two refresh buttons the running scan belongs to, so that one shows it works. */
  scanKind = $state<"fetch" | "local" | null>(null);
  /** The start runs in two stages: first what is here, then fetch and server. Null otherwise. */
  stage = $state<"local" | "server" | null>(null);
  /** Local results are in, the server branches are still being assessed. */
  onlinePending = $state(false);
  scannedAt = $state<number | null>(null);
  lastDurationMs = $state<number | null>(null);
  // Repos this scan has finished; cached results shown meanwhile are no progress.
  doneRepos = $derived(this.scanning ? scanResults.repos.length - scanResults.pendingCount : scanResults.results.length);

  private lastScanAt = 0;
  /** When the last scan with fetch ended (0: none yet). */
  private lastFetchAt = 0;
  private lastServerCheck = Date.now();
  private autoFetches = 0;
  /** A scan asked for while one runs: whether it fetches, or null when none is waiting. */
  private scanAgain: boolean | null = null;

  /** Per kind and path: answers arrive in any order, only the one asked for last may land. */
  private tickets = new Tickets();
  /** When each ticket was drawn, and when the last scan started, on one counter: which was asked first. */
  private seq = 0;
  private drawnAt = new Map<string, number>();
  private scanStartedAt = 0;

  private incoming: RepoResult[] = [];
  private flushTimer: TimerHandle | undefined;
  private onlineTimers = new Map<string, TimerHandle>();
  /** Repos whose refs changed while a scan ran: the scan may have read them before the change. */
  private changedDuringScan = new Set<string>();
  // A repo where agents commit in many worktrees changes its refs every few seconds; each change
  // reassessed the whole repo. Now at most once per gap per repo, and the last request is not lost.
  private refs = new Throttle(timers);
  /** What the statuses and the watcher were last refreshed for. */
  private monitored = { fingerprints: new Map<string, string>(), watched: "" };

  resetForTests() {
    this.scanning = false;
    this.scanKind = null;
    this.stage = null;
    this.onlinePending = false;
    this.scannedAt = null;
    this.lastDurationMs = null;
    this.lastScanAt = 0;
    this.lastFetchAt = 0;
    this.lastServerCheck = Date.now();
    this.autoFetches = 0;
    this.scanAgain = null;
    this.incoming = [];
    this.flushTimer = undefined;
    this.onlineTimers.clear();
    this.changedDuringScan.clear();
    this.refs = new Throttle(timers);
    this.monitored = { fingerprints: new Map(), watched: "" };
  }

  private ticket(key: string) {
    this.drawnAt.set(key, ++this.seq);
    return this.tickets.next(key);
  }

  /**
   * A scan's answer for a repo replaces a request asked before the scan started. One asked after it may
   * have read newer state than the scan did, so it keeps its turn.
   */
  private supersede(key: string) {
    if ((this.drawnAt.get(key) ?? 0) < this.scanStartedAt) this.ticket(key);
  }

  // ---- the backend's scan events -------------------------------------------------------------

  /** A scan starts: previous results stay visible until the fresh result for that repo arrives. */
  scanStarted(e: ScanStarted) {
    this.scanStartedAt = ++this.seq;
    scanResults.beginScan(e.repos);
    this.forgetOthers(new Set(e.repos.map((r) => r.path)));
  }

  /** A scan's result is newer than any rescan still on its way; it lands with the next batch. */
  queueResult(result: RepoResult) {
    this.supersede(`result:${result.repo.path}`);
    this.incoming.push(result);
    this.flushTimer ??= timers.after(RESULT_BATCH_MS, () => this.flushResults());
  }

  /** Server branches build on the local results: those still in the batch go first. */
  onlineScanned(e: OnlineScanned) {
    this.supersede(`online:${e.path}`);
    this.flushResults();
    scanResults.applyOnline(e);
  }

  private flushResults() {
    timers.cancel(this.flushTimer);
    this.flushTimer = undefined;
    const batch = this.incoming;
    this.incoming = [];
    if (batch.length) this.apply(batch);
  }

  /** One write for many results; the scan's progress and what the table marked follow it. */
  private apply(batch: RepoResult[]) {
    scanResults.applyBatch(batch);
    if (scanResults.pendingCount === 0 && this.scanning) this.onlinePending = !!settings.config?.scanOnline;
    cleanupView.pruneChecked();
  }

  /**
   * Timers of repos the scan no longer lists: they would only run into nothing. Tickets stay: one drawn
   * again from 1 for a repo that comes back would let an old answer through.
   */
  private forgetOthers(keep: Set<string>) {
    for (const [path, h] of this.onlineTimers) {
      if (keep.has(path)) continue;
      timers.cancel(h);
      this.onlineTimers.delete(path);
    }
    this.refs.forget((path) => keep.has(path));
  }

  // ---- scanning ------------------------------------------------------------------------------

  /**
   * The start in two stages: first assess what is here (no network), taking over every repo whose refs and
   * files are as the last run left them; then ask the server lightly and fetch only the repos it moved for.
   * Refresh (F5) and the auto fetch still fetch everything.
   */
  async startScans() {
    this.stage = "local";
    const fetchedBefore = this.lastFetchAt;
    const stopped = await this.scan(false, false, "start");
    mark("local-assessed");
    // A refresh asked for during stage one fetched every repo already; the light stage would fetch again.
    if (!stopped && this.lastFetchAt === fetchedBefore) {
      this.stage = "server";
      await this.scan(true, false, "start", true);
    }
    mark("fetched");
    this.stage = null;
  }

  /**
   * A background scan stays silent: fetch problems show at the tab and in the sidebar, not as toasts.
   * Only a scan the user started may ask for a sign-in; one the app starts must never open a dialog.
   * Resolves true when the user stopped it.
   */
  async scan(fetch: boolean, background = false, cause: TriggerKind = "manual", changedOnly = false): Promise<boolean> {
    triggers.add(cause, this.scanning ? "busy" : fetch ? "fetch" : "scan");
    if (this.scanning) {
      // A folder added or removed mid-scan must still be scanned; a background tick can wait for the next one.
      if (!background) this.scanAgain = (this.scanAgain ?? false) || fetch;
      return false;
    }
    this.scanning = true;
    this.scanKind = fetch ? "fetch" : "local";
    const act = activity.begin(fetch ? t.activity.scanFetch : t.activity.scanLocal);
    let stopped = false;
    try {
      const r = await api.scan(fetch, changedOnly, !background && cause === "manual");
      stopped = r.cancelled;
      activity.end(act, stopped ? "cancelled" : "ok");
      this.flushResults();
      // A stopped scan saw only part of the repos: the data keeps the age of the last full one.
      if (stopped) toasts.toast("info", t.activity.scanCancelled);
      else {
        this.lastDurationMs = r.durationMs;
        this.scannedAt = Date.now();
        if (!background) {
          if (r.repoCount === 0) toasts.toast("info", t.startup.noRepos);
          this.reportFetchProblems();
        }
        cleanupView.pruneTableFolds();
        void lenses.notifyNewStale();
      }
    } catch (e) {
      activity.end(act, "failed", explainError(e).text);
      if (!background) toasts.fail(e);
    } finally {
      this.scanning = false;
      this.scanKind = null;
      this.onlinePending = false;
      scanResults.endScan();
      this.lastScanAt = Date.now();
      if (fetch && !stopped) this.lastFetchAt = this.lastScanAt;
      scanResults.markLoaded();
      cleanupView.ensureSelection();
      void this.startMonitoring();
      const changed = [...this.changedDuringScan];
      this.changedDuringScan.clear();
      for (const p of changed) {
        triggers.add("afterScan", "rescan", p);
        void this.rescan(p, { quiet: true });
      }
    }
    const again = this.scanAgain;
    this.scanAgain = null;
    if (again === null || stopped) return stopped;
    // A refresh waiting behind the start's first stage fetches: it is the server stage now.
    if (again && this.stage === "local") this.stage = "server";
    return this.scan(again);
  }

  /** The running fetches end; what landed stays. The scan itself reports that it stopped. */
  async cancelScan() {
    if (!this.scanning) return;
    try {
      await api.cancelScan();
    } catch (e) {
      toasts.fail(e);
    }
  }

  /** One message per cause instead of one per repository: offline means every repo fails. */
  private reportFetchProblems() {
    const kinds = scanResults.repos.map((r) => r.result?.fetchErrorKind).filter(Boolean);
    const network = kinds.filter((k) => k === "Network").length;
    const auth = kinds.filter((k) => k === "AuthRequired").length;
    if (network) toasts.toast("error", t.startup.fetchFailed(network));
    if (auth) toasts.toast("error", t.startup.fetchAuth(auth));
  }

  /** `quiet`: started by the app itself (the watcher, the server check), so a failure shows at the repo. */
  async rescan(repoPath: string, opts: { quiet?: boolean } = {}) {
    const root = scanResults.repoByPath.get(repoPath)?.root ?? "";
    const latest = this.ticket(`result:${repoPath}`);
    try {
      const result = await activity.track(t.activity.rescan, repoPath, () => api.rescanRepo(repoPath, root));
      if (!latest()) return;
      scanResults.noteBackground(repoPath, "rescan", null);
      // A repo that left the list meanwhile (its folder was removed) must not come back as a row.
      if (!scanResults.has(repoPath)) return;
      // The scan's answer still waiting in the batch arrived before this one: it must not land over it.
      this.incoming = this.incoming.filter((r) => r.repo.path !== repoPath);
      this.apply([result]);
    } catch (e) {
      if (!latest()) return;
      if (opts.quiet) scanResults.noteBackground(repoPath, "rescan", e);
      else toasts.fail(e);
    }
  }

  /** One after the other: a whole folder in parallel would compete with the watcher and the UI. */
  async rescanAll(paths: string[]) {
    for (const p of paths) await this.rescan(p);
  }

  /** `interactive`: the user asked for it, so the fetch may ask for a sign-in. */
  async refreshOnline(repoPath: string, fetch = true, interactive = false) {
    const latest = this.ticket(`online:${repoPath}`);
    try {
      const e = await activity.track(t.activity.online, repoPath, () => api.refreshOnline(repoPath, fetch, interactive));
      if (latest()) scanResults.applyOnline(e);
    } catch (e) {
      if (fetch && latest()) toasts.fail(e);
    }
  }

  // ---- statuses and the watcher --------------------------------------------------------------

  /**
   * The branch and changes of every known repo, beside the scan instead of after it: a status read takes
   * milliseconds, the scan with its fetch takes seconds. Afterwards the scan refreshes only repos it changed.
   */
  async readStatusesEarly() {
    const repos = scanResults.repos;
    const paths = statusOrder(repos.map((r) => r.info.path), repoSelection.gitRepo ?? repos[0]?.info.path ?? null);
    this.monitored.fingerprints = new Map(repos.map((r) => [r.info.path, statusFingerprint(r.result)]));
    if (settings.config) await pooled(paths, settings.config.concurrency, (p) => gitStatus.refreshStatus(p));
  }

  /**
   * After a scan: statuses only of repos whose result changed (the watcher reports the rest), a few
   * at a time, and a new watcher only for a new set of repos.
   */
  private async startMonitoring() {
    const repos = scanResults.repos;
    const paths = repos.map((r) => r.info.path);
    const now = new Map(repos.map((r) => [r.info.path, statusFingerprint(r.result)]));
    const stale = staleStatuses(paths, (p) => gitStatus.statuses.has(p), this.monitored.fingerprints, now);
    this.monitored.fingerprints = now;
    if (settings.config) await pooled(stale, settings.config.concurrency, (p) => gitStatus.refreshStatus(p));
    this.pruneChangesFolds();
    // The backend watches each repo's worktrees too: a new or removed one needs a new watcher.
    const watched = paths.map((p) => `${p}:${(gitStatus.statuses.get(p)?.worktrees ?? []).map((w) => w.path).join(",")}`).sort().join("\n");
    if (watched === this.monitored.watched) return;
    try {
      await api.watchRepos(paths);
      this.monitored.watched = watched;
    } catch (e) {
      toasts.toast("error", t.startup.monitorFailed, { detail: explainError(e).text });
    }
  }

  /**
   * Forgets the folds of Changes blocks (a repo or worktree, and the folders inside it) whose working copy
   * is gone. Only while no scan runs and every scanned repo has a fresh status: before that, a worktree not
   * listed yet would lose its folds for nothing.
   */
  private pruneChangesFolds() {
    const repos = scanResults.repos.map((r) => r.info.path);
    if (this.scanning || repos.some((p) => !gitStatus.statuses.has(p) || gitStatus.isStale(p))) return;
    const copies = repos.flatMap((p) => [p, ...(gitStatus.statuses.get(p)?.worktrees ?? []).map((w) => w.path)]);
    const known = new Set(copies.map(folderKey));
    fold.prune("changesRepos", (path) => known.has(folderKey(path)));
    // A folder's key starts with its working copy (see dirKey in git/changesList.ts).
    fold.prune("changesDirs", (key) => copies.some((p) => key.startsWith(`${p}|`)));
  }

  repoChanged(e: RepoChanged) {
    const ui = settings.config?.ui;
    const refs = e.scopes.includes("Refs");
    const files = e.files ?? [];
    // Files changed in named working copies: only those are read again. A change in the git directory
    // names none and may concern the repo and every worktree it lists.
    const statusOn = refs ? ui?.watchRefs !== false : ui?.watchFiles !== false;
    if (!refs) triggers.add("watchFiles", statusOn ? "status" : "off", e.path, files);
    if (statusOn) {
      const copies = e.paths?.length ? e.paths : [e.path, ...(gitStatus.statuses.get(e.path)?.worktrees ?? []).filter((w) => !w.isMain).map((w) => w.path)];
      for (const p of copies) {
        const known = p === e.path ? e.path : [...gitStatus.statuses.keys()].find((k) => sameFolder(k, p));
        if (known) gitStatus.refreshFromWatcher(known);
      }
    }
    if (!refs) return;
    if (ui?.watchRefs === false) return triggers.add("watchRefs", "off", e.path, files);
    if (this.scanning) {
      this.changedDuringScan.add(e.path);
      return triggers.add("watchRefs", "busy", e.path, files);
    }
    if (deletes.running) return triggers.add("watchRefs", "busy", e.path, files);
    triggers.add("watchRefs", this.rescanFromWatcher(e.path), e.path, files);
  }

  private rescanFromWatcher(path: string): "rescan" | "throttled" {
    const gap = (settings.config?.ui.refsGapSeconds ?? 0) * 1000;
    const ran = this.refs.run(path, gap, () => {
      // A branch switch, new commit or fetch changes what the cleanup analysis sees.
      void this.rescan(path, { quiet: true });
      // A fetch in a terminal or IDE brings new server state: re-assess without fetching again.
      if (scanResults.resultOf(path)?.online) {
        timers.cancel(this.onlineTimers.get(path));
        this.onlineTimers.set(
          path,
          timers.after(ONLINE_AFTER_REFS_MS, () => {
            this.onlineTimers.delete(path);
            void this.refreshOnline(path, false);
          }),
        );
      }
    });
    return ran ? "rescan" : "throttled";
  }

  // ---- periodic work -------------------------------------------------------------------------

  /** The light check: one ls-remote per assessed repository; only a change leads to a fetch. */
  async serverCheckTick(now = Date.now()) {
    const c = settings.config;
    const busy = this.scanning || gitClaims.gitBusy || deletes.running;
    // Its own interval decides (0 = off); the bell only decides whether a change is announced.
    if (!c || !due(now, this.lastServerCheck, c.serverCheckMinutes, busy)) return;
    this.lastServerCheck = now;
    void pullRequests.poll();
    const paths = scanResults.results.filter((r) => r.online !== null).map((r) => r.repo.path);
    triggers.add("serverCheck", "none");
    if (!paths.length) return;
    let heads;
    try {
      heads = await api.serverHeads(paths);
    } catch {
      // A background check stays quiet: the backend logs its git calls, and the next check tries again.
      return;
    }
    let found = false;
    for (const h of heads) {
      if (h.errorKind) {
        scanResults.updateResult(h.path, (r) => (r.onlineFetched ? { ...r, onlineFetched: false } : r));
        continue;
      }
      if (!h.changed) continue;
      // A git operation the user started in this repo goes first; the next check comes back to it.
      let failure: unknown = null;
      const fetch = async () => {
        try {
          await api.fetchRepo(h.path);
        } catch (e) {
          failure = e;
        }
      };
      if (!(await gitClaims.withClaim([h.path], t.git.op.Fetch.label, fetch, { quiet: true }))) {
        triggers.add("serverCheck", "busy", h.path);
        continue;
      }
      triggers.add("serverCheck", "fetch", h.path);
      // Nobody asked for it: a failure shows at the repo, and without new refs there is nothing to assess.
      scanResults.noteBackground(h.path, "fetch", failure);
      if (failure) continue;
      found = true;
      await this.rescan(h.path, { quiet: true });
      await this.refreshOnline(h.path, false);
    }
    if (found) void lenses.notifyNewStale();
  }

  /** The automatic fetch, when its interval has passed and nothing else runs. */
  autoFetchTick(now = Date.now()) {
    const minutes = settings.config?.autoFetchMinutes;
    const idle = !this.scanning && !gitClaims.gitBusy && !deletes.running;
    if (!minutes || !idle || now - this.lastScanAt < minutes * 60_000) return;
    const full = ++this.autoFetches % FULL_AUTO_FETCH_EVERY === 0;
    void this.scan(true, true, "autoFetch", !full);
  }
}

export const scanner = new Scanner();
