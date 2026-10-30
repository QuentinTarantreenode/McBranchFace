<script lang="ts">
  import { tooltip, type TooltipInput } from "./tooltip";

  let { checked = $bindable(false), label, tip }: { checked?: boolean; label: string; tip?: TooltipInput } = $props();
</script>

<!-- A bordered control like every other button; the track sits inside it. -->
<label
  class="inline-flex h-8 shrink-0 cursor-pointer items-center gap-2 rounded-lg border px-2.5 text-base whitespace-nowrap transition-colors select-none
    {checked ? 'border-accent/50 bg-accent/8 text-fg' : 'border-line-strong text-muted hover:border-faint/60 hover:bg-hover hover:text-fg'}
    has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-accent/40"
  use:tooltip={tip}
>
  <input type="checkbox" role="switch" class="peer sr-only" bind:checked />
  <span
    class="relative h-4 w-7 shrink-0 rounded-full bg-line-strong shadow-[inset_0_1px_2px_rgb(0_0_0/0.18)] transition-colors peer-checked:bg-accent
      after:absolute after:top-0.5 after:left-0.5 after:size-3 after:rounded-full after:bg-white after:shadow-[0_1px_2px_rgb(0_0_0/0.35)] after:transition-transform peer-checked:after:translate-x-3"
  ></span>
  <span>{label}</span>
</label>
