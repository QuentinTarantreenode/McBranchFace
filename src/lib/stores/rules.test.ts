// @vitest-environment jsdom
// Locks, ignores and notes: in every working copy at once, saved, and kept when a result arrives.
import { describe, expect, it, vi } from "vitest";
import { emit } from "@tauri-apps/api/event";
import { branch, onlineScanned, remote, repo, result } from "../../test/backend";
import { backend, savedConfigs, start, store, storeTests } from "../../test/store";
import { waitFor } from "../../test/wait";

// Only the menu helpers need icons; loading the whole icon package would dominate the run time.
vi.mock("@lucide/svelte", () => ({ Eye: {}, EyeOff: {} }));

const A = repo("C:/ws/a");
const A2 = repo("C:/ws/copy/a", { identity: A.identity });

storeTests();

describe("locks, ignores, notes", () => {
  const copies = () => [result(A, [branch(A.path, "x")], [remote(A.path, "x")]), result(A2, [branch(A2.path, "x")])];

  it("lock a branch in every working copy at once", async () => {
    await start({ cached_results: copies });
    await store.setLock(A.path, "x", true);
    expect(store.allBranches.every((b) => b.locked)).toBe(true);
    expect(store.allOnline?.[0].locked).toBe(true);
    await store.setLock(A.path, null, true);
    expect(store.isRepoLocked(A2.path)).toBe(true);
    await store.setLock(A.path, "x", false);
    await store.setLock(A.path, null, false);
    expect(store.allBranches.some((b) => b.locked)).toBe(false);
  });

  it("a lock, an ignore and a server answer replace the result they change instead of writing into it", async () => {
    await start({ cached_results: copies });
    const before = store.repos[0].result!;
    const [local, online] = [before.branches[0], before.online![0]];
    await store.setLock(A.path, "x", true);
    expect(store.repos[0].result).not.toBe(before);
    expect([local.locked, online.locked]).toEqual([false, false]);
    expect(store.allOnline?.[0].locked).toBe(true);
    const locked = store.repos[0].result!;
    await store.setIgnore(A.path, "x", true, null);
    expect(store.repos[0].result).not.toBe(locked);
    expect(store.allOnline?.[0].ignored).toBe(true);
    const ignored = store.repos[0].result!;
    await emit("scan-online", onlineScanned(A.path, [remote(A.path, "y")], { at: 7 }));
    await waitFor(() => expect(store.allOnline?.map((b) => b.name)).toEqual(["y"]));
    expect(ignored.online!.map((b) => b.name)).toEqual(["x"]);
  });

  it("ignore on one side, then both, then end one side", async () => {
    await start({ cached_results: copies });
    await store.setIgnore(A.path, "x", false, 30);
    expect(store.visibleIgnored).toHaveLength(2);
    expect(store.allOnline?.[0].ignored).toBe(false);
    expect(store.ignoreOf(A.path, "x")?.until).toBeGreaterThan(Date.now() / 1000);
    await store.setIgnore(A.path, "x", true, null);
    expect(store.ignoreOf(A.path, "x")?.scope).toBe("Both");
    expect(store.allOnline?.[0].ignored).toBe(true);
    await store.clearIgnore(A.path, "x", false);
    expect(store.visibleIgnored).toHaveLength(0);
    expect(store.allOnline?.[0].ignored).toBe(true);
    await store.removeIgnore(store.ignoreOf(A.path, "x")!);
    expect(store.config?.ignores).toEqual([]);
    expect(savedConfigs().length).toBeGreaterThanOrEqual(4);
  });

  it("does nothing for an unknown repo", async () => {
    await start();
    await store.setIgnore("C:/nowhere", "x", false, 30);
    await store.clearIgnore("C:/nowhere", "x", false);
    await store.setLock("C:/nowhere", "x", true);
    store.setAnnotation("C:/nowhere", "x", { note: "n", tags: [] });
    expect(savedConfigs()).toEqual([]);
    expect(store.annotationOf("C:/nowhere", null)).toEqual({ note: "", tags: [] });
  });

  it("saves notes and tags quietly, inherits repo tags, drops empty ones", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    await start({ cached_results: copies });
    store.setAnnotation(A.path, "x", { note: "wait for QA", tags: ["qa"] });
    store.setAnnotation(A.path, null, { note: "core repo", tags: ["core"] });
    expect(store.annotate({ repoPath: A2.path, name: "x" })).toEqual({ tags: ["qa", "core"], note: "wait for QA\ncore repo" });
    expect(store.tags).toEqual(["core", "qa"]);
    store.toggleTagFilter("core");
    expect(store.visible.map((b) => b.repoPath)).toEqual([A.path, A2.path]);
    store.toggleTagFilter("core");
    expect(store.filters.tags).toEqual([]);
    // The write waits for its turn in the queue: one more microtask after the timer.
    await vi.advanceTimersByTimeAsync(400);
    expect(Object.keys(savedConfigs().at(-1)!.annotations)).toHaveLength(2);
    store.setAnnotation(A.path, "x", { note: "  ", tags: [] });
    expect(store.annotationOf(A.path, "x")).toEqual({ note: "", tags: [] });
  });

  it("excludes a repo from the online check and brings it back", async () => {
    await start({
      cached_results: copies,
      refresh_online: () => ({ path: A.path, branches: [remote(A.path, "x")], error: null, at: 2, fetched: true }),
    });
    await store.setOnlineExcluded(A.path, true);
    expect(store.allOnline ?? []).toEqual([]);
    expect(store.excludedRepos.map((r) => r.path)).toEqual([A.path, A2.path]);
    await store.setOnlineExcluded(A.path, false);
    await waitFor(() => expect(backend.called("refresh_online")).toEqual([{ path: A.path, fetch: true, interactive: true }]));
  });
});

describe("ignore menu", () => {
  it("offers how long to ignore, or ends the ignore with its date", async () => {
    await start({ cached_results: () => [result(A, [branch(A.path, "x")])] });
    const { ignoreItem, untilText } = await import("$lib/components/ignoreMenu");
    const b = store.allBranches[0];
    const item = ignoreItem(b, false);
    expect(item.submenu?.filter((e) => typeof e === "object" && "run" in e)).toHaveLength(3);
    item.run();
    const choice = item.submenu![3] as { run: () => Promise<void> };
    await choice.run();
    expect(store.ignoreOf(A.path, "x")?.until).toBeNull();
    const undo = ignoreItem(store.allBranches[0], false);
    expect(undo.hint).toBe(untilText(null));
    await undo.run();
    expect(store.allBranches[0].ignored).toBe(false);
    // In the middle of a year: the same year in every time zone.
    expect(untilText(86_400 * 500)).toMatch(/1971/);
  });
});
