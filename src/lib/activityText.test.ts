import { describe, expect, it } from "vitest";
import { describeProcess, type OpTexts } from "./activityText";

const t: OpTexts = {
  local: "Local",
  server: "Server",
  azure: "Azure DevOps",
  github: "GitHub",
  fetch: (r) => `fetch from ${r}`,
  pull: (r) => `pull from ${r}`,
  push: (r) => `push to ${r}`,
  heads: (r) => `heads of ${r}`,
  status: "status",
  refs: "branches",
  commits: "commits",
  worktrees: "worktrees",
  stashes: "stashes",
  config: "config",
  resolve: "refs",
  prs: "pull requests",
  branches: "server branches",
  user: "user",
  other: (w) => w,
};
const az = () => "Azure" as const;

describe("describeProcess", () => {
  it("names the server behind a fetch and the folder from -C", () => {
    expect(describeProcess("C:/Program Files/Git/cmd/git.exe", ["-c", "core.quotepath=off", "-C", "C:/ws/a", "fetch", "--prune", "upstream"], null, az, t)).toEqual({
      text: "Azure DevOps · fetch from upstream",
      where: "C:/ws/a",
      repo: null,
    });
    expect(describeProcess("git", ["fetch"], "C:/ws/a", () => null, t).text).toBe("Server · fetch from origin");
  });

  it("calls local reads local, and names an unknown one by its command", () => {
    expect(describeProcess("git", ["for-each-ref", "--format=%(refname)"], "C:/ws/a", az, t).text).toBe("Local · branches");
    expect(describeProcess("git", ["reflog"], "C:/ws/a", az, t).text).toBe("Local · git reflog");
  });

  it("names the provider, the operation and the repo of a provider call", () => {
    expect(describeProcess("az.cmd", ["repos", "pr", "list", "--organization", "o", "--repository", "Acme.Core"], null, az, t)).toEqual({
      text: "Azure DevOps · pull requests",
      where: null,
      repo: "Acme.Core",
    });
    expect(describeProcess("gh", ["pr", "list", "-R", "acme/tools", "--json", "x"], null, az, t).repo).toBe("tools");
    expect(describeProcess("gh", ["api", "repos/acme/tools/branches?per_page=100"], null, az, t)).toEqual({ text: "GitHub · server branches", where: null, repo: "tools" });
  });
});
