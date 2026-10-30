import { describe, expect, it } from "vitest";
import { sameValue } from "./same";

describe("same value", () => {
  it("compares plain data deeply, keys in any order", () => {
    const status = { path: "a", head: { branch: "main", ahead: 0 }, entries: [{ path: "x", staged: null }], stashes: 1 };
    expect(sameValue(status, structuredClone(status))).toBe(true);
    expect(sameValue({ a: 1, b: [1, 2] }, { b: [1, 2], a: 1 })).toBe(true);
    expect(sameValue(status, { ...status, entries: [{ path: "x", staged: "Modified" }] })).toBe(false);
    expect(sameValue(status, { ...status, stashes: 2 })).toBe(false);
    expect(sameValue([1, 2], [1, 2, 3])).toBe(false);
    expect(sameValue({ a: undefined }, { b: undefined })).toBe(false);
    expect(sameValue([], {})).toBe(false);
    expect(sameValue(null, {})).toBe(false);
    expect(sameValue(null, null)).toBe(true);
  });
});
