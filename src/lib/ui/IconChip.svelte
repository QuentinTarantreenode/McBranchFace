<script lang="ts" module>
  export type ChipTone = "neutral" | "accent" | "review" | "unsafe" | "blocked";

  /** The ink of each tone alone, for signs that share one frame. */
  export const CHIP_INK = {
    neutral: "text-muted",
    accent: "text-accent-ink",
    review: "text-review-ink",
    unsafe: "text-unsafe-ink",
    blocked: "text-blocked-ink",
  } satisfies Record<ChipTone, string>;

  // The same frames as StatusChip: a sign without a count still reads as a sign, not as decoration.
  const tones: Record<ChipTone, string> = {
    neutral: `border-line-strong ${CHIP_INK.neutral}`,
    accent: `border-accent/35 bg-accent/8 ${CHIP_INK.accent}`,
    review: `border-review/30 bg-review/8 ${CHIP_INK.review}`,
    unsafe: `border-unsafe/35 bg-unsafe/10 ${CHIP_INK.unsafe}`,
    blocked: `border-blocked/30 bg-blocked/8 ${CHIP_INK.blocked}`,
  };
</script>

<script lang="ts">
  import type { Component } from "svelte";
  import { tooltip, type TooltipSource } from "./tooltip";

  let {
    icon: Icon,
    tone = "neutral",
    tip,
    label,
  }: { icon: Component<{ size?: number; class?: string }>; tone?: ChipTone; tip?: TooltipSource; label?: string } = $props();
</script>

<span class="inline-grid size-5 shrink-0 place-items-center rounded-md border {tones[tone]}" role={label ? "img" : undefined} aria-label={label} use:tooltip={tip ?? null}>
  <Icon size={12} />
</span>
