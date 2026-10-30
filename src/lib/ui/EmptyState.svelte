<script lang="ts">
  import type { Component, Snippet } from "svelte";

  let {
    icon: Icon,
    title,
    text,
    children,
  }: { icon?: Component<{ size?: number; class?: string }>; title: string; text?: string; children?: Snippet } = $props();
</script>

<div class="grid h-full place-items-center p-8 text-center">
  <div class="max-w-sm">
    {#if Icon}<Icon size={28} class="mx-auto mb-3 text-faint" />{/if}
    <p class="text-lg font-medium">{title}</p>
    {#if text}<p class="mt-1.5 text-base leading-relaxed text-muted">{text}</p>{/if}
    {#if children}<div class="mt-4 flex justify-center gap-2">{@render children()}</div>{/if}
  </div>
</div>
