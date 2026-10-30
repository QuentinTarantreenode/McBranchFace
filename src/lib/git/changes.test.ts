import { describe, expect, it } from "vitest";
import type { StatusEntry } from "$lib/bindings/StatusEntry";
import { byDirectory, groupChanges, Lru, partlyStaged, splitPath } from "./changes";

const e = (over: Partial<StatusEntry>): StatusEntry => ({
  path: "a.txt",
  origPath: null,
  staged: null,
  unstaged: null,
  conflicted: false,
  untracked: false,
  ...over,
});

describe("groupChanges", () => {
  it("splits partly staged files into both groups and orders groups by urgency", () => {
    const g = groupChanges([
      e({ path: "z.rs", unstaged: "Modified" }),
      e({ path: "b.rs", staged: "Modified", unstaged: "Modified" }),
      e({ path: "new.txt", untracked: true }),
      e({ path: "c.txt", conflicted: true }),
    ]);
    expect(g.map((x) => x.id)).toEqual(["conflicts", "staged", "unstaged", "untracked"]);
    expect(g[1].rows.map((r) => r.path)).toEqual(["b.rs"]);
    expect(g[2].rows.map((r) => r.path)).toEqual(["b.rs", "z.rs"]);
    expect(g[3].rows[0].source).toBe("Untracked");
  });

  it("filters by path text", () => {
    const g = groupChanges([e({ path: "src/App.svelte", unstaged: "Modified" }), e({ path: "README.md", untracked: true })], "app");
    expect(g.flatMap((x) => x.rows.map((r) => r.path))).toEqual(["src/App.svelte"]);
  });

  it("omits empty groups", () => {
    expect(groupChanges([])).toEqual([]);
  });

  it("splits paths for display", () => {
    expect(splitPath("src/lib/a.ts")).toEqual({ dir: "src/lib/", name: "a.ts" });
    expect(splitPath("a.ts")).toEqual({ dir: "", name: "a.ts" });
  });
});

describe("Lru", () => {
  it("evicts the least recently used entry", () => {
    const c = new Lru<number>(2);
    c.set("a", 1);
    c.set("b", 2);
    c.get("a");
    c.set("c", 3);
    expect(c.get("b")).toBeUndefined();
    expect(c.get("a")).toBe(1);
    expect(c.get("c")).toBe(3);
  });
});

describe("byDirectory and partlyStaged", () => {
  it("puts top-level files first, then each directory once, in order", () => {
    const rows = groupChanges([e({ path: "src/b.ts", unstaged: "Modified" }), e({ path: "a.md", unstaged: "Modified" }), e({ path: "lib/x.ts", unstaged: "Added" }), e({ path: "src/a.ts", unstaged: "Modified" })])[0].rows;
    expect(byDirectory(rows).map((d) => [d.dir, d.rows.map((r) => r.path)])).toEqual([
      ["", ["a.md"]],
      ["lib/", ["lib/x.ts"]],
      ["src/", ["src/a.ts", "src/b.ts"]],
    ]);
  });

  it("names the files with a staged and an unstaged part", () => {
    const set = partlyStaged([e({ path: "both", staged: "Modified", unstaged: "Modified" }), e({ path: "one", staged: "Added" }), e({ path: "c", staged: "Modified", unstaged: "Modified", conflicted: true })]);
    expect([...set]).toEqual(["both"]);
  });
});
