<script lang="ts">
  import { Cloud, CloudOff } from "@lucide/svelte";
  import { refParts } from "$lib/branchName";
  import { t } from "$lib/i18n/index.svelte";
  import IconChip from "$lib/ui/IconChip.svelte";
  import RefName from "$lib/ui/RefName.svelte";
  import { tooltip } from "$lib/ui/tooltip";

  /**
   * Where a branch tracks: the ref while it exists, only the cloud once the server deleted it (the ref
   * moves into the tip), "local only" without one. Never a crossed-out ref: a state is there or not.
   * With \`branch\`, an upstream of the same name shrinks to its remote: the name stands right above.
   */
  let { upstream, gone, branch = null }: { upstream: string | null; gone: boolean; branch?: string | null } = $props();

  const parts = $derived(upstream ? refParts(upstream) : null);
  const sameName = $derived(!!branch && !!parts?.remote && parts.name === branch);
  const tip = $derived(upstream ? { title: t.branchTip.upstream, rows: [{ label: t.branchTip.upstream, value: upstream, kind: "branch" as const }] } : null);
</script>

{#if upstream && gone}
  <IconChip icon={CloudOff} tone="review" label={t.branchTip.gone} tip={{ title: t.branchTip.gone, text: t.cleanup.upstreamGone, rows: [{ label: t.branchTip.upstream, value: upstream, kind: "branch" }] }} />
{:else if upstream && sameName}
  <span class="inline-flex items-center gap-1" use:tooltip={tip}><Cloud size={12} class="shrink-0 text-faint" />{parts?.remote}</span>
{:else if upstream}
  <span class="flex min-w-0"><RefName ref={upstream} /></span>
{:else}
  <span class="text-faint" use:tooltip={t.git.neverPushed}>{t.branchTip.localOnly}</span>
{/if}
