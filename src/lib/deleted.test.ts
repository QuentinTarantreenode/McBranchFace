import { describe, expect, it } from "vitest";
import { isStashEntry, isWorktreeEntry, onlineVerdictOf } from "./deleted";

describe("isStashEntry", () => {
  it("tells a dropped stash from a deleted branch by its missing branch", () => {
    expect(isStashEntry({ branch: "", remote: null })).toBe(true);
    expect(isStashEntry({ branch: "feature/x", remote: null })).toBe(false);
    expect(isStashEntry({ branch: "feature/x", remote: "origin" })).toBe(false);
  });

  it("tells a removed worktree from a dropped stash by the folder it names", () => {
    const worktree = { branch: "", remote: null, removedWorktree: "C:/ws/wt-1" };
    expect(isWorktreeEntry(worktree)).toBe(true);
    expect(isStashEntry(worktree)).toBe(false);
    // A branch delete that took its worktree along is a branch entry.
    expect(isWorktreeEntry({ branch: "feature/x", remote: null, removedWorktree: "C:/ws/wt-1" })).toBe(false);
    expect(isWorktreeEntry({ branch: "", remote: null })).toBe(false);
  });
});

describe("onlineVerdictOf", () => {
  it("shows a merged server branch as Merged and one deleted unmerged as Inactive", () => {
    expect(onlineVerdictOf({ verdict: "Safe" })).toBe("Merged");
    expect(onlineVerdictOf({ verdict: "Review" })).toBe("Inactive");
  });
});
