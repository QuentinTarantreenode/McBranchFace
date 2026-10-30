import { describe, expect, it } from "vitest";
import { nameParts, prefixColor, prefixOf, prefixStats, segments, splitRemote, refParts } from "./branchName";

describe("branch names", () => {
  it("splits at slashes and ignores empty pieces", () => {
    expect(segments("feature/checklist-ui")).toEqual(["feature", "checklist-ui"]);
    expect(segments("user/me/spike/x")).toEqual(["user", "me", "spike", "x"]);
    expect(segments("main")).toEqual(["main"]);
    expect(segments("/odd//name/")).toEqual(["odd", "name"]);
  });

  it("takes the first segment as prefix, case-insensitive, only with a slash", () => {
    expect(prefixOf("Feature/x")).toBe("feature");
    expect(prefixOf("main")).toBeNull();
    expect(prefixOf("/main")).toBeNull();
  });

  it("counts per prefix, largest first, names without prefix last", () => {
    expect(prefixStats(["feature/a", "main", "bugfix/b", "feature/c", "Feature/d", "develop", "bugfix/e", "alpha/x"])).toEqual([
      { prefix: "feature", count: 3 },
      { prefix: "bugfix", count: 2 },
      { prefix: "alpha", count: 1 },
      { prefix: null, count: 2 },
    ]);
    expect(prefixStats([])).toEqual([]);
  });

  it("gives known prefixes fixed colours and others a stable one", () => {
    expect(prefixColor("feature")).toBe(prefixColor("feat"));
    expect(prefixColor("fix")).toBe(prefixColor("Bugfix"));
    expect(prefixColor("feature")).not.toBe(prefixColor("fix"));
    expect(prefixColor("whatever")).toBe(prefixColor("whatever"));
    expect(prefixColor("whatever")).toMatch(/^var\(--id-[0-7]\)$/);
  });

  it("reads every ref form the app meets as remote and branch name", () => {
    expect(refParts("refs/heads/team/main")).toEqual({ remote: null, name: "team/main" });
    expect(refParts("refs/remotes/origin/bugfix/1042_2")).toEqual({ remote: "origin", name: "bugfix/1042_2" });
    expect(refParts("origin/team/main")).toEqual({ remote: "origin", name: "team/main" });
    // A prefix is not a remote: without the refs/ form only known remotes are split off.
    expect(refParts("feature/x")).toEqual({ remote: null, name: "feature/x" });
    expect(refParts("fork/x", ["fork"])).toEqual({ remote: "fork", name: "x" });
  });

  it("splits the remote off a remote-tracking name", () => {
    expect(splitRemote("origin/feature/x")).toEqual({ remote: "origin", name: "feature/x" });
    expect(splitRemote("main")).toEqual({ remote: null, name: "main" });
  });

  it("reads a leading namespace without letters apart from the prefix, and keeps the rest as one name", () => {
    expect(nameParts("2.4/release/Contoso/rc-1/main")).toEqual({ namespace: "2.4", prefix: "release", rest: "Contoso/rc-1/main" });
    expect(nameParts("2.4/main")).toEqual({ namespace: "2.4", prefix: null, rest: "main" });
    expect(nameParts("2.4/hotfix-53")).toEqual({ namespace: "2.4", prefix: null, rest: "hotfix-53" });
    expect(nameParts("2.4.1/7/feature/x")).toEqual({ namespace: "2.4.1/7", prefix: "feature", rest: "x" });
    expect(nameParts("feature/ui/checklist")).toEqual({ namespace: null, prefix: "feature", rest: "ui/checklist" });
    expect(nameParts("main")).toEqual({ namespace: null, prefix: null, rest: "main" });
    expect(nameParts("0")).toEqual({ namespace: null, prefix: null, rest: "0" });
    // Statistics count the prefix, not the namespace.
    expect(prefixOf("2.4/feature/search")).toBe("feature");
    expect(prefixOf("2.4/main")).toBeNull();
  });
});
