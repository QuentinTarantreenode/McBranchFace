// @vitest-environment jsdom
// Actions across repos: a branch name in all its repos, a switch from the dropdown, a run with progress
// and a stop, and the claim a write holds on its repo.
import { describe, expect, it, vi } from "vitest";
import type { RepoStatus } from "$lib/bindings/RepoStatus";
import { branch, config, repo, result } from "../../test/backend";
import { backend, gitStatus, settled, start, store, storeTests } from "../../test/store";
import { waitFor } from "../../test/wait";

// Only the menu helpers need icons; loading the whole icon package would dominate the run time.
vi.mock("@lucide/svelte", () => ({ Eye: {}, EyeOff: {} }));

const A = repo("C:/ws/a");
const B = repo("C:/ws/b");

storeTests();

describe("group actions", () => {
  it("a branch name group acts in all its repos, names the ones that failed and reassesses every one", async () => {
    const C = repo("C:/ws/c");
    const inA = branch(A.path, "feature/x", { upstreamState: "Live", behind: 2, unpushedCommitCount: 1 });
    const inB = branch(B.path, "feature/x", { upstreamState: "Live", worktree: { path: B.path, isMain: true, files: [] } });
    await start({
      get_config: () => config({ roots: ["C:/ws"] }),
      cached_results: () => [result(A, [inA]), result(B, [inB]), result(C, [])],
      git_remote: (a) => {
        if (a.path === A.path) throw { kind: "Rejected", op: "Push", detail: "protected", path: null, changed: false };
        return { sha: null, warning: null, backup: null };
      },
      git_fast_forward: () => ({ sha: "s", warning: null, backup: null }),
      git_create_branch: () => ({ sha: "s", warning: null, backup: null }),
      rescan_repo: (a) => result([A, B, C].find((r) => r.path === a.path)!),
    });
    const g = await import("$lib/services/groupActions");
    const to = g.groupTargets([inA, inB]);
    expect([to.behind, to.notCheckedOut, to.unpushed].map((l) => l.map((b) => b.repoPath))).toEqual([[A.path], [A.path], [A.path]]);
    expect(to.missing).toEqual([C.path]);

    await g.createIn("feature/x", to.missing);
    expect(backend.called("git_create_branch")).toEqual([{ path: C.path, name: "feature/x", start: "main^{commit}", switch: false }]);
    // Taken over where it is missing, without switching: from the repo's HEAD or its own default branch.
    await g.createMissing("feature/y", [C.path], "head");
    await g.createMissing("feature/z", [C.path], "default");
    expect(backend.called("git_create_branch").slice(1)).toEqual([
      { path: C.path, name: "feature/y", start: "HEAD", switch: false },
      { path: C.path, name: "feature/z", start: "main^{commit}", switch: false },
    ]);
    await g.pushAll("feature/x", [inA, inB]);
    expect(backend.called("git_remote").map((a) => [a.path, a.branch])).toEqual([[A.path, "feature/x"], [B.path, "feature/x"]]);
    const last = store.toasts.at(-1)!;
    expect([last.kind, last.text]).toEqual(["error", "Push: 1 von 2 Repos"]);
    expect(last.detail).toContain("a:");
    expect(backend.called("rescan_repo").map((a) => a.path)).toEqual(expect.arrayContaining([A.path, B.path, C.path]));
  });

  it("a switch from the dropdown reads the status fresh and reassesses the repo of a worktree, not the worktree", async () => {
    const WT = "C:/ws/a-wt";
    const st = (path: string, entries: unknown[]): RepoStatus => ({ path, head: { branch: "main", oid: "o", upstream: null, ahead: 0, behind: 0, unreferenced: 0 }, entries, worktrees: [{ path: A.path, branch: "main", head: "o", isMain: true, detached: false, foreign: false, unreferenced: 0 }, { path: WT, branch: "wt", head: "o", isMain: false, detached: false, foreign: false, unreferenced: 0 }], stashes: 0 }) as RepoStatus;
    await start({
      cached_results: () => [result(A)],
      // The worktree has changes now, though the store still holds a clean status for it.
      repo_status: (a) => st(String(a.path), a.path === WT ? [{ path: "f.txt" }] : []),
      git_switch: () => ({ sha: null, backupDir: null, stashed: false, warning: null, summary: null }),
      rescan_repo: () => result(A),
    });
    gitStatus.statuses.set(A.path, st(A.path, []));
    gitStatus.statuses.set(WT, st(WT, []));
    const { switchRepos } = await import("$lib/services/quickSwitch");
    await switchRepos("dev", [{ path: WT, kind: "local", ref: "dev", elsewhere: null }], "Bring", "head");
    await settled();
    expect(backend.called("git_switch")).toEqual([{ path: WT, target: "dev", remote: false, carry: "Bring" }]);
    expect(backend.called("rescan_repo").map((a) => a.path)).toEqual([A.path]);
  });

  it("reassess a whole folder one repo after the other", async () => {
    await start({ cached_results: () => [result(A), result(B)], rescan_repo: (a) => result(a.path === A.path ? A : B) });
    await store.rescanAll([A.path, B.path]);
    expect(backend.called("rescan_repo").map((a) => a.path)).toEqual([A.path, B.path]);
  });

  it("a run across repos counts its progress and stops when asked", async () => {
    let release: () => void = () => {};
    await start({
      cached_results: () => [result(A, []), result(B, [])],
      git_remote: (a) => (a.path === A.path ? new Promise((r) => (release = () => r({ sha: null, warning: null, backup: null }))) : { sha: null, warning: null, backup: null }),
      git_cancel: () => null,
      rescan_repo: (a) => result([A, B].find((r) => r.path === a.path)!),
    });
    const { activity } = await import("$lib/stores/activity.svelte");
    const g = await import("$lib/services/groupActions");
    const run = g.fetchIn([A.path, B.path], []);
    await waitFor(() => expect(activity.front?.progress).toEqual({ done: 0, total: 2 }));
    const own = activity.front!;
    expect([own.own, own.progress]).toEqual([true, { done: 0, total: 2 }]);
    own.cancel!();
    expect(backend.called("git_cancel")).toHaveLength(1);
    release();
    await run;
    expect(backend.called("git_remote").map((a) => a.path)).toEqual([A.path]);
    expect(store.toasts.at(-1)!.text).toBe("Fetch abgebrochen nach 1 von 2 Repos");
    expect(activity.running.size).toBe(0);
  });
});

describe("claims", () => {
  const ok = { sha: null, backupDir: null, stashed: false, warning: null, summary: null };

  it("claims the repo while a write from the cleanup runs; another one waits instead of running beside it", async () => {
    let release: (v: unknown) => void = () => {};
    await start({ cached_results: () => [result(A, [branch(A.path, "x")])], git_remote: () => new Promise((r) => (release = r)) });
    const { gitClaims } = await import("$lib/stores/gitClaims.svelte");
    const { t } = await import("$lib/i18n/index.svelte");
    const b = store.allBranches[0];
    const pushing = store.push(b);
    await waitFor(() => expect(gitClaims.gitRunning(A.path)).not.toBeNull());
    await store.fastForward(b);
    expect(backend.called("git_fast_forward")).toEqual([]);
    expect(store.toasts.at(-1)?.text).toBe(t.common.gitBusy);
    release(ok);
    await pushing;
    expect(gitClaims.gitRunning(A.path)).toBeNull();
    // Free again: the next write runs.
    backend.handlers.git_fast_forward = () => ok;
    await store.fastForward(b);
    expect(backend.called("git_fast_forward")).toHaveLength(1);
  });
});
