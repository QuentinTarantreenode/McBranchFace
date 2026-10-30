// Dragging something onto a target (a repo onto a group), with pointer events: HTML5 drag and drop does
// not reach a WebView whose window accepts file drops (see sortable.ts). Targets mark themselves with
// `data-drop`; the live state is shared, so targets light up and a label follows the pointer.

export interface DragState<T> {
  payload: T;
  /** What the label at the pointer says. */
  label: string;
  x: number;
  y: number;
  /** `data-drop` of the target under the pointer; null over nothing that takes it. */
  target: string | null;
  /** Shift held: move instead of copy, where a target tells the two apart. */
  shift: boolean;
}

class Drag {
  current = $state<DragState<unknown> | null>(null);
}
export const drag = new Drag();

// A short way before a press becomes a drag, so a click stays a click.
const THRESHOLD = 5;

/** The drop target at a point: the nearest `data-drop` around the element there. */
export const dropTargetAt = (el: Element | null): string | null => el?.closest<HTMLElement>("[data-drop]")?.dataset.drop ?? null;

export interface DragOptions<T> {
  payload: () => T;
  label: () => string;
  ondrop: (payload: T, target: string, shift: boolean) => void;
  /** A press on these (a dropdown, a field) belongs to them and starts no drag. */
  skip?: string;
}

export function dragTo<T>(node: HTMLElement, options: DragOptions<T>) {
  let o = options;
  let start: { x: number; y: number; pointer: number } | null = null;
  let active = false;

  const end = () => {
    start = null;
    active = false;
    drag.current = null;
    document.body.classList.remove("mbf-dragging");
    removeEventListener("keydown", onKey, true);
    removeEventListener("pointermove", move);
    removeEventListener("pointerup", up);
    removeEventListener("pointercancel", cancel);
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== "Escape") return;
    e.preventDefault();
    e.stopPropagation();
    end();
  };

  const down = (e: PointerEvent) => {
    if (e.button !== 0 || (o.skip && (e.target as HTMLElement).closest(o.skip))) return;
    start = { x: e.clientX, y: e.clientY, pointer: e.pointerId };
    // From the press on, the window hears the pointer: a quick move leaves the element before its first
    // move event, and the drop target lies elsewhere anyway.
    addEventListener("pointermove", move);
    addEventListener("pointerup", up);
    addEventListener("pointercancel", cancel);
  };
  const move = (e: PointerEvent) => {
    if (!start || e.pointerId !== start.pointer) return;
    if (!active) {
      if (Math.hypot(e.clientX - start.x, e.clientY - start.y) < THRESHOLD) return;
      active = true;
      document.body.classList.add("mbf-dragging");
      addEventListener("keydown", onKey, true);
      drag.current = { payload: o.payload(), label: o.label(), x: e.clientX, y: e.clientY, target: null, shift: e.shiftKey };
    }
    e.preventDefault();
    const target = dropTargetAt(document.elementFromPoint?.(e.clientX, e.clientY) ?? null);
    if (drag.current) drag.current = { ...drag.current, x: e.clientX, y: e.clientY, target, shift: e.shiftKey };
  };
  const up = (e: PointerEvent) => {
    if (!start || e.pointerId !== start.pointer) return;
    const was = active ? drag.current : null;
    end();
    if (!was) return;
    // The click that follows the release belongs to the drag, not to the card under it.
    // It comes in the same task; a later click is the user's again.
    const eat = (c: MouseEvent) => (c.stopPropagation(), c.preventDefault());
    addEventListener("click", eat, { capture: true, once: true });
    setTimeout(() => removeEventListener("click", eat, true), 0);
    if (was.target) o.ondrop(was.payload as T, was.target, e.shiftKey);
  };
  const cancel = () => end();
  // The browser's own drag of text or images would take the pointer away.
  const noNative = (e: DragEvent) => e.preventDefault();

  node.addEventListener("pointerdown", down);
  node.addEventListener("dragstart", noNative);
  return {
    update(next: DragOptions<T>) {
      o = next;
    },
    destroy() {
      if (start) end();
      node.removeEventListener("pointerdown", down);
      node.removeEventListener("dragstart", noNative);
    },
  };
}
