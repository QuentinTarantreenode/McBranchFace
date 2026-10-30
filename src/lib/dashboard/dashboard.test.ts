// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { branch, installBackend, repo, result } from "../../test/backend";
import { WAIT_MS } from "../../test/wait";

vi.mock("@lucide/svelte", () => ({ Eye: {}, EyeOff: {} }));
const counted = vi.hoisted(() => ({ prSteps: 0, statusSteps: 0 }));
vi.mock("./model", async (actual) => {
  const m = await actual<typeof import("./model")>();
  return {
    ...m,
    prSteps: (...a: Parameters<typeof m.prSteps>) => (counted.prSteps++, m.prSteps(...a)),
    statusSteps: (...a: Parameters<typeof m.statusSteps>) => (counted.statusSteps++, m.statusSteps(...a)),
  };
});

const A = repo("C:/ws/a");
let dispose = () => {};
afterEach(() => dispose());

describe("dashboard input", () => {
  it("a status written by the watcher rebuilds what the working copies say, not the steps of pull requests", async () => {
    installBackend({ cached_results: () => [result(A, [branch(A.path, "x")])] });
    const { store } = await import("../store.svelte");
    const { gitStatus } = await import("../stores/gitStatus.svelte");
    const { dashboard } = await import("./dashboard.svelte");
    const { testApi } = await import("../app/testHook.svelte");
    await store.init();
    dispose = () => store.dispose();
    // Started: no status of the start lands over the one this test sets.
    await testApi.when(testApi.idle, WAIT_MS);
    const st = { path: A.path, head: { branch: "main", oid: "o", upstream: null, ahead: 0, behind: 0, unreferenced: 0 }, entries: [], worktrees: [], stashes: 0 };
    gitStatus.statuses.set(A.path, st);
    expect(dashboard.steps.some((s) => s.kind === "dirty")).toBe(false);
    const [prs, statuses] = [counted.prSteps, counted.statusSteps];
    gitStatus.statuses.set(A.path, { ...st, entries: [{ path: "f.txt", origPath: null, staged: null, unstaged: "Modified", conflicted: false, untracked: false }] });
    expect(dashboard.steps.some((s) => s.kind === "dirty")).toBe(true);
    expect(counted.statusSteps).toBe(statuses + 1);
    expect(counted.prSteps).toBe(prs);
  });
});
