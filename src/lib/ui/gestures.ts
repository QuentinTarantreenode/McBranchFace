// What an element does beyond a plain click, registered where the gesture is wired. A tooltip that asks
// for it (`gestures: true`) reads the hints from here, so it can never promise a gesture the element
// lacks, and an element that has one says so without anyone remembering to write it.

/** A hint is read when the tip shows, so a language switch reaches it too. */
type Hint = string | (() => string);
const registry = new WeakMap<Element, Set<Hint>>();

function register(node: Element, hint: Hint): () => void {
  const set = registry.get(node) ?? new Set<Hint>();
  set.add(hint);
  registry.set(node, set);
  return () => set.delete(hint);
}

/** The hints of the element and its ancestors, nearest first, each once. */
export function gestureHints(node: Element | null): string[] {
  const out: string[] = [];
  for (let n = node; n; n = n.parentElement) {
    for (const h of registry.get(n) ?? []) {
      const text = typeof h === "function" ? h() : h;
      // Empty: the gesture belongs to an ancestor right now, which names it itself.
      if (text && !out.includes(text)) out.push(text);
    }
  }
  return out;
}

interface DoubleClick {
  run: (e: MouseEvent) => unknown;
  /** What tooltips over this element say about the double click. */
  hint: Hint;
  /** A double click on a control inside (a button, a field) belongs to that control. */
  skip?: (e: MouseEvent) => boolean;
}

export function doubleClick(node: HTMLElement, params: DoubleClick) {
  let p = params;
  let off = register(node, p.hint);
  const on = (e: MouseEvent) => {
    if (!p.skip?.(e)) p.run(e);
  };
  node.addEventListener("dblclick", on);
  return {
    update(next: DoubleClick) {
      off();
      p = next;
      off = register(node, p.hint);
    },
    destroy() {
      off();
      node.removeEventListener("dblclick", on);
    },
  };
}

/** For actions of other modules that bring their own gesture (the context menu). */
export const addGestureHint = register;
