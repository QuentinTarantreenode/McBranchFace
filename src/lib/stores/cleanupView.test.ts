// @vitest-environment jsdom
// The cleanup table: what it selects and shows, filters, sorting, marks, groups and the lenses of the bell.
import { describe, expect, it, vi } from "vitest";
import { LENSES, lensKeys } from "$lib/alerts";
import { branchKey, onlineKey } from "$lib/filter";
import { branch, config, remote, repo, result } from "../../test/backend";
import { backend, savedConfigs, start, store, storeTests } from "../../test/store";
import { waitFor } from "../../test/wait";

// Only the menu helpers need icons; loading the whole icon package would dominate the run time.
vi.mock("@lucide/svelte", () => ({ Eye: {}, EyeOff: {} }));

const A = repo("C:/ws/a");
const B = repo("C:/ws/b");

storeTests();

describe("table", () => {
  const two = () => [result(A, [branch(A.path, "safe"), branch(A.path, "risky", { verdict: "Unsafe" })])];

  it("selects what needs attention first and moves with the keyboard", async () => {
    await start({ cached_results: two });
    expect(store.selected?.name).toBe("risky");
    expect(store.rows.map((b) => b.name)).toEqual(["safe", "risky"]);
    store.moveSelection(-1);
    expect(store.selected?.name).toBe("safe");
    store.moveSelection(5);
    expect(store.selected?.name).toBe("risky");
    store.selectKey(null);
    store.moveSelection(1);
    expect(store.selected?.name).toBe("safe");
  });

  it("filters, sorts and resets", async () => {
    await start({ cached_results: two });
    store.toggleVerdict("Safe");
    expect(store.visible.map((b) => b.name)).toEqual(["safe"]);
    store.toggleVerdict("Safe");
    store.setSort("name");
    expect(store.visible.map((b) => b.name)).toEqual(["risky", "safe"]);
    store.setSort("name");
    expect(store.sort.dir).toBe(-1);
    store.toggleOnlineVerdict("Merged");
    store.toggleOnlineVerdict("Merged");
    store.filters.search = "zzz";
    store.resetFilters();
    expect(store.filters.search).toBe("");
  });

  it("shows orphaned branches first; the switch brings the others and is remembered, alerts stay on the orphaned", async () => {
    const mixed = () => [
      result(A, [
        branch(A.path, "gone"),
        branch(A.path, "alive", { upstreamState: "Live" }),
        branch(A.path, "never", { upstreamState: "None", verdict: "Unsafe" }),
      ]),
    ];
    await start({ cached_results: mixed });
    expect(store.orphanedOnly).toBe(true);
    expect(store.visible.map((b) => b.name)).toEqual(["gone"]);
    expect(store.counts.Unsafe).toBe(0);
    const bell = store.bellCount;

    store.setUi({ orphanedOnly: false });
    expect(store.visible.map((b) => b.name).sort()).toEqual(["alive", "gone", "never"]);
    expect(store.counts.Unsafe).toBe(1);
    expect(store.bellCount).toBe(bell);
    // A remembered view setting: a filter reset leaves it alone, the config carries it.
    store.resetFilters();
    expect(store.orphanedOnly).toBe(false);
    await waitFor(() => expect(savedConfigs().at(-1)?.ui.orphanedOnly).toBe(false));

    // A lens says where its branches stand on the server; opening it sets the switch to match.
    const { LENSES } = await import("$lib/alerts");
    store.applyLens(LENSES.find((l) => l.id === "localSafe")!);
    expect(store.orphanedOnly).toBe(true);
    store.applyLens(LENSES.find((l) => l.id === "localForgotten")!);
    expect(store.orphanedOnly).toBe(false);
    expect(store.filters.ages).toEqual(["quarter", "older"]);
  });

  it("fast-forwards a branch and reassesses its repo; a refusal says why", async () => {
    const behind = branch(A.path, "alive", { upstreamState: "Live", behind: 2 });
    let refuse = false;
    await start({
      cached_results: () => [result(A, [behind])],
      git_fast_forward: () => {
        if (refuse) throw { kind: "Diverged", op: "FastForward", detail: "alive has commits", path: null, changed: false };
        return { sha: "b".repeat(40), warning: null, backup: null };
      },
      rescan_repo: () => result(A, [{ ...behind, behind: 0 }]),
    });
    await store.fastForward(behind);
    expect(backend.called("git_fast_forward")).toEqual([{ path: A.path, branch: "alive" }]);
    expect(store.allBranches[0].behind).toBe(0);
    expect(store.toasts.at(-1)?.kind).toBe("success");

    refuse = true;
    await store.fastForward(behind);
    expect(store.toasts.at(-1)?.text).toBe("Branch ist auseinandergelaufen");
  });

  it("opens a lens with its exact filter", async () => {
    await start({ cached_results: two });
    store.applyLens({ id: "onlineMerged", scope: "Online", verdicts: [], onlineVerdicts: ["Merged"], onlyMine: true, pref: "onlineMerged" });
    expect(store.scope).toBe("Online");
    expect(store.filters.onlyMine).toBe(true);
  });

  it("opens the never-pushed lens on exactly the branches it counts", async () => {
    const old = Math.floor(Date.now() / 1000) - 200 * 86400;
    const at = (name: string, upstreamState: "None" | "Live" | "Gone") =>
      branch(A.path, name, { verdict: "Unsafe", upstreamState, lastCommitAt: old });
    await start({ cached_results: () => [result(A, [at("never", "None"), at("live-ahead", "Live"), at("gone-ahead", "Gone")])] });
    const lens = LENSES.find((l) => l.id === "localForgotten")!;
    expect(lensKeys(lens, store.allBranches, [])).toEqual(["C:/ws/a::never"]);
    store.applyLens(lens);
    expect(store.visible.map((b) => b.name)).toEqual(["never"]);
  });

  it("marks and unmarks rows", async () => {
    await start({ cached_results: two });
    store.toggleChecked("C:/ws/a::safe");
    expect(store.checkedSafe.map((b) => b.name)).toEqual(["safe"]);
    store.toggleChecked("C:/ws/a::safe");
    expect(store.checkedSafe).toEqual([]);
  });

  it("deletes only marked rows the filter still shows", async () => {
    await start({ cached_results: two });
    store.toggleChecked("C:/ws/a::safe");
    // Filtered to another repo: the marked row is out of sight, so "delete marked" must not take it.
    store.filters.repos = ["C:/ws/b"];
    expect(store.checkedSafe).toEqual([]);
    store.filters.repos = [];
    expect(store.checkedSafe.map((b) => b.name)).toEqual(["safe"]);
  });

  it("keeps folded sections out of keyboard navigation", async () => {
    await start({
      get_config: () => config({ locks: [{ identity: A.identity, branch: "c" }], ignores: [{ identity: A.identity, branch: "b", scope: "Local", until: null }] }),
      cached_results: () => [result(A, [branch(A.path, "a"), branch(A.path, "b"), branch(A.path, "c")])],
    });
    expect(store.rows.map((b) => b.name)).toEqual(["a"]);
    store.sectionOpen.ignored = true;
    store.sectionOpen.locked = true;
    expect(store.rows.map((b) => b.name)).toEqual(["a", "b", "c"]);
  });

  it("switches scope and selects there", async () => {
    await start({ cached_results: () => [result(A, [branch(A.path, "a")], [remote(A.path, "m", { merged: false, openPr: true }), remote(A.path, "n")])] });
    store.setScope("Online");
    expect(store.selectedOnline?.name).toBe("n");
    store.setScope("Online");
    store.moveSelection(1);
    expect(store.selectedOnline).not.toBeNull();
  });
});

