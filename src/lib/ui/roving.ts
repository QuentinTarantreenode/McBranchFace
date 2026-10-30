// Keyboard over a list of rows: one row is in the tab order, the arrows move between them. What a row
// does when the focus arrives (select it, extend a range) is up to the list.

export interface RovingOptions {
  /** The rows in the order they are shown; hidden ones are skipped. */
  rows: string;
  /** The focus moved to `row` by the keyboard; `e` carries Shift and Ctrl. */
  onarrive?: (row: HTMLElement, e: KeyboardEvent) => void;
}

const shown = (el: HTMLElement) => el.getClientRects().length > 0 && !el.closest("[inert]");

export function roving(node: HTMLElement, options: RovingOptions) {
  let opts = options;
  const list = () => [...node.querySelectorAll<HTMLElement>(opts.rows)].filter(shown);

  // Exactly one row is reachable with Tab: the one last focused, else the first.
  const settle = (current?: HTMLElement) => {
    const rows = list();
    const keep = current && rows.includes(current) ? current : (rows.find((r) => r.tabIndex === 0) ?? rows[0]);
    for (const r of rows) r.tabIndex = r === keep ? 0 : -1;
  };

  const onFocusIn = (e: FocusEvent) => {
    const row = (e.target as HTMLElement).closest<HTMLElement>(opts.rows);
    if (row && node.contains(row)) settle(row);
  };

  const onKey = (e: KeyboardEvent) => {
    const rows = list();
    const at = rows.findIndex((r) => r === document.activeElement || r.contains(document.activeElement));
    let to: number;
    if (e.key === "ArrowDown" || (e.key === "j" && !e.ctrlKey)) to = Math.min(rows.length - 1, at + 1);
    else if (e.key === "ArrowUp" || (e.key === "k" && !e.ctrlKey)) to = Math.max(0, at < 0 ? 0 : at - 1);
    else if (e.key === "Home") to = 0;
    else if (e.key === "End") to = rows.length - 1;
    else return;
    // Typing in a field inside the list keeps its keys.
    if ((e.target as HTMLElement).closest("input, textarea, [contenteditable=true]")) return;
    e.preventDefault();
    const row = rows[to];
    if (!row || to === at) return;
    row.focus();
    row.scrollIntoView({ block: "nearest" });
    opts.onarrive?.(row, e);
  };

  node.addEventListener("focusin", onFocusIn);
  node.addEventListener("keydown", onKey);
  // Rows come and go with every status update: settle once per frame, not per mutation.
  let pending = false;
  const observer = new MutationObserver(() => {
    if (pending) return;
    pending = true;
    requestAnimationFrame(() => {
      pending = false;
      settle(document.activeElement instanceof HTMLElement ? (document.activeElement.closest<HTMLElement>(opts.rows) ?? undefined) : undefined);
    });
  });
  observer.observe(node, { childList: true, subtree: true });
  settle();
  return {
    update(next: RovingOptions) {
      opts = next;
    },
    destroy() {
      observer.disconnect();
      node.removeEventListener("focusin", onFocusIn);
      node.removeEventListener("keydown", onKey);
    },
  };
}
