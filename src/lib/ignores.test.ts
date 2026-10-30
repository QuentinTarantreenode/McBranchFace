import { describe, expect, it } from "vitest";
import type { Ignore } from "./bindings/Ignore";
import { isIgnored, isLocked, withIgnore, withoutIgnore } from "./ignores";

const ig = (over: Partial<Ignore> = {}): Ignore => ({ identity: "r", branch: "b", scope: "Local", until: null, ...over });

describe("ignores", () => {
  it("match identity, branch, side and expiry", () => {
    const list = [ig(), ig({ branch: "c", scope: "Online", until: 100 })];
    expect(isIgnored(list, "r", "b", false, 50)).toBe(true);
    expect(isIgnored(list, "r", "b", true, 50)).toBe(false);
    expect(isIgnored(list, "r", "c", true, 50)).toBe(true);
    expect(isIgnored(list, "r", "c", true, 100)).toBe(false);
    expect(isIgnored(list, "x", "b", false, 50)).toBe(false);
    expect(isIgnored([ig({ scope: "Both" })], "r", "b", true, 0)).toBe(true);
  });

  it("locks hold a branch, whatever its case, or the whole repository", () => {
    const locks = [{ identity: "r", branch: "Feature/X" }, { identity: "s", branch: null }];
    expect(isLocked(locks, "r", "feature/x")).toBe(true);
    expect(isLocked(locks, "r", "other")).toBe(false);
    expect(isLocked(locks, "r", null)).toBe(false);
    expect(isLocked(locks, "s", "any")).toBe(true);
    expect(isLocked(locks, "s", null)).toBe(true);
    expect(isLocked(locks, "x", "feature/x")).toBe(false);
  });

  it("widen to both sides instead of replacing the other side", () => {
    expect(withIgnore([ig()], "r", "b", true, null, 0)).toEqual([ig({ scope: "Both" })]);
    expect(withIgnore([ig({ until: 10 })], "r", "b", true, 500, 20)).toEqual([ig({ scope: "Online", until: 500 })]);
    expect(withIgnore([ig()], "r", "b", false, 90, 0)).toEqual([ig({ until: 90 })]);
    expect(withIgnore([], "r", "b", false, null, 0)).toEqual([ig()]);
  });

  it("end one side and keep the other", () => {
    expect(withoutIgnore([ig({ scope: "Both" })], "r", "b", true)).toEqual([ig({ scope: "Local" })]);
    expect(withoutIgnore([ig()], "r", "b", false)).toEqual([]);
    expect(withoutIgnore([ig()], "r", "b", true)).toEqual([ig()]);
    expect(withoutIgnore([ig({ branch: "z" })], "r", "b", false)).toEqual([ig({ branch: "z" })]);
  });
});
