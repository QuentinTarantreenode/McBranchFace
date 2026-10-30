<script lang="ts" generics="T">
  import { onDestroy, untrack, type Snippet } from "svelte";
  import { restoreAnchor, restoreAnchorOf, rowAt, rowTops, scrollIntoView, scrollIntoViewOf, visibleRange, visibleRangeOf } from "./virtual";

  const UNMEASURED_HEIGHT = 1080;

  let {
    items,
    rowHeight,
    heightOf,
    key,
    row,
    empty,
    sticky,
    activeKey = null,
    class: extra = "",
    onkeydown,
    label,
    onnearend,
    ontop,
    scrollTop = $bindable(0),
  }: {
    items: T[];
    /** The height of every row; `heightOf` instead, where rows differ (heads and rows of a tree). */
    rowHeight: number;
    heightOf?: (item: T) => number;
    key: (item: T) => string;
    row: Snippet<[T, number]>;
    empty?: Snippet;
    /** What stays at the top while the rows scroll under it (the heads of the group in view); takes no room. */
    sticky?: Snippet;
    /** Brought into view when it changes (click, keyboard); a rebuilt list only keeps its place. */
    activeKey?: string | null;
    class?: string;
    onkeydown?: (e: KeyboardEvent) => void;
    label?: string;
    /** Fires when the visible window gets close to the end — for paging. */
    onnearend?: () => void;
    /** The index of the row at the top of the viewport, whenever it changes. */
    ontop?: (index: number) => void;
    /** How far the list is scrolled; bound where something follows the scrolling itself. */
    scrollTop?: number;
  } = $props();

  let viewport: HTMLDivElement | undefined = $state();
  let height = $state(0);
  let scrolling = $state(false);
  let settle: ReturnType<typeof setTimeout> | undefined;
  onDestroy(() => clearTimeout(settle));

  const keys = $derived(items.map(key));
  // Rows of one height need no offsets: row i starts at i × rowHeight.
  const tops = $derived(heightOf ? rowTops(items.map(heightOf)) : null);
  const topOf = (i: number) => (tops ? tops[i] : i * rowHeight);
  const total = $derived(tops ? tops[items.length] : items.length * rowHeight);
  // Until the viewport is measured, a screenful: the first frame must not show only a handful of rows.
  const viewportHeight = $derived(height || UNMEASURED_HEIGHT);
  const range = (y: number) => (tops ? visibleRangeOf(tops, y, viewportHeight) : visibleRange(y, viewportHeight, rowHeight, items.length));
  // Separate numbers: the slice is rebuilt only when a row boundary is crossed, not on every scroll event.
  const start = $derived(range(scrollTop).start);
  const end = $derived(range(scrollTop).end);
  const slice = $derived(items.slice(start, end));
  const top = $derived(tops ? rowAt(tops, scrollTop) : Math.min(items.length - 1, Math.floor(scrollTop / rowHeight)));
  $effect(() => {
    const i = top;
    // untrack: the callback belongs to the parent and may read and write its own state.
    untrack(() => ontop?.(Math.max(0, i)));
  });

  /** Writes the viewport and the state together, so no frame is painted with a stale offset. */
  function setScroll(top: number) {
    if (!viewport) return;
    viewport.scrollTop = top;
    scrollTop = viewport.scrollTop;
  }

  // Before the new rows render: keep the row the reader looks at in place.
  let before: string[] = [];
  let beforeTops: number[] | null = null;
  $effect.pre(() => {
    const after = keys;
    const afterTops = tops;
    untrack(() => {
      if (viewport && before.length && after !== before) {
        const top = afterTops && beforeTops ? restoreAnchorOf(before, beforeTops, after, afterTops, viewport.scrollTop) : restoreAnchor(before, after, viewport.scrollTop, rowHeight);
        if (top !== null) scrollTop = top;
      }
      before = after;
      beforeTops = afterTops;
    });
  });
  // After they rendered: the spacer has its new height, so the viewport can follow the state.
  $effect(() => {
    void keys;
    untrack(() => {
      if (!viewport) return;
      if (Math.abs(viewport.scrollTop - scrollTop) >= 1) setScroll(scrollTop);
      else scrollTop = viewport.scrollTop;
    });
  });

  // Also when the rows change: a key asked for before its row was there is brought into view once it is.
  let shown: string | null = null;
  $effect(() => {
    const k = activeKey;
    void keys;
    untrack(() => {
      if (!viewport || k === null || k === shown) return;
      const i = keys.indexOf(k);
      if (i < 0) return;
      shown = k;
      const next = tops ? scrollIntoViewOf(tops, i, viewport.scrollTop, viewport.clientHeight) : scrollIntoView(i, viewport.scrollTop, viewport.clientHeight, rowHeight);
      if (next !== null) setScroll(next);
    });
  });

  $effect(() => {
    // untrack: the callback reads its own state, which must not re-trigger this effect.
    if (onnearend && items.length > 0 && end >= items.length - 20) untrack(onnearend);
  });

  function onscroll() {
    if (!viewport) return;
    scrollTop = viewport.scrollTop;
    // Rows passing under a resting pointer must not light up or open tooltips.
    scrolling = true;
    clearTimeout(settle);
    settle = setTimeout(() => (scrolling = false), 150);
  }
</script>

<div
  bind:this={viewport}
  bind:clientHeight={height}
  {onscroll}
  class="mbf-virtual min-h-0 overflow-y-auto outline-none {extra}"
  data-scrolling={scrolling || undefined}
  tabindex="0"
  role="listbox"
  aria-label={label}
  {onkeydown}
>
  {#if items.length === 0}
    {@render empty?.()}
  {:else}
    {#if sticky}
      <!-- Sticky inside the scroll box: it stays clear of the scrollbar, and with no height it moves no row. -->
      <div class="sticky top-0 z-10 h-0">{@render sticky()}</div>
    {/if}
    <!-- Each row places itself by its index: position and content always change together, and
         DOM order is irrelevant, so no frame can show rows shifted against their slot. -->
    <div style="height: {total}px; position: relative">
      {#each slice as item, i (key(item))}
        <!-- data-row marks every slot, headers included, for layout checks that measure coverage. -->
        <div class="absolute inset-x-0" data-row={key(item)} style="top: {topOf(start + i)}px; height: {topOf(start + i + 1) - topOf(start + i)}px">
          {@render row(item, start + i)}
        </div>
      {/each}
    </div>
  {/if}
</div>
