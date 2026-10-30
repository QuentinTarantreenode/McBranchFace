// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { drag, dragTo, dropTargetAt } from "./dragTo.svelte";

const pointer = (type: string, x: number, y: number, extra: PointerEventInit = {}) =>
  new PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId: 1, button: 0, ...extra });

const el = (tag: string, attrs: Record<string, string> = {}, ...children: Element[]) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  e.append(...children);
  return e;
};

function setup(skip?: string) {
  const src = el("div", {}, el("button", { "aria-haspopup": "dialog" }));
  const target = el("span");
  document.body.append(src, el("div", { "data-drop": "group:a" }, target));
  const ondrop = vi.fn();
  const action = dragTo(src, { payload: () => ({ paths: ["/r"] }), label: () => "r", ondrop, skip });
  let under: Element | null = null;
  Object.assign(document, { elementFromPoint: () => under });
  return { src, target, ondrop, action, over: (el: Element | null) => (under = el) };
}

afterEach(() => {
  drag.current = null;
  document.body.replaceChildren();
});

describe("dragTo", () => {
  it("finds the nearest drop target around an element", () => {
    const inner = el("b");
    document.body.append(el("div", { "data-drop": "out" }, el("div", { "data-drop": "group:a" }, inner)));
    expect(dropTargetAt(inner)).toBe("group:a");
    expect(dropTargetAt(null)).toBeNull();
  });

  it("stays a click below the threshold and drops on the target under the pointer beyond it", () => {
    const { src, target, ondrop, over } = setup();
    src.dispatchEvent(pointer("pointerdown", 10, 10));
    window.dispatchEvent(pointer("pointermove", 12, 12));
    expect(drag.current).toBeNull();
    over(target);
    window.dispatchEvent(pointer("pointermove", 40, 40, { shiftKey: true }));
    expect(drag.current).toMatchObject({ label: "r", target: "group:a", shift: true });
    window.dispatchEvent(pointer("pointerup", 40, 40, { shiftKey: true }));
    expect(ondrop).toHaveBeenCalledWith({ paths: ["/r"] }, "group:a", true);
    expect(drag.current).toBeNull();
  });

  it("drops nothing over no target, and Esc cancels", () => {
    const { src, target, ondrop, over } = setup();
    src.dispatchEvent(pointer("pointerdown", 0, 0));
    window.dispatchEvent(pointer("pointermove", 30, 0));
    window.dispatchEvent(pointer("pointerup", 30, 0));
    expect(ondrop).not.toHaveBeenCalled();
    over(target);
    src.dispatchEvent(pointer("pointerdown", 0, 0));
    window.dispatchEvent(pointer("pointermove", 30, 0));
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(drag.current).toBeNull();
    window.dispatchEvent(pointer("pointerup", 30, 0));
    expect(ondrop).not.toHaveBeenCalled();
  });

  it("leaves a press on a control inside to the control", () => {
    const { src, ondrop } = setup("[aria-haspopup]");
    const button = src.querySelector("button")!;
    button.dispatchEvent(pointer("pointerdown", 0, 0));
    window.dispatchEvent(pointer("pointermove", 50, 0));
    expect(drag.current).toBeNull();
    expect(ondrop).not.toHaveBeenCalled();
  });

  it("swallows the click that ends a drag, not the next one", async () => {
    const { src, target, over } = setup();
    const clicked = vi.fn();
    src.addEventListener("click", clicked);
    over(target);
    src.dispatchEvent(pointer("pointerdown", 0, 0));
    window.dispatchEvent(pointer("pointermove", 30, 0));
    window.dispatchEvent(pointer("pointerup", 30, 0));
    src.click();
    expect(clicked).not.toHaveBeenCalled();
    await new Promise((r) => setTimeout(r, 0));
    src.click();
    expect(clicked).toHaveBeenCalledTimes(1);
  });
});
