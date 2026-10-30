<script lang="ts" module>
  export type ButtonVariant = "primary" | "delete" | "danger" | "danger-outline" | "secondary" | "ghost";
  export type ButtonSize = "sm" | "md";

  const variants: Record<ButtonVariant, string> = {
    primary: "bg-accent text-accent-fg shadow-sm hover:brightness-110 active:brightness-95",
    // Deleting is never green, even when it is safe: a pastel red that reads as "removes something".
    delete: "border border-unsafe/40 bg-unsafe/12 text-unsafe-ink hover:bg-unsafe/20 active:bg-unsafe/25 dark:bg-unsafe/18 dark:hover:bg-unsafe/26",
    danger: "bg-unsafe text-white shadow-sm hover:brightness-110 active:brightness-95 dark:text-bg",
    "danger-outline": "border border-unsafe/45 text-unsafe-ink hover:bg-unsafe/10 active:bg-unsafe/15",
    secondary: "border border-line-strong bg-panel text-fg hover:bg-hover active:bg-line",
    ghost: "border border-line-strong text-muted hover:border-faint/60 hover:bg-hover hover:text-fg active:bg-line",
  };
  const sizes: Record<ButtonSize, string> = {
    sm: "h-7 px-2.5 text-sm gap-1.5",
    md: "h-8 px-3 text-base gap-2",
  };
</script>

<script lang="ts">
  import type { Component, Snippet } from "svelte";
  import type { HTMLButtonAttributes } from "svelte/elements";
  import { tooltip, type TooltipInput } from "./tooltip";

  let {
    variant = "secondary",
    size = "md",
    icon: Icon,
    tip,
    busy = false,
    count = 0,
    children,
    class: extra = "",
    ...rest
  }: HTMLButtonAttributes & {
    variant?: ButtonVariant;
    size?: ButtonSize;
    icon?: Component<{ size?: number; class?: string }>;
    tip?: TooltipInput;
    /** Running: the icon turns, and the button stays legible although it is disabled. */
    busy?: boolean;
    /** How many of its values are active, as a chip after the label; nothing while none is. */
    count?: number;
    children?: Snippet;
  } = $props();
</script>

<!-- The wrapper carries the tooltip, because disabled buttons receive no pointer events. -->
<span class="inline-flex" use:tooltip={tip}>
  <button
    type="button"
    class="inline-flex shrink-0 items-center justify-center rounded-lg font-medium whitespace-nowrap transition-colors
      disabled:pointer-events-none {busy ? 'disabled:opacity-80' : 'disabled:opacity-45'} {variants[variant]} {sizes[size]} {extra}"
    aria-busy={busy || undefined}
    {...rest}
  >
    {#if Icon}<Icon size={size === "sm" ? 13 : 14} class={busy ? "animate-spin" : undefined} />{/if}
    {@render children?.()}{#if count}<span class="ml-0.5 rounded bg-accent/15 px-1 text-xs tabular-nums text-accent-ink">{count}</span>{/if}
  </button>
</span>
