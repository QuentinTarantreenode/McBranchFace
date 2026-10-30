import { describe, expect, it } from "vitest";
import { borrowedWorktrees, folderLabel, groupId, groupRows, NO_ROOT, sidebarGroups } from "./groups";

const repo = (path: string, root: string, verdicts: string[] = [], locked: boolean[] = [], live: boolean[] = []) => ({
  info: { path, name: path.split("/").pop()!, root },
  result: { branches: verdicts.map((verdict, i) => ({ verdict, locked: locked[i] ?? false, upstreamState: live[i] ? ("Live" as const) : ("Gone" as const) })) },
});

describe("sidebar groups", () => {
  const repos = [
    // The fourth is still on the server: the badge counts orphaned branches only.
    repo("C:/ws/a/Core", "C:/ws/a", ["Safe", "Unsafe", "Safe", "Unsafe"], [false, false, true, false], [false, false, false, true]),
    repo("C:/ws/a/Tools", "C:/ws/a"),
    repo("D:/other/x", "D:/other/"),
    { info: { path: "E:/loose", name: "loose", root: "" }, result: null },
  ];

  it("group by root with counts of repos, gone branches and Unsafe ones", () => {
    const g = sidebarGroups(repos, "", new Set([]), "Other");
    expect(g.map((x) => [x.label, x.total, x.gone, x.unsafe, x.open])).toEqual([
      ["ws/a", 2, 2, 1, true],
      ["D:/other", 1, 0, 0, true],
      ["Other", 1, 0, 0, true],
    ]);
  });

  it("key the group without a root apart from its label", () => {
    const loose = sidebarGroups(repos, "", new Set([NO_ROOT]), "Other").at(-1)!;
    expect([loose.root, loose.label, loose.open]).toEqual([NO_ROOT, "Other", false]);
    expect(sidebarGroups(repos, "", new Set([]), "Andere").at(-1)!.root).toBe(NO_ROOT);
  });

  it("count an ignored gone branch as little as the bell and the table do", () => {
    const r = repo("C:/ws/b/Core", "C:/ws/b", ["Safe", "Unsafe"]);
    (r.result.branches[1] as { ignored?: boolean }).ignored = true;
    expect(sidebarGroups([r], "", new Set([]), "Other").map((x) => [x.gone, x.unsafe])).toEqual([[1, 0]]);
  });

  it("keep folded groups folded, but a search opens every group with a hit", () => {
    expect(sidebarGroups(repos, "", new Set(["C:/ws/a"]), "Other")[0].open).toBe(false);
    const found = sidebarGroups(repos, "tools", new Set(["C:/ws/a"]), "Other");
    expect(found.map((x) => [x.label, x.repos.length, x.total, x.open])).toEqual([["ws/a", 1, 2, true]]);
  });

  it("follow the configured order, list empty roots, and put repos without a root last", () => {
    const g = sidebarGroups(repos, "", new Set([]), "Other", ["D:\\other", "C:\\ws\\empty", "C:\\ws\\a"]);
    expect(g.map((x) => [x.label, x.total])).toEqual([["D:/other", 1], ["ws/empty", 0], ["ws/a", 2], ["Other", 1]]);
    expect(sidebarGroups(repos, "core", new Set([]), "Other", ["C:\\ws\\empty"]).map((x) => x.label)).toEqual(["ws/a"]);
  });

  it("label folders by their last two segments", () => {
    expect(folderLabel("C:\\Projects\\Acme_Platform\\")).toBe("Projects/Acme_Platform");
    expect(folderLabel("/home/me")).toBe("home/me");
  });
});

describe("table groups", () => {
  const rows = [
    { repoPath: "a1", name: "x" },
    { repoPath: "b", name: "y" },
    { repoPath: "a2", name: "z" },
  ];
  const keyOf = (r: { repoPath: string }) => r.repoPath.slice(0, 1);
  const labelOf = (k: string) => k.toUpperCase();

  it("keep the table's order within groups and groups in order of first appearance", () => {
    const g = groupRows(rows, "Repo", keyOf, labelOf, new Set());
    expect(g.map((x) => [x.label, x.items.map((r) => r.name), x.open])).toEqual([
      ["A", ["x", "z"], true],
      ["B", ["y"], true],
    ]);
  });

  it("fold groups by id and pass everything through without grouping", () => {
    expect(groupRows(rows, "Folder", keyOf, labelOf, new Set([groupId("Folder", "a")]))[0].open).toBe(false);
    expect(groupRows(rows, "Repo", keyOf, labelOf, new Set([groupId("Folder", "a")]))[0].open).toBe(true);
    expect(groupRows(rows, "None", keyOf, labelOf, new Set())).toEqual([{ key: "", label: "", items: rows, open: true }]);
  });
});

describe("worktrees in another folder", () => {
  it("shows a folder of linked worktrees with them, not empty, while the repo stays under its own folder", () => {
    const repo = (path: string, root: string) => ({ info: { path, name: path.split("/").pop()!, root }, result: null });
    const core = repo("C:/ws/Acme26/Core", "C:/ws/Acme26");
    const shop = repo("C:/ws/Acme26/Shop", "C:/ws/Acme26");
    const wt = (path: string, over = {}) => ({ path, branch: "feature/x", head: "abc", isMain: false, foreign: false, unreferenced: 0, ...over });
    const lists = new Map([
      [core, [wt("C:/ws/Acme26/Core", { isMain: true }), wt("C:/ws/Northwind/Core"), wt("C:/ws/Acme26/Core-agent")]],
      [shop, [wt("C:/ws/Northwind/Shop"), wt("C:/ws/Northwind/Copied", { foreign: true })]],
    ]);
    const found = borrowedWorktrees("C:/ws/Northwind", [core, shop], (r) => lists.get(r) ?? []);
    expect(found.map((w) => [w.owner.info.name, w.path]).sort()).toEqual([["Core", "C:/ws/Northwind/Core"], ["Shop", "C:/ws/Northwind/Shop"]]);
    // A worktree next to its repo stays under the repo's card only.
    expect(borrowedWorktrees("C:/ws/Acme26", [core, shop], (r) => lists.get(r) ?? [])).toEqual([]);
  });
});
