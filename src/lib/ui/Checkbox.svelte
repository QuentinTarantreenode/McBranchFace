<script lang="ts">
  import { Check, Minus } from "@lucide/svelte";
  import type { Snippet } from "svelte";
  import { tooltip, type TooltipSource } from "./tooltip";

  let {
    checked = $bindable(false),
    indeterminate = false,
    label,
    description,
    ariaLabel,
    tip,
    tone = "accent",
    disabled = false,
    children,
    onchange,
  }: {
    checked?: boolean;
    indeterminate?: boolean;
    label?: string;
    description?: string;
    /** For a checkbox without visible label, e.g. in a table row. */
    ariaLabel?: string;
    /** What a click does, for a checkbox whose label does not say it. */
    tip?: TooltipSource;
    tone?: "accent" | "danger";
    disabled?: boolean;
    children?: Snippet;
    onchange?: (checked: boolean) => void;
  } = $props();

  const on = $derived(checked || indeterminate);
</script>

<!--
  Two-column grid: the box sits in a cell exactly one text line high, so it is centred on the first
  line of the label; the description starts in the label column, never under the box.
-->
<label
  class="inline-grid items-start gap-x-2.5 text-base
    {label || children ? 'grid-cols-[16px_minmax(0,1fr)]' : 'grid-cols-[16px]'} {disabled ? 'opacity-50' : 'cursor-pointer'}"
  use:tooltip={tip}
>
  <span class="relative flex h-[19px] items-center">
    <input
      type="checkbox"
      class="peer absolute inset-0 m-0 size-full cursor-[inherit] opacity-0"
      bind:checked
      {indeterminate}
      {disabled}
      aria-label={ariaLabel}
      onchange={() => onchange?.(checked)}
    />
    <span
      aria-hidden="true"
      class="grid size-4 place-items-center rounded-[4px] border transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-offset-1 peer-focus-visible:ring-offset-panel
        {on
          ? tone === 'danger'
            ? 'border-unsafe bg-unsafe text-white dark:text-bg peer-focus-visible:ring-unsafe/40'
            : 'border-accent bg-accent text-accent-fg peer-focus-visible:ring-accent/40'
          : 'border-line-strong bg-input peer-hover:border-faint peer-focus-visible:ring-accent/40'}"
    >
      {#if indeterminate}<Minus size={12} strokeWidth={3} />{:else if checked}<Check size={12} strokeWidth={3} />{/if}
    </span>
  </span>
  {#if label || children}
    <span class="min-w-0 leading-[19px]">
      {#if label}{label}{/if}
      {@render children?.()}
    </span>
  {/if}
  {#if description}<span class="col-start-2 mt-0.5 text-sm text-faint">{description}</span>{/if}
</label>
