<script lang="ts">
  import type { Component } from "svelte";
  import type { HTMLButtonAttributes } from "svelte/elements";
  import { tooltip } from "./tooltip";

  let {
    icon: Icon,
    label,
    hint,
    keys,
    active = undefined,
    badge,
    badgeTone = "accent",
    size = "md",
    tone = "default",
    element = $bindable(),
    class: extra = "",
    ...rest
  }: HTMLButtonAttributes & {
    icon: Component<{ size?: number; class?: string }>;
    /** Required: becomes aria-label and tooltip title, an icon alone is never self-explanatory. */
    label: string;
    /** Optional explanation under the title. */
    hint?: string;
    keys?: string;
    /** A toggle: shown and announced as on or off. Left out, the button is a plain button. */
    active?: boolean;
    badge?: number;
    badgeTone?: "accent" | "danger";
    size?: "sm" | "md";
    tone?: "default" | "danger";
    element?: HTMLButtonElement;
  } = $props();
</script>

<span class="inline-flex" use:tooltip={{ title: label, text: hint, keys }}>
  <button
    bind:this={element}
    type="button"
    aria-label={badge ? `${label} (${badge})` : label}
    aria-pressed={active}
    class="relative inline-grid shrink-0 place-items-center rounded-lg border transition-colors disabled:pointer-events-none disabled:opacity-40
      {size === 'sm' ? 'size-7' : 'size-8'}
      {active ? 'border-accent/60 bg-accent/14 text-accent-ink hover:bg-accent/20' : 'border-line-strong text-muted hover:border-faint/60 hover:bg-hover hover:text-fg'}
      {tone === 'danger' ? 'hover:!border-unsafe/40 hover:!bg-unsafe/12 hover:!text-unsafe' : ''} {extra}"
    {...rest}
  >
    <Icon size={size === "sm" ? 14 : 16} />
    {#if badge}
      <span
        class="absolute -top-1.5 -right-1.5 grid h-4 min-w-4 place-items-center rounded-full px-1.5 text-[10px] leading-none font-bold tabular-nums ring-2 ring-panel
          {badgeTone === 'danger' ? 'bg-unsafe text-white dark:text-bg' : 'bg-accent text-accent-fg'}"
      >
        {badge > 99 ? "99+" : badge}
      </span>
    {/if}
  </button>
</span>
