// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { foldKeys } from "./foldKeys";

const key = (k: string, altKey = false) => new KeyboardEvent("keydown", { key: k, altKey, cancelable: true });

describe("fold keys of a group head", () => {
  it("fold an open head with left and leave a folded one as it is", () => {
    const toggle = vi.fn();
    expect(foldKeys(key("ArrowLeft"), { open: true, toggle })).toBe(true);
    foldKeys(key("ArrowLeft"), { open: false, toggle });
    expect(toggle).toHaveBeenCalledTimes(1);
  });

  it("open a folded head with right", () => {
    const toggle = vi.fn();
    foldKeys(key("ArrowRight"), { open: false, toggle });
    foldKeys(key("ArrowRight"), { open: true, toggle });
    expect(toggle).toHaveBeenCalledTimes(1);
  });

  it("fold or open the whole level with Alt, else just this head", () => {
    const toggle = vi.fn();
    const all = vi.fn();
    foldKeys(key("ArrowRight", true), { open: true, toggle, all });
    expect(all).toHaveBeenCalledWith(true);
    foldKeys(key("ArrowLeft", true), { open: true, toggle });
    expect(toggle).toHaveBeenCalledTimes(1);
  });

  it("leave other keys alone and cancel only its own", () => {
    const e = key("Enter");
    expect(foldKeys(e, { open: true, toggle: vi.fn() })).toBe(false);
    expect(e.defaultPrevented).toBe(false);
    const left = key("ArrowLeft");
    foldKeys(left, { open: false, toggle: vi.fn() });
    expect(left.defaultPrevented).toBe(true);
  });
});
