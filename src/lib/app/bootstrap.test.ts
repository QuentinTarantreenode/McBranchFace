// @vitest-environment jsdom
// The start of the app: config, cached results and statuses, the two stages of the first scan, what it
// reports, and the tray.
import { describe, expect, it, vi } from "vitest";
import { emit } from "@tauri-apps/api/event";
import { branch, config, repo, result } from "../../test/backend";
import { backend, gitStatus, notified, start, store, storeTests } from "../../test/store";
import { waitFor } from "../../test/wait";

// Only the menu helpers need icons; loading the whole icon package would dominate the run time.
vi.mock("@lucide/svelte", () => ({ Eye: {}, EyeOff: {} }));

const A = repo("C:/ws/a");
const B = repo("C:/ws/b");

storeTests();

describe("start", () => {
  it("loads config and cached results, reports every startup issue and scans", async () => {
    await start({
      cached_results: () => [result(A, [branch(A.path, "x")])],
      startup_issues: () => [
        { code: "ConfigCorrupt", p: { backup: "C:/b.json", detail: "bad" } },
        { code: "AppDirReadOnly", p: { path: "C:/app", detail: "denied" } },
        { code: "ProbeLeftovers", p: { folders: [{ path: "C:/ws/wt.12-0.mcbranchface-probe", original: "C:/ws/wt" }] } },
        { code: "LastCrash", p: { log: "C:/crash.log", message: "boom" } },
      ],
    });
    expect(store.config?.language).toBe("De");
    expect(store.allBranches.map((b) => b.name)).toEqual(["x"]);
    expect(store.toasts.map((t) => t.detail)).toEqual([
      "C:/b.json",
      "denied",
      "Benenne C:\\ws\\wt.12-0.mcbranchface-probe wieder in C:\\ws\\wt um, sobald kein Programm mehr eine Datei darin geöffnet hat. Bis dahin fehlt dieser Worktree in git und in McBranchFace.",
      "boom · C:/crash.log",
    ]);
    // Two stages: what is here first, without the network; then fetch and server.
    // Local first, then the server: only the repos it moved for are fetched.
    expect(backend.called("scan")).toEqual([{ fetch: false, changedOnly: false, interactive: false }, { fetch: true, changedOnly: true, interactive: false }]);
    expect(store.stage).toBeNull();
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(store.selectedKey).toBe("C:/ws/a::x");
  });

  it("shows the git state of the last run at once, dimmed, and the age of the last scan", async () => {
    const st = (path: string, branch: string) => ({ path, head: { branch, oid: "o", upstream: null, ahead: 0, behind: 0, unreferenced: 0 }, entries: [], worktrees: [], stashes: 0 });
    let answer: (v: unknown) => void = () => {};
    await start({
      cached_results: () => [result(A), result(B)],
      cached_status: () => ({ statuses: [st(A.path, "cached"), st(B.path, "cached")], scannedAt: 1_700_000_000 }),
      // The scan still runs: until it ends, the time shown is that of the last one.
      scan: () => new Promise(() => {}),
      // A's fresh status is still on its way; B's comes back at once.
      repo_status: (a) => (a.path === A.path ? new Promise((r) => (answer = r)) : st(B.path, "fresh")),
    }, () => gitStatus.statuses.get(B.path)?.head.branch === "fresh");
    expect(store.scannedAt).toBe(1_700_000_000_000);
    expect(gitStatus.statuses.get(A.path)?.head.branch).toBe("cached");
    expect(gitStatus.isStale(A.path)).toBe(true);
    expect(gitStatus.statuses.get(B.path)?.head.branch).toBe("fresh");
    expect(gitStatus.isStale(B.path)).toBe(false);
    answer(st(A.path, "fresh"));
    await waitFor(() => expect(gitStatus.isStale(A.path)).toBe(false));
  });

  it("stage one asks no provider and takes the cached pull requests; stage two fetches", async () => {
    const stages: string[] = [];
    await start({ cached_results: () => [result(A)], scan: (a) => (stages.push(String(store.stage) + ":" + String(a.fetch)), { durationMs: 1, repoCount: 1 }) });
    expect(stages).toEqual(["local:false", "server:true"]);
  });

  it("says why when the config cannot be read", async () => {
    await start({
      get_config: () => {
        throw { code: "Other", detail: "disk gone" };
      },
    });
    expect(store.config).toBeNull();
    expect(store.toasts[0].text).toBe("disk gone");
  });

  it("a start the user stops skips the server stage and keeps the age of the data", async () => {
    const fetches: unknown[] = [];
    await start({
      cached_results: () => [result(A)],
      cached_status: () => ({ statuses: [], scannedAt: 1_700_000_000 }),
      scan: (a) => (fetches.push(a.fetch), { durationMs: 1, repoCount: 1, cancelled: true }),
    });
    expect(fetches).toEqual([false]);
    expect(store.stage).toBeNull();
    expect(store.scannedAt).toBe(1_700_000_000_000);
    expect(store.toasts.map((t) => t.text)).toEqual(["Scan gestoppt. Die Repos, die er noch nicht bewertet hatte, zeigen ihr letztes Ergebnis."]);
  });

  it("does not scan without roots and asks for onboarding", async () => {
    await start({ get_config: () => config({ roots: [] }) });
    expect(backend.called("scan")).toEqual([]);
    expect(store.loaded).toBe(true);
  });

  it("reports a failed environment check and a failed history load", async () => {
    await start({
      environment_status: () => {
        throw "env";
      },
      deleted_entries: () => {
        throw "journal";
      },
    });
    expect(store.envChecking).toBe(false);
    expect(store.toasts.map((t) => t.text)).toEqual(expect.arrayContaining(["env", "journal"]));
    expect(store.tool("Git")).toBeUndefined();
  });
});

describe("tray", () => {
  it("answer the tray menu and describe the bell in its tooltip", async () => {
    await start({ cached_results: () => [result(A, [branch(A.path, "x")])] });
    expect(store.trayStatus()).toMatchObject({ tooltip: "McBranchFace: 1 veralteter Branch", notifyOn: true });
    const scans = backend.called("scan").length;
    await emit("tray-refresh", null);
    await waitFor(() => expect(backend.called("scan").length).toBe(scans + 1));
    await emit("tray-toggle-notify", null);
    await waitFor(() => expect(store.config?.alerts.notify).toBe(false));
    await emit("hidden-to-tray", null);
    await waitFor(() => expect(notified).toContain("McBranchFace läuft im Tray weiter"));
  });

  it("stay in the tray when started hidden by the system", async () => {
    // A start shows the window two animation frames after it. Frames run in the order they were asked
    // for: first those of the test before (they would call this test's backend), then this start's own.
    const frames = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    await frames();
    await start({ window_capabilities: () => ({ tray: true, autostart: true, startedHidden: true, home: null }) });
    await frames();
    expect(backend.called("plugin:window|show")).toEqual([]);
    expect(store.trayStatus().tooltip).toBe("McBranchFace: nichts zu tun");
  });
});
