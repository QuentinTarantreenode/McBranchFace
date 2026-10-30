// @vitest-environment jsdom
// The scanner: scans and their results, reassessments after a change, the server check and the automatic
// fetch, and answers that arrive late or out of order.
import { describe, expect, it, vi } from "vitest";
import { emit } from "@tauri-apps/api/event";
import { branch, config, flush, onlineScanned, remote, repo, result } from "../../test/backend";
import { backend, gitStatus, later, notified, scanner, settled, start, store, storeTests, timers, until } from "../../test/store";
import { waitFor } from "../../test/wait";

// Only the menu helpers need icons; loading the whole icon package would dominate the run time.
vi.mock("@lucide/svelte", () => ({ Eye: {}, EyeOff: {} }));

const A = repo("C:/ws/a");
const A2 = repo("C:/ws/copy/a", { identity: A.identity });
const B = repo("C:/ws/b");

storeTests();

describe("scan", () => {
  it("stops only a running scan; a stopped refresh counts as no fetch", async () => {
    await start();
    await scanner.cancelScan();
    expect(backend.called("cancel_scan")).toEqual([]);
    let end: (v: unknown) => void = () => {};
    backend.handlers.scan = () => new Promise((r) => (end = r));
    backend.handlers.cancel_scan = () => (end({ durationMs: 1, repoCount: 1, cancelled: true }), true);
    const running = store.scan(true);
    await waitFor(() => expect(backend.called("scan").at(-1)).toEqual({ fetch: true, changedOnly: false, interactive: true }));
    await scanner.cancelScan();
    expect(await running).toBe(true);
    expect(backend.called("cancel_scan").length).toBe(1);
    expect(backend.called("scan").at(-1)).toEqual({ fetch: true, changedOnly: false, interactive: true });
    expect(store.scanning).toBe(false);
  });

  it("shows results as they arrive and keeps old ones until then", async () => {
    await start({ cached_results: () => [result(A, [branch(A.path, "old")])] });
    await emit("scan-started", { repos: [A, B] });
    await flush();
    expect(store.allBranches.map((b) => b.name)).toEqual(["old"]);
    store.scanning = true;
    expect(store.isPending(B.path)).toBe(true);
    // The cached result of A is no progress: the scan has finished none of the two yet.
    expect(store.doneRepos).toBe(0);
    await emit("scan-repo", result(B, [branch(B.path, "fresh")]));
    await emit("scan-repo", result(A, [branch(A.path, "new")]));
    await flush();
    // Results land together, a moment later: one update for the batch instead of one per repo.
    expect(store.allBranches.map((b) => b.name)).toEqual(["old"]);
    await waitFor(() => expect(store.allBranches.map((b) => b.name).sort()).toEqual(["fresh", "new"]));
    expect(store.onlinePending).toBe(true);
    await emit("scan-online", onlineScanned(A.path, [remote(A.path, "m")], { at: 5 }));
    await emit("scan-online", onlineScanned(B.path, [], { error: "offline", at: 5, fetched: false }));
    await waitFor(() => expect(store.allOnline?.map((b) => b.name)).toEqual(["m"]));
    expect(store.results.find((r) => r.repo.path === B.path)?.warnings[0]).toEqual({ code: "OnlineFailed", p: { detail: "offline" } });
  });

  it("names the kind of the running scan until it ends, a queued one included", async () => {
    await start();
    const done: (() => void)[] = [];
    backend.handlers.scan = () => new Promise((r) => done.push(() => r({ repoCount: 0, durationMs: 1 })));
    const first = store.scan(false);
    expect(store.scanKind).toBe("local");
    void store.scan(true);
    done.shift()!();
    await waitFor(() => expect(store.scanKind).toBe("fetch"));
    done.shift()!();
    await first;
    expect(store.scanKind).toBeNull();
  });

  it("shares one repo selection between cleanup and Git", async () => {
    await start({ cached_results: () => [result(A, []), result(B, [])] });
    expect(store.gitRepo).toBeNull();
    // Several repos in cleanup: Git shows the one clicked last, and switching keeps all of them.
    store.filters.repos = [A.path, B.path];
    store.focusRepo = B.path;
    store.setUi({ perspective: "Git" });
    expect(store.gitRepo).toBe(B.path);
    store.setUi({ perspective: "Cleanup" });
    expect(store.filters.repos).toEqual([A.path, B.path]);
    // Opening another repo in Git selects it, for cleanup too.
    const C = repo("C:/ws/c");
    store.gitRepo = C.path;
    expect(store.filters.repos).toEqual([C.path]);
    // A focus outside the selection falls back to its first repo.
    store.filters.repos = [A.path];
    expect(store.gitRepo).toBe(A.path);
    // With all repos shown, Git follows the focus alone and leaves the filter alone.
    store.filters.repos = [];
    store.gitRepo = B.path;
    expect([store.gitRepo, store.filters.repos]).toEqual([B.path, []]);
  });

  it("reports fetch problems once per cause, a background scan stays silent", async () => {
    await start({ cached_results: () => [
      result(A, [], null, { fetchErrorKind: "Network" }),
      result(B, [], null, { fetchErrorKind: "Network" }),
      result(repo("C:/ws/c"), [], null, { fetchErrorKind: "AuthRequired" }),
    ] });
    expect(store.toasts.map((t) => t.kind)).toEqual(["error", "error"]);
    store.toasts = [];
    await store.scan(true, true);
    expect(store.toasts).toEqual([]);
  });

  it("says so when no repository was found", async () => {
    await start({ scan: () => ({ durationMs: 1, repoCount: 0 }) });
    expect(store.toasts.some((t) => t.kind === "info")).toBe(true);
  });

  it("reports a failed scan unless it ran in the background", async () => {
    await start({ scan: () => { throw { code: "ScanRunning", detail: "" }; } });
    expect(store.toasts.at(-1)?.text).toBe("Es läuft bereits ein Scan.");
    store.toasts = [];
    await store.scan(true, true);
    expect(store.toasts).toEqual([]);
  });

  it("notifies once about new stale branches, not again after the next scan", async () => {
    await start({ cached_results: () => [result(A, [branch(A.path, "x")])] });
    expect(notified).toHaveLength(1);
    await store.scan(true);
    await flush();
    expect(notified).toHaveLength(1);
  });

  it("does not notify about ignored or locked branches", async () => {
    await start({
      get_config: () => config({ locks: [{ identity: A.identity, branch: "y" }], ignores: [{ identity: A.identity, branch: "x", scope: "Local", until: null }] }),
      cached_results: () => [result(A, [branch(A.path, "x"), branch(A.path, "y")])],
    });
    expect(notified).toHaveLength(0);
    expect(store.bellCount).toBe(0);
  });

  it("rescans a repo after a ref change and refreshes its server view later", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    await start({
      cached_results: () => [result(A, [branch(A.path, "x")], [remote(A.path, "x")])],
      rescan_repo: () => result(A, [branch(A.path, "y")], [remote(A.path, "x")]),
      refresh_online: () => ({ path: A.path, branches: [], error: null, at: 9, fetched: false }),
    });
    await emit("repo-changed", { path: A.path, scopes: ["Files"] });
    await flush();
    expect(backend.called("rescan_repo")).toEqual([]);
    await emit("repo-changed", { path: A.path, scopes: ["Refs"] });
    await waitFor(() => expect(backend.called("rescan_repo")).toHaveLength(1));
    // Reassessed: the server view follows a while after.
    await settled();
    vi.advanceTimersByTime(3000);
    await waitFor(() => expect(backend.called("refresh_online")).toEqual([{ path: A.path, fetch: false, interactive: false }]));
  });

  it("reassesses a repo at most once per gap, keeps the last request, and logs every trigger", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    await start({ cached_results: () => [result(A, [branch(A.path, "x")])], rescan_repo: () => result(A, [branch(A.path, "y")]) });
    const { triggers } = await import("$lib/stores/triggers.svelte");
    const before = backend.called("rescan_repo").length;
    for (const file of [".git/refs/heads/a", ".git/refs/heads/b", ".git/refs/heads/c"]) {
      await emit("repo-changed", { path: A.path, scopes: ["Refs"], paths: [], files: [file] });
      await settled();
    }
    // The first at once, the others held back into one that follows the gap.
    expect(backend.called("rescan_repo").length).toBe(before + 1);
    expect(triggers.entries.slice(0, 3).map((e) => [e.kind, e.effect, e.files[0]])).toEqual([
      ["watchRefs", "throttled", ".git/refs/heads/c"],
      ["watchRefs", "throttled", ".git/refs/heads/b"],
      ["watchRefs", "rescan", ".git/refs/heads/a"],
    ]);
    vi.advanceTimersByTime(30_000);
    await waitFor(() => expect(backend.called("rescan_repo").length).toBe(before + 2));
    // Switched off, a ref change reassesses nothing and says so.
    store.setUi({ watchRefs: false });
    vi.advanceTimersByTime(60_000);
    await emit("repo-changed", { path: A.path, scopes: ["Refs"], paths: [], files: [".git/HEAD"] });
    await flush();
    expect(backend.called("rescan_repo").length).toBe(before + 2);
    expect([triggers.entries[0].kind, triggers.entries[0].effect]).toEqual(["watchRefs", "off"]);
  });

  it("assesses a repo whose refs changed during a scan once the scan is over", async () => {
    let finish!: () => void;
    await start({
      cached_results: () => [result(A, [branch(A.path, "x")])],
      scan: () => new Promise((ok) => (finish = () => ok({ durationMs: 1, repoCount: 1 }))),
      rescan_repo: () => result(A, [branch(A.path, "y")]),
    }, () => scanner.scanning);
    const before = backend.called("rescan_repo").length;
    const scan = store.scan(false);
    await emit("repo-changed", { path: A.path, scopes: ["Refs"] });
    await flush();
    expect(backend.called("rescan_repo").length).toBe(before);
    finish();
    await scan;
    await waitFor(() => expect(backend.called("rescan_repo").length).toBe(before + 1));
  });

  it("reads the statuses of known repos while the scan still runs, not after it", async () => {
    const st = (path: string) => ({ path, head: { branch: "main", oid: "o", upstream: null, ahead: 0, behind: 0, unreferenced: 0 }, entries: [], worktrees: [], stashes: 0 });
    // The scan never finishes here: whatever status arrives, arrived beside it.
    await start({ cached_results: () => [result(A), result(B)], scan: () => new Promise(() => {}), repo_status: (a) => st(a.path as string) }, () => gitStatus.statuses.has(A.path) && gitStatus.statuses.has(B.path));
    expect(store.scanning).toBe(true);
    expect(gitStatus.statuses.get(A.path)?.head.branch).toBe("main");
    expect(gitStatus.statuses.get(B.path)?.head.branch).toBe("main");
  });

  it("keeps a failed status read from showing stale state", async () => {
    await start({ repo_status: () => { throw "gone"; } });
    gitStatus.statuses.set(A.path, {} as never);
    await gitStatus.refreshStatus(A.path);
    expect(gitStatus.statuses.get(A.path)).toBeUndefined();
    // Marked as such: the sidebar says it cannot read it, instead of loading for ever.
    expect(gitStatus.statusFailed.has(A.path)).toBe(true);
  });

  it("a scan result still in its batch does not overwrite a fresher reassessment of the same repo", async () => {
    await start({ cached_results: () => [result(A, [branch(A.path, "cached")])], rescan_repo: () => result(A, [branch(A.path, "fresh")]) });
    await emit("scan-started", { repos: [A] });
    await emit("scan-repo", result(A, [branch(A.path, "scanned")]));
    // Asked after the scan's answer arrived: it read the repo later than the scan did.
    await store.rescan(A.path);
    expect(store.allBranches.map((b) => b.name)).toEqual(["fresh"]);
    // The batch the scan's answer waited in has landed.
    await until(() => timers.pending === 0);
    expect(store.allBranches.map((b) => b.name)).toEqual(["fresh"]);
  });

  it("a reassessment in the background that fails shows at the repo instead of a toast; one asked for still says so", async () => {
    await start({
      cached_results: () => [result(A, [branch(A.path, "x")])],
      rescan_repo: () => {
        throw "index locked";
      },
    });
    store.toasts = [];
    await emit("repo-changed", { path: A.path, scopes: ["Refs"] });
    await waitFor(() => expect(store.backgroundFailures.get(A.path)).toEqual({ rescan: "index locked" }));
    expect(store.toasts).toEqual([]);
    await store.rescan(A.path);
    expect(store.toasts.at(-1)?.text).toBe("index locked");
    backend.handlers.rescan_repo = () => result(A, [branch(A.path, "y")]);
    await store.rescan(A.path, { quiet: true });
    expect(store.backgroundFailures.has(A.path)).toBe(false);
  });

  it("names a failed watcher start", async () => {
    await start({ cached_results: () => [result(A)], watch_repos: () => { throw "no watcher"; } });
    await waitFor(() => expect(store.toasts.some((t) => t.detail === "no watcher")).toBe(true));
  });
});

