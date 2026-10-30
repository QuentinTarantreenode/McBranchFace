<script lang="ts">
  import { FolderTree } from "@lucide/svelte";
  import { api } from "$lib/api";
  import type { BorrowedWorktree } from "$lib/groups";
  import { repoName } from "$lib/filter";
  import { t } from "$lib/i18n/index.svelte";
  import type { RepoEntry } from "$lib/stores/scanResults.svelte";
  import { identities } from "$lib/stores/identities.svelte";
  import { sidebarSelection } from "$lib/stores/sidebarSelection.svelte";
  import { dragTo } from "$lib/ui/dragTo.svelte";
  import { doubleClick } from "$lib/ui/gestures";
  import { contextmenu } from "$lib/ui/menu.svelte";
  import { fullText, tooltip } from "$lib/ui/tooltip";
  import QuickSwitch from "./QuickSwitch.svelte";
  import { repoDragOptions } from "./repoGroupDrop.svelte";
  import { copyMenuOf, isControl, rowClick } from "./sidebarRows.svelte";
  import { toasts } from "$lib/stores/toasts.svelte";

  /** A worktree whose repo is listed under another folder: shown where it lies, as the folder holds it. */
  let { w }: { w: BorrowedWorktree<RepoEntry> } = $props();

  const edge = $derived(identities.tintOf(w.path));
  const chosen = $derived(sidebarSelection.has(w.path));
  const name = $derived(repoName(w.path));
</script>

<!-- Keys belong to the list: roving focus, Enter and Space in the sidebar's handler. -->
<!-- svelte-ignore a11y_click_events_have_key_events -->
<div
  style={edge ? `border-left: 3px solid ${edge} !important` : undefined}
  class="mt-2 grid cursor-pointer grid-cols-[28px_minmax(0,1fr)] items-center gap-x-2 rounded-lg border px-3 py-2 outline-none focus-visible:ring-2 focus-visible:ring-accent/60 {chosen ? 'mbf-selected-card' : 'border-line bg-panel'}"
  data-sel-path={w.path}
  role="option"
  aria-selected={chosen}
  tabindex="-1"
  aria-label={name}
  onclick={(e) => rowClick(w.path, e)}
  use:doubleClick={{ run: () => toasts.safely(() => api.openFolder(w.path)), hint: () => t.sidebar.openHint, skip: isControl }}
  use:contextmenu={() => copyMenuOf(w.path)}
  use:dragTo={repoDragOptions(w.path, null, () => [])}
  use:tooltip={() => ({ title: name, path: w.path, text: t.sidebar.selectWorktreeTip, gestures: true })}
>
  <span class="grid h-5 place-items-center text-faint" use:tooltip={{ title: t.sidebar.worktreeTitle, path: w.path, text: t.sidebar.borrowedTip(w.owner.info.name), gestures: true }}><FolderTree size={14} /></span>
  <span class="flex min-w-0 flex-col gap-1">
    <span class="flex min-w-0 items-baseline gap-1.5">
      <span class="min-w-0 max-w-[75%] shrink-0 truncate text-base font-medium" use:fullText={w.path}>{name}</span>
      <span class="min-w-0 truncate text-xs text-faint" use:fullText={w.owner.info.name}>{w.owner.info.name}</span>
    </span>
    <span class="flex min-w-0"><QuickSwitch path={w.path} branch={w.branch} sha={w.head} unreferenced={w.unreferenced} size="xs" /></span>
  </span>
</div>
