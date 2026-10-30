// The app's start and end: the backend's events wired to the stores and services, the last run's state shown
// at once, the periodic work, and the scans. A second start ends what the first one began.
import { listen } from "@tauri-apps/api/event";
import { api, onCommandDone, onCommandOutput, onRepoChanged, onScanOnline, onScanRepo, onScanStarted } from "$lib/api";
import { appWindow } from "$lib/appWindow";
import type { CachedStatus } from "$lib/bindings/CachedStatus";
import type { Config } from "$lib/bindings/Config";
import type { RepoResult } from "$lib/bindings/RepoResult";
import type { StartupIssue } from "$lib/bindings/StartupIssue";
import type { WindowCapabilities } from "$lib/bindings/WindowCapabilities";
import { i18n, t } from "$lib/i18n/index.svelte";
import { mark } from "$lib/marks";
import { displayPath } from "$lib/paths";
import { scanner } from "$lib/services/scanner.svelte";
import { activity } from "$lib/stores/activity.svelte";
import { cleanupView } from "$lib/stores/cleanupView.svelte";
import { clock } from "$lib/stores/clock.svelte";
import { commandRuns } from "$lib/stores/commandRuns.svelte";
import { deletes } from "$lib/stores/deletes.svelte";
import { environment } from "$lib/stores/environment.svelte";
import { gitStatus } from "$lib/stores/gitStatus.svelte";
import { lenses } from "$lib/stores/lenses.svelte";
import { repoSelection } from "$lib/stores/repoSelection.svelte";
import { scanResults } from "$lib/stores/scanResults.svelte";
import { settings } from "$lib/stores/settings.svelte";
import { toasts } from "$lib/stores/toasts.svelte";
import { timers } from "$lib/timers";
import { setTooltipHome } from "$lib/ui/tooltip";

/** The clock behind relative times ("3 minutes ago"). */
const CLOCK_TICK_MS = 30_000;
const AUTO_FETCH_TICK_MS = 60_000;
const SERVER_CHECK_TICK_MS = 30_000;

/** Whether the backend reports its external calls: it does while the activity display is on. */
let watchingProcesses = false;

/** The backend reports its external calls only while the display is on; the listener loads with it. */
function followActivityDisplay() {
  return $effect.root(() => {
    $effect(() => {
      const on = activity.shown;
      if (on === watchingProcesses) return;
      watchingProcesses = on;
      void api.setActivityWatch(on).catch(() => {});
      void import("$lib/stores/activityProcess").then((m) => m.watch(on));
    });
  });
}

/** The start measurement (scripts/perf-start.mjs) marks when the repo Git shows has its fresh status. */
function markGitReady() {
  // The Git perspective shows the first repo while none is chosen.
  const git = repoSelection.gitRepo ?? scanResults.repos[0]?.info.path;
  if (git && gitStatus.statuses.has(git) && !gitStatus.staleStatus.has(git)) mark("git-ready");
}

function reportStartupIssues(issues: StartupIssue[]) {
  for (const i of issues) {
    if (i.code === "ConfigCorrupt") toasts.toast("error", t.startup.configCorrupt, { detail: i.p.backup || i.p.detail });
    else if (i.code === "ConfigUnreadable") toasts.toast("error", t.startup.configUnreadable(i.p.path), { detail: i.p.detail });
    else if (i.code === "AppDirReadOnly") toasts.toast("error", t.startup.appDirReadOnly(i.p.path), { detail: i.p.detail });
    else if (i.code === "ProbeLeftovers")
      toasts.toast("error", t.startup.probeLeftovers(i.p.folders.length), {
        detail: i.p.folders.map((f) => t.startup.probeLeftover(displayPath(f.path), displayPath(f.original))).join(" "),
      });
    else toasts.toast("error", t.startup.lastCrash, { detail: i.p.message + " · " + i.p.log });
  }
}

