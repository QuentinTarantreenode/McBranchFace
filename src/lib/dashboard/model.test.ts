import { describe, expect, it } from "vitest";
import type { BranchReport } from "$lib/bindings/BranchReport";
import type { PullRequestInfo } from "$lib/bindings/PullRequestInfo";
import type { RepoStatus } from "$lib/bindings/RepoStatus";
import { LENSES, lensKeys, type LensId } from "$lib/alerts";
import type { RemoteBranchReport } from "$lib/bindings/RemoteBranchReport";
import { branchIndex, isAgentWorktree, nextSteps, prBranches, prsOf, shownSteps, type DashInput } from "./model";

const NOW = 2_000_000_000;
const pr = (id: number, author: string, extra: Partial<PullRequestInfo> = {}): PullRequestInfo => ({
  id,
  title: `PR ${id}`,
  state: "Open",
  url: `u${id}`,
  author,
  authorName: null,
  sourceRef: "refs/heads/f",
  targetRef: "refs/heads/main",
  sourceSha: null,
  createdAt: NOW - 86_400,
  closedAt: null,
  targetSha: null,
  reviewers: [],
  isDraft: false, hasConflicts: false,
  ...extra,
});
const status = (branch: string, behind = 0, files = 0): RepoStatus =>
  ({ path: "", head: { branch, oid: "o", upstream: "origin/" + branch, ahead: 0, behind, unreferenced: 0 }, entries: Array.from({ length: files }, (_, i) => ({ path: `f${i}` })), worktrees: [], stashes: 0 }) as unknown as RepoStatus;
// The lens lists as the store hands them in: counted over the same branches.
const input = (over: Partial<DashInput> & { online?: RemoteBranchReport[] } = {}): DashInput => {
  const { online = [], ...rest } = over;
  const base = { local: [], repos: [{ path: "C:/a", name: "a", host: "GitHub" as const, defaultBranch: "main" }], statuses: {}, prs: {}, me: { GitHub: "Me" }, mergedWorktrees: [], now: NOW, ...rest };
  const keys = Object.fromEntries(LENSES.map((l) => [l.id, lensKeys(l, base.local, online, base.now)])) as Record<LensId, string[]>;
  return { ...base, branches: over.branches ?? branchIndex(base.local, online), lensKeys: over.lensKeys ?? keys };
};

