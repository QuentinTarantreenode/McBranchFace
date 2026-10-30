import { describe, expect, it, vi } from "vitest";

const statuses = new Map<string, unknown>();
const repos: unknown[] = [];

vi.mock("$lib/stores/scanResults.svelte", () => ({
  scanResults: {
    repoByPath: new Map(),
    resultOf: (path: string) => (repos as { info: { path: string }; result: unknown }[]).find((r) => r.info.path === path)?.result ?? null,
    groupOf: () => null,
    copyLabel: () => null,
  },
}));
vi.mock("$lib/stores/rules.svelte", () => ({ rules: { annotationOf: () => ({ tags: [], note: "" }) } }));
vi.mock("$lib/stores/gitStatus.svelte", () => ({ gitStatus: { statuses } }));
vi.mock("$lib/stores/identities.svelte", () => ({ identities: { rootBadgeOf: () => null } }));

const { capWorktrees, repoTip, WORKTREE_TIP_LIMIT } = await import("./repoTip");
const { i18n } = await import("$lib/i18n/index.svelte");
await i18n.set("En");

const wt = (branch: string | null, i: number) => ({ path: `C:/ws/wt/${i}`, branch, head: "abcdef1234567", isMain: false, detached: !branch, foreign: false, unreferenced: 0 });

describe("capWorktrees", () => {
  it("keep the most relevant, in their order, and count the rest by prefix", () => {
    const names = ["worktree-agent-a1", "r2/x", "fix-1", "worktree-agent-b2", "r2/y", "worktree-agent-c3", "fix-2", "keep"];
    const cap = capWorktrees(names, (n) => n, (n) => (n === "keep" ? 2 : 1), 3);
    expect(cap.shown).toEqual(["keep", "worktree-agent-a1", "r2/x"]);
    expect(cap.rest).toBe(5);
    expect(cap.prefixes).toEqual([
      ["fix", 2],
      ["worktree-agent", 2],
      ["", 1],
    ]);
  });

  it("show everything when under the limit", () => {
    const cap = capWorktrees(["a", "b"], (n) => n, () => 0);
    expect(cap).toEqual({ shown: ["a", "b"], rest: 0, prefixes: [] });
  });
});

describe("repoTip worktrees", () => {
  it("cap the section at a few one-line rows and a summary line", () => {
    const path = "C:/ws/repo";
    const list = [
      { path, branch: "main", head: "1", isMain: true, detached: false, foreign: false, unreferenced: 0 },
      ...Array.from({ length: 35 }, (_, i) => wt(i < 20 ? `worktree-agent-${i}` : i < 30 ? `r2/${i}` : `fix-${i}`, i)),
      wt(null, 99),
    ];
    statuses.set(path, { head: { branch: "main", upstream: null, ahead: 0, behind: 0 }, entries: [], stashes: 0, worktrees: list });
    // A worktree with local changes comes first.
    statuses.set("C:/ws/wt/33", { entries: [{}] });
    const section = repoTip(path, true).sections!.find((s) => s.rows && s.rows.length > WORKTREE_TIP_LIMIT)!;
    const rows = section.rows as { value: string; label?: string; kind?: string }[];
    expect(rows).toHaveLength(WORKTREE_TIP_LIMIT + 1);
    expect(rows[0].value).toBe("fix-33");
    expect(rows.slice(0, WORKTREE_TIP_LIMIT).every((r) => r.kind === "branch")).toBe(true);
    expect(rows[WORKTREE_TIP_LIMIT].value).toMatch(/^\+31 .*16 worktree-agent, 10 r2, 4 fix, 1 other$/);
  });

  it("name a detached worktree by its folder and the short sha every list shows, without a summary line", () => {
    const path = "C:/ws/small";
    statuses.set(path, { head: { branch: "main", upstream: null, ahead: 0, behind: 0 }, entries: [], stashes: 0, worktrees: [wt(null, 7)] });
    const section = repoTip(path, true).sections!.find((s) => s.title === "Worktrees")!;
    expect(section.rows).toEqual([{ label: "7", value: "abcdef12", kind: "mono", tone: "review" }]);
  });
});
