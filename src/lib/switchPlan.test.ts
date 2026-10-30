import { describe, expect, it } from "vitest";
import type { BranchList } from "$lib/bindings/BranchList";
import type { BranchRow } from "$lib/bindings/BranchRow";
import { companions, mergeLists, runnable, stepFor, switchItems } from "./switchPlan";

const row = (name: string, over: Partial<BranchRow> = {}): BranchRow => ({
  name, fullRef: `refs/heads/${name}`, sha: "s", upstream: null, ahead: 0, behind: 0, gone: false, isHead: false, worktreePath: null, committedAt: 0, subject: "", author: "", isMine: false, ...over,
});
const list = (local: BranchRow[], remote: string[] = []): BranchList => ({ local, remote: remote.map((r) => row(r)) });

describe("switch plan", () => {
  it("filters the dropdown by local, server and own branches, with counts that follow the search", () => {
    const l: BranchList = {
      local: [row("main", { isHead: true }), row("feature/mine", { isMine: true }), row("feature/a")],
      remote: [row("origin/main"), row("origin/feature/srv-mine", { isMine: true }), row("origin/feature/srv")],
    };
    const names = (scope: Parameters<typeof switchItems>[2], q = "") => switchItems(l, q, scope).items.map((i) => i.remote ?? i.name);
    expect(names("all")).toEqual(["main", "feature/mine", "feature/a", "origin/feature/srv-mine", "origin/feature/srv"]);
    expect(names("local")).toEqual(["main", "feature/mine", "feature/a"]);
    expect(names("remote")).toEqual(["origin/feature/srv-mine", "origin/feature/srv"]);
    expect(names("mine")).toEqual(["feature/mine", "origin/feature/srv-mine"]);
    expect(switchItems(l, "srv", "local").counts).toEqual({ all: 2, local: 0, remote: 2, mine: 1, partial: 0 });
    // A new name is offered whatever the scope; an existing one never twice.
    expect(switchItems(l, "feature/new", "mine").items.map((i) => i.create)).toEqual([true]);
    expect(switchItems(l, "feature/srv", "local").items).toEqual([]);
  });

  it("tells current, local, server, new and checked out elsewhere apart", () => {
    const l = list([row("main", { isHead: true }), row("feature/a"), row("feature/wt", { worktreePath: "C:/wt" })], ["origin/feature/srv", "origin/team/release/x"]);
    expect(stepFor("r", "main", l).kind).toBe("current");
    expect(stepFor("r", "feature/a", l).kind).toBe("local");
    expect(stepFor("r", "feature/srv", l)).toMatchObject({ kind: "remote", ref: "origin/feature/srv" });
    // Namespaced names keep their slashes after the remote.
    expect(stepFor("r", "team/release/x", l)).toMatchObject({ kind: "remote", ref: "origin/team/release/x" });
    expect(stepFor("r", "feature/wt", l)).toMatchObject({ kind: "elsewhere", elsewhere: "C:/wt" });
    expect(stepFor("r", "feature/new", l).kind).toBe("create");
    expect(["current", "elsewhere"].map((kind) => runnable({ path: "r", kind: kind as never, ref: "", elsewhere: null }))).toEqual([false, false]);
  });

  it("offers the repos that have the branch, and for a new one only the marked repos, marked first", () => {
    const lists = {
      here: list([row("feature/x", { isHead: true })]),
      a: list([row("main")], ["origin/feature/x"]),
      b: list([row("feature/x")]),
      c: list([row("main")]),
      d: list([row("main")]),
    };
    const offered = companions("feature/x", "here", lists, ["b", "d"]);
    expect(offered.map((o) => [o.step.path, o.step.kind, o.preselected])).toEqual([
      ["b", "local", true],
      ["d", "create", true],
      ["a", "remote", false],
    ]);
  });

  it("does not preselect a marked repo that cannot switch", () => {
    const lists = { here: list([]), a: list([row("feature/x", { worktreePath: "C:/a-wt" })]) };
    expect(companions("feature/x", "here", lists, ["a"])).toEqual([{ step: expect.objectContaining({ kind: "elsewhere" }), preselected: false }]);
  });
});

describe("switching a group", () => {
  it("lists every branch once, counts the repos that have it and is current only where all stand on it", () => {
    const { list: merged, have } = mergeLists([
      list([row("main", { isHead: true, ahead: 2 }), row("feature/a")], ["origin/main", "origin/feature/b"]),
      list([row("main"), row("feature/a", { isHead: true, worktreePath: "/wt" })], ["origin/main"]),
    ]);
    expect(merged.local.map((b) => [b.name, b.isHead, b.ahead, b.worktreePath])).toEqual([["main", false, 0, null], ["feature/a", false, 0, null]]);
    expect(merged.remote.map((b) => b.name)).toEqual(["origin/main", "origin/feature/b"]);
    expect(Object.fromEntries(have)).toEqual({ main: 2, "feature/a": 2, "feature/b": 1 });
    const both = mergeLists([list([row("main", { isHead: true })]), list([row("main", { isHead: true })])]);
    expect(both.list.local[0].isHead).toBe(true);
  });
});