describe("dashboard", () => {
  it("puts a review waiting for me first, then my pull requests that need something", () => {
    const prs = {
      "C:/a": [
        pr(1, "anna", { reviewers: [{ id: "me", state: "Pending", required: false }] }),
        pr(2, "me", { reviewers: [{ id: "bob", state: "Changes", required: false }] }),
        pr(3, "me", { reviewers: [{ id: "bob", state: "Approved", required: true }] }),
        pr(4, "me", { createdAt: NOW - 10 * 86_400 }),
        pr(5, "me"),
        pr(6, "anna"),
        pr(7, "me", { hasConflicts: true, reviewers: [{ id: "bob", state: "Changes", required: false }] }),
      ],
    };
    const steps = nextSteps(input({ prs }));
    expect(steps.map((s) => [s.kind, s.pr?.id])).toEqual([["review", 1], ["conflict", 7], ["changes", 2], ["approved", 3], ["waiting", 4]]);
    expect(steps[4].count).toBe(10);
  });

  it("lists mine and those for my review, or all open ones", () => {
    const prs = { "C:/a": [pr(1, "anna"), pr(2, "me"), pr(3, "x", { state: "Merged" }), pr(4, "bob", { reviewers: [{ id: "ME", state: "Pending", required: true }] })] };
    expect(prsOf(input({ prs }), "mine").map((x) => [x.pr.id, x.why])).toEqual([[4, "review"], [2, "mine"]]);
    expect(prsOf(input({ prs }), "all").map((x) => x.pr.id)).toEqual([4, 2, 1]);
    // Without knowing who I am, nothing is mine.
    expect(prsOf(input({ prs, me: {} }), "mine")).toEqual([]);
  });

  it("names local work at risk, the default branch behind, uncommitted files and merged worktrees", () => {
    const local = [
      { repoPath: "C:/a", name: "lost", unpushedCommitCount: 3, upstreamState: "Gone", locked: false, ignored: false, verdict: "Unsafe" },
      { repoPath: "C:/a", name: "kept", unpushedCommitCount: 2, upstreamState: "Gone", locked: true, ignored: false, verdict: "Unsafe" },
    ] as unknown as BranchReport[];
    const many = [1, 2, 3].map((i) => ({ repoPath: "C:/b", name: `agent-${i}`, unpushedCommitCount: i, upstreamState: "None", locked: false, ignored: false }));
    const summed = nextSteps(input({ local: many as unknown as BranchReport[] })).find((s) => s.repos[0] === "C:/b")!;
    expect([summed.branches, summed.count, summed.branch]).toEqual([3, 6, undefined]);
    const steps = nextSteps(input({ local, statuses: { "C:/a": status("main", 4, 2) }, mergedWorktrees: [{ repo: "C:/a", paths: ["C:/a-wt"], branches: ["done"] }] }));
    // Keeping work comes before tidying up: the merged worktree goes last.
    expect(steps.map((s) => [s.section, s.kind, s.count])).toEqual([["secure", "atRisk", 3], ["secure", "behind", 4], ["secure", "dirty", 2], ["cleanup", "worktrees", 1]]);
    expect(steps.find((s) => s.kind === "worktrees")!.items).toEqual([{ repo: "C:/a", name: "a-wt", branch: "done" }]);
    // Every step has its one button; for files not committed it leads where the line leads.
    expect(steps.find((s) => s.kind === "dirty")!.action).toEqual({ kind: "changes", path: "C:/a" });
    expect(steps.find((s) => s.kind === "dirty")!.items?.map((x) => x.name)).toEqual(["f0", "f1"]);
  });

  it("lists a pull request once, with every copy that reports it, and leads to its branch", () => {
    const copies = [
      { path: "C:/ws1/core", name: "core", host: "GitHub" as const, defaultBranch: "main" },
      { path: "C:/ws2/core", name: "core", host: "GitHub" as const, defaultBranch: "main" },
    ];
    const one = pr(7, "me", { sourceRef: "refs/heads/feature/x", reviewers: [{ id: "bob", state: "Changes", required: false }] });
    const local = [{ repoPath: "C:/ws2/core", name: "feature/x" }] as unknown as BranchReport[];
    const it = input({ repos: copies, prs: { "C:/ws1/core": [one], "C:/ws2/core": [one] }, local });
    const rows = prsOf(it, "all");
    expect(rows).toHaveLength(1);
    expect(rows[0].repos.map((r) => r.path)).toEqual(["C:/ws1/core", "C:/ws2/core"]);
    expect(prBranches(it.branches, rows[0])).toEqual({ keys: ["C:/ws2/core::feature/x"], scope: "Local" });
    const step = nextSteps(it).find((x) => x.kind === "changes")!;
    expect([step.repos, step.open, step.action]).toEqual([["C:/ws1/core", "C:/ws2/core"], { kind: "focus", keys: ["C:/ws2/core::feature/x"], scope: "Local" }, { kind: "url", url: "u7" }]);
    // Known nowhere: the line opens the pull request itself.
    expect(nextSteps(input({ repos: copies, prs: { "C:/ws1/core": [one] } })).find((x) => x.kind === "changes")!.open).toEqual({ kind: "url", url: "u7" });
  });

  it("names the branches not pushed, most commits first, those of agents, and leads to exactly them", () => {
    const at = (name: string, n: number, wt?: string) => ({ repoPath: "C:/b", name, unpushedCommitCount: n, upstreamState: "None", locked: false, ignored: false, worktree: wt ? { path: wt } : null });
    const local = [at("a", 1), at("b", 5, "C:\\b\\.claude\\worktrees\\agent-1"), at("c", 3, "C:/b/.claude/worktrees/agent-2"), at("d", 2)] as unknown as BranchReport[];
    const s = nextSteps(input({ local }))[0];
    expect([s.kind, s.count, s.branches, s.agents]).toEqual(["atRisk", 11, 4, 2]);
    expect(s.items?.map((x) => [x.name, x.count, x.agent])).toEqual([["b", 5, true], ["c", 3, true], ["d", 2, false], ["a", 1, false]]);
    expect(s.open).toEqual({ kind: "focus", keys: ["C:/b::a", "C:/b::b", "C:/b::c", "C:/b::d"], scope: "Local" });
    expect(isAgentWorktree("C:/b/src")).toBe(false);
  });

  it("splits a cleanup step by repo and offers the delete dialog for exactly its branches", () => {
    const safe = (repoPath: string, name: string) => ({ repoPath, name, verdict: "Safe", upstreamState: "Gone", locked: false, ignored: false, isMine: true, lastCommitAt: NOW });
    const local = [safe("C:/a", "x"), safe("C:/b", "y"), safe("C:/b", "z")] as unknown as BranchReport[];
    const s = nextSteps(input({ local })).find((x) => x.kind === "cleanup")!;
    expect(s.split).toEqual([{ repo: "C:/b", count: 2 }, { repo: "C:/a", count: 1 }]);
    expect(s.action).toEqual({ kind: "delete", keys: ["C:/a::x", "C:/b::y", "C:/b::z"], scope: "Local" });
  });

  it("groups the steps: answers for others first, then work to keep, then tidying up", () => {
    const safe = { repoPath: "C:/a", name: "x", verdict: "Safe", upstreamState: "Gone", locked: false, ignored: false, isMine: true, lastCommitAt: NOW, unpushedCommitCount: 0 };
    const lost = { repoPath: "C:/a", name: "lost", unpushedCommitCount: 1, upstreamState: "None", locked: false, ignored: false };
    const prs = { "C:/a": [pr(1, "anna", { reviewers: [{ id: "me", state: "Pending", required: false }] })] };
    const steps = nextSteps(input({ local: [safe, lost] as unknown as BranchReport[], prs, statuses: { "C:/a": status("main", 0, 1) } }));
    expect(steps.map((s) => s.section)).toEqual(["forYou", "secure", "secure", "cleanup"]);
  });

  it("keeps a step put aside away until its state changes", () => {
    const steps = nextSteps(input({ statuses: { "C:/a": status("main", 0, 2) } }));
    expect(shownSteps(steps, { "dirty:C:/a": "2" })).toEqual([]);
    expect(shownSteps(steps, { "dirty:C:/a": "1" })).toHaveLength(1);
  });
});
