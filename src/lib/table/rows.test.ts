import { describe, expect, it } from "vitest";
import type { BranchReport } from "$lib/bindings/BranchReport";
import type { Grouped } from "$lib/groups";
import { tableRows, verdictCounts, type AnyBranch, type GroupRow, type RowContext } from "./rows";

const b = (name: string, verdict: string, repoPath = "C:/ws/a") => ({ name, verdict, repoPath }) as unknown as BranchReport;
const one = (list: AnyBranch[]): Grouped<AnyBranch>[] => [{ key: "", label: "", items: list, open: true }];
const byRepo = (list: AnyBranch[]): Grouped<AnyBranch>[] => {
  const keys = [...new Set(list.map((x) => x.repoPath))];
  return keys.map((k) => ({ key: k, label: k.split("/").pop()!, items: list.filter((x) => x.repoPath === k), open: k !== "C:/ws/folded" }));
};
const ctx = (over: Partial<RowContext> = {}): RowContext => ({ by: "None", online: false, grouped: one, deletable: new Set(), ...over });

describe("table rows", () => {
  it("stripe every second row and key them as the store does", () => {
    const rows = tableRows({ main: [b("x", "Safe"), b("y", "Review")], ignored: [], locked: [] }, { ignored: false, locked: false }, ctx());
    expect(rows.map((r) => [r.key, r.kind === "local" && r.alt])).toEqual([
      ["C:/ws/a::x", false],
      ["C:/ws/a::y", true],
    ]);
  });

  it("count the verdicts once per group head and name the branches it can mark", () => {
    const main = [b("x", "Safe"), b("y", "Safe"), b("z", "Unsafe"), b("w", "Safe", "C:/ws/b")];
    const rows = tableRows({ main, ignored: [], locked: [] }, { ignored: false, locked: false }, ctx({ by: "Repo", grouped: byRepo, deletable: new Set(["C:/ws/a::x", "C:/ws/b::w"]) }));
    const heads = rows.filter((r): r is GroupRow => r.kind === "group");
    expect(heads.map((h) => [h.label, h.markable, h.counts.filter((c) => c.n).map((c) => `${c.verdict}:${c.n}`)])).toEqual([
      ["a", ["C:/ws/a::x"], ["Safe:2", "Unsafe:1"]],
      ["b", ["C:/ws/b::w"], ["Safe:1"]],
    ]);
  });

  it("leave the rows of a folded group out but keep its head", () => {
    const main = [b("x", "Safe", "C:/ws/folded"), b("y", "Safe")];
    const rows = tableRows({ main, ignored: [], locked: [] }, { ignored: false, locked: false }, ctx({ by: "Repo", grouped: byRepo }));
    expect(rows.map((r) => r.kind)).toEqual(["group", "group", "local"]);
  });

  it("show a section head with its count, its rows only while open", () => {
    const lists = { main: [], ignored: [b("i", "Safe")], locked: [b("l", "Safe"), b("m", "Safe")] };
    expect(tableRows(lists, { ignored: false, locked: false }, ctx()).map((r) => r.key)).toEqual(["::ignored", "::locked"]);
    expect(tableRows(lists, { ignored: true, locked: false }, ctx()).map((r) => r.key)).toEqual(["::ignored", "C:/ws/a::i", "::locked"]);
  });

  it("count the server verdicts in the order of the status filter", () => {
    const list = [b("x", "Safe"), b("y", "Merged")];
    expect(verdictCounts(list, true).map((c) => [c.online, c.n])).toEqual([
      ["Merged", 1],
      ["Inactive", 0],
      ["Active", 0],
    ]);
  });
});
