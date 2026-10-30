// Reordering by dragging, with pointer events. HTML5 drag and drop does not reach a WebView whose
// window accepts file drops (the Tauri default on Windows), so this works by pointer capture.

export interface SortState {
  id: string;
  /** The item the dragged one would land beside; null over its own place. */
  over: string | null;
  after: boolean;
  /** Where the pointer is, for a label that follows it. */
  x: number;
  y: number;
}

export interface SortOptions {
  axis: "x" | "y";
  /** Selector of the items inside the node; each carries `data-sort-id`. */
  items: string;
  /** Selector of the part of an item that starts a drag; without it, the whole item does. */
  handle?: string;
  /** Live state for the insertion line; null when no drag is going on. */
  onchange: (s: SortState | null) => void;
  ondrop: (id: string, over: string, after: boolean) => void;
}

// A short way before a press becomes a drag, so clicks (sorting a column, opening a group) stay clicks.
const THRESHOLD = 5;

type Box = { id: string; start: number; end: number };

/** Which item the pointer is over, and whether on its far half. Past the last item: after it. */
export function dropTarget(boxes: Box[], pos: number): { over: string; after: boolean } | null {
  if (!boxes.length) return null;
  for (const b of boxes) if (pos < b.end) return { over: b.id, after: pos > (b.start + b.end) / 2 };
  return { over: boxes[boxes.length - 1].id, after: true };
}

export function sortable(node: HTMLElement, options: SortOptions) {
  let o = options;
  let start: { id: string; x: number; y: number; pointer: number } | null = null;
  let dragging = false;
  let state: SortState | null = null;

  const boxes = (): Box[] =>
    [...node.querySelectorAll<HTMLElement>(o.items)].map((el) => {
      const r = el.getBoundingClientRect();
      return { id: el.dataset.sortId ?? "", start: o.axis === "x" ? r.left : r.top, end: o.axis === "x" ? r.right : r.bottom };
    });

  const reset = () => {
    const was = dragging;
    start = null;
    dragging = false;
    state = null;
    if (was) o.onchange(null);
  };

  const down = (e: PointerEvent) => {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    // Resize grips and fields keep their own gesture.
    if (target.closest("[role=separator], input, textarea")) return;
    if (o.handle && !target.closest(o.handle)) return;
    const item = target.closest<HTMLElement>(o.items);
    if (!item || !node.contains(item) || !item.dataset.sortId) return;
    // No text selection and no native drag of the pressed element: the WebView would start one and
    // cancel the pointer stream, and the item would never move. The click that follows still fires.
    e.preventDefault();
    start = { id: item.dataset.sortId, x: e.clientX, y: e.clientY, pointer: e.pointerId };
  };

  const move = (e: PointerEvent) => {
    if (!start || e.pointerId !== start.pointer) return;
    if (!dragging) {
      if (Math.hypot(e.clientX - start.x, e.clientY - start.y) < THRESHOLD) return;
      dragging = true;
      node.setPointerCapture?.(e.pointerId);
    }
    const hit = dropTarget(boxes(), o.axis === "x" ? e.clientX : e.clientY);
    state = { id: start.id, over: hit && hit.over !== start.id ? hit.over : null, after: hit?.after ?? false, x: e.clientX, y: e.clientY };
    o.onchange(state);
  };

  const up = () => {
    if (!start) return;
    if (dragging) {
      if (state?.over) o.ondrop(state.id, state.over, state.after);
      // The click that ends a drag must not also sort the column or open the group it lands on.
      const swallow = (c: Event) => {
        c.stopPropagation();
        c.preventDefault();
      };
      window.addEventListener("click", swallow, { capture: true, once: true });
      setTimeout(() => window.removeEventListener("click", swallow, { capture: true }), 0);
    }
    reset();
  };

  const key = (e: KeyboardEvent) => {
    if (dragging && e.key === "Escape") reset();
  };

  const noNativeDrag = (e: DragEvent) => start && e.preventDefault();

  node.addEventListener("pointerdown", down);
  node.addEventListener("dragstart", noNativeDrag);
  node.addEventListener("pointermove", move);
  node.addEventListener("pointerup", up);
  node.addEventListener("pointercancel", reset);
  window.addEventListener("keydown", key);
  return {
    update(next: SortOptions) {
      o = next;
    },
    destroy() {
      node.removeEventListener("pointerdown", down);
      node.removeEventListener("dragstart", noNativeDrag);
      node.removeEventListener("pointermove", move);
      node.removeEventListener("pointerup", up);
      node.removeEventListener("pointercancel", reset);
      window.removeEventListener("keydown", key);
    },
  };
}
