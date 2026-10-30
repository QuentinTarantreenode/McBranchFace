import { describe, expect, it } from "vitest";
import { branch } from "../test/backend";
import type { Check } from "./bindings/Check";
import { todos } from "./todos";

const fail = (code: Check["code"]): Check => ({ kind: "Pushed", outcome: "Fail", code });
const kinds = (b: ReturnType<typeof branch>) => todos(b).map((x) => x.kind);
const merged = { kind: "Ancestor" as const, target: "refs/remotes/origin/main" };

describe("todos", () => {
  it("nothing to do for a safe or a locked branch", () => {
    expect(todos(branch("r", "a"))).toEqual([]);
    expect(todos(branch("r", "a", { verdict: "Unsafe", locked: true, stashes: [{ selector: "s", sha: "s", message: "m" }] }))).toEqual([]);
  });

  it("saves the work before it frees the branch", () => {
    const b = branch("r", "a", {
      verdict: "Unsafe",
      worktree: { path: "C:/wt", isMain: false, files: [{ path: "f", kind: "Unstaged" }] },
      stashes: [{ selector: "s", sha: "s", message: "m" }],
      unpushedCommits: [{ sha: "u", subject: "s", authorEmail: "e", authoredAt: 1 }],
      upstreamState: "Live",
      checks: [fail({ code: "CommitsAfterPush", p: { count: 1, upstream: "refs/remotes/origin/a", merged: false } })],
    });
    expect(kinds(b)).toEqual(["commit", "stash", "push", "worktree"]);
    expect(todos(b)[2]).toEqual({ kind: "push", count: 1, first: false, ready: true, gone: false });
  });

  it("pushes a never pushed branch with -u, but not one that tracks the integration line", () => {
    const never = fail({ code: "NeverPushed", p: { count: 2, merged: false } });
    expect(todos(branch("r", "a", { verdict: "Unsafe", upstream: "", upstreamState: "None", unpushedCommitCount: 2, checks: [never] }))[0]).toEqual({
      kind: "push",
      count: 2,
      first: true,
      ready: true,
      gone: false,
    });
    // Deleted on the server: a push would bring the branch back there, so it is left to the user in Git.
    expect(todos(branch("r", "a", { verdict: "Unsafe", upstreamState: "Gone", unpushedCommitCount: 1, checks: [never] }))[0]).toMatchObject({ ready: false, gone: true });
    const tracksMain = branch("r", "a", { verdict: "Unsafe", upstream: "refs/remotes/origin/main", upstreamState: "None", unpushedCommitCount: 2, checks: [never] });
    expect(todos(tracksMain)[0]).toMatchObject({ kind: "push", ready: false });
  });

  it("merged commits need no push, and a merged checked-out branch only the checkout", () => {
    const b = branch("r", "a", {
      verdict: "Unsafe",
      mergeEvidence: merged,
      worktree: { path: "C:/r", isMain: true, files: [] },
      checks: [fail({ code: "CommitsAfterPush", p: { count: 1, upstream: "refs/remotes/origin/a", merged: true } })],
    });
    expect(todos(b)).toEqual([{ kind: "checkout", clean: true, andDelete: true }]);
    const dirty = { ...b, worktree: { path: "C:/r", isMain: true, files: [{ path: "f", kind: "Unstaged" as const }] } };
    expect(todos(dirty).at(-1)).toEqual({ kind: "checkout", clean: false, andDelete: false });
  });

  it("an open PR comes before the review of unmerged commits", () => {
    const noEvidence = fail({ code: "NoMergeEvidence", p: { own: 3, base: "refs/remotes/origin/main" } });
    const pr = { id: 7, title: "t", state: "Open" as const, url: "u", author: "a", authorName: null, sourceRef: "s", targetRef: "t", sourceSha: null, createdAt: null, closedAt: null, targetSha: null , reviewers: [], isDraft: false, hasConflicts: false};
    expect(kinds(branch("r", "a", { verdict: "Review", ownCommitCount: 3, checks: [noEvidence], pullRequest: pr }))).toEqual(["pr"]);
    expect(todos(branch("r", "a", { verdict: "Review", ownCommitCount: 3, checks: [noEvidence] }))).toEqual([{ kind: "review", count: 3 }]);
  });

  it("offers the fast-forward of a branch behind its upstream", () => {
    expect(kinds(branch("r", "a", { verdict: "Review", behind: 2, upstreamState: "Live" }))).toEqual(["fastForward"]);
  });
});
