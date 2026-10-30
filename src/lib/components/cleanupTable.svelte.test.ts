// @vitest-environment jsdom
// The cleanup table: sections, groups, filters by tag, prefix and column, the column layout, the search
// field and the tooltip of a row.
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/svelte";
import { tick } from "svelte";
import { store } from "$lib/store.svelte";
import { menu } from "$lib/ui/menu.svelte";
import { branch, config, result } from "../../test/backend";
import { A, A2, backend, start, startApp } from "../../test/views";
import { waitFor } from "../../test/wait";
import BranchTable from "./BranchTable.svelte";
import { branchTip } from "./branchTip";

vi.mock("@lucide/svelte", async () => (await import("../../test/icons")).iconModule());

const items = (m: { current: { entries: unknown[] } | null }) =>
  m.current!.entries.filter((e) => typeof e === "object" && e !== null && "run" in (e as object)) as { label: string; checked?: boolean; submenu?: unknown[]; run: () => void }[];

describe("BranchTable", () => {
  it("shows ignored and locked sections folded, with their counts, and unfolds them", async () => {
    await startApp({
      get_config: () => config({ language: "En", locks: [{ identity: A.identity, branch: "c" }], ignores: [{ identity: A.identity, branch: "b", scope: "Local", until: null }] }),
      cached_results: () => [result(A, [branch(A.path, "a"), branch(A.path, "b"), branch(A.path, "c")])],
    });
    store.setAnnotation(A.path, "a", { note: "note text", tags: ["t1", "t2", "t3"] });
    render(BranchTable);
    await tick();
    // Name and upstream both show the branch: count rows by any match.
    expect(screen.queryAllByText("b")).toHaveLength(0);
    const ignored = screen.getByRole("button", { name: /Ignored/ });
    expect(ignored.textContent).toContain("1");
    await fireEvent.click(ignored);
    await fireEvent.click(screen.getByRole("button", { name: /Locked/ }));
    await tick();
    expect(screen.getAllByText("b").length).toBeGreaterThan(0);
    expect(screen.getAllByText("c").length).toBeGreaterThan(0);
    // Up to two tag pills, the rest as "+n".
    expect(screen.getByText("+1")).toBeTruthy();
  });

  it("filters by tag through the menu and shows the active tags", async () => {
    await startApp({ cached_results: () => [result(A, [branch(A.path, "a"), branch(A.path, "b")])] });
    store.setAnnotation(A.path, "a", { note: "", tags: ["qa"] });
    render(BranchTable);
    await tick();
    await fireEvent.click(screen.getByRole("button", { name: /Tags/ }));
    // The table menus load their code on first open.
    await waitFor(() => expect(menu.current).not.toBeNull());
    const entry = menu.current!.entries[0] as { run: () => void };
    entry.run();
    await tick();
    expect(store.filters.tags).toEqual(["qa"]);
    expect(screen.queryByText("b")).toBeNull();
    await fireEvent.click(screen.getByRole("button", { name: "Remove tag qa" }));
    expect(store.filters.tags).toEqual([]);
  });

  it("says why the Delete key does not delete the branch checked out in the main worktree", async () => {
    const current = branch(A.path, "current", { verdict: "Blocked", worktree: { path: A.path, isMain: true, files: [] } });
    await startApp({ cached_results: () => [result(A, [current])] });
    render(BranchTable);
    await tick();
    store.selectKey(`${A.path}::current`);
    await tick();
    await fireEvent.keyDown(screen.getByRole("listbox"), { key: "Delete" });
    expect(store.deleteJob).toBeNull();
    expect(store.toasts.at(-1)?.text).toBe("Current branch");
  });

  it("table groups by repo with a header that marks and folds its group", async () => {
    await start({
      get_config: () => config({ language: "En" }),
      cached_results: () => [result(A, [branch(A.path, "s1"), branch(A.path, "s2"), branch(A.path, "u", { verdict: "Unsafe" })])],
    });
    render(BranchTable);
    await tick();
    await fireEvent.click(screen.getByRole("button", { name: /Group/ }));
    (menu.current!.entries.find((e) => typeof e === "object" && "label" in e && e.label === "Repo") as { run: () => void }).run();
    await tick();
    const mark = screen.getByRole("checkbox", { name: /Mark every deletable branch in a/ });
    await fireEvent.click(mark);
    expect(store.checkedSafe.map((b) => b.name).sort()).toEqual(["s1", "s2"]);
    await fireEvent.click(screen.getByRole("button", { name: /^a/, expanded: true }));
    await tick();
    expect(screen.queryByText("s1")).toBeNull();
    expect(store.rows).toEqual([]);
  });

  it("prefix menu counts what the other filters leave and filters the table", async () => {
    await start({
      cached_results: () => [result(A, [branch(A.path, "feature/a"), branch(A.path, "feature/b"), branch(A.path, "bugfix/c"), branch(A.path, "main")])],
      get_config: () => config({ language: "En" }),
    });
    expect(store.prefixCounts).toEqual([{ prefix: "feature", count: 2 }, { prefix: "bugfix", count: 1 }, { prefix: null, count: 1 }]);
    render(BranchTable);
    await tick();
    await fireEvent.click(screen.getByRole("button", { name: /Prefixes/ }));
    await waitFor(() => expect(menu.current).not.toBeNull());
    const prefixes = menu.current!.entries.filter((e) => typeof e === "object" && "run" in e) as { label: string; count: number; bar: { ratio: number }; run: () => void }[];
    expect(prefixes.map((i) => [i.label, i.count, i.bar.ratio])).toEqual([["feature", 2, 1], ["bugfix", 1, 0.5], ["no prefix", 1, 0.5]]);
    prefixes[1].run();
    await tick();
    expect(store.filters.prefixes).toEqual(["bugfix"]);
    expect(store.visible.map((b) => b.name)).toEqual(["bugfix/c"]);
    // The counts ignore the prefix filter itself, so the other choices stay visible.
    expect(store.prefixCounts).toHaveLength(3);
    await fireEvent.click(screen.getByRole("button", { name: "Remove prefix bugfix" }));
    expect(store.filters.prefixes).toEqual([]);
  });
});

