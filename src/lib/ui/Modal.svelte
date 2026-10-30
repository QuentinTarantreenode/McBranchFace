<script lang="ts">
  import { X } from "@lucide/svelte";
  import type { Snippet } from "svelte";
  import { t } from "$lib/i18n/index.svelte";
  import IconButton from "./IconButton.svelte";

  type Size = { width: number; height: number };

  let {
    open,
    title,
    width = "560px",
    onclose,
    children,
    footer,
    tone = "default",
    dismissible = true,
    resizable = false,
    savedSize = null,
    onsize,
  }: {
    open: boolean;
    title: string;
    width?: string;
    onclose: () => void;
    children: Snippet;
    footer?: Snippet;
    tone?: "default" | "danger";
    /** false while an operation runs: no Esc, no backdrop click, no close button. */
    dismissible?: boolean;
    /** A grip in the corner; the size the user gives it comes back through `onsize`. */
    resizable?: boolean;
    savedSize?: Size | null;
    /** The new size after a resize, null after a reset. */
    onsize?: (s: Size | null) => void;
  } = $props();

  const MIN = { width: 360, height: 240 };
  // Anchored at the top: content that grows (a longer tab, an error line) never moves the head.
  const TOP = "6vh";

  let dialog: HTMLDialogElement | undefined = $state();
  let offset = $state({ x: 0, y: 0 });
  let size = $state<Size | null>(null);

  $effect(() => {
    if (!dialog) return;
    if (open && !dialog.open) {
      offset = { x: 0, y: 0 };
      size = resizable ? savedSize : null;
      dialog.showModal();
      // showModal focuses the first control (the close button) with a visible ring; without an
      // explicit target the dialog itself takes the focus, so Esc and Tab still work.
      (dialog.querySelector<HTMLElement>("[data-autofocus]") ?? dialog).focus();
    }
    if (!open && dialog.open) dialog.close();
  });

  // One gesture at a time, by pointer capture: moving by the head, or resizing by the grip.
  let drag: { kind: "move" | "size"; x: number; y: number; start: { x: number; y: number }; box: Size } | null = null;

  function begin(e: PointerEvent, kind: "move" | "size") {
    if (e.button !== 0 || !dialog) return;
    // Buttons in the head (close) keep their click.
    if (kind === "move" && (e.target as HTMLElement).closest("button")) return;
    const r = dialog.getBoundingClientRect();
    drag = { kind, x: e.clientX, y: e.clientY, start: { ...offset }, box: size ?? { width: r.width, height: r.height } };
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    e.preventDefault();
  }

  function move(e: PointerEvent) {
    if (!drag) return;
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    if (drag.kind === "move") {
      // The head always stays reachable inside the window.
      const half = innerWidth / 2;
      offset = { x: Math.max(-half + 80, Math.min(half - 80, drag.start.x + dx)), y: Math.max(-40, Math.min(innerHeight - 120, drag.start.y + dy)) };
      return;
    }
    const w = Math.max(MIN.width, Math.min(innerWidth - 16, drag.box.width + dx));
    const h = Math.max(MIN.height, Math.min(innerHeight - 16, drag.box.height + dy));
    // The dialog is centred: half of the width change moves the left edge, which is undone here.
    offset = { x: drag.start.x + (w - drag.box.width) / 2, y: offset.y };
    size = { width: Math.round(w), height: Math.round(h) };
  }

  function end() {
    if (drag?.kind === "size" && size) onsize?.(size);
    drag = null;
  }

  function reset() {
    offset = { x: 0, y: 0 };
    if (resizable && size) {
      size = null;
      onsize?.(null);
    }
  }
</script>

<dialog
  bind:this={dialog}
  tabindex="-1"
  onclose={onclose}
  oncancel={(e) => !dismissible && e.preventDefault()}
  onclick={(e) => dismissible && e.target === dialog && onclose()}
  class="mx-auto mb-0 max-w-[96vw] overflow-hidden rounded-2xl border border-line bg-panel p-0 text-fg shadow-panel outline-none"
  style="margin-top: {TOP}; bottom: auto; max-height: calc(100vh - {TOP} - 16px); translate: {offset.x}px {offset.y}px;
    width: {size ? `${size.width}px` : `min(${width}, 92vw)`}; {size ? `height: ${size.height}px;` : ''}"
>
  {#if open}
    <div class="flex flex-col {size ? 'h-full' : ''}" style="max-height: calc(100vh - {TOP} - 16px)">
      <!-- The head moves the dialog; a double click puts it back where it opened. Moving is a pointer
           extra, the dialog works fully without it, hence presentation. -->
      <header
        role="presentation"
        class="flex cursor-grab touch-none items-center gap-3 border-b border-line px-4 py-3 select-none active:cursor-grabbing {tone === 'danger' ? 'bg-unsafe/8' : 'surface-glow'}"
        onpointerdown={(e) => begin(e, "move")}
        onpointermove={move}
        onpointerup={end}
        onpointercancel={end}
        ondblclick={reset}
      >
        <h2 class="flex-1 t-title {tone === 'danger' ? 'text-unsafe' : ''}">{title}</h2>
        {#if dismissible}
          <IconButton icon={X} size="sm" label={t.common.close} keys="Esc" onclick={onclose} />
        {/if}
      </header>
      <div class="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {@render children()}
      </div>
      {#if footer}
        <footer class="flex items-center justify-end gap-2 border-t border-line bg-panel-2/60 px-4 py-2.5">
          {@render footer()}
        </footer>
      {/if}
    </div>
    {#if resizable}
      <div
        role="separator"
        aria-label={t.common.resizeDialog}
        class="absolute right-0 bottom-0 size-4 cursor-nwse-resize touch-none"
        style="background: linear-gradient(135deg, transparent 55%, var(--line-strong) 55%, var(--line-strong) 62%, transparent 62%, transparent 72%, var(--line-strong) 72%, var(--line-strong) 79%, transparent 79%)"
        onpointerdown={(e) => begin(e, "size")}
        onpointermove={move}
        onpointerup={end}
        onpointercancel={end}
      ></div>
    {/if}
  {/if}
</dialog>
