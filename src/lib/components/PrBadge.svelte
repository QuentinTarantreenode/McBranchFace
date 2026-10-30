<script lang="ts">
  import { GitPullRequest } from "@lucide/svelte";
  import { untrack } from "svelte";
  import { t } from "$lib/i18n/index.svelte";
  import { pullRequests } from "$lib/stores/pullRequests.svelte";
  import { openBelow } from "$lib/ui/menu.svelte";
  import { tooltip } from "$lib/ui/tooltip";

  let { path }: { path: string } = $props();

  const count = $derived(pullRequests.count(path));
  const failed = $derived(pullRequests.failedFor(path));
  // Loads when the path changes only: the load reads the lists it writes.
  $effect(() => {
    const p = path;
    untrack(() => void pullRequests.load(p));
  });
</script>

<!-- Shown while the repo has open pull requests, a count to act on, or while they could not be loaded. -->
{#if count || failed}
  <button
    type="button"
    class="inline-flex h-5 shrink-0 items-center gap-1 rounded-md border px-1.5 text-xs tabular-nums transition-colors hover:border-faint/60 hover:bg-hover hover:text-fg
      {failed ? 'border-unsafe/50 text-unsafe-ink' : 'border-line-strong text-muted'} {pullRequests.refreshingFor(path) ? 'mbf-refreshing' : ''}"
    aria-label={failed ? t.prs.failed : t.prs.count(count)}
    aria-haspopup="menu"
    use:tooltip={failed ? { title: t.prs.failed, text: t.prs.failedTip } : { title: t.prs.count(count), text: t.prs.badgeTip }}
    onclick={(e) => {
      e.stopPropagation();
      // The list and its icons load with the first opening, not with the sidebar.
      openBelow(e.currentTarget as HTMLElement, import("./prMenu").then((m) => m.prEntries(path)), t.prs.menu);
    }}
  >
    <GitPullRequest size={12} />{#if count}{count}{/if}
  </button>
{/if}
