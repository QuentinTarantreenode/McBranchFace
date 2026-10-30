import { describe, expect, it } from "vitest";
import type { BranchReport } from "./bindings/BranchReport";
import { ageBucket, branchKey, countByVerdict, countOnline, emptyFilters, facetCounts, facetField, filterBranches, isDeletable, repoName, sortBranches, withoutFacet, type Filters } from "./filter";
import { relativeTime } from "./format";
import { i18n } from "./i18n/index.svelte";

const branch = (over: Partial<BranchReport>): BranchReport => ({
  repoPath: "C:/ws/Core",
  name: "feature/a",
  sha: "a".repeat(40),
  upstream: "refs/remotes/origin/feature/a",
  upstreamState: "Gone",
  remoteRef: "refs/heads/feature/a",
  lastCommitAt: 1000,
  lastCommitSubject: "Add thing",
  lastCommitAuthor: "me@example.com",
  ignored: false,
  authors: ["me@example.com"],
  isMine: true,
  locked: false,
  verdict: "Safe",
  checks: [],
  mergeEvidence: null,
  ownCommitCount: 0,
  unpushedCommitCount: 0,
  behind: 0,
  pushState: null,
  worktree: null,
  stashes: [],
  pullRequest: null,
  ...over,
});

const none: Filters = emptyFilters();

describe("isDeletable", () => {
  it("takes what is safe locally and what is merged on the server", () => {
    expect(isDeletable(branch({ verdict: "Safe" }))).toBe(true);
    expect(isDeletable(branch({ verdict: "Review" }))).toBe(false);
    const online = { ...branch({}), remote: "origin" } as unknown as Parameters<typeof isDeletable>[0];
    expect(isDeletable({ ...online, verdict: "Merged" } as typeof online)).toBe(true);
    expect(isDeletable({ ...online, verdict: "Inactive" } as typeof online)).toBe(false);
  });
});

describe("filterBranches", () => {
  const list = [
    branch({ name: "feature/a" }),
    branch({ name: "bugfix/b", isMine: false, verdict: "Unsafe", repoPath: "C:\\ws\\Contoso" }),
    branch({ name: "feature/c", verdict: "Review", pullRequest: { id: 42 } as BranchReport["pullRequest"] }),
  ];

  it("combines all filters", () => {
    expect(filterBranches(list, none)).toHaveLength(3);
    expect(filterBranches(list, { ...none, onlyMine: true }).map((b) => b.name)).toEqual(["feature/a", "feature/c"]);
    expect(filterBranches(list, { ...none, verdicts: ["Unsafe"] }).map((b) => b.name)).toEqual(["bugfix/b"]);
    expect(filterBranches(list, { ...none, repos: ["C:\\ws\\Contoso"] })).toHaveLength(1);
    expect(filterBranches(list, { ...none, search: "contos" })).toHaveLength(1);
    expect(filterBranches(list, { ...none, search: "#42" }).map((b) => b.name)).toEqual(["feature/c"]);
  });

  it("filters by name prefix, with names without one as their own choice, and finds names as shown in pills", () => {
    const more = [...list, branch({ name: "main" })];
    expect(filterBranches(more, { ...none, prefixes: ["bugfix"] }).map((b) => b.name)).toEqual(["bugfix/b"]);
    expect(filterBranches(more, { ...none, prefixes: ["feature", ""] }).map((b) => b.name)).toEqual(["feature/a", "feature/c", "main"]);
    expect(filterBranches(more, { ...none, search: "feature › c" }).map((b) => b.name)).toEqual(["feature/c"]);
  });

  it("keeps exactly the branches a focus names, by repo and name", () => {
    const keys = [branchKey(list[1]), branchKey({ repoPath: "C:\\ws\\Other", name: "feature/a" })];
    expect(filterBranches(list, { ...none, focus: { label: "x", keys } }).map((b) => b.name)).toEqual(["bugfix/b"]);
    expect(filterBranches(list, { ...none, focus: { label: "x", keys: [] } })).toHaveLength(0);
  });
});

describe("sortBranches", () => {
  it("sorts by verdict order and falls back to name", () => {
    const list = [branch({ name: "z", verdict: "Unsafe" }), branch({ name: "b" }), branch({ name: "a" })];
    expect(sortBranches(list, { key: "verdict", dir: 1 }).map((b) => b.name)).toEqual(["a", "b", "z"]);
    expect(sortBranches(list, { key: "verdict", dir: -1 }).map((b) => b.name)[0]).toBe("z");
  });

  it("orders equal names in several working copies the same way whatever order they came in", () => {
    const a = branch({ name: "x", repoPath: "C:/ws/a" });
    const b = branch({ name: "x", repoPath: "C:/ws/b" });
    const c = branch({ name: "x", repoPath: "C:/ws/c" });
    const order = (l: BranchReport[]) => sortBranches(l, { key: "verdict", dir: 1 }).map((x) => x.repoPath);
    expect(order([c, a, b])).toEqual(["C:/ws/a", "C:/ws/b", "C:/ws/c"]);
    expect(order([b, c, a])).toEqual(order([c, a, b]));
  });
});

