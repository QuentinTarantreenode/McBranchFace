import { describe, expect, it } from "vitest";
import { restoreAnchor, restoreAnchorOf, rowAt, rowTops, scrollIntoView, scrollIntoViewOf, visibleRange, visibleRangeOf } from "./virtual";

const keys = (n: number, p = "k") => Array.from({ length: n }, (_, i) => `${p}${i}`);

describe("virtual list math", () => {
  it("renders only the visible window plus overscan", () => {
    expect(visibleRange(0, 400, 40, 10_000, 8)).toEqual({ start: 0, end: 18 });
    expect(visibleRange(40_000, 400, 40, 10_000, 8)).toEqual({ start: 992, end: 1018 });
    expect(visibleRange(399_600, 400, 40, 10_000, 8)).toEqual({ start: 9982, end: 10_000 });
    expect(visibleRange(0, 400, 40, 0)).toEqual({ start: 0, end: 0 });
  });

  it("never renders an empty window when the list got shorter than the old offset", () => {
    // 200 rows scrolled far down, then groups fold to 12 rows: the last rows stay visible.
    const r = visibleRange(6000, 400, 40, 12, 8);
    expect(r.start).toBeLessThan(r.end);
    expect(r).toEqual({ start: 0, end: 12 });
    expect(visibleRange(-50, 400, 40, 100, 8)).toEqual({ start: 0, end: 18 });
  });

  it("scrolls only when the row is outside the viewport", () => {
    expect(scrollIntoView(5, 0, 400, 40)).toBeNull();
    expect(scrollIntoView(20, 0, 400, 40)).toBe(20 * 40 + 40 - 400);
    expect(scrollIntoView(2, 400, 400, 40)).toBe(80);
  });

  it("keeps the first visible row in place when rows are inserted or removed above it", () => {
    const before = keys(100);
    // Row k10 is at the top, 12 px scrolled into it; three group headers are inserted above.
    const after = ["h0", ...before.slice(0, 5), "h1", ...before.slice(5, 9), "h2", ...before.slice(9)];
    expect(restoreAnchor(before, after, 10 * 44 + 12, 44)).toBe(13 * 44 + 12);
    // Rows above vanish: the same row moves up in the list, the view follows.
    expect(restoreAnchor(before, before.slice(4), 10 * 44, 44)).toBe(6 * 44);
  });

  it("uses the next surviving row when the top row itself is gone, and stays put at the top", () => {
    const before = keys(50);
    const after = before.filter((k) => k !== "k10" && k !== "k11");
    // k12 was two rows below the top; it keeps that screen position.
    expect(restoreAnchor(before, after, 10 * 40, 40)).toBe(8 * 40);
    expect(restoreAnchor(before, ["x", ...before], 0, 40)).toBeNull();
    expect(restoreAnchor(before, keys(5, "other"), 400, 40)).toBeNull();
  });
});

describe("virtual list math, rows of different heights", () => {
  // Heads of 32 and 24 px between rows of 28 px, as in the list of changes.
  const heights = [32, 28, 24, 28, 28, 28, 24, 28];
  const tops = rowTops(heights);

  it("knows where each row starts and which row covers a point", () => {
    expect(tops).toEqual([0, 32, 60, 84, 112, 140, 168, 192, 220]);
    expect([rowAt(tops, 0), rowAt(tops, 31), rowAt(tops, 32), rowAt(tops, 219), rowAt(tops, 500), rowAt(tops, -5)]).toEqual([0, 0, 1, 7, 7, 0]);
    expect(rowAt([0], 10)).toBe(0);
  });

  it("renders the visible window plus overscan, also after the list got shorter", () => {
    expect(visibleRangeOf(tops, 60, 56, 1)).toEqual({ start: 1, end: 6 });
    expect(visibleRangeOf(tops, 5000, 100, 0)).toEqual({ start: 4, end: 8 });
    expect(visibleRangeOf([0], 0, 100)).toEqual({ start: 0, end: 0 });
  });

  it("scrolls only when the row is outside the viewport", () => {
    expect(scrollIntoViewOf(tops, 1, 0, 100)).toBeNull();
    expect(scrollIntoViewOf(tops, 5, 0, 100)).toBe(168 - 100);
    expect(scrollIntoViewOf(tops, 1, 100, 100)).toBe(32);
  });

  it("keeps the row at the top in place when rows of another height come or go above it", () => {
    const before = keys(8);
    const after = ["new", ...before];
    // k3 is at the top, 10 px into it; a head of 32 px comes in above.
    expect(restoreAnchorOf(before, tops, after, rowTops([32, ...heights]), 84 + 10)).toBe(84 + 32 + 10);
    expect(restoreAnchorOf(before, tops, before.slice(2), rowTops(heights.slice(2)), 84 + 10)).toBe(24 + 10);
    expect(restoreAnchorOf(before, tops, after, rowTops([32, ...heights]), 0)).toBeNull();
  });
});
