<script lang="ts">
  import { ChevronRight, Ellipsis, FolderGit2, FolderOpen, FoldVertical, GitBranch, UnfoldVertical, UserRound } from "@lucide/svelte";
  import type { BranchReport } from "$lib/bindings/BranchReport";
  import { t } from "$lib/i18n/index.svelte";
  import { identities } from "$lib/stores/identities.svelte";
  import type { GroupRow } from "$lib/table/rows";
  import BranchName from "$lib/ui/BranchName.svelte";
  import Checkbox from "$lib/ui/Checkbox.svelte";
  import { foldKeys } from "$lib/ui/foldKeys";
  import IconButton from "$lib/ui/IconButton.svelte";
  import { contextmenu, openBelow, type MenuEntries } from "$lib/ui/menu.svelte";
  import RootBadge from "$lib/ui/RootBadge.svelte";
  import { tooltip } from "$lib/ui/tooltip";
  import VerdictBadge from "./VerdictBadge.svelte";
  import { cleanupView } from "$lib/stores/cleanupView.svelte";

  /** Group header: opaque like the column header, normal case to tell it from a section. */
  let {
    r,
    rowHeight,
    anyOpen,
    nameGroups,
    menu,
    onfoldall,
  }: {
    r: GroupRow;
    rowHeight: number;
    /** Some group of the table is open: the fold button folds them all, else it opens them. */
    anyOpen: boolean;
    /** Grouped by branch name: a head stands for one branch in several repos and carries their actions. */
    nameGroups: boolean;
    menu: () => MenuEntries;
    onfoldall: (open: boolean) => void;
  } = $props();

  // Only the branches still marked are counted live; which ones can be marked came with the row.
  const marked = $derived(r.markable.reduce((n, k) => n + (cleanupView.checked.has(k) ? 1 : 0), 0));
  const badge = $derived(cleanupView.tableGroup === "Folder" ? identities.rootBadges.get(r.title) : undefined);

  function toggleMarks() {
    const all = marked === r.markable.length;
    for (const k of r.markable) all ? cleanupView.checked.delete(k) : cleanupView.checked.add(k);
  }
  const nameMenu = (name: string) => import("./tableMenus").then((m) => m.nameGroupEntries(name, r.items as BranchReport[]));
</script>

<div class="mbf-group-head flex items-center gap-3 bg-panel-2 px-4 pt-2" style="height: {rowHeight}px" use:contextmenu={menu}>
  <span class="inline-flex w-4 shrink-0">
    {#if r.markable.length}
      <Checkbox checked={marked === r.markable.length} indeterminate={marked > 0 && marked < r.markable.length} ariaLabel={t.cleanup.markGroup(r.label)} tip={t.cleanup.markGroupTip} onchange={toggleMarks} />
    {/if}
  </span>
  <button
    type="button"
    class="flex min-w-0 flex-1 items-center gap-2 text-left hover:text-accent"
    aria-expanded={r.open}
    use:tooltip={r.title !== r.label ? { path: r.title } : undefined}
    onclick={(e) => (e.altKey ? onfoldall(!r.open) : cleanupView.toggleGroup(r.id))}
    onkeydown={(e) => foldKeys(e, { open: r.open, toggle: () => cleanupView.toggleGroup(r.id), all: onfoldall })}
  >
    <ChevronRight size={14} class="shrink-0 text-faint transition-transform {r.open ? 'rotate-90' : ''}" />
    <!-- A folder group carries its folder's badge, as the sidebar head does. -->
    {#if cleanupView.tableGroup === "Folder"}{#if badge}<RootBadge {badge} root={r.title} tip={false} />{:else}<FolderOpen size={14} class="shrink-0 text-faint" />{/if}
    {:else if cleanupView.tableGroup === "Prefix"}<GitBranch size={14} class="shrink-0 text-faint" />
    {:else if cleanupView.tableGroup === "Author"}<UserRound size={14} class="shrink-0 text-faint" />
    {:else if cleanupView.tableGroup === "Repo"}<FolderGit2 size={14} class="shrink-0 text-faint" />{/if}
    {#if r.name}<span class="flex min-w-0"><BranchName name={r.name} /></span>
    {:else}<span class="truncate text-base font-medium">{r.label}</span>{/if}
    <span class="mbf-count shrink-0">{r.items.length}</span>
  </button>
  {#if nameGroups && r.name}
    {@const name = r.name}
    <IconButton icon={Ellipsis} size="sm" label={t.groupOps.actions} aria-haspopup="menu" onclick={(e) => openBelow(e.currentTarget as HTMLElement, nameMenu(name), name)} />
  {/if}
  <!-- What the group holds, in the verdict pills of the status column: a word, not a coloured dot. -->
  <span class="flex shrink-0 items-center gap-1">
    {#each r.counts as c, j (j)}
      {#if c.n}<VerdictBadge verdict={c.verdict} online={c.online} count={c.n} />{/if}
    {/each}
  </span>
  <IconButton
    icon={anyOpen ? FoldVertical : UnfoldVertical}
    size="sm"
    class="!border-transparent"
    label={anyOpen ? t.cleanup.collapseGroups : t.cleanup.expandGroups}
    keys="Alt+← →"
    onclick={() => onfoldall(!anyOpen)}
  />
</div>