describe("helpers", () => {
  it("counts verdicts", () => {
    expect(countByVerdict([branch({}), branch({ verdict: "Blocked" })])).toEqual({ Safe: 1, Review: 0, Blocked: 1, Unsafe: 0 });
  });
  it("filters by tags and finds tags and notes in the search", () => {
    const list = [branch({ name: "feature/a" }), branch({ name: "feature/b" })];
    const annotate = (b: { name: string }) =>
      b.name === "feature/a" ? { tags: ["Release"], note: "wait for QA sign-off" } : { tags: [], note: "" };
    expect(filterBranches(list, { ...none, tags: ["release"] }, annotate).map((b) => b.name)).toEqual(["feature/a"]);
    expect(filterBranches(list, { ...none, search: "#rel" }, annotate).map((b) => b.name)).toEqual(["feature/a"]);
    expect(filterBranches(list, { ...none, search: "sign-off" }, annotate).map((b) => b.name)).toEqual(["feature/a"]);
    expect(filterBranches(list, { ...none, tags: ["nope"] }, annotate)).toEqual([]);
  });

  it("extracts repo names from both path styles", () => {
    expect(repoName("C:\\Projects\\ws\\Core")).toBe("Core");
    expect(repoName("/home/u/ws/Contoso/")).toBe("Contoso");
  });
  it("formats relative times in the chosen language", async () => {
    await i18n.set("De");
    expect(relativeTime(0, 3 * 24 * 3600)).toBe("vor 3 Tagen");
    expect(relativeTime(100, 100)).toBe("gerade eben");
    await i18n.set("En");
    expect(relativeTime(0, 3 * 24 * 3600)).toBe("3 days ago");
    expect(relativeTime(100, 100)).toBe("just now");
  });
});

describe("sorting and counting", () => {
  it("sorts by repo and by date, ties by name", () => {
    const list = [
      branch({ name: "b", repoPath: "C:/ws/zeta", lastCommitAt: 5 }),
      branch({ name: "a", repoPath: "C:/ws/alpha", lastCommitAt: 5 }),
      branch({ name: "c", repoPath: "C:/ws/alpha", lastCommitAt: 1 }),
    ];
    expect(sortBranches(list, { key: "repo", dir: 1 }).map((b) => b.name)).toEqual(["a", "c", "b"]);
    expect(sortBranches(list, { key: "lastCommitAt", dir: -1 }).map((b) => b.name)).toEqual(["a", "b", "c"]);
  });

  it("counts server branches by verdict", () => {
    const r = (verdict: "Merged" | "Inactive" | "Active") => ({ verdict }) as never;
    expect(countOnline([r("Merged"), r("Merged"), r("Active")])).toEqual({ Merged: 2, Inactive: 0, Active: 1 });
  });
});

describe("column facets", () => {
  const now = 100 * 86_400;
  const ctx = { now };
  const list = [
    branch({ name: "feature/a", repoPath: "C:/ws/a", lastCommitAuthor: "me@x", lastCommitAt: now - 2 * 86_400 }),
    branch({ name: "feature/b", repoPath: "C:/ws/b", lastCommitAuthor: "you@x", lastCommitAt: now - 40 * 86_400, pullRequest: { id: 1, state: "Open" } as BranchReport["pullRequest"] }),
    branch({ name: "main", repoPath: "C:/ws/a", lastCommitAuthor: "me@x", lastCommitAt: now - 200 * 86_400 }),
  ];

  it("counts values per facet, largest first", () => {
    expect(facetCounts(list, "author", ctx)).toEqual([{ value: "me@x", count: 2 }, { value: "you@x", count: 1 }]);
    expect(facetCounts(list, "age", ctx).map((c) => c.value).sort()).toEqual(["older", "quarter", "week"]);
    expect(facetCounts(list, "pr", ctx)).toEqual([{ value: "None", count: 2 }, { value: "Open", count: 1 }]);
    expect(facetCounts(list, "prefix", ctx)[0]).toEqual({ value: "feature", count: 2 });
    expect(ageBucket(6 * 86_400)).toBe("week");
    expect(ageBucket(8 * 86_400)).toBe("month");
  });

  it("filters by repos, authors, ages and PR state, and leaves out one facet for its own counts", () => {
    const f = { ...none, repos: ["C:/ws/a"], authors: ["me@x"] };
    expect(filterBranches(list, f, undefined, ctx).map((b) => b.name)).toEqual(["feature/a", "main"]);
    expect(filterBranches(list, { ...none, ages: ["week", "quarter"] }, undefined, ctx).map((b) => b.name)).toEqual(["feature/a", "feature/b"]);
    expect(filterBranches(list, { ...none, prStates: ["Open"] }, undefined, ctx).map((b) => b.name)).toEqual(["feature/b"]);
    expect(withoutFacet(f, "repo", false).repos).toEqual([]);
    expect(withoutFacet(f, "repo", false).authors).toEqual(["me@x"]);
    expect(facetField("verdict", true)).toBe("onlineVerdicts");
  });

  it("sorts by author", () => {
    expect(sortBranches(list, { key: "author", dir: 1 }).map((b) => b.lastCommitAuthor)).toEqual(["me@x", "me@x", "you@x"]);
  });
});
