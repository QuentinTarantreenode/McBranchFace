// Selection in a list the way a file manager does it: click, Ctrl+click, Shift+click, Ctrl+Shift+click,
// all and none. A pure function over the order the user sees, so every list selects the same way.

export interface Selection {
  items: string[];
  /** Where a Shift range starts. */
  anchor: string | null;
  /** The one in front: the detail and the actions follow it. */
  focus: string | null;
}

export type SelectAction =
  | { kind: "click"; id: string; ctrl?: boolean; shift?: boolean }
  /** A group head: its members, alone or (Ctrl) added or taken out; Shift spans from the anchor over all of them. */
  | { kind: "group"; ids: string[]; ctrl?: boolean; shift?: boolean }
  /** Keyboard: the focus moves by `delta`; with Shift the range follows it. */
  | { kind: "move"; delta: number; shift?: boolean }
  | { kind: "toggle"; id: string }
  | { kind: "all" }
  | { kind: "none" }
  /** A known set: only these, these added, or these taken out (a folder's repos from its menu). */
  | { kind: "set"; ids: string[]; mode: "only" | "add" | "remove" };

export const emptySelection: Selection = { items: [], anchor: null, focus: null };

function range(order: string[], from: string | null, to: string): string[] {
  const b = order.indexOf(to);
  const a = from === null ? -1 : order.indexOf(from);
  if (b < 0) return [to];
  if (a < 0) return [to];
  return order.slice(Math.min(a, b), Math.max(a, b) + 1);
}

/** `order`: the selectable rows as shown, folded groups left out. */
export function nextSelection(s: Selection, action: SelectAction, order: string[]): Selection {
  switch (action.kind) {
    case "click": {
      const { id, ctrl, shift } = action;
      if (shift) {
        const span = range(order, s.anchor ?? s.focus, id);
        const items = ctrl ? [...new Set([...s.items, ...span])] : span;
        return { items, anchor: s.anchor ?? s.focus ?? id, focus: id };
      }
      if (ctrl) {
        const has = s.items.includes(id);
        const items = has ? s.items.filter((x) => x !== id) : [...s.items, id];
        return { items, anchor: id, focus: has ? (items.at(-1) ?? null) : id };
      }
      // A plain click on the only selected row clears it again: back to all.
      if (s.items.length === 1 && s.items[0] === id) return emptySelection;
      return { items: [id], anchor: id, focus: id };
    }
    case "group": {
      const { ids, ctrl, shift } = action;
      if (!ids.length) return s;
      const from = s.anchor ?? s.focus;
      const at = from === null ? -1 : order.indexOf(from);
      if (shift && at >= 0) {
        // The rows between the anchor and the farthest member, and the members themselves (folded ones too).
        const marks = [at, ...ids.map((x) => order.indexOf(x)).filter((i) => i >= 0)];
        const span = order.slice(Math.min(...marks), Math.max(...marks) + 1);
        return { items: [...new Set([...(ctrl ? s.items : []), ...span, ...ids])], anchor: from, focus: ids[0] };
      }
      const all = ids.every((x) => s.items.includes(x));
      if (ctrl) {
        const items = all ? s.items.filter((x) => !ids.includes(x)) : [...new Set([...s.items, ...ids])];
        return { items, anchor: ids[0], focus: all ? (items[0] ?? null) : ids[0] };
      }
      if (all && s.items.length === ids.length) return emptySelection;
      return { items: [...ids], anchor: ids[0], focus: ids[0] };
    }
    case "move": {
      if (!order.length) return s;
      const at = s.focus === null ? -1 : order.indexOf(s.focus);
      const next = order[Math.min(order.length - 1, Math.max(0, at < 0 ? (action.delta > 0 ? 0 : order.length - 1) : at + action.delta))];
      if (action.shift) return { items: range(order, s.anchor ?? s.focus ?? next, next), anchor: s.anchor ?? s.focus ?? next, focus: next };
      return { items: [next], anchor: next, focus: next };
    }
    case "toggle":
      return nextSelection(s, { kind: "click", id: action.id, ctrl: true }, order);
    case "all":
      return { items: [...order], anchor: order[0] ?? null, focus: s.focus && order.includes(s.focus) ? s.focus : (order[0] ?? null) };
    case "none":
      return emptySelection;
    case "set": {
      const { ids, mode } = action;
      const items = mode === "only" ? [...ids] : mode === "add" ? [...new Set([...s.items, ...ids])] : s.items.filter((x) => !ids.includes(x));
      if (!items.length) return emptySelection;
      const focus = s.focus && items.includes(s.focus) ? s.focus : (items[0] ?? null);
      return { items, anchor: mode === "remove" ? s.anchor : (ids[0] ?? s.anchor), focus };
    }
  }
}