describe("folds of the Changes view", () => {
  const wt = (path: string, isMain: boolean) => ({ path, branch: "main", head: "o", isMain, detached: false, foreign: false, unreferenced: 0 });
  const st = (path: string) => ({ path, head: { branch: "main", oid: "o", upstream: null, ahead: 0, behind: 0, unreferenced: 0 }, entries: [], worktrees: [wt(path, true), wt(`${path}-wt`, false)], stashes: 0 });
  const folds = { changesRepos: [A.path, `${A.path}-wt`, "C:/ws/gone"], changesDirs: [`${A.path}|staged|src`, `${A.path}-wt|unstaged|lib`, "C:/ws/gone|staged|x"] };

  it("forget the working copies that are gone once every repo has a fresh status, and keep those of worktrees", async () => {
    await start({ cached_results: () => [result(A)], repo_status: (a) => st(a.path as string) });
    store.setUi({ collapsed: folds });
    await store.scan(false);
    await waitFor(() => expect(store.config?.ui.collapsed.changesRepos).toEqual([A.path, `${A.path}-wt`]));
    expect(store.config?.ui.collapsed.changesDirs).toEqual([`${A.path}|staged|src`, `${A.path}-wt|unstaged|lib`]);
  });

  it("stay while a repo has no fresh status: its worktrees are not known yet", async () => {
    await start({
      cached_results: () => [result(A)],
      repo_status: () => {
        throw "unreadable";
      },
    });
    store.setUi({ collapsed: folds });
    await store.scan(false);
    await settled();
    expect(store.config?.ui.collapsed).toEqual(folds);
  });
});

