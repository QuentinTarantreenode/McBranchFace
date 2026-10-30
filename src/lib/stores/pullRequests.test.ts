// @vitest-environment jsdom
// Open pull requests: asked only with the provider's CLI ready, the provider only for the repo in front,
// and a list that could not be loaded marked as such.
import { describe, expect, it, vi } from "vitest";
import { pullRequest, repo, result } from "../../test/backend";
import { start, store, storeTests } from "../../test/store";

// Only the menu helpers need icons; loading the whole icon package would dominate the run time.
vi.mock("@lucide/svelte", () => ({ Eye: {}, EyeOff: {} }));


storeTests();

describe("pull requests", () => {
  it("asks for the open pull requests only with the provider's CLI ready, and the provider only for the repo in front", async () => {
    const links = { home: "h", pullRequests: "p", branch: "b" };
    const Z = repo("C:/ws/z", { provider: "Azure", links });
    const asked: unknown[] = [];
    const pr = pullRequest(7, { title: "Feature", url: "u", author: "x", sourceRef: "refs/heads/f" });
    await start({ cached_results: () => [result(Z)], open_pull_requests: (a) => (asked.push(a.refresh), [pr]) });
    const { pullRequests } = await import("$lib/stores/pullRequests.svelte");
    await pullRequests.load(Z.path);
    expect(asked).toEqual([]);
    expect(pullRequests.unavailable(Z.path)).not.toBeNull();
    store.tools = [{ id: "AzureCli", required: false, state: "Ready", version: null, minVersion: null, account: null, commands: [] } as unknown as (typeof store.tools)[number]];
    await pullRequests.load(Z.path);
    expect(pullRequests.count(Z.path)).toBe(1);
    store.gitRepo = Z.path;
    await pullRequests.poll();
    expect(asked).toEqual([false, true]);
  });

  it("asks the provider after a cache read that was on its way, and marks a list that could not be loaded", async () => {
    const Z = repo("C:/ws/z", { provider: "Azure", links: { home: "h", pullRequests: "p", branch: "b" } });
    const asked: unknown[] = [];
    let hold: (v: unknown) => void = () => {};
    let fail = false;
    await start({
      cached_results: () => [result(Z)],
      open_pull_requests: (a) => {
        asked.push(a.refresh);
        if (fail) throw { code: "Other", detail: "provider down" };
        return asked.length === 1 ? new Promise((r) => (hold = r)) : [];
      },
    });
    store.tools = [{ id: "AzureCli", required: false, state: "Ready", version: null, minVersion: null, account: null, commands: [] } as unknown as (typeof store.tools)[number]];
    const { pullRequests } = await import("$lib/stores/pullRequests.svelte");
    const cache = pullRequests.load(Z.path, "cache");
    await pullRequests.load(Z.path, "provider");
    hold([]);
    await cache;
    expect(asked).toEqual([false, true]);
    expect(pullRequests.failed.has(Z.path)).toBe(false);
    fail = true;
    await pullRequests.load(Z.path, "provider");
    expect(pullRequests.failed.has(Z.path)).toBe(true);
  });
});
