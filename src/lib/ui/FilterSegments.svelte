<script lang="ts" generics="T extends string">
  import { tooltip, type TooltipInput } from "./tooltip";

  /**
   * A toggle filter as one pill: "all" first, then one segment per value with its count. Several
   * values can be on at once; with none on, "all" is.
   */
  let {
    label,
    allLabel,
    allTip,
    total,
    options,
    selected,
    compact = false,
    ontoggle,
    onall,
  }: {
    label: string;
    allLabel: string;
    allTip?: TooltipInput;
    total: number;
    options: { id: T; label: string; count: number; dot: string; tip?: TooltipInput }[];
    selected: T[];
    /** Only dot and count, the label in the tip: for a narrow bar. */
    compact?: boolean;
    ontoggle: (id: T) => void;
    onall: () => void;
  } = $props();

  const none = $derived(selected.length === 0);
</script>

<div role="group" aria-label={label} class="inline-flex shrink-0 items-center gap-0.5 rounded-full border border-line-strong p-0.5">
  <button
    type="button"
    aria-pressed={none}
    use:tooltip={allTip}
    class="inline-flex h-6 items-center gap-1.5 rounded-full px-2.5 text-sm transition-colors {none ? 'bg-raised font-medium text-fg shadow-sm' : 'text-muted hover:bg-hover hover:text-fg'}"
    onclick={onall}
  >
    {allLabel}<span class="mbf-count">{total}</span>
  </button>
  {#each options as o (o.id)}
    {@const on = selected.includes(o.id)}
    <button
      type="button"
      aria-pressed={on}
      aria-label={compact ? `${o.label} ${o.count}` : undefined}
      class="inline-flex h-6 items-center gap-1.5 rounded-full text-sm transition-colors {compact ? 'px-2' : 'px-2.5'}
        {on ? 'bg-accent/15 font-medium text-fg ring-1 ring-accent/50' : 'text-muted hover:bg-hover hover:text-fg'}"
      use:tooltip={compact ? { title: o.label, text: typeof o.tip === "string" ? o.tip : undefined } : o.tip}
      onclick={() => ontoggle(o.id)}
    >
      <span class="size-1.5 rounded-full {o.dot} {o.count ? '' : 'opacity-40'}"></span>
      {#if !compact}{o.label}{/if}
      <span class="mbf-count">{o.count}</span>
    </button>
  {/each}
</div>
