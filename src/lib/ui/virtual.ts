/** Which rows of a fixed-height list are visible, plus overscan so fast scrolling never shows gaps. */
export function visibleRange(scrollTop: number, viewport: number, rowHeight: number, count: number, overscan = 8) {
  if (count === 0 || rowHeight <= 0) return { start: 0, end: 0 };
  // A list that just got shorter still reports the old offset until the browser clamps it.
  const top = Math.min(Math.max(0, scrollTop), Math.max(0, count * rowHeight - viewport));
  const first = Math.floor(top / rowHeight);
  const visible = Math.ceil(viewport / rowHeight);
  return {
    start: Math.max(0, first - overscan),
    end: Math.min(count, first + visible + overscan),
  };
}

/** New scrollTop that brings `index` into view, or null when it already is. */
export function scrollIntoView(index: number, scrollTop: number, viewport: number, rowHeight: number): number | null {
  const top = index * rowHeight;
  if (top < scrollTop) return top;
  if (top + rowHeight > scrollTop + viewport) return top + rowHeight - viewport;
  return null;
}

/**
 * scrollTop that keeps what the reader looks at in place after the list changed (rows added or
 * removed above, another grouping): the first visible row that is still there keeps its height on
 * screen. null when nothing has to move: at the very top, or when no row survived.
 */
export function restoreAnchor(before: string[], after: string[], scrollTop: number, rowHeight: number): number | null {
  if (scrollTop <= 0 || rowHeight <= 0) return null;
  const first = Math.floor(scrollTop / rowHeight);
  const offset = scrollTop - first * rowHeight;
  const index = new Map(after.map((k, i) => [k, i]));
  for (let i = first; i < before.length; i++) {
    const j = index.get(before[i]);
    if (j !== undefined) return Math.max(0, (j - (i - first)) * rowHeight + offset);
  }
  return null;
}

// ---- rows of different heights: the same answers from the rows' offsets -------------------------

/** Where each row starts: `tops[i]` for row i, `tops[n]` the height of all of them. */
export function rowTops(heights: readonly number[]): number[] {
  const tops = new Array<number>(heights.length + 1);
  tops[0] = 0;
  for (let i = 0; i < heights.length; i++) tops[i + 1] = tops[i] + heights[i];
  return tops;
}

/** The row that covers `y`; the first or the last one for a `y` outside the list. */
export function rowAt(tops: readonly number[], y: number): number {
  const n = tops.length - 1;
  if (n <= 0) return 0;
  let [lo, hi] = [0, n - 1];
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (tops[mid] <= y) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** visibleRange for rows of different heights. */
export function visibleRangeOf(tops: readonly number[], scrollTop: number, viewport: number, overscan = 8) {
  const count = tops.length - 1;
  if (count <= 0) return { start: 0, end: 0 };
  const top = Math.min(Math.max(0, scrollTop), Math.max(0, tops[count] - viewport));
  return {
    start: Math.max(0, rowAt(tops, top) - overscan),
    end: Math.min(count, rowAt(tops, top + viewport) + 1 + overscan),
  };
}

/** scrollIntoView for rows of different heights. */
export function scrollIntoViewOf(tops: readonly number[], index: number, scrollTop: number, viewport: number): number | null {
  const [top, bottom] = [tops[index], tops[index + 1]];
  if (top < scrollTop) return top;
  if (bottom > scrollTop + viewport) return bottom - viewport;
  return null;
}

/** restoreAnchor for rows of different heights. */
export function restoreAnchorOf(before: string[], beforeTops: readonly number[], after: string[], afterTops: readonly number[], scrollTop: number): number | null {
  if (scrollTop <= 0 || !before.length) return null;
  const first = rowAt(beforeTops, scrollTop);
  const offset = scrollTop - beforeTops[first];
  const index = new Map(after.map((k, i) => [k, i]));
  for (let i = first; i < before.length; i++) {
    const j = index.get(before[i]);
    if (j !== undefined) return Math.max(0, afterTops[j] - (beforeTops[i] - beforeTops[first]) + offset);
  }
  return null;
}
