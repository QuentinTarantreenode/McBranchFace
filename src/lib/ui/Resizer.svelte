<script lang="ts">
  import { tooltip } from "./tooltip";
  import { t } from "$lib/i18n/index.svelte";

  let {
    width = $bindable(),
    min,
    max,
    side,
    onend,
    oninput,
    onreset,
    label = t.common.resize,
  }: {
    width: number;
    min: number;
    max: number;
    /** Which edge of the panel the handle sits on; dragging outward grows the panel. */
    side: "left" | "right";
    onend?: (width: number) => void;
    /** Every step while dragging, for a live preview when the width is not bound. */
    oninput?: (width: number) => void;
    /** Double click: back to the default width. */
    onreset?: () => void;
    label?: string;
  } = $props();

  function start(e: PointerEvent) {
    // Only this handle: a draggable parent (a column head) must not start a move. No text selection
    // or native drag either: the WebView would start one and cancel the pointer stream mid-drag.
    e.stopPropagation();
    e.preventDefault();
    const handle = e.currentTarget as HTMLElement;
    handle.setPointerCapture(e.pointerId);
    const x0 = e.clientX;
    const w0 = width;
    const move = (m: PointerEvent) => {
      const dx = m.clientX - x0;
      width = Math.round(Math.min(max, Math.max(min, side === "right" ? w0 + dx : w0 - dx)));
      oninput?.(width);
    };
    const up = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", up);
      handle.removeEventListener("pointercancel", up);
      onend?.(width);
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", up);
    // A lost capture (window switch, touch cancel) ends the drag like a release.
    handle.addEventListener("pointercancel", up);
  }

  function key(e: KeyboardEvent) {
    const step = e.shiftKey ? 40 : 10;
    const grow = side === "right" ? "ArrowRight" : "ArrowLeft";
    const shrink = side === "right" ? "ArrowLeft" : "ArrowRight";
    if (e.key === grow) width = Math.min(max, width + step);
    else if (e.key === shrink) width = Math.max(min, width - step);
    else return;
    e.preventDefault();
    e.stopPropagation();
    onend?.(width);
  }
</script>

<!-- A focusable separator with aria-value* is the WAI-ARIA window splitter pattern, i.e. interactive. -->
<!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
<div
  role="separator"
  aria-orientation="vertical"
  aria-valuenow={width}
  aria-valuemin={min}
  aria-valuemax={max}
  tabindex="0"
  aria-label={label}
  draggable="false"
  use:tooltip={{ title: label, keys: "← →" }}
  class="group pointer-events-auto absolute top-0 bottom-0 z-10 w-2.5 cursor-col-resize touch-none outline-none select-none {side === 'right' ? '-right-[5px]' : '-left-[5px]'}"
  onpointerdown={start}
  ondblclick={(e) => {
    e.stopPropagation();
    onreset?.();
  }}
  onkeydown={key}
>
  <div class="mx-auto h-full w-px bg-transparent transition-colors group-hover:bg-accent group-focus-visible:bg-accent"></div>
  <!-- At rest a short grip in the middle says the edge can be dragged; the line takes over on hover. -->
  <div class="pointer-events-none absolute top-1/2 left-1/2 h-6 max-h-[60%] w-[3px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-line-strong transition-opacity group-hover:opacity-0 group-focus-visible:opacity-0"></div>
</div>