describe("server check", () => {
  const setup = (heads: unknown) =>
    start({
      cached_results: () => [result(A, [], [remote(A.path, "x")]), result(B, [], [remote(B.path, "y")])],
      server_heads: () => heads,
      rescan_repo: (a) => result(a.path === A.path ? A : B, [], []),
      refresh_online: (a) => ({ path: a.path, branches: [remote(a.path as string, "new")], error: null, at: 9, fetched: false }),
    });

  it("fetches and reassesses only repos whose server state changed", async () => {
    await setup([
      { path: A.path, changed: true, errorKind: null },
      { path: B.path, changed: false, errorKind: null },
    ]);
    await scanner.serverCheckTick(later());
    expect(backend.called("fetch_repo")).toEqual([{ path: A.path }]);
    expect(backend.called("refresh_online")).toEqual([{ path: A.path, fetch: false, interactive: false }]);
  });

  it("checks the server also with the bell switched off: its own setting decides", async () => {
    await setup([{ path: A.path, changed: true, errorKind: null }]);
    await store.saveConfig({ ...store.config!, alerts: { ...store.config!.alerts, enabled: false } }, true);
    await scanner.serverCheckTick(later());
    expect(backend.called("server_heads")).toHaveLength(1);
  });

  it("marks an unreachable server without a toast", async () => {
    await setup([{ path: A.path, changed: false, errorKind: "Network" }]);
    await scanner.serverCheckTick(later());
    expect(store.results.find((r) => r.repo.path === A.path)?.onlineFetched).toBe(false);
    expect(store.toasts).toEqual([]);
  });

  it("waits until due, and stays quiet when the check itself fails", async () => {
    await setup(null);
    await scanner.serverCheckTick();
    expect(backend.called("server_heads")).toEqual([]);
    backend.handlers.server_heads = () => {
      throw "down";
    };
    await scanner.serverCheckTick(later());
    expect(store.toasts).toEqual([]);
  });

  it("a fetch the check started that fails shows at the repo, not as a toast, and reassesses nothing", async () => {
    await setup([{ path: A.path, changed: true, errorKind: null }]);
    backend.handlers.fetch_repo = () => {
      throw "auth needed";
    };
    store.toasts = [];
    const rescans = backend.called("rescan_repo").length;
    await scanner.serverCheckTick(later());
    expect(store.toasts).toEqual([]);
    expect(store.backgroundFailures.get(A.path)).toEqual({ fetch: "auth needed" });
    expect(backend.called("rescan_repo").length).toBe(rescans);
    backend.handlers.fetch_repo = () => null;
    await scanner.serverCheckTick(later());
    expect(store.backgroundFailures.has(A.path)).toBe(false);
  });

  it("the automatic fetch fetches only the repos the server moved for; every fourth run asks every repo", async () => {
    await setup([]);
    const before = backend.called("scan").length;
    for (let i = 0; i < 4; i++) {
      scanner.autoFetchTick(later());
      await settled();
    }
    expect(backend.called("scan").slice(before).map((a) => a.changedOnly)).toEqual([true, true, true, false]);
  });

  it("runs the background scan when it is due and nothing else runs", async () => {
    await setup([]);
    const scans = backend.called("scan").length;
    scanner.autoFetchTick(later());
    await waitFor(() => expect(backend.called("scan").length).toBe(scans + 1));
  });
});

