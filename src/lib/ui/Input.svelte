<script lang="ts">
  import type { Component, Snippet } from "svelte";
  import type { HTMLInputAttributes } from "svelte/elements";
  import { X } from "@lucide/svelte";
  import { t } from "$lib/i18n/index.svelte";
  import { tooltip, type TooltipInput } from "./tooltip";

  let {
    value = $bindable(""),
    label,
    hint,
    icon: Icon,
    mono = false,
    trailing,
    class: extra = "",
    element = $bindable(),
    tip,
    error,
    clearable = false,
    clearLabel,
    ...rest
  }: HTMLInputAttributes & {
    value?: string | number;
    label?: string;
    hint?: string;
    icon?: Component<{ size?: number; class?: string }>;
    mono?: boolean;
    trailing?: Snippet;
    element?: HTMLInputElement;
    tip?: TooltipInput;
    /** Shown instead of the hint, in red, and marks the field invalid. */
    error?: string | null;
    /** A button that empties the field, shown while it holds text. */
    clearable?: boolean;
    clearLabel?: string;
  } = $props();
</script>

<!-- Inset surface + border + focus ring: an input must never look like static text. -->
<label class="block {extra}">
  {#if label}<span class="mb-1 block text-sm font-medium text-fg">{label}</span>{/if}
  <span
    use:tooltip={tip}
    class="flex h-8 items-center gap-2 rounded-lg border bg-transparent px-2.5 transition-colors focus-within:ring-2
      {error ? 'border-unsafe focus-within:ring-unsafe/20' : 'border-line-strong focus-within:border-accent focus-within:ring-accent/20'}"
  >
    {#if Icon}<Icon size={14} class="shrink-0 text-faint" />{/if}
    <input
      bind:this={element}
      bind:value
      aria-invalid={error ? true : undefined}
      class="min-w-0 flex-1 bg-transparent text-base text-fg outline-none placeholder:text-faint {mono ? 'font-mono' : ''}"
      {...rest}
    />
    {@render trailing?.()}
    {#if clearable && value !== ""}
      <button type="button" class="grid size-5 place-items-center rounded-md border border-line-strong text-faint transition-colors hover:border-faint/60 hover:bg-hover hover:text-fg" aria-label={clearLabel ?? t.common.clear} onclick={() => (value = "")}><X size={13} /></button>
    {/if}
  </span>
  {#if error}<span class="mt-1 block text-xs text-unsafe">{error}</span>{:else if hint}<span class="mt-1 block text-xs text-faint">{hint}</span>{/if}
</label>
