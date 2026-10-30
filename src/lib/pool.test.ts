import { describe, expect, it } from "vitest";
import { pooled } from "./pool";

const tick = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("pooled", () => {
  it("never runs more than the limit at once and runs every item", async () => {
    let running = 0;
    let peak = 0;
    const done: number[] = [];
    await pooled([...Array(12).keys()], 3, async (i) => {
      peak = Math.max(peak, ++running);
      await tick(12 - i);
      running--;
      done.push(i);
    });
    expect(peak).toBe(3);
    expect(done.sort((a, b) => a - b)).toEqual([...Array(12).keys()]);
  });

  it("keeps going after a failure, returns what failed, and copes with a limit of zero or no items", async () => {
    const seen: number[] = [];
    const failed = await pooled([1, 2, 3], 0, async (i) => {
      seen.push(i);
      if (i === 1) throw new Error("boom");
    });
    expect(seen).toEqual([1, 2, 3]);
    // What failed comes back instead of vanishing.
    expect(failed.map((f) => [f.item, (f.error as Error).message])).toEqual([[1, "boom"]]);
    await expect(pooled([], 4, async () => {})).resolves.toEqual([]);
  });
});
