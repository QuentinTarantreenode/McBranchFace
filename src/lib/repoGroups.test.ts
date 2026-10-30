import { describe, expect, it } from "vitest";
import type { RepoGroup } from "./bindings/RepoGroup";
import type { RepoStatus } from "./bindings/RepoStatus";
import { newTo, nextGroupName, remoteTargets, withAdded, withGroup, withMoved, withRemoved, withRenamed, withoutGroup } from "./repoGroups";

const g = (id: string, paths: string[] = [], name = id): RepoGroup => ({ id, name, paths });
const status = (branch: string | null, upstream: string | null, ahead = 0): RepoStatus => ({
  path: "",
  head: { branch, oid: "abc", upstream, ahead, behind: 0, unreferenced: 0 },
  entries: [],
  worktrees: [],
  stashes: 0,
});

describe("repo groups", () => {
  it("add each folder once, however it is spelled, and one repo may be in several groups", () => {
    let list = withGroup([], g("a", [String.raw`C:\ws\core`, "c:/ws/core/"]));
    list = withGroup(list, g("b", [String.raw`C:\ws\core`]));
    list = withAdded(list, "a", ["C:/WS/CORE", String.raw`C:\ws\app`]);
    expect(list.map((x) => x.paths)).toEqual([[String.raw`C:\ws\core`, String.raw`C:\ws\app`], [String.raw`C:\ws\core`]]);
    expect(newTo(list[0], ["c:/ws/app", "C:/ws/web", "C:/ws/web/"])).toEqual(["C:/ws/web"]);
  });

  it("remove, rename, delete and reorder", () => {
    const list = [g("a", ["C:/ws/core", "C:/ws/app"]), g("b"), g("c")];
    expect(withRemoved(list, "a", [String.raw`C:\ws\core`])[0].paths).toEqual(["C:/ws/app"]);
    expect(withRenamed(list, "b", "  Backend ")[1].name).toBe("Backend");
    expect(withRenamed(list, "b", "  ")[1].name).toBe("b");
    expect(withoutGroup(list, "b").map((x) => x.id)).toEqual(["a", "c"]);
    expect(withMoved(list, "c", "a", false).map((x) => x.id)).toEqual(["c", "a", "b"]);
    expect(withMoved(list, "a", "b", true).map((x) => x.id)).toEqual(["b", "a", "c"]);
    expect(withMoved(list, "a", "x", true)).toBe(list);
  });

  it("name a new group with the first free number", () => {
    const name = (n: number) => `Gruppe ${n}`;
    expect(nextGroupName([], name)).toBe("Gruppe 1");
    expect(nextGroupName([g("a", [], "Gruppe 2")], name)).toBe("Gruppe 3");
    expect(nextGroupName([g("a", [], "Backend")], name)).toBe("Gruppe 2");
  });

  it("say before anything runs what fetch, pull and push would touch", () => {
    const t = remoteTargets(["/a", "/b", "/c", "/d", "/gone"], {
      "/a": status("main", "origin/main"),
      "/b": status("feature/x", "origin/feature/x", 2),
      "/c": status("feature/new", null),
      "/d": status(null, null),
    });
    expect(t.fetch).toEqual(["/a", "/b", "/c", "/d"]);
    expect(t.pull.map((x) => x.path)).toEqual(["/a", "/b"]);
    expect(t.push).toEqual([{ path: "/b", branch: "feature/x" }, { path: "/c", branch: "feature/new" }]);
    expect(t.skipped).toEqual([{ path: "/d", why: "detached" }, { path: "/gone", why: "missing" }]);
  });
});
