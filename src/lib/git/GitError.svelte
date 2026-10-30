<script lang="ts">
  import { TriangleAlert, X } from "@lucide/svelte";
  import { t } from "$lib/i18n/index.svelte";
  import IconButton from "$lib/ui/IconButton.svelte";
  import { fullText } from "$lib/ui/tooltip";
  import { gitStore, type GitResource } from "./gitStore.svelte";

  /** The failed loads of these resources, shown where the resources are shown. */
  let { of, class: extra = "" }: { of: GitResource[]; class?: string } = $props();

  const shown = $derived(of.flatMap((r) => (gitStore.errors[r] ? [{ r, text: gitStore.errors[r] }] : [])));
</script>

{#each shown as e (e.r)}
  <div class="flex shrink-0 items-center gap-2 rounded-lg border border-unsafe/30 bg-unsafe/8 px-3 py-1.5 text-sm text-unsafe-ink {extra}" role="alert">
    <TriangleAlert size={14} class="shrink-0" /><span class="selectable min-w-0 flex-1 truncate" use:fullText={e.text}>{e.text}</span>
    <IconButton icon={X} size="sm" label={t.common.close} onclick={() => gitStore.clearError(e.r)} />
  </div>
{/each}