describe("table grid", () => {
  it("header menu filters by a column, hides, moves and groups columns; the layout is saved per scope", async () => {
    await start({
      cached_results: () => [
        result(A, [branch(A.path, "feature/a", { lastCommitAuthor: "me@example.com" }), branch(A.path, "bugfix/b", { lastCommitAuthor: "you@example.com" })]),
        result(A2, [branch(A2.path, "feature/c")]),
      ],
      get_config: () => config({ language: "En" }),
    });
    render(BranchTable);
    await tick();
    const head = (label: string) => screen.getAllByRole("columnheader").find((h) => h.textContent?.includes(label))!;
    // The table menus load their code on first open.
    const openOn = async (el: HTMLElement) => {
      menu.close(false);
      await fireEvent.contextMenu(el);
      await waitFor(() => expect(menu.current).not.toBeNull());
    };
    expect(screen.getAllByRole("columnheader").map((h) => h.textContent?.trim().split(/\s/)[0])).toEqual(["Status", "Branch", "Repo", "Author", "Commit", "PR"]);

    await openOn(head("Repo"));
    const filter = items(menu).find((i) => i.label === "Filter")!;
    const values = filter.submenu as { label: string; count: number; run: () => void }[];
    expect(values.map((v) => v.count).sort()).toEqual([1, 2]);
    values.find((v) => v.count === 1)!.run();
    await tick();
    expect(store.filters.repos).toEqual([A2.path]);
    expect(store.visible.map((b) => b.name)).toEqual(["feature/c"]);
    expect(screen.getByRole("button", { name: /Remove filter Repo/ })).toBeTruthy();
    store.filters.repos = [];

    await openOn(head("Commit"));
    items(menu).find((i) => i.label === "Move left")!.run();
    await tick();
    expect(store.columns.filter((c) => c.visible).map((c) => c.id)).toEqual(["status", "branch", "repo", "commit", "author", "pr"]);
    await openOn(head("PR"));
    // Hiding is one of the tiles at the top of the menu.
    const tiles = menu.current!.entries.find((e): e is { tiles: { label: string; run: () => unknown }[] } => typeof e === "object" && "tiles" in e)!.tiles;
    tiles.find((x) => x.label === "Hide column")!.run();
    await tick();
    expect(screen.getAllByRole("columnheader")).toHaveLength(5);
    await openOn(head("Branch"));
    items(menu).find((i) => i.label === "Group by this column")!.run();
    await tick();
    expect(store.tableGroup).toBe("Prefix");
    // Config writes are debounced: the layout arrives with the next quiet save.
    const saved = () => backend.called("save_config").at(-1)!.config as { ui: { tableLayout: { local: { id: string; visible: boolean }[]; online: unknown[] } } };
    await waitFor(() => expect(saved().ui.tableLayout.local.find((c) => c.id === "pr")?.visible).toBe(false));
    expect(saved().ui.tableLayout.online).toEqual([]);
    await openOn(head("Branch"));
    items(menu).find((i) => i.label === "Reset columns")!.run();
    await tick();
    expect(screen.getAllByRole("columnheader")).toHaveLength(6);
  });
});