class Bootstrap {
  /** What the last start registered: a second start replaces it instead of adding to it. */
  private teardown: (() => void)[] = [];

  /** Ends what the start began: listeners, the activity loader, intervals and every timer still waiting. */
  dispose() {
    for (const off of this.teardown.splice(0)) off();
    timers.clearAll();
    gitStatus.afterLand = null;
  }

  async init() {
    this.dispose();
    // All registered at once: one after the other they held up the start by a round trip each.
    const listening = await Promise.allSettled([
      onScanStarted((e) => scanner.scanStarted(e)),
      onScanRepo((result) => scanner.queueResult(result)),
      onScanOnline((e) => scanner.onlineScanned(e)),
      onRepoChanged((e) => scanner.repoChanged(e)),
      listen("tray-refresh", () => scanner.scan(true)),
      listen("tray-toggle-notify", () => settings.config && settings.setAlerts({ notify: !settings.config.alerts.notify })),
      listen("hidden-to-tray", () => lenses.announceTray()),
      onCommandOutput((e) => commandRuns.output(e)),
      onCommandDone((e) => commandRuns.done(e)),
    ]);
    // Removing a listener calls the backend too; one that is gone already has nothing left to remove.
    // Those that came are ended with the rest, also when another one failed to come.
    for (const l of listening) if (l.status === "fulfilled") this.teardown.push(() => void Promise.resolve().then(l.value).catch(() => {}));
    const refused = listening.find((l) => l.status === "rejected");
    if (refused) throw refused.reason;
    this.teardown.push(followActivityDisplay());

    performance.mark("mbf:init");
    let loaded: [Config, RepoResult[], StartupIssue[], WindowCapabilities, CachedStatus];
    try {
      loaded = await Promise.all([api.getConfig(), api.cachedResults(), api.startupIssues(), api.windowCapabilities(), api.cachedStatus()]);
    } catch (e) {
      // Without a config nothing works; the page still needs a dictionary to say so.
      await i18n.set("Auto");
      appWindow.show().catch(() => {});
      toasts.fail(e);
      return;
    }
    const [config, cached, issues, windowCaps, last] = loaded;
    environment.windowCaps = windowCaps;
    setTooltipHome(windowCaps.home);
    // The page renders once the dictionary is there; the window is still hidden at this point. The texts
    // of Git, settings and dialogs follow without holding up the first paint.
    await i18n.set(config.language, false);
    settings.load({ ...config, ui: { ...config.ui, perspective: "Dashboard" } });
    // Stale-while-revalidate: the last results are visible at once, the fresh scan replaces them.
    scanResults.seed(cached);
    // The git state of the last run as well: branches and changes show at once, dimmed until fresh.
    gitStatus.seedFromCache(last.statuses);
    gitStatus.afterLand = markGitReady;
    if (last.scannedAt) scanner.scannedAt = last.scannedAt * 1000;
    if (cached.length > 0 || config.roots.length === 0) scanResults.markLoaded();
    cleanupView.ensureSelection();
    // Shown only after the first frame in the right theme, so there is no white flash.
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        // How many statuses the first paint had: the start measurement checks the cache was there.
        performance.mark("mbf:first-paint", { detail: gitStatus.statuses.size });
        // Started with the system into the tray: the window opens only on request.
        if (!windowCaps.startedHidden) appWindow.show().catch(() => {});
      }),
    );
    reportStartupIssues(issues);
    timers.every(CLOCK_TICK_MS, () => clock.tick());
    timers.every(AUTO_FETCH_TICK_MS, () => scanner.autoFetchTick());
    timers.every(SERVER_CHECK_TICK_MS, () => void scanner.serverCheckTick());

    void environment.refreshEnvironment();
    void deletes.loadDeleted();
    environment.probeGithubDesktop();
    if (config.roots.length > 0) void scanner.startScans();
    void scanner.readStatusesEarly();
  }
}

export const bootstrap = new Bootstrap();
