import { describe, expect, it } from "vitest";
import { logScopes, refLabel } from "./logScope";

const revs = (l: { rev: string }[]) => l.map((s) => s.rev);

describe("logScopes", () => {
  it("offers HEAD and the new commits of the checked-out branch", () => {
    expect(revs(logScopes("HEAD", "feat/x", "origin/main"))).toEqual(["HEAD", "origin/main..refs/heads/feat/x"]);
  });

  it("adds the branch a log was opened for when it is not checked out", () => {
    const l = logScopes("refs/heads/feat/y", "main", "origin/main");
    expect(revs(l)).toEqual(["HEAD", "refs/heads/feat/y", "origin/main..refs/heads/feat/y"]);
    expect(l[1].branch).toBe("feat/y");
  });

  it("names the branch a log was opened for even when it is the one checked out", () => {
    const l = logScopes("refs/heads/feat/x", "feat/x", "origin/main");
    expect(l.map((x) => x.kind)).toEqual(["head", "branch", "new"]);
    expect(l.find((x) => x.rev === "refs/heads/feat/x")?.kind).toBe("branch");
  });

  it("does not compare the default branch with itself", () => {
    expect(revs(logScopes("HEAD", "main", "main"))).toEqual(["HEAD"]);
    expect(revs(logScopes("refs/remotes/origin/main", "feat/x", "origin/main"))).toEqual(["HEAD", "refs/remotes/origin/main"]);
  });

  it("keeps a range the log was opened with as its own choice", () => {
    const l = logScopes("abc..def", "feat/x", null);
    expect(revs(l)).toEqual(["HEAD", "abc..def"]);
    expect(l.at(-1)!.kind).toBe("range");
  });

  it("works on a detached HEAD", () => {
    expect(revs(logScopes("HEAD", null, "origin/main"))).toEqual(["HEAD"]);
  });

  it("shortens full refs for labels only", () => {
    expect(refLabel("refs/heads/a/b")).toBe("a/b");
    expect(refLabel("refs/remotes/origin/a")).toBe("origin/a");
    expect(refLabel("a..b")).toBe("a..b");
  });
});