describe("BranchTable search", () => {
  it("keeps what is typed and filters after a short pause", async () => {
    await startApp({ cached_results: () => [result(A, [branch(A.path, "feature/wip"), branch(A.path, "other")])] });
    render(BranchTable);
    await tick();
    const input = screen.getByLabelText("Branch, commit, author, #PR") as HTMLInputElement;
    await fireEvent.input(input, { target: { value: "wip" } });
    await tick();
    expect(input.value).toBe("wip");
    await waitFor(() => expect(store.filters.search).toBe("wip"));
    await tick();
    expect(screen.queryByText("other")).toBeNull();
    // Resetting the filters empties the field too.
    store.resetFilters();
    await tick();
    expect(input.value).toBe("");
  });

  it("keeps the last keystrokes when the view is left before the pause", async () => {
    await startApp({ cached_results: () => [result(A, [branch(A.path, "feature/wip")])] });
    const view = render(BranchTable);
    await tick();
    const input = screen.getByLabelText("Branch, commit, author, #PR") as HTMLInputElement;
    await fireEvent.input(input, { target: { value: "wi" } });
    await tick();
    view.unmount();
    expect(store.filters.search).toBe("wi");
  });
});

describe("branch tooltip", () => {
  it("says only what the row does not: the reason, the server, and what stands behind each flag", async () => {
    await start();
    const b = store.allBranches.find((x) => x.name === "x" && x.repoPath === A.path)!;
    const tip = await branchTip(b);
    // Name, repo, subject, author and tags are in the row; the tip does not repeat them.
    expect(tip.path).toBeUndefined();
    expect(tip.pills).toBeUndefined();
    expect(tip.title).toBe("Unpushed commits, changes in the worktree or a stash.");
    expect(tip.sections!.map((s) => s.title)).toEqual(["Server", "Evidence and PR", "1 commit after the last push", "1 dirty file", "1 stash"]);
    const server = tip.sections![0].rows!.map((r) => ("label" in r ? r.label : ""));
    expect(server).toContain("Deleted on the server");
    const values = (i: number) => tip.sections![i].rows!.map((r) => ("value" in r ? r.value : ""));
    expect([values(2), values(3), values(4)]).toEqual([["u1 local only"], ["f.txt"], ["wip"]]);
  });

  it("lists the local copies of a server branch, or says there is none", async () => {
    await start();
    const old = store.allOnline!.find((x) => x.name === "old")!;
    const tip = await branchTip(old);
    expect(tip.sections![0].title).toBe("Local copies");
    expect(tip.sections![0].rows!.map((r) => ("value" in r ? r.value : r[1]))).toEqual(["No local copy"]);
  });
});
