<script lang="ts" module>
  import type { Component } from "svelte";
  import type { TooltipInput } from "./tooltip";

  export interface Segment<V> {
    id: V;
    label: string;
    icon?: Component<{ size?: number; class?: string }>;
    count?: number;
    /** A number over the corner, outside the layout: it may come and go without moving anything. */
    badge?: number;
    tip?: TooltipInput;
  }
</script>

<script lang="ts" generics="T extends string">
  import { tooltip } from "./tooltip";

  let {
    options,
    value,
    onchange,
    label,
  }: {
    options: Segment<T>[];
    value: T;
    onchange: (v: T) => void;
    label: string;
  } = $props();

  function onKey(e: KeyboardEvent) {
    const i = options.findIndex((o) => o.id === value);
    const d = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    const next = options[(i + d + options.length) % options.length];
    onchange(next.id);
    (e.currentTarget as HTMLElement).querySelector<HTMLElement>(`[data-id="${next.id}"]`)?.focus();
  }
</script>

<div
  class="inline-flex shrink-0 rounded-lg border border-line bg-panel-2 p-0.5"
  role="tablist"
  aria-label={label}
  tabindex="-1"
  onkeydown={onKey}
>
  {#each options as o (o.id)}
    {@const on = o.id === value}
    <button
      type="button"
      role="tab"
      data-id={o.id}
      aria-selected={on}
      tabindex={on ? 0 : -1}
      use:tooltip={o.tip}
      class="relative inline-flex items-center gap-1.5 rounded-md font-medium whitespace-nowrap transition-colors
        h-7 px-2.5 text-sm {on ? 'bg-panel text-fg shadow-sm' : 'text-muted hover:bg-hover hover:text-fg'}"
      onclick={() => onchange(o.id)}
    >
      {#if o.icon}<o.icon size={14} />{/if}
      {o.label}
      {#if o.count !== undefined}
        <span class="rounded px-1.5 py-px text-xs tabular-nums {on ? 'bg-panel-2 text-muted' : 'bg-panel text-muted'}">{o.count}</span>
      {/if}
      {#if o.badge}
        <span class="absolute -top-1.5 -right-1.5 grid h-[18px] min-w-[18px] place-items-center rounded-full border border-review/40 bg-panel px-1.5 text-xs leading-none font-semibold text-review-ink tabular-nums">{o.badge}</span>
      {/if}
    </button>
  {/each}
</div>
