import { describe, expect, it } from "vitest";
import { nextCompactLevel } from "./compact";

const base = { max: 4, widths: [] as (number | undefined)[] };

describe("nextCompactLevel", () => {
  it("grows while the content overflows", () => {
    expect(nextCompactLevel({ ...base, level: 0, available: 800, needed: 950 })).toBe(1);
    expect(nextCompactLevel({ ...base, level: 2, available: 800, needed: 802 })).toBe(3);
  });

  it("tolerates a sub-pixel overflow", () => {
    expect(nextCompactLevel({ ...base, level: 1, available: 800, needed: 800.8, widths: [900] })).toBe(1);
  });

  it("stops growing at the last level", () => {
    expect(nextCompactLevel({ ...base, level: 4, available: 300, needed: 600 })).toBe(4);
  });

  it("shrinks only when the wider level was measured to fit", () => {
    const widths = [1000, 900];
    expect(nextCompactLevel({ ...base, level: 2, available: 899, needed: 820, widths })).toBe(2);
    expect(nextCompactLevel({ ...base, level: 2, available: 900, needed: 820, widths })).toBe(1);
  });

  it("probes a wider level whose width is unknown", () => {
    expect(nextCompactLevel({ ...base, level: 2, available: 900, needed: 820, widths: [1000] })).toBe(1);
  });

  it("stays at full size when it fits", () => {
    expect(nextCompactLevel({ ...base, level: 0, available: 1200, needed: 1000 })).toBe(0);
  });

  it("clamps a level outside the range", () => {
    expect(nextCompactLevel({ ...base, level: 9, available: 300, needed: 600 })).toBe(4);
    expect(nextCompactLevel({ ...base, level: -3, available: 1200, needed: 600 })).toBe(0);
  });

  it("does not oscillate around a width just below the wider level", () => {
    const widths: (number | undefined)[] = [];
    let level = 0;
    const need = [1000, 900, 850, 780, 700];
    for (let i = 0; i < 10; i++) {
      widths[level] = need[level];
      level = nextCompactLevel({ max: 4, level, available: 880, needed: need[level], widths });
    }
    expect(level).toBe(2);
  });
});
