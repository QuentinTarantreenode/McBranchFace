<script lang="ts">
  import { X } from "@lucide/svelte";
  import { tagColor } from "$lib/annotations";
  import { fullText, tooltip, type TooltipInput } from "./tooltip";

  let {
    tag,
    onremove,
    removeLabel,
    removeHint,
    muted = false,
    tip,
    color: fixed,
  }: { tag: string; onremove?: () => void; removeLabel?: string; removeHint?: string; muted?: boolean; tip?: TooltipInput; color?: string } = $props();
  const color = $derived(fixed ?? tagColor(tag));
</script>

<!-- Tinted surface in the tag colour; the text keeps the full colour, which is contrast-checked on --panel. -->
<span
  class="inline-flex h-[18px] max-w-[160px] shrink-0 items-center gap-0.5 rounded-full px-1.5 text-xs font-medium {muted ? 'opacity-75' : ''}"
  style="color: color-mix(in oklab, {color} 78%, var(--fg)); background: color-mix(in oklab, {color} 11%, transparent); box-shadow: inset 0 0 0 1px color-mix(in oklab, {color} 28%, transparent)"
  use:tooltip={tip}
>
  <!-- Without an own tip, a cut-off tag shows its full text. -->
  {#if tip}<span class="truncate">{tag}</span>{:else}<span class="truncate" use:fullText={tag}>{tag}</span>{/if}
  {#if onremove}
    <button type="button" class="-mr-0.5 grid size-3.5 place-items-center rounded-full hover:bg-current/15" aria-label={removeLabel} use:tooltip={{ title: removeLabel, text: removeHint }} onclick={onremove}>
      <X size={10} />
    </button>
  {/if}
</span>
