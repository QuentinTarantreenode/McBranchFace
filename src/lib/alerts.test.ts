import { describe, expect, it } from "vitest";
import type { AlertPrefs } from "./bindings/AlertPrefs";
import type { BranchReport } from "./bindings/BranchReport";
import type { RemoteBranchReport } from "./bindings/RemoteBranchReport";
import type { RepoResult } from "./bindings/RepoResult";
import { activeLenses, LENSES, lensKeys, newKeys } from "./alerts";
import { copyGroups, copyLabels, localCopies, siblingGone } from "./identity";

const local = (name: string, over: Partial<BranchReport> = {}) =>
  ({ repoPath: "C:/a", name, verdict: "Safe", upstreamState: "Gone", isMine: true, locked: false, ignored: false, ...over }) as BranchReport;
const online = (name: string, over: Partial<RemoteBranchReport> = {}) =>
  ({ repoPath: "C:/a", remote: "origin", name, verdict: "Merged", isMine: true, locked: false, ignored: false, ...over }) as RemoteBranchReport;
const lens = (id: string) => LENSES.find((l) => l.id === id)!;

describe("lenses", () => {
  it("count what they show and never locked branches", () => {
    const l = [local("a"), local("b", { verdict: "Review" }), local("c", { locked: true }), local("d", { ignored: true })];
    expect(lensKeys(lens("localSafe"), l, [])).toEqual(["C:/a::a"]);
    expect(lensKeys(lens("localReview"), l, [])).toEqual(["C:/a::b"]);
    const o = [online("x"), online("y", { verdict: "Inactive" }), online("z", { verdict: "Inactive", isMine: false })];
    expect(lensKeys(lens("onlineMerged"), [], o)).toEqual(["C:/a::online::x"]);
    expect(lensKeys(lens("onlineInactive"), [], o)).toEqual(["C:/a::online::y"]);
  });

  it("keep to where a branch stands on the server; forgotten means never pushed, unsafe and quiet for over a month", () => {
    const now = 1_800_000_000;
    const day = 86_400;
    const l = [
      local("live", { upstreamState: "Live" }),
      local("old", { upstreamState: "None", verdict: "Unsafe", lastCommitAt: now - 40 * day }),
      local("fresh", { upstreamState: "None", verdict: "Unsafe", lastCommitAt: now - 3 * day }),
      local("gone", { verdict: "Unsafe", lastCommitAt: now - 40 * day }),
    ];
    expect(lensKeys(lens("localSafe"), l, [], now), "a branch the server still has is no news").toEqual([]);
    expect(lensKeys(lens("localForgotten"), l, [], now)).toEqual(["C:/a::old"]);
  });

  it("follow the preferences", () => {
    const prefs: AlertPrefs = { enabled: true, notify: true, localSafe: true, localReview: false, onlineMerged: true, onlineInactive: false, localForgotten: false };
    expect(activeLenses(prefs).map((l) => l.id)).toEqual(["localSafe", "onlineMerged"]);
    expect(activeLenses({ ...prefs, enabled: false })).toEqual([]);
  });

  it("count an ignored branch again once its ignore ends", () => {
    const before = lensKeys(lens("localSafe"), [local("a", { ignored: true })], []);
    const after = lensKeys(lens("localSafe"), [local("a", { ignored: false })], []);
    expect(newKeys(new Set(before), after)).toEqual(["C:/a::a"]);
  });

  it("notify only about branches not seen before", () => {
    expect(newKeys(new Set(["a", "b"]), ["b", "c"])).toEqual(["c"]);
    expect(newKeys(new Set(), ["a"])).toEqual(["a"]);
    expect(newKeys(new Set(["a"]), [])).toEqual([]);
  });
});