describe("groups", () => {
  it("group the table rows and skip folded groups in keyboard navigation", async () => {
    const T = repo("D:/tools/T", { root: "D:/tools" });
    await start({ cached_results: () => [result(A, [branch(A.path, "a1"), branch(A.path, "a2")]), result(T, [branch(T.path, "t1")])] });
    store.setUi({ tableGroup: "Folder" });
    expect(store.grouped(store.visible).map((g) => [g.label, g.items.length])).toEqual([["C:/ws", 2], ["D:/tools", 1]]);
    store.toggleGroup("Folder:C:/ws");
    expect(store.rows.map((b) => b.name)).toEqual(["t1"]);
    store.toggleGroup("Folder:C:/ws");
    store.setUi({ tableGroup: "Repo" });
    expect(store.groupLabelOf(A.identity, "Repo")).toBe("a");
    expect(store.groupLabelOf("", "Folder")).toBe("Sonstige");
    (await import("$lib/stores/fold.svelte")).fold.toggle("roots", "C:/ws");
    expect(store.config?.ui.collapsedRoots).toEqual(["C:/ws"]);
    (await import("$lib/stores/fold.svelte")).fold.toggle("roots", "C:/ws");
    expect(store.config?.ui.collapsedRoots).toEqual([]);
  });

  it("group by branch name: one feature across repositories in one group", async () => {
    await start({
      cached_results: () => [
        result(A, [branch(A.path, "feature/x"), branch(A.path, "only-a")]),
        result(B, [branch(B.path, "feature/x", { verdict: "Unsafe" })]),
      ],
    });
    store.setUi({ tableGroup: "Name" });
    const groups = store.grouped(store.visible).map((g) => [g.label, g.items.map((b) => b.repoPath).sort()]);
    // The shared name first, whatever the sort of the table says.
    expect(groups).toEqual([
      ["feature/x", [A.path, B.path]],
      // A name in one repo only gets no header of its own: those share one last group.
      ["Nur in einem Repo", [A.path]],
    ]);
    store.setSort("name");
    store.setSort("name");
    expect(store.grouped(store.visible)[0].label).toBe("feature/x");
  });
});

