import { describe, expect, it } from "vitest";
import { branch, repo, result } from "../test/backend";
import { staleStatuses, statusFingerprint, statusOrder } from "./monitor";

const A = repo("C:/ws/a");
const track = (ahead: number) => ({ branch: "main", remote: "origin", remoteBranch: "main", gone: false, ahead, behind: 0, checkedOut: true });

describe("statuses after a scan", () => {
  it("changes the fingerprint when ahead/behind or a worktree changes, not otherwise", () => {
    const base = { ...result(A, [branch(A.path, "x")]), tracking: [track(0)] };
    expect(statusFingerprint(base)).toBe(statusFingerprint({ ...base, durationMs: 99 }));
    expect(statusFingerprint(base)).not.toBe(statusFingerprint({ ...base, tracking: [track(1)] }));
    const wt = { ...base, branches: [branch(A.path, "x", { worktree: { path: "C:/wt", isMain: false, files: [] } })] };
    expect(statusFingerprint(base)).not.toBe(statusFingerprint(wt));
    expect(statusFingerprint(null)).toBe("");
  });

  it("refreshes repos without a status and those whose fingerprint moved", () => {
    const last = new Map([["a", "1"], ["b", "2"], ["c", "3"]]);
    const now = new Map([["a", "1"], ["b", "changed"], ["c", "3"], ["d", "4"]]);
    const has = (p: string) => p !== "c";
    expect(staleStatuses(["a", "b", "c", "d"], has, last, now)).toEqual(["b", "c", "d"]);
  });
});

describe("statuses at the start", () => {
  it("reads the repo open in Git first, the rest in sidebar order", () => {
    expect(statusOrder(["a", "b", "c"], "c")).toEqual(["c", "a", "b"]);
    expect(statusOrder(["a", "b"], null)).toEqual(["a", "b"]);
    // A Git repo that is not among them (a worktree) changes nothing.
    expect(statusOrder(["a", "b"], "w")).toEqual(["a", "b"]);
  });
});
