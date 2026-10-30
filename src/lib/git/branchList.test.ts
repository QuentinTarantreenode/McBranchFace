import { describe, expect, it } from "vitest";
import type { BranchRow } from "$lib/bindings/BranchRow";
import { emptyBranchFilter, filterRows, groupRows, listRows, sortRows, upstreamOf } from "./branchList";
import { groupByPrefix, prefixOf } from "$lib/groups";

const row = (name: string, over: Partial<BranchRow> = {}): BranchRow => ({
  name,
  fullRef: `refs/heads/${name}`,
  sha: "s",
  upstream: `origin/${name}`,
  ahead: 0,
  behind: 0,
  gone: false,
  isHead: false,
  worktreePath: null,
  committedAt: 1,
  subject: "",
  author: "me",
  isMine: false,
  ...over,
});

describe("branch list", () => {
  const local = [row("dev", { isHead: true }), row("worktree-agent-a12801721f04f4e9b", { worktreePath: "C:/w/1", upstream: null }), row("worktree-agent-a1bcdf85bdcb05b59", { worktreePath: "C:/w/2", upstream: null }), row("r2-icons", { ahead: 2 }), row("r2-shell", { gone: true }), row("fix/login")];
  const remote = [row("origin/dev"), row("origin/feature/x")];
  const rows = listRows(local, remote);

  it("leaves out server branches with a local one, and says where each stands", () => {
    expect(rows.filter((r) => r.remote).map((r) => r.name)).toEqual(["origin/feature/x"]);
    expect(rows.map(upstreamOf)).toEqual(["even", "localOnly", "localOnly", "ahead", "gone", "even", "remote"]);
  });

  it("filters by kind, upstream, worktree, mine and text", () => {
    const f = emptyBranchFilter();
    expect(filterRows(rows, { ...f, kind: "remote" }).length).toBe(1);
    expect(filterRows(rows, { ...f, upstream: "localOnly" }).length).toBe(2);
    expect(filterRows(rows, { ...f, worktree: "with" }).length).toBe(2);
    expect(filterRows(rows, { ...f, query: "R2" }).map((r) => r.name)).toEqual(["r2-icons", "r2-shell"]);
  });

  it("keeps the checked-out branch first and sorts the rest", () => {
    expect(sortRows(rows, "name", -1)[0].name).toBe("dev");
    expect(sortRows(rows, "name", 1).slice(1, 3).map((r) => r.name)).toEqual(["fix/login", "origin/feature/x"]);
  });

  it("groups agents' worktree branches together by their shared prefix", () => {
    const g = groupRows(rows, "Prefix", () => "Others");
    expect(g.find((x) => x.label === "worktree-agent-")?.rows.length).toBe(2);
    expect(g.find((x) => x.label === "r2-")?.rows.length).toBe(2);
    expect(g.at(-1)?.label).toBe("Others");
    expect(groupRows(rows, "Worktree", (_, k) => k).map((x) => [x.key, x.rows.length])).toEqual([
      ["without", 5],
      ["with", 2],
    ]);
  });

  it("takes the first word of a name as its prefix", () => {
    expect(prefixOf("fix/review-store")).toBe("fix");
    expect(prefixOf("r2-substitution")).toBe("r2");
    expect(groupByPrefix(["vis-a", "vis-b", "solo"], (x) => x).map((g) => g.label)).toEqual(["vis", ""]);
  });
});
