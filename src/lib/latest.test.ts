import { afterEach, describe, expect, it, vi } from "vitest";
import { Latest, Throttle, Tickets } from "./latest";

afterEach(() => vi.useRealTimers());

describe("only the newest answer lands", () => {
  it("a ticket is current until a newer one is drawn; a check of now stays true until then", () => {
    const line = new Latest();
    const first = line.next();
    const asOfFirst = line.now();
    expect([first(), asOfFirst()]).toEqual([true, true]);
    const second = line.next();
    expect([first(), asOfFirst(), second()]).toEqual([false, false, true]);
  });

  it("per key, each key has its own line", () => {
    const t = new Tickets();
    const a1 = t.next("a");
    const b1 = t.next("b");
    const a2 = t.next("a");
    expect([a1(), b1(), a2()]).toEqual([false, true, true]);
  });
});

describe("throttle per key", () => {
  it("runs at once after a quiet spell, then once at the end of the gap however often it was asked", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    const t = new Throttle();
    const work = vi.fn();
    expect(t.run("a", 1000, work)).toBe(true);
    expect(t.run("a", 1000, work)).toBe(false);
    expect(t.run("a", 1000, work)).toBe(false);
    // Another key is not held back.
    expect(t.run("b", 1000, work)).toBe(true);
    expect(work).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(1000);
    expect(work).toHaveBeenCalledTimes(3);
    vi.advanceTimersByTime(5000);
    expect(t.run("a", 1000, work)).toBe(true);
  });

  it("forgets what waits for a key that is gone", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    const t = new Throttle();
    const work = vi.fn();
    t.run("a", 1000, work);
    t.run("a", 1000, work);
    t.forget((k) => k !== "a");
    vi.advanceTimersByTime(2000);
    expect(work).toHaveBeenCalledTimes(1);
    // Forgotten: the next call runs at once.
    expect(t.run("a", 1000, work)).toBe(true);
  });
});