describe("steady lists", () => {
  it("the clock tick keeps the server list as it is while no verdict changes", async () => {
    const now = Math.floor(Date.now() / 1000);
    await start({ cached_results: () => [result(A, [], [remote(A.path, "fresh", { merged: false, lastCommitAt: now }), remote(A.path, "old", { merged: false, lastCommitAt: now - 400 * 86400 })])] });
    const first = store.allOnline;
    store.now += 30;
    expect(store.allOnline).toBe(first);
    // Crossing the threshold changes one verdict: only that branch gets a new object.
    store.now += 31 * 86400;
    const next = store.allOnline!;
    expect(next).not.toBe(first);
    expect(next.find((b) => b.name === "old")).toBe(first!.find((b) => b.name === "old"));
  });
});

describe("lenses and sections", () => {
  it("counts on the bell exactly the rows a lens opens", async () => {
    const now = Math.floor(Date.now() / 1000);
    await start({
      get_config: () =>
        config({
          locks: [{ identity: A.identity, branch: "held" }],
          alerts: { enabled: true, notify: false, localSafe: true, localReview: true, onlineMerged: true, onlineInactive: true, localForgotten: true },
        }),
      cached_results: () => [
        result(
          A,
          [
            branch(A.path, "safe"),
            branch(A.path, "review", { verdict: "Review" }),
            branch(A.path, "held"),
            branch(A.path, "live", { upstreamState: "Live" }),
            branch(A.path, "forgotten", { verdict: "Unsafe", upstreamState: "None" }),
            branch(A.path, "fresh", { verdict: "Unsafe", upstreamState: "None", lastCommitAt: now }),
          ],
          [
            remote(A.path, "merged"),
            remote(A.path, "mergedOther", { isMine: false }),
            remote(A.path, "inactive", { merged: false }),
            remote(A.path, "inactiveOther", { merged: false, isMine: false }),
            remote(A.path, "active", { merged: false, lastCommitAt: now }),
          ],
        ),
      ],
    });
    for (const lens of LENSES) {
      store.applyLens(lens);
      const rows = lens.scope === "Local" ? store.visible.map(branchKey) : store.onlineVisible.map(onlineKey);
      expect(rows.length, lens.id).toBeGreaterThan(0);
      expect([...(store.lensKeysById.get(lens.id) ?? [])].sort(), lens.id).toEqual([...rows].sort());
      expect(store.lensCounts.get(lens.id), lens.id).toBe(rows.length);
    }
  });

  it("remembers which sections of the table are open, with the layout", async () => {
    await start({ cached_results: () => [result(A)] });
    expect(store.sectionOpen).toMatchObject({ ignored: false, locked: false });
    store.sectionOpen.ignored = true;
    expect(store.config?.ui.collapsed.tableSections).toEqual(["ignored"]);
    expect(store.sectionOpen).toMatchObject({ ignored: true, locked: false });
    store.sectionOpen = { ignored: false, locked: true };
    expect(store.config?.ui.collapsed.tableSections).toEqual(["locked"]);
  });
});
