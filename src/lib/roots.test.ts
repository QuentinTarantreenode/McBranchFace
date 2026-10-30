import { describe, expect, it } from "vitest";
import { isWithin, moveRoot, planRootAdds, rootRank, withoutRoot } from "./roots";

const dir = (path: string) => ({ path, dir: true });

describe("roots", () => {
  it("adds new folders and skips files, folders already listed and folders inside a listed one", () => {
    const plan = planRootAdds(["C:\\ws\\a"], [dir("C:/WS/A/"), dir("C:\\ws\\a\\sub"), { path: "C:\\ws\\x.txt", dir: false }, dir("D:\\new\\")]);
    expect(plan.add).toEqual(["D:\\new"]);
    expect(plan.skipped.map((s) => s.reason)).toEqual(["present", "inside", "file"]);
    expect(plan.skipped[1].root).toBe("C:\\ws\\a");
  });

  it("does not add the same folder twice from one drop", () => {
    const plan = planRootAdds([], [dir("D:\\n"), dir("d:/n"), dir("D:\\n\\deeper")]);
    expect(plan.add).toEqual(["D:\\n"]);
    expect(plan.skipped.map((s) => s.reason)).toEqual(["present", "inside"]);
  });

  it("tells a folder inside from one that only shares a name prefix", () => {
    expect(isWithin("C:\\ws\\ab", "C:\\ws\\a")).toBe(false);
    expect(isWithin("C:\\ws\\a\\b", "C:/ws/a/")).toBe(true);
  });

  it("removes a root however it is spelled", () => {
    expect(withoutRoot(["C:\\a", "D:\\b"], "c:/a/")).toEqual(["D:\\b"]);
  });

  it("moves a root before or after another and ignores unknown ones", () => {
    const r = ["a", "b", "c"];
    expect(moveRoot(r, "c", "a", false)).toEqual(["c", "a", "b"]);
    expect(moveRoot(r, "a", "c", true)).toEqual(["b", "c", "a"]);
    expect(moveRoot(r, "a", "b", false)).toEqual(["a", "b", "c"]);
    expect(moveRoot(r, "x", "a", false)).toBe(r);
    expect(moveRoot(r, "a", "a", true)).toBe(r);
  });

  it("ranks unknown roots after the configured ones", () => {
    expect(rootRank(["C:\\a", "C:\\b"], "c:/b")).toBe(1);
    expect(rootRank(["C:\\a"], "Z:\\z")).toBe(1);
  });
});
