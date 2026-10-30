import { describe, expect, it } from "vitest";
import { cloneTarget, folderNameProblem, repoNameFromUrl } from "./cloneTarget";

describe("repoNameFromUrl", () => {
  it("takes the last segment of a link, an scp-style address or a path, without .git", () => {
    expect(repoNameFromUrl("https://example.com/acme/widgets.git")).toBe("widgets");
    expect(repoNameFromUrl("https://example.com/acme/widgets/")).toBe("widgets");
    expect(repoNameFromUrl("git@example.com:acme/widgets.git")).toBe("widgets");
    expect(repoNameFromUrl("git@example.com:widgets")).toBe("widgets");
    expect(repoNameFromUrl("ssh://git@example.com:22/acme/widgets.git")).toBe("widgets");
    expect(repoNameFromUrl("C:\\repos\\fabrikam.git")).toBe("fabrikam");
    expect(repoNameFromUrl("  /srv/git/northwind  ")).toBe("northwind");
  });
  it("is empty when there is nothing to name a folder after", () => {
    for (const u of ["", "   ", "https://example.com", "https://example.com/", "/", ".git"]) expect(repoNameFromUrl(u), u).toBe("");
  });
});

describe("folderNameProblem", () => {
  it("accepts ordinary names and refuses what no folder can be called", () => {
    for (const ok of ["widgets", "my.repo", "a b", "x-1_2"]) expect(folderNameProblem(ok), ok).toBeNull();
    expect(folderNameProblem("")).toBe("empty");
    expect(folderNameProblem("  ")).toBe("empty");
    for (const bad of [".", "..", "a/b", "a\\b", "a:b", "a*b", "a?b", "a|b", "a<b", 'a"b', "name.", "name ", " name", "con", "NUL.txt"]) {
      expect(folderNameProblem(bad), bad).toBe("invalid");
    }
  });
});

describe("cloneTarget", () => {
  it("joins in the separator style of the parent folder", () => {
    expect(cloneTarget("C:\\ws", "widgets")).toBe("C:\\ws\\widgets");
    expect(cloneTarget("C:/ws/", "widgets")).toBe("C:/ws/widgets");
    expect(cloneTarget("/home/me/ws", "widgets")).toBe("/home/me/ws/widgets");
    expect(cloneTarget("C:\\ws\\", "widgets")).toBe("C:\\ws\\widgets");
  });
  it("is empty while the parent or the name is missing", () => {
    expect(cloneTarget("", "widgets")).toBe("");
    expect(cloneTarget("C:\\ws", " ")).toBe("");
  });
});
