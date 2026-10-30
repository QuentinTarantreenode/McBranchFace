<script lang="ts">
  import { FolderTree, TriangleAlert } from "@lucide/svelte";
  import { api } from "$lib/api";
  import type { WorktreeInfo } from "$lib/bindings/WorktreeInfo";
  import { repoName } from "$lib/filter";
  import { t } from "$lib/i18n/index.svelte";
  import { gitStatus } from "$lib/stores/gitStatus.svelte";
  import { sidebarSelection } from "$lib/stores/sidebarSelection.svelte";
  import BranchName from "$lib/ui/BranchName.svelte";
  import { dragTo } from "$lib/ui/dragTo.svelte";
  import { doubleClick } from "$lib/ui/gestures";
  import IconChip from "$lib/ui/IconChip.svelte";
  import { contextmenu } from "$lib/ui/menu.svelte";
  import { tooltip } from "$lib/ui/tooltip";
  import { repoDragOptions } from "./repoGroupDrop.svelte";
  import { copyMenuOf, isControl, rowClick, worktreeSwitch } from "./sidebarRows.svelte";
  import { toasts } from "$lib/stores/toasts.svelte";

  /** A worktree belongs to its branch: the line shows it as a label; switching lives in the context menu. */
  let { w, done }: { w: WorktreeInfo; /** The scan says its branch is merged: the worktree has done its job. */ done: boolean } = $props();

  let el = $state<HTMLElement>();
  const chosen = $derived(sidebarSelection.has(w.path));
  // Seven characters: the line of a narrow sidebar has room for no more.
  const short = $derived((w.head ?? "").slice(0, 7));
</script>

<!-- Keys belong to the list: roving focus, Enter and Space in the sidebar's handler. -->
<!-- svelte-ignore a11y_click_events_have_key_events -->
<div
  bind:this={el}
  class="grid cursor-pointer grid-cols-[16px_minmax(0,1fr)_auto] items-center gap-x-2 rounded-md py-0.5 pr-2.5 pl-1.5 text-xs text-faint outline-none focus-visible:ring-2 focus-visible:ring-accent/60 {chosen ? 'mbf-selected text-fg' : 'hover:bg-hover/70'} {gitStatus.isRefreshing(w.path) ? 'mbf-refreshing' : ''}"
  data-sel-path={w.path}
  role="option"
  aria-selected={chosen}
  tabindex="-1"
  aria-label={repoName(w.path)}
  onclick={(e) => rowClick(w.path, e)}
  use:doubleClick={{ run: () => toasts.safely(() => api.openFolder(w.path)), hint: () => t.sidebar.openHint, skip: isControl }}
  use:contextmenu={() => copyMenuOf(w.path, () => (worktreeSwitch.path = w.path))}
  use:dragTo={repoDragOptions(w.path, null, () => [])}
  use:tooltip={() => ({ title: repoName(w.path), path: w.path, text: t.sidebar.selectWorktreeTip, gestures: true })}
>
  <span class="grid justify-self-center" use:tooltip={() => ({ title: t.sidebar.worktreeTitle, path: w.path, text: t.sidebar.worktreeTip, gestures: true })}><FolderTree size={12} /></span>
  <span class="flex min-w-0 items-center" use:tooltip={{ title: w.branch ?? t.sidebar.detachedTitle, path: w.path, text: t.sidebar.worktreeBranchTip }}>
    {#if w.branch}<BranchName name={w.branch} size="xs" quiet />
    {:else}
      <!-- A state without a branch is a word, as the help shows it: the pill, then where HEAD stands. -->
      <span class="inline-flex min-w-0 items-center gap-1 font-mono">
        <span class="shrink-0 rounded px-1 font-sans text-[11px] text-review-ink ring-1 ring-review/40">{t.sidebar.detachedPill}</span>
        <span class="truncate text-muted">{short}</span>
        {#if w.unreferenced > 0}<IconChip icon={TriangleAlert} tone="unsafe" tip={{ title: t.sidebar.strandedTitle(w.unreferenced), text: t.quick.stranded(short, w.unreferenced) }} />{/if}
      </span>
    {/if}
  </span>
  {#if done}<span class="rounded px-1 text-[11px] text-safe-ink ring-1 ring-safe/40" use:tooltip={t.sidebar.worktreeMergedTip}>{t.sidebar.worktreeMerged}</span>{:else}<span></span>{/if}
</div>
{#if worktreeSwitch.path === w.path && el}
  {#await import("./QuickSwitchPanel.svelte") then m}
    <m.default path={w.path} branch={w.branch} sha={w.head} unreferenced={w.unreferenced} trigger={el} onclose={() => (worktreeSwitch.path = null)} />
  {/await}
{/if}
