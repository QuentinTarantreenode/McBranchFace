import { describe, expect, it } from "vitest";
import type { StatusEntry } from "$lib/bindings/StatusEntry";
import { groupChanges } from "./changes";
import { allReposRows, oneRepoRows, type ChangesItem, type Openness } from "./changesList";

const entry = (path: string, over: Partial<StatusEntry> = {}): StatusEntry => ({ path, origPath: null, staged: null, unstaged: "Modified", conflicted: false, untracked: false, ...over });
const status = (path: string, entries: StatusEntry[]) => ({ path, head: { branch: "main", oid: null, upstream: null, ahead: 0, behind: 0, unreferenced: 0 }, entries, worktrees: [], stashes: 0 });
const block = (path: string, entries: StatusEntry[]) => ({ path, st: status(path, entries), groups: groupChanges(entries) });
const allOpen: Openness = { repo: () => true, folder: () => true, status: () => true, dir: () => true, clean: true };
/** Kind, guide lines outside and inside, identity piece, gap: what a row draws of the tree around it. */
const shape = (items: ChangesItem[]) => items.map((i) => [i.kind, i.outer, i.inner, i.id, i.gap].join(" "));

describe("the list of changes as rows", () => {
  it("one repo: its status groups along one identity line, from the first head to the last file", () => {
    const entries = [entry("a.ts"), entry("b.ts", { staged: "Added", unstaged: null })];
    expect(shape(oneRepoRows("C:/r", groupChanges(entries), entries, false, allOpen))).toEqual([
      "pad 0 0  0",
      "status 0 0 first 0",
      "file 0 1 mid 0",
      "status 0 0 mid 0",
      "file 0 1 last 0",
      "pad 0 0  0",
    ]);
  });

  it("by directory: the directories one step in, their files one more; a folded directory hides its files", () => {
    const entries = [entry("top.ts"), entry("src/a.ts"), entry("src/b.ts")];
    const open = { ...allOpen, dir: (k: string) => !k.endsWith("src/") };
    const rows = oneRepoRows("C:/r", groupChanges(entries), entries, true, allOpen);
    expect(rows.filter((r) => r.kind !== "pad").map((r) => [r.kind, r.inner])).toEqual([["status", 0], ["file", 1], ["dir", 1], ["file", 2], ["file", 2]]);
    expect(oneRepoRows("C:/r", groupChanges(entries), entries, true, open).filter((r) => r.kind === "file")).toHaveLength(1);
  });

  it("several repos by folder: the folder's guide outside each repo's line, gaps only between top-level blocks", () => {
    const a = block("C:/ws/a", [entry("x.ts")]);
    const b = block("C:/ws/b", [entry("y.ts")]);
    const p = { path: "C:/ws/p", st: undefined, groups: [] };
    const rows = allReposRows({ folders: [{ root: "C:/ws", changed: [a, b], pending: [p] }], changed: [a, b], pending: [p], clean: [block("C:/ws/c", [])] }, false, allOpen);
    expect(shape(rows)).toEqual([
      "pad 0 0  0",
      "folder 0 0  0",
      "repo 1 0 first 0",
      "status 1 1 mid 0",
      "file 1 2 last 0",
      "repo 1 0 first 0",
      "status 1 1 mid 0",
      "file 1 2 last 0",
      "pending 1 0 first 0",
      "skeleton 1 1 last 0.125",
      "cleanHead 0 0  0",
      "clean 0 1  0",
      "pad 0 0  0",
    ]);
    // What stays at the top while a row scrolls under it: its folder and its repo.
    const file = rows.findIndex((r) => r.kind === "file");
    expect([rows[file].folderAt, rows[file].repoAt]).toEqual([1, 2]);
    expect(rows.reduce((h, r) => h + r.height + r.gap, 0)).toBe(0.25 + 2 + 2 * (1.75 + 1.5 + 1.75) + 1.75 + 2.5 + 0.125 + 1.75 + 1.75 + 0.25);
  });

  it("several repos without folders: each repo a block of its own, a folded repo is a line of its own", () => {
    const a = block("C:/ws/a", [entry("x.ts")]);
    const b = block("C:/ws/b", [entry("y.ts")]);
    const open = { ...allOpen, repo: (p: string) => p !== a.path };
    expect(shape(allReposRows({ folders: null, changed: [a, b], pending: [], clean: [] }, false, open))).toEqual([
      "pad 0 0  0",
      "repo 0 0 only 0.125",
      "repo 0 0 first 0",
      "status 0 1 mid 0",
      "file 0 2 last 0",
      "pad 0 0  0",
    ]);
  });
});
