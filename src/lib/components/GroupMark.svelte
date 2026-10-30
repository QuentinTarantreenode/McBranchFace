<script lang="ts">
  import { Boxes } from "@lucide/svelte";
  import { identityKey } from "./identityKey";
  import { settings } from "$lib/stores/settings.svelte";

  /** A repo group's sign: its own short sign as a badge, else the group icon, in its colour where it has one. */
  let { id, active = false }: { id: string; active?: boolean } = $props();
  const own = $derived(settings.config?.identities[identityKey("group", id)]);
</script>

{#if own?.short}
  <span class="mbf-root-badge" style="--root: {own.color ? `var(--${own.color})` : 'var(--accent)'}">{own.short}</span>
{:else}
  <Boxes size={13} class="shrink-0 {active ? 'text-accent-ink' : own?.color ? '' : 'text-faint'}" style={own?.color && !active ? `color: var(--${own.color})` : undefined} />
{/if}
