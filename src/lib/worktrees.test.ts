import { describe, expect, it } from "vitest";
import { branch } from "../test/backend";
import { isMergedBranch, mergedBranches } from "./worktrees";

describe("isMergedBranch", () => {
  const evidence = { kind: "Ancestor" } as never;

  it("needs a Safe verdict with merge evidence for the branch named", () => {
    const result = { branches: [branch("C:/r", "done", { mergeEvidence: evidence }), branch("C:/r", "safeNoEvidence"), branch("C:/r", "open", { verdict: "Unsafe", mergeEvidence: evidence })] };
    expect(isMergedBranch(result, "done")).toBe(true);
    expect(isMergedBranch(result, "safeNoEvidence")).toBe(false);
    expect(isMergedBranch(result, "open")).toBe(false);
    expect(isMergedBranch(result, "missing")).toBe(false);
    expect(isMergedBranch(result, null)).toBe(false);
    expect(isMergedBranch(null, "done")).toBe(false);
    expect([...mergedBranches(result)]).toEqual(["done"]);
    expect(mergedBranches(null).size).toBe(0);
  });
});
