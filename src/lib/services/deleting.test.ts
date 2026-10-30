// @vitest-environment jsdom
// Deleting: local and on the server, retries, undo and restore, and what a broken run leaves free.
import { describe, expect, it, vi } from "vitest";
import { branch, config, entry, outcome, remote, repo, result } from "../../test/backend";
import { backend, start, store, storeTests } from "../../test/store";

// Only the menu helpers need icons; loading the whole icon package would dominate the run time.
vi.mock("@lucide/svelte", () => ({ Eye: {}, EyeOff: {} }));

const A = repo("C:/ws/a");

storeTests();

describe("deleting", () => {
  it("deletes locally, rescans and undoes", async () => {
    await start({
      get_config: () => config({ locks: [{ identity: A.identity, branch: "l" }] }),
      cached_results: () => [result(A, [branch(A.path, "x"), branch(A.path, "l")])],
      delete_branch: (a) => outcome({ repoPath: A.path, name: (a.request as { branch: string }).branch }),
      rescan_repo: () => result(A, [branch(A.path, "l")]),
      restore_branch: (a) => entry({ repoPath: A.path, name: "x" }, { id: a.id as string }),
    });
    await store.openDelete(store.allBranches.filter((b) => b.locked));
    expect(store.deleteJob).toBeNull();
    await store.openDelete(store.allBranches);
    expect(store.deleteJob?.items.map((i) => i.key)).toEqual(["C:/ws/a::x"]);
    await store.runDelete();
    expect(backend.called("delete_branch")).toHaveLength(1);
    expect(store.allBranches.map((b) => b.name)).toEqual(["l"]);
    await store.undoDelete();
    expect(backend.called("restore_branch")).toEqual([{ id: "e-x" }]);
    expect(store.toasts.at(-1)?.kind).toBe("success");
  });

  it("retries what failed and closes only when not running", async () => {
    let fail = true;
    await start({
      cached_results: () => [result(A, [branch(A.path, "x")])],
      delete_branch: () => {
        if (fail) throw { kind: "Lock", detail: "busy" };
        return outcome({ repoPath: A.path, name: "x" });
      },
      rescan_repo: () => result(A, []),
    });
    await store.openDelete(store.allBranches);
    await store.runDelete();
    expect(store.deleteJob?.items[0].status).toBe("failed");
    fail = false;
    await store.retryDelete();
    expect(store.deleteJob?.items[0].status).toBe("ok");
    store.closeDelete();
    expect(store.deleteJob).toBeNull();
  });

  it("deletes on the server, leaves others' branches unticked and takes local copies along", async () => {
    await start({
      cached_results: () => [
        result(A, [branch(A.path, "mine"), branch(A.path, "busy", { verdict: "Unsafe" })], [
          remote(A.path, "mine"),
          remote(A.path, "theirs", { isMine: false }),
          remote(A.path, "busy"),
        ]),
      ],
      delete_remote_branches: (a) =>
        (a.requests as { branch: string }[]).map((r) => ({ repoPath: A.path, branch: r.branch, outcome: outcome({ repoPath: A.path, name: r.branch }, { id: `r-${r.branch}` }), failure: null })),
      rescan_repo: () => result(A, [branch(A.path, "mine"), branch(A.path, "busy", { verdict: "Unsafe" })], null),
      delete_branch: (a) => outcome({ repoPath: A.path, name: (a.request as { branch: string }).branch }, { id: "local-mine" }),
      restore_branch: (a) => entry({ repoPath: A.path, name: "x" }, { id: a.id as string, remote: "origin" }),
      refresh_online: () => ({ path: A.path, branches: [], error: null, at: 3, fetched: true }),
    });
    await store.openOnlineDelete(store.allOnline!);
    const job = store.deleteJob!;
    expect(job.items.find((i) => i.key.endsWith("theirs"))?.status).toBe("excluded");
    await store.runDelete();
    expect(backend.called("delete_remote_branches")[0].requests).toHaveLength(2);
    expect(backend.called("prune_tracking")).toHaveLength(2);
    expect(job.followUps.map((f) => [f.branch, f.status])).toEqual([["mine", "ok"], ["busy", "skipped"]]);
    await store.undoDelete();
    expect(backend.called("restore_branch").map((a) => a.id)).toEqual(["r-mine", "r-busy", "local-mine"]);
  });

  it("a restore counts what came back, not what was asked for, and names a stash only when one alone came back", async () => {
    await start({
      cached_results: () => [result(A, [])],
      restore_branch: (a) => {
        if (a.id === "gone") throw { code: "AlreadyRestored", detail: "" };
        return a.id === "stash" ? entry({ repoPath: A.path, name: "" }, { id: "stash", branch: "" }) : entry({ repoPath: A.path, name: String(a.id) }, { id: String(a.id) });
      },
      rescan_repo: () => result(A, []),
    });
    await store.restore(["x", "y", "gone"]);
    expect(store.toasts.find((t) => t.kind === "success")?.text).toBe("2 Branches wiederhergestellt.");
    store.toasts = [];
    await store.restore(["x", "stash"]);
    expect(store.toasts.find((t) => t.kind === "success")?.text).toBe("2 Branches wiederhergestellt.");
    store.toasts = [];
    await store.restore(["stash", "x"]);
    expect(store.toasts.find((t) => t.kind === "success")?.text).toBe("2 Branches wiederhergestellt.");
    store.toasts = [];
    await store.restore(["gone", "x"]);
    expect(store.toasts.find((t) => t.kind === "success")?.text).toBe("Branch wiederhergestellt.");
    store.toasts = [];
    await store.restore(["stash", "gone"]);
    expect(store.toasts.find((t) => t.kind === "success")?.text).toBe("Stash wiederhergestellt.");
  });

  it("frees the rows of a delete that broke off unexpectedly", async () => {
    await start({
      cached_results: () => [result(A, [branch(A.path, "x")])],
      delete_branch: () => outcome({ repoPath: A.path, name: "x" }),
    });
    await store.openDelete(store.allBranches);
    const job = store.deleteJob as unknown as { run: () => Promise<void> };
    job.run = () => Promise.reject(new Error("broken"));
    await store.runDelete().catch(() => {});
    expect(store.busy.size).toBe(0);
  });

  it("restores, purges and switches away before deleting", async () => {
    await start({
      cached_results: () => [result(A, [branch(A.path, "x", { verdict: "Blocked" })])],
      restore_branch: () => {
        throw { code: "AlreadyRestored", detail: "" };
      },
      purge_backups: () => 2,
      checkout_default: () => "main",
      rescan_repo: () => result(A, [branch(A.path, "x")]),
    });
    await store.restore(["nope"]);
    expect(store.toasts.at(-1)?.text).toBe("Wurde bereits wiederhergestellt.");
    await store.purge(["a", "b"]);
    expect(store.toasts.at(-1)?.kind).toBe("info");
    await store.checkoutAndDelete(store.allBranches[0]);
    expect(store.deleteJob?.force).toBe(false);
    backend.handlers.checkout_default = () => {
      throw { code: "WorkingTreeDirty", detail: "" };
    };
    expect(await store.checkoutDefault(A.path)).toBe(false);
    backend.handlers.purge_backups = () => {
      throw "denied";
    };
    await store.purge(["a"]);
    expect(store.toasts.at(-1)?.text).toBe("denied");
  });
});
