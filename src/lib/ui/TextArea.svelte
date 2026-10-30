<script lang="ts">
  import type { HTMLTextareaAttributes } from "svelte/elements";

  let {
    value = $bindable(""),
    label,
    hint,
    mono = false,
    ...rest
  }: HTMLTextareaAttributes & { value?: string; label?: string; hint?: string; mono?: boolean } = $props();
</script>

<label class="block">
  {#if label}<span class="mb-1 block text-sm font-medium text-fg">{label}</span>{/if}
  <textarea
    bind:value
    class="block w-full resize-y rounded-lg border border-line-strong bg-input px-2.5 py-2 text-base text-fg outline-none transition-colors
      placeholder:text-faint focus:border-accent focus:ring-2 focus:ring-accent/20 {mono ? 'font-mono' : ''}"
    {...rest}
  ></textarea>
  {#if hint}<span class="mt-1 block text-xs text-faint">{hint}</span>{/if}
</label>
