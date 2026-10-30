// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { dropTarget, sortable } from "./sortable";

const boxes = [
  { id: "a", start: 0, end: 100 },
  { id: "b", start: 100, end: 200 },
  { id: "c", start: 200, end: 300 },
];

describe("sortable", () => {
  it("finds the item under the pointer and the half it is on", () => {
    expect(dropTarget(boxes, 20)).toEqual({ over: "a", after: false });
    expect(dropTarget(boxes, 180)).toEqual({ over: "b", after: true });
    expect(dropTarget(boxes, 999)).toEqual({ over: "c", after: true });
    expect(dropTarget([], 5)).toBeNull();
  });

  function setup(handle?: string) {
    const node = document.createElement("div");
    for (const [i, id] of ["a", "b", "c"].entries()) {
      const item = document.createElement("div");
      item.dataset.sortId = id;
      const button = document.createElement("button");
      button.textContent = `sort ${id}`;
      const grip = document.createElement("span");
      grip.setAttribute("role", "separator");
      item.append(button, grip);
      item.getBoundingClientRect = () => ({ left: i * 100, right: i * 100 + 100, top: 0, bottom: 20, width: 100, height: 20 }) as DOMRect;
      node.append(item);
    }
    document.body.append(node);
    const ondrop = vi.fn();
    const onchange = vi.fn();
    const action = sortable(node, { axis: "x", items: "[data-sort-id]", handle, onchange, ondrop });
    const at = (sel: string) => node.querySelector(sel)!;
    const fire = (el: Element, type: string, x: number) => el.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: 5, pointerId: 1, button: 0 }));
    return { node, ondrop, onchange, action, at, fire };
  }

  it("moves an item by dragging its head, and the click that ends the drag does not also act", () => {
    const { at, fire, ondrop, onchange, action, node } = setup();
    const clicked = vi.fn();
    at("[data-sort-id=a] button").addEventListener("click", clicked);
    // The press is kept from the WebView: a native drag or text selection would cancel the pointer stream.
    expect(fire(at("[data-sort-id=a] button"), "pointerdown", 10)).toBe(false);
    fire(at("[data-sort-id=a] button"), "pointermove", 12);
    expect(onchange).not.toHaveBeenCalled();
    fire(at("[data-sort-id=a] button"), "pointermove", 260);
    expect(onchange).toHaveBeenLastCalledWith({ id: "a", over: "c", after: true, x: 260, y: 5 });
    fire(at("[data-sort-id=a] button"), "pointerup", 260);
    at("[data-sort-id=a] button").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(ondrop).toHaveBeenCalledWith("a", "c", true);
    expect(clicked).not.toHaveBeenCalled();
    expect(onchange).toHaveBeenLastCalledWith(null);
    action.destroy();
    node.remove();
  });

  it("leaves a plain click, the resize grip and Escape alone", () => {
    const { at, fire, ondrop, action, node } = setup();
    const clicked = vi.fn();
    at("[data-sort-id=b] button").addEventListener("click", clicked);
    fire(at("[data-sort-id=b] button"), "pointerdown", 150);
    fire(at("[data-sort-id=b] button"), "pointerup", 150);
    at("[data-sort-id=b] button").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(clicked).toHaveBeenCalledTimes(1);
    fire(at("[data-sort-id=b] [role=separator]"), "pointerdown", 199);
    fire(at("[data-sort-id=b] [role=separator]"), "pointermove", 290);
    fire(at("[data-sort-id=b] [role=separator]"), "pointerup", 290);
    fire(at("[data-sort-id=c] button"), "pointerdown", 250);
    fire(at("[data-sort-id=c] button"), "pointermove", 20);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    fire(at("[data-sort-id=c] button"), "pointerup", 20);
    expect(ondrop).not.toHaveBeenCalled();
    action.destroy();
    node.remove();
  });

  it("with a handle, only the handle starts a drag", () => {
    const { at, fire, ondrop, action, node } = setup("button");
    const drag = (sel: string) => {
      fire(at(sel), "pointerdown", 10);
      fire(at(sel), "pointermove", 260);
      fire(at(sel), "pointerup", 260);
    };
    at("[data-sort-id=a]").append(Object.assign(document.createElement("p"), { className: "body" }));
    drag("[data-sort-id=a] .body");
    expect(ondrop).not.toHaveBeenCalled();
    drag("[data-sort-id=a] button");
    expect(ondrop).toHaveBeenCalledWith("a", "c", true);
    action.destroy();
    node.remove();
  });
});
