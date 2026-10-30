import { describe, expect, it } from "vitest";
import { minWindow, nearestScale, stepScale } from "./scale";

describe("scale", () => {
  it("snaps any value to an offered step", () => {
    expect(nearestScale(100)).toBe(100);
    expect(nearestScale(120)).toBe(115);
    expect(nearestScale(400)).toBe(130);
    expect(nearestScale(0)).toBe(100);
  });

  it("steps up and down and stops at the ends", () => {
    expect(stepScale(115, 1)).toBe(130);
    expect(stepScale(130, 1)).toBe(130);
    expect(stepScale(115, -1)).toBe(100);
    expect(stepScale(100, -1)).toBe(100);
  });

  it("grows the minimum window with the zoom, but never beyond the screen", () => {
    expect(minWindow(100, { width: 2560, height: 1440 })).toEqual({ width: 1100, height: 620 });
    expect(minWindow(130, { width: 2560, height: 1440 })).toEqual({ width: 1430, height: 806 });
    expect(minWindow(130, { width: 1366, height: 768 })).toEqual({ width: 1229, height: 691 });
    // A screen that reports no size (remote sessions, tests) does not shrink the window to nothing.
    expect(minWindow(115, { width: 0, height: 0 })).toEqual({ width: 1265, height: 713 });
  });
});
