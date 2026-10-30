<script lang="ts">
  import { identities } from "$lib/stores/identities.svelte";
  import { FolderGit2 } from "@lucide/svelte";
  import RootBadge from "$lib/ui/RootBadge.svelte";
  import { repoName } from "$lib/filter";
  import { copyLabelIn } from "$lib/repoLabel";
  import { api } from "$lib/api";
  import { t } from "$lib/i18n/index.svelte";
  import { doubleClick } from "$lib/ui/gestures";
  import { tooltip } from "$lib/ui/tooltip";
  import { toasts } from "$lib/stores/toasts.svelte";
  import { scanResults } from "$lib/stores/scanResults.svelte";

  /** A repository by name, behind the badge of the folder it is in; a copy label only where the badge does not tell the copies apart. */
  let { path, stacked = false, inFolder = null }: { path: string; stacked?: boolean; /** Group folder the name is listed under: a label that only repeats it is left out. */ inFolder?: string | null } = $props();

  const group = $derived(scanResults.groupOf(path));
  const badge = $derived(identities.markOf(path));
  const label = $derived(copyLabelIn(path, inFolder));
  // Only where the label says more than the folder's badge: two copies below one root.
  const extra = $derived(label && label !== badge?.badge.name ? label : null);
  // The tip names the repo in its head: beside the badge the name alone does not say which folder.
  // The builder loads on the first hover, not with the start page.
  let nameEl = $state<HTMLElement>();
  const tip = () => import("./repoTip").then((m) => m.repoTip(path, !!nameEl && nameEl.scrollWidth > nameEl.clientWidth + 1));
  const open = $derived({ run: () => toasts.safely(() => api.openFolder(path)), hint: () => t.sidebar.openHint });
</script>

{#snippet pill()}
  {#if group && extra}
    <span class="mbf-copy-pill mbf-truncate-start max-w-full min-w-[min(100%,7ch)] shrink rounded px-1.5 text-xs font-medium" style="--pill: {badge?.badge.color ?? group.color}"><bdi>{extra}</bdi></span>
  {/if}
{/snippet}

{#snippet mark()}
  {#if badge}<RootBadge badge={badge.badge} root={badge.root} tip={false} />{:else}<FolderGit2 size={13} class="shrink-0 text-faint" />{/if}
{/snippet}

<!-- The same in every list as on the sidebar card: the folder's badge, the repo's name, the copy as a pill in the badge's colour. -->
{#if stacked}
  <span class="flex min-w-0 flex-col items-start gap-0.5" use:tooltip={tip} use:doubleClick={open}>
    <span class="flex max-w-full items-center gap-1.5">
      {@render mark()}
      <span class="truncate text-fg" bind:this={nameEl}>{repoName(path)}</span>
    </span>
    {#if group && extra}<span class="ml-[24px] flex max-w-[calc(100%-24px)]">{@render pill()}</span>{/if}
  </span>
{:else}
  <span class="inline-flex min-w-0 items-center gap-1.5 overflow-hidden" use:tooltip={tip} use:doubleClick={open}>
    {@render mark()}
    <!-- Where room runs out the name gives way first: the badge and the start of the name say which repo,
         the copy label is all that tells two copies apart. -->
    <span class="min-w-[4ch] shrink-[10] truncate" bind:this={nameEl}>{repoName(path)}</span>
    {@render pill()}
  </span>
{/if}
