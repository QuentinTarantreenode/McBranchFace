// What the dev, audit and e2e builds put on the window for the scripts that drive the app over CDP: the store
// facade (`__mbfStore`) and `__mbfTest`, which says when the app is quiet and what it told the user. Loaded
// only there (see main.ts and audit/main.ts), so the release bundle never carries it.
import { probe, type ProbeEvent } from "$lib/probe";
import { scanner } from "$lib/services/scanner.svelte";
import { resettable, store } from "$lib/store.svelte";
import { activity } from "$lib/stores/activity.svelte";
import { openProcesses } from "$lib/stores/activityProcess";
import { deletes } from "$lib/stores/deletes.svelte";
import { gitClaims } from "$lib/stores/gitClaims.svelte";
import { gitStatus } from "$lib/stores/gitStatus.svelte";
import { triggers } from "$lib/stores/triggers.svelte";
import { timers } from "$lib/timers";

/** Commands that only read or report state: no operation, so they stay out of the log. */
const READS = new Set([
  "get_config", "startup_issues", "environment_status", "cached_results", "cached_status", "repo_status", "deleted_entries", "backups_size", "stash_stat", "server_heads",
  "git_log", "commit_detail", "branch_list", "working_diff", "commit_diff", "pr_commits", "open_pull_requests", "folder_kinds", "find_commit", "free_copy_folders",
  "check_copy_targets", "preview_custom_command", "app_info", "provider_identity", "window_capabilities", "github_desktop_available", "watch_repos", "set_tray_status",
  "set_activity_watch", "diagnostics_note", "branch_commits",
]);
/** Commands that answer with a whole assessment: never measured, never kept in the log. */
const ASSESSMENTS = new Set(["rescan_repo", "refresh_online"]);
/** Any other answer larger than this stays out of its entry as well; `ok` still says how it ended. */
const RESULT_MAX = 4000;

export interface TestEvent {
  /** Counts from 1; a script keeps the last one it saw and reads what came after. */
  seq: number;
  at: number;
  /** A message shown to the user, or a command that changed something. */
  kind: "toast" | "op";
  /** The message, or the command's name. */
  text: string;
  /** Toasts: info, success or error. */
  level?: "info" | "success" | "error";
  /** Commands: whether it succeeded, and its answer (an OpResult, an outcome …) when it is small. */
  ok?: boolean;
  result?: unknown;
  /** Toasts: the detail line. Failed commands: the kind or code of the failure. */
  detail?: string;
}

const events: TestEvent[] = [];
let seq = 0;

const failureOf = (e: unknown): string =>
  e && typeof e === "object" ? String((e as { kind?: string }).kind ?? (e as { code?: string }).code ?? JSON.stringify(e)) : String(e);

function record(e: ProbeEvent) {
  const at = Date.now();
  if (e.kind === "toast") {
    events.push({ seq: ++seq, at, kind: "toast", level: e.level, text: e.text, ...(e.detail ? { detail: e.detail } : {}) });
    return;
  }
  if (READS.has(e.command)) return;
  const small = e.ok && !ASSESSMENTS.has(e.command) && JSON.stringify(e.value ?? null).length <= RESULT_MAX;
  events.push({ seq: ++seq, at, kind: "op", text: e.command, ok: e.ok, ...(small ? { result: e.value } : {}), ...(e.ok ? {} : { detail: failureOf(e.value) }) });
}

/**
 * Nothing runs or waits: no command in flight, no scan (and no stage of the start between two), no git
 * operation, no delete, no timer some work waits for, no status about to land, and no external call the
 * backend reported as started and not as ended.
 */
function idle(): boolean {
  return (
    probe.invokes === 0 &&
    !scanner.scanning &&
    scanner.stage === null &&
    !gitClaims.gitBusy &&
    !deletes.running &&
    timers.pending === 0 &&
    !gitStatus.landing &&
    openProcesses() === 0
  );
}

/** What keeps the app from being idle, each part only while it holds: a timed-out wait names the culprit. */
function busy(): Record<string, unknown> {
  const parts: Record<string, unknown> = {
    invokes: [...probe.running.values()].map((i) => i.command),
    scanning: scanner.scanning,
    stage: scanner.stage,
    gitClaims: Object.fromEntries(gitClaims.gitRepos),
    deleting: deletes.running,
    timers: timers.pending,
    landing: gitStatus.landing,
    processes: openProcesses(),
  };
  return Object.fromEntries(Object.entries(parts).filter(([, v]) => (Array.isArray(v) ? v.length : v && typeof v === "object" ? Object.keys(v).length : v)));
}

/** Everything a failure report needs that no store shows on its own: the last commands, activities, triggers. */
function report() {
  return {
    busy: busy(),
    invokes: probe.recent,
    running: [...probe.running.values()],
    activities: { running: [...activity.running.values()], recent: activity.recent },
    triggers: triggers.entries,
  };
}

/**
 * The periodic work, run once now: the e2e configuration switches the intervals off, so a run never has a
 * fetch or rescan land in the middle of a step, and a step that tests them calls them here instead.
 */
function tick(kind: "serverCheck" | "autoFetch", now = Date.now()): Promise<void> {
  if (kind === "serverCheck") return scanner.serverCheckTick(now);
  scanner.autoFetchTick(now);
  return Promise.resolve();
}

/** Polled besides the change notices, for what neither a store nor the page reports (a layout, a timer's end). */
const POLL_MS = 50;

/**
 * Resolves once `cond` holds, checked on every change of what it reads, of the work in flight and of the page
 * (an element shown, an attribute set), and still holds after everything already queued ran (an answer's
 * continuation may start the next step). Rejects after `ms`. A condition that throws counts as not met.
 */
function when(cond: () => boolean, ms = 30_000): Promise<void> {
  return new Promise((resolve, reject) => {
    let done = false;
    let confirming = false;
    const stops: (() => void)[] = [];
    const finish = (error?: Error) => {
      if (done) return;
      done = true;
      for (const stop of stops) stop();
      if (error) reject(error);
      else resolve();
    };
    const holds = () => {
      try {
        return !!cond();
      } catch {
        return false;
      }
    };
    const check = () => {
      if (done || confirming || !holds()) return;
      confirming = true;
      // Plain timers on purpose: a test waiting must not count as work the app waits for.
      setTimeout(() => {
        confirming = false;
        if (holds()) finish();
      }, 0);
    };
    stops.push(
      $effect.root(() => {
        $effect(() => {
          if (holds()) queueMicrotask(check);
        });
      }),
    );
    stops.push(probe.listen(check));
    if (typeof MutationObserver !== "undefined" && document.body) {
      const observer = new MutationObserver(check);
      observer.observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true });
      stops.push(() => observer.disconnect());
    }
    const poll = setInterval(check, POLL_MS);
    const timeout = setTimeout(() => finish(new Error(`condition not met within ${ms} ms`)), ms);
    stops.push(
      () => clearInterval(poll),
      () => clearTimeout(timeout),
    );
    check();
  });
}

/** The named stores as at the start; every store when none is named. */
function reset(...names: (keyof typeof resettable)[]) {
  if (!names.length) return store.resetForTests();
  for (const n of names) resettable[n].resetForTests();
}

/** What the scripts that drive the app rely on. */
export const testApi = { idle, busy, when, events, reset, report, tick };

export function install() {
  probe.record = record;
  Object.assign(globalThis, { __mbfStore: store, __mbfTest: testApi });
}
