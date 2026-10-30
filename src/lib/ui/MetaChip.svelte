<script lang="ts" module>
  export type MetaChipTone = "neutral" | "accent" | "review" | "unsafe" | "blocked";

  // The frames of IconChip and StatusChip, so a fact about the branch reads the same everywhere.
  const tones: Record<MetaChipTone, string> = {
    neutral: "border-line-strong text-muted",
    accent: "border-accent/35 bg-accent/8 text-accent-ink",
    review: "border-review/30 bg-review/8 text-review-ink",
    unsafe: "border-unsafe/35 bg-unsafe/10 text-unsafe-ink",
    blocked: "border-blocked/30 bg-blocked/8 text-blocked-ink",
  };
</script>

<script lang="ts">
  import type { Component, Snippet } from "svelte";
  import { tooltip, type TooltipSource } from "./tooltip";

  /**
   * One fact about a branch – its repo, commit, upstream or a state – in a frame of one height, so a
   * row of them lines up. With `onclick` the chip is a button and shows it on hover.
   */
  let {
    icon: Icon,
    label,
    tip,
    onclick,
    tone = "neutral",
    mono = false,
    class: extra = "",
    children,
  }: {
    icon?: Component<{ size?: number; class?: string }>;
    label?: string;
    tip?: TooltipSource;
    onclick?: (e: MouseEvent) => void;
    tone?: MetaChipTone;
    mono?: boolean;
    class?: string;
    children?: Snippet;
  } = $props();

  const frame = $derived(
    `inline-flex h-6 max-w-full min-w-0 shrink-0 items-center gap-1.5 rounded-md border px-1.5 text-sm whitespace-nowrap ${tones[tone]} ${mono ? "font-mono" : ""} ${extra}`,
  );
</script>

{#snippet body()}
  {#if Icon}<Icon size={13} class="shrink-0" />{/if}
  {#if label}<span class="min-w-0 truncate">{label}</span>{/if}
  {@render children?.()}
{/snippet}

{#if onclick}
  <button type="button" class="{frame} transition-colors hover:border-faint/60 hover:bg-hover hover:text-fg" use:tooltip={tip ?? null} {onclick}>{@render body()}</button>
{:else}
  <span class={frame} use:tooltip={tip ?? null}>{@render body()}</span>
{/if}
