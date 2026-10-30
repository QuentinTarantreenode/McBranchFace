import { describe, expect, it } from "vitest";
import { isRich, mono, path, plain, ref, rich, strong } from "./rich";

describe("rich text", () => {
  it("keeps literal parts and values in order and reads back as plain text", () => {
    const r = rich`Merged into ${ref("refs/heads/team/main")} with ${strong(3)} commits (${mono("e06e2da8")})`;
    expect(r).toEqual(["Merged into ", { ref: "refs/heads/team/main" }, " with ", { strong: "3" }, " commits (", { mono: "e06e2da8" }, ")"]);
    expect(plain(r)).toBe("Merged into refs/heads/team/main with 3 commits (e06e2da8)");
    expect(plain("already text")).toBe("already text");
    expect(isRich(r) && !isRich(["a", 1])).toBe(true);
    expect(rich`${ref("x")}`).toEqual([{ ref: "x" }]);
  });

  it("carries a folder as a path part: the whole path when read as text", () => {
    const r = rich`Checked out in ${path("C:/ws/repo-wt")}.`;
    expect(isRich(r)).toBe(true);
    expect(plain(r)).toBe("Checked out in C:/ws/repo-wt.");
  });
});
