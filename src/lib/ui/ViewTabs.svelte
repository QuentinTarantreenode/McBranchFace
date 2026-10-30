<script lang="ts" generics="V extends string">
  // The views of the window as tabs: the active one stands on the bar's lower edge in the colour of the
  // view below, so tab and view read as one surface; the others are plain tabs beside it.
  import type { Component } from "svelte";
  import { tooltip, type TooltipInput } from "./tooltip";

  let {
    options,
    value,
    onchange,
    label,
    compact = false,
  }: {
    options: { id: V; label: string; icon: Component<{ size?: number; class?: string }>; badge?: number; tip?: TooltipInput }[];
    value: V;
    onchange: (v: V) => void;
    label: string;
    /** Icons only, the names in the tooltips: for a narrow window. */
    compact?: boolean;
  } = $props();

  function onKey(e: KeyboardEvent) {
    const d = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    const i = options.findIndex((o) => o.id === value);
    const next = options[(i + d + options.length) % options.length];
    onchange(next.id);
    (e.currentTarget as HTMLElement).querySelector<HTMLElement>(`[data-tab="${next.id}"]`)?.focus();
  }
</script>

<div class="flex h-full items-end gap-1 self-stretch" role="tablist" aria-label={label} tabindex="-1" onkeydown={onKey}>
  {#each options as o (o.id)}
    {@const on = o.id === value}
    <button
      type="button"
      role="tab"
      data-tab={o.id}
      aria-selected={on}
      aria-label={compact ? o.label : undefined}
      tabindex={on ? 0 : -1}
      class="relative -mb-px flex items-center gap-2 rounded-t-lg border border-b-0 px-3 font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-accent/60
        {on
          ? 'z-10 h-10 border-line bg-bg text-fg shadow-[inset_0_2px_0_var(--accent)]'
          : 'mb-0 h-9 border-line-strong/60 bg-panel text-muted hover:bg-hover hover:text-fg'}"
      use:tooltip={o.tip ?? null}
      onclick={() => onchange(o.id)}
    >
      <o.icon size={15} class={on ? "text-accent-ink" : ""} />
      {#if !compact}<span>{o.label}</span>{/if}
      {#if o.badge}<span class="mbf-count {compact ? 'absolute -top-1.5 -right-1.5' : ''}">{o.badge}</span>{/if}
    </button>
  {/each}
</div>
