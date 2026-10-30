// The stores alone, without a view, loaded afresh for every test (vi.resetModules): nothing one test leaves
// behind reaches the next. A test file calls `storeTests()` once, then `start` in each test.
import { afterEach, beforeEach, expect, vi } from "vitest";
import type { Config } from "$lib/bindings/Config";
import { flush, installBackend, type Backend, type Handler } from "./backend";
import { waitFor } from "./wait";

type Store = (typeof import("$lib/store.svelte"))["store"];

/** Live bindings, set by `start`: the backend and the store instances of the running test. */
export let backend: Backend;
export let store: Store;
export let commandRuns: (typeof import("$lib/stores/commandRuns.svelte"))["commandRuns"];
export let gitStatus: (typeof import("$lib/stores/gitStatus.svelte"))["gitStatus"];
export let scanner: (typeof import("$lib/services/scanner.svelte"))["scanner"];
export let timers: (typeof import("$lib/timers"))["timers"];
/** Titles of the system notifications the app sent in this test. */
export let notified: string[] = [];

// The periodic checks run from intervals; tests run them at a time of their own, later than the last run.
let ahead = 0;
export const later = () => Date.now() + ++ahead * 86_400_000;
export const savedConfigs = () => backend.called("save_config").map((a) => a.config as Config);

/** What every store test needs around it: no stored state, notifications that are counted, a clipboard; the app ended after it. */
export function storeTests() {
  beforeEach(() => {
    localStorage.clear();
    notified = [];
    // Tauri's notification plugin uses the web Notification API, which jsdom lacks.
    (globalThis as Record<string, unknown>).Notification = class {
      static permission = "granted";
      constructor(title: string) {
        notified.push(title);
      }
    };
    Object.assign(navigator, { clipboard: { writeText: vi.fn(async () => {}) } });
  });
  // The IPC mock stays until the next test installs its own: late animation frames of the app still use it.
  afterEach(() => {
    // Its listeners, intervals and timers (a quiet save still pending) would run into the next test's backend.
    store?.dispose();
    vi.useRealTimers();
  });
}

/**
 * Holds once `cond` is true and still is after everything already queued ran: the continuation of an
 * answer may start the next step. setImmediate, which no test fakes, lets the queue run.
 */
export async function until(cond: () => boolean) {
  await waitFor(async () => {
    expect(cond()).toBe(true);
    await flush(1);
    expect(cond()).toBe(true);
  });
}

let probe: (typeof import("$lib/probe"))["probe"];

/**
 * Every command answered, no scan and no stage of the start, no status about to land. Not the test hook's
 * idle: timers count there, and a test that fakes them moves them on itself.
 */
export const settled = () => until(() => probe.invokes === 0 && !scanner.scanning && scanner.stage === null && !gitStatus.landing);

/**
 * The app on `handlers`, with modules of its own, once the start is over (`settled`). A test that holds an
 * answer back says with `started` what it waits for instead.
 */
export async function start(handlers: Record<string, Handler> = {}, started?: () => boolean) {
  backend = installBackend(handlers);
  vi.resetModules();
  store = (await import("$lib/store.svelte")).store;
  commandRuns = (await import("$lib/stores/commandRuns.svelte")).commandRuns;
  gitStatus = (await import("$lib/stores/gitStatus.svelte")).gitStatus;
  scanner = (await import("$lib/services/scanner.svelte")).scanner;
  timers = (await import("$lib/timers")).timers;
  probe = (await import("$lib/probe")).probe;
  await store.init();
  await (started ? until(started) : settled());
}
