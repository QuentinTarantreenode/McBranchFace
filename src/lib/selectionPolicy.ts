// Which row of a list is selected: one to start with so the detail pane is never empty, and where the
// arrow keys lead. Marking rows goes through `toggled` (lists.ts).

/**
 * The key to select when nothing shown is: the first row that needs attention, else the first. Null keeps
 * the selection as it is (one is shown, or the list is empty).
 */
export function defaultSelection<T>(list: readonly T[], selectionShown: boolean, needsAttention: (b: T) => boolean, keyOf: (b: T) => string): string | null {
  if (selectionShown || list.length === 0) return null;
  return keyOf(list.find(needsAttention) ?? list[0]);
}

/** The index a step of `delta` leads to from `index` (-1: nothing selected, which leads to the first row). */
export function moveIndex(length: number, index: number, delta: number): number {
  return index < 0 ? 0 : Math.min(length - 1, Math.max(0, index + delta));
}
