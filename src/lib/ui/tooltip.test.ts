import { describe, expect, it } from "vitest";
import { place, placeBeside } from "./tooltip";

const view = { w: 1000, h: 800 };
const size = { w: 200, h: 60 };

describe("tooltip placement", () => {
  it("sits below-right of the cursor", () => {
    expect(place({ x: 100, y: 100 }, size, view)).toEqual({ x: 114, y: 120 });
  });

  it("flips left at the right edge and up at the bottom edge", () => {
    const p = place({ x: 950, y: 780 }, size, view);
    expect(p.x + size.w).toBeLessThanOrEqual(950);
    expect(p.y + size.h).toBeLessThanOrEqual(780);
  });

  it("never leaves the viewport, even when larger than the free space", () => {
    const p = place({ x: 5, y: 5 }, { w: 2000, h: 2000 }, view);
    expect(p.x).toBeGreaterThanOrEqual(6);
    expect(p.y).toBeGreaterThanOrEqual(6);
  });

  it("a tall tip that fits neither below nor above the cursor is pushed up until it fits", () => {
    // Cursor in the middle of a low window: 500 px do not fit below (380) nor above (380).
    const p = place({ x: 100, y: 400 }, { w: 200, h: 500 }, view);
    expect(p.y + 500).toBeLessThanOrEqual(view.h - 6);
    expect(p.y).toBeGreaterThanOrEqual(6);
  });

  it("stays inside when the anchor lies beyond the edge (keyboard focus on a row cut off at the bottom)", () => {
    const p = place({ x: 100, y: 820 }, size, view);
    expect(p.y + size.h).toBeLessThanOrEqual(view.h - 6);
  });

  it("uses whole pixels, so text stays sharp at any scale", () => {
    const p = place({ x: 10.4, y: 20.6 }, size, view);
    expect(Number.isInteger(p.x) && Number.isInteger(p.y)).toBe(true);
  });
});

describe("placeBeside", () => {
  const view = { w: 1000, h: 800 };
  const size = { w: 200, h: 40 };
  it("stands right of the box at the cursor's height, left where the right has no room", () => {
    expect(placeBeside({ x: 100, y: 300 }, size, view, { left: 50, right: 300 })).toEqual({ x: 308, y: 280 });
    expect(placeBeside({ x: 900, y: 300 }, size, view, { left: 700, right: 950 })).toEqual({ x: 492, y: 280 });
  });
  it("falls back to the cursor where neither side has room", () => {
    const p = placeBeside({ x: 500, y: 300 }, size, view, { left: 100, right: 900 });
    expect(p).toEqual({ x: 514, y: 320 });
  });
});
