import { afterEach, describe, expect, it, vi } from "vitest";
import { frame } from "./frame";

describe("next frame", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("runs once at the next frame, and the timer that follows does not run it again", () => {
    vi.stubEnv("MODE", "production");
    vi.useFakeTimers();
    let paint: () => void = () => {};
    vi.stubGlobal("requestAnimationFrame", (f: () => void) => (paint = f));
    const run = vi.fn();
    frame.next(run);
    expect(run).not.toHaveBeenCalled();
    paint();
    vi.advanceTimersByTime(100);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("still runs in a hidden window, where no frame comes", () => {
    vi.stubEnv("MODE", "production");
    vi.useFakeTimers();
    vi.stubGlobal("requestAnimationFrame", () => 0);
    const run = vi.fn();
    frame.next(run);
    vi.advanceTimersByTime(49);
    expect(run).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(run).toHaveBeenCalledTimes(1);
  });
});