describe("late scan results", () => {
  it("keep a lock and an ignore that were saved while the scan ran", async () => {
    await start({ cached_results: () => [result(A, [branch(A.path, "x"), branch(A.path, "y")], [remote(A.path, "x")])] });
    await store.setIgnore(A.path, "x", false, null);
    await store.setLock(A.path, "y", true);
    // A result computed before the saves: both flags still false.
    await emit("scan-repo", result(A, [branch(A.path, "x"), branch(A.path, "y")], [remote(A.path, "x")]));
    await emit("scan-online", onlineScanned(A.path, [remote(A.path, "y")], { at: 1 }));
    // Results outside a scan land in a batch as well.
    await until(() => timers.pending === 0);
    expect(store.allBranches.find((b) => b.name === "x")?.ignored).toBe(true);
    expect(store.allBranches.find((b) => b.name === "y")?.locked).toBe(true);
    expect(store.allOnline?.find((b) => b.name === "y")?.locked).toBe(true);
  });
});

describe("late answers", () => {
  const names = () => store.allBranches.map((b) => b.name);

  it("keeps one warning per failing server check instead of piling them up", async () => {
    await start({ cached_results: () => [result(A, [], [remote(A.path, "x")])] });
    for (const error of ["offline", "still offline"]) await emit("scan-online", onlineScanned(A.path, [], { error, fetched: false }));
    const warnings = () => store.repos[0].result!.warnings.filter((w) => w.code === "OnlineFailed");
    await waitFor(() => expect(warnings().map((w) => w.p)).toEqual([{ detail: "still offline" }]));
  });

  it("shows server branches that could not be checked like local ones, once, until the next answer", async () => {
    const local = { code: "BranchFailed", p: { branch: "x", detail: "bad" } } as const;
    const server = { code: "BranchFailed", p: { branch: "origin/y", detail: "bad" } } as const;
    await start({ cached_results: () => [{ ...result(A, [], [remote(A.path, "x")]), warnings: [local] }] });
    const answer = (warnings: unknown[], error: string | null = null) =>
      emit("scan-online", { path: A.path, branches: [], warnings, error, at: 9, fetched: true });
    await answer([server, server, local]);
    await waitFor(() => expect(store.repos[0].result!.warnings).toEqual([local, server]));
    await answer([], "offline");
    await waitFor(() => expect(store.repos[0].result!.warnings).toEqual([local, { code: "OnlineFailed", p: { detail: "offline" } }]));
    await answer([]);
    await waitFor(() => expect(store.repos[0].result!.warnings).toEqual([local]));
  });

  it("lets only the server answer asked for last land, and a scan's newer answer replace an older request", async () => {
    const answers: ((v: unknown) => void)[] = [];
    const online = (name: string) => onlineScanned(A.path, [remote(A.path, name)]);
    await start({ cached_results: () => [result(A, [], [remote(A.path, "cached")])], refresh_online: () => new Promise((r) => answers.push(r)) });
    const first = store.refreshOnline(A.path, false);
    const second = store.refreshOnline(A.path, false);
    await waitFor(() => expect(answers).toHaveLength(2));
    answers[1](online("new"));
    answers[0](online("old"));
    await Promise.all([first, second]);
    expect(store.allOnline?.map((b) => b.name)).toEqual(["new"]);
    // Asked before the scan started: the scan's answer is newer and stays.
    const third = store.refreshOnline(A.path, false);
    await waitFor(() => expect(answers).toHaveLength(3));
    await emit("scan-started", { repos: [A] });
    await emit("scan-online", online("scanned"));
    answers[2](online("stale"));
    await third;
    await flush();
    expect(store.allOnline?.map((b) => b.name)).toEqual(["scanned"]);
  });

  it("drops a rescan asked for before the scan started, and keeps one asked for after it", async () => {
    const answers: ((v: unknown) => void)[] = [];
    await start({ cached_results: () => [result(A, [branch(A.path, "cached")])], rescan_repo: () => new Promise((r) => answers.push(r)) });
    const before = store.rescan(A.path);
    await waitFor(() => expect(answers).toHaveLength(1));
    await emit("scan-started", { repos: [A] });
    await emit("scan-repo", result(A, [branch(A.path, "scanned")]));
    answers[0](result(A, [branch(A.path, "before")]));
    await before;
    // The scan's answer has landed from its batch.
    await until(() => timers.pending === 0);
    expect(names()).toEqual(["scanned"]);
    // Asked after the next scan started, it may have read newer state than the scan: it keeps its turn.
    await emit("scan-started", { repos: [A] });
    const after = store.rescan(A.path);
    await waitFor(() => expect(answers).toHaveLength(2));
    await emit("scan-repo", result(A, [branch(A.path, "scanned again")]));
    await until(() => timers.pending === 0);
    answers[1](result(A, [branch(A.path, "after")]));
    await after;
    await waitFor(() => expect(names()).toEqual(["after"]));
  });

  it("does not fetch twice when a refresh comes during the first stage of the start", async () => {
    const seen: string[] = [];
    await start({
      cached_results: () => [result(A)],
      scan: (a) => {
        seen.push(`${store.stage}:${a.fetch}:${a.changedOnly}`);
        // F5 while stage one runs: it waits, then fetches everything.
        if (seen.length === 1) void store.scan(true);
        return { durationMs: 1, repoCount: 1 };
      },
    });
    await waitFor(() => expect(store.stage).toBeNull());
    expect(seen).toEqual(["local:false:false", "server:true:false"]);
  });

  // Answers for one command, released by hand in any order.
  function gate<T>() {
    const waiting: ((v: T) => void)[] = [];
    return { handler: () => new Promise<T>((r) => waiting.push(r)), release: (i: number, v: T) => waiting[i](v) };
  }

  it("an older rescan answer never overwrites a newer one", async () => {
    await start({ cached_results: () => [result(A), result(A2)] });
    const g = gate<unknown>();
    backend.handlers.rescan_repo = g.handler;
    const first = store.rescan(A.path);
    const second = store.rescan(A.path);
    g.release(1, result(A, [branch(A.path, "new")]));
    await second;
    g.release(0, result(A, [branch(A.path, "old")]));
    await first;
    expect(store.repos.find((r) => r.info.path === A.path)!.result!.branches.map((b) => b.name)).toEqual(["new"]);
  });

  it("a rescan answering after its repo left the list does not bring it back", async () => {
    await start({ cached_results: () => [result(A), result(A2)] });
    const g = gate<unknown>();
    backend.handlers.rescan_repo = g.handler;
    const pending = store.rescan(A2.path);
    // A scan that no longer lists the copy (its folder was removed).
    await emit("scan-started", { repos: store.repos.map((r) => r.info).filter((i) => i.path !== A2.path) });
    g.release(0, result(A2, [branch(A2.path, "x")]));
    await pending;
    expect(store.repos.some((r) => r.info.path === A2.path)).toBe(false);
  });

  it("an older status answer never overwrites a newer one", async () => {
    await start({ cached_results: () => [result(A), result(A2)] });
    const g = gate<unknown>();
    backend.handlers.repo_status = g.handler;
    const status = (branch: string) => ({ path: A.path, head: { branch, oid: "o", upstream: null, ahead: 0, behind: 0, unreferenced: 0 }, entries: [], worktrees: [] });
    const first = gitStatus.refreshStatus(A.path);
    const second = gitStatus.refreshStatus(A.path);
    g.release(1, status("new"));
    await second;
    g.release(0, status("old"));
    await first;
    expect(gitStatus.statuses.get(A.path)?.head.branch).toBe("new");
  });
});