describe("working copies", () => {
  it("group by identity and colour only real groups, deterministically", () => {
    const g = copyGroups([
      { path: "C:/b/core", identity: "x" },
      { path: "C:/a/core", identity: "x" },
      { path: "C:/solo", identity: "y" },
      { path: "C:/c", identity: "w" },
      { path: "C:/d", identity: "w" },
    ]);
    expect([...g.keys()]).toEqual(["w", "x"]);
    expect(g.get("x")).toMatchObject({ identity: "x", paths: ["C:/a/core", "C:/b/core"], color: "var(--id-1)" });
    expect(g.get("x")?.labels).toEqual({ "C:/a/core": "a", "C:/b/core": "b" });
    expect(g.has("y")).toBe(false);
  });

  it("label copies by the nearest folder that differs", () => {
    expect(copyLabels(["C:\\ws\\f1\\core", "C:\\ws\\f2\\core"])).toEqual({ "C:\\ws\\f1\\core": "f1", "C:\\ws\\f2\\core": "f2" });
    expect(copyLabels(["/a/x/src/core", "/b/x/src/core"])).toEqual({ "/a/x/src/core": "a/x/src", "/b/x/src/core": "b/x/src" });
    expect(copyLabels(["/w/core", "/w/core-2"])).toEqual({ "/w/core": "core", "/w/core-2": "core-2" });
    // A new copy next to one of two same-named ones keeps the short labels.
    expect(copyLabels(["C:/ws/f1/core", "C:/ws/f2/core", "C:/ws/f2/core-agent-1"])).toEqual({ "C:/ws/f1/core": "f1", "C:/ws/f2/core": "f2", "C:/ws/f2/core-agent-1": "core-agent-1" });
    expect(copyLabels(["/a/x", "/b/x", "/c/a"])).toEqual({ "/a/x": "/a/x", "/b/x": "/b/x", "/c/a": "/c/a" });
  });

  it("map server branches to local tracking branches across copies", () => {
    const results = [
      { repo: { path: "C:/a", identity: "x" }, tracking: [{ branch: "f", remote: "origin", remoteBranch: "feature/f", gone: false, ahead: 1, behind: 0, checkedOut: true }] },
      { repo: { path: "C:/b", identity: "x" }, tracking: [{ branch: "feature/f", remote: "origin", remoteBranch: "feature/f", gone: false, ahead: 0, behind: 2, checkedOut: false }] },
      { repo: { path: "C:/c", identity: "other" }, tracking: [{ branch: "feature/f", remote: "origin", remoteBranch: "feature/f", gone: false, ahead: 0, behind: 0, checkedOut: false }] },
    ] as unknown as RepoResult[];
    const copies = localCopies(online("feature/f"), results, "x");
    expect(copies.map((c) => `${c.repoPath}:${c.branch}`)).toEqual(["C:/a:f", "C:/b:feature/f"]);
    expect(copies[0]).toMatchObject({ ahead: 1, checkedOut: true });
    expect(localCopies(online("feature/none"), results, "x")).toEqual([]);
    // Indexed per result list: a new list (a new scan result) is indexed anew.
    expect(localCopies(online("feature/f"), results.slice(1), "x").map((c) => c.repoPath)).toEqual(["C:/b"]);
  });

  it("find the same gone branch in sibling copies", () => {
    const ids: Record<string, string> = { "C:/a": "x", "C:/b": "x", "C:/c": "y" };
    const all = [local("f"), local("f", { repoPath: "C:/b" }), local("f", { repoPath: "C:/c" }), local("g", { repoPath: "C:/b" })];
    expect(siblingGone(all[0], all, (p) => ids[p])).toEqual(["C:/b"]);
    // A copy where the server still has the branch is no sibling in that sense, and neither is a live branch itself.
    const live = [local("f"), local("f", { repoPath: "C:/b", upstreamState: "Live" })];
    expect(siblingGone(live[0], live, (p) => ids[p])).toEqual([]);
    expect(siblingGone(live[1], all, (p) => ids[p])).toEqual([]);
  });
});
