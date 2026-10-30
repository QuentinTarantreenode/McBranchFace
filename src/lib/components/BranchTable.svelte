<script lang="ts">
  import { identities } from "$lib/stores/identities.svelte";
  import { layout as tableLayout } from "$lib/stores/layout.svelte";
  import {
    ChevronRight, CheckCheck, EyeOff, FileDown, FoldVertical, GitBranch, GitGraph, GlobeLock, Group, Laptop, Lock, Minus, SquareDashed, Tags, TriangleAlert, UnfoldVertical,
  } from "@lucide/svelte";
  import { copyBranchEntries } from "$lib/branchCopy";
  import { isDeletable, needsForce, type Facet } from "$lib/filter";
  import { absoluteTime, relativeTime } from "$lib/format";
  import { t } from "$lib/i18n/index.svelte";
  import type { BranchReport } from "$lib/bindings/BranchReport";
  import Button from "$lib/ui/Button.svelte";
  import ToolGroup from "$lib/ui/ToolGroup.svelte";
  import EmptyState from "$lib/ui/EmptyState.svelte";
  import IconButton from "$lib/ui/IconButton.svelte";
  import Skeleton from "$lib/ui/Skeleton.svelte";
  import VirtualList from "$lib/ui/VirtualList.svelte";
  import { delayed } from "$lib/ui/delay.svelte";
  import { openBelow, type MenuEntries, type MenuEntry } from "$lib/ui/menu.svelte";
  import { tooltip, type TooltipContent } from "$lib/ui/tooltip";
  import { prefixColor } from "$lib/branchName";
  import type { TableGroup } from "$lib/bindings/TableGroup";
  import { COMPACT_MAX } from "$lib/table/compact";
  import { gridTemplate, minTableWidth, withoutGrouped, type ColumnId } from "$lib/table/columns";
  import type { AnyBranch, BranchRow as Branch, Row } from "$lib/table/rows";
  import BranchRow from "./BranchRow.svelte";
  import FilterPills from "./FilterPills.svelte";
  import TableGroupHead from "./TableGroupHead.svelte";
  import TableHead from "./TableHead.svelte";
  import TableToolbar from "./TableToolbar.svelte";
  import { colLabel, facetLabel } from "./tableLabels";
  import { toasts } from "$lib/stores/toasts.svelte";
  import { settings } from "$lib/stores/settings.svelte";
  import { clock } from "$lib/stores/clock.svelte";
  import { dialogs } from "$lib/stores/dialogs.svelte";
  import { scanResults } from "$lib/stores/scanResults.svelte";
  import { rules } from "$lib/stores/rules.svelte";
  import { repoSelection } from "$lib/stores/repoSelection.svelte";
  import { cleanupView } from "$lib/stores/cleanupView.svelte";
  import { deletes } from "$lib/stores/deletes.svelte";
  import { scanner } from "$lib/services/scanner.svelte";
  import { repoActions } from "$lib/services/repoActions.svelte";

  /** The width of the detail floating at the right of the list: the list ends beside it. */
  let { detailInset = 0 }: { detailInset?: number } = $props();

  const ROW = 44;
  const online = $derived(cleanupView.scope === "Online");

  // The toolbar measures how far it has to give up to fit; at its last level the bar above the table
  // keeps only the icons of its filter and view buttons, as a wide sidebar leaves the table little room.
  let toolbar: { focusSearch: () => void; clearSearch: () => void } | undefined = $state();
  let compactLevel = $state(0);
  const iconsOnly = $derived(compactLevel >= COMPACT_MAX);

  // The bars above the list keep their place when the detail floats over the table: search, filters and
  // the delete button stay reachable. Measured whenever the list moves: the bars wrap or compact as the
  // width changes, and the list moves with them without its container changing size.
  let listBox = $state<HTMLElement>();
  $effect(() => {
    const box = listBox;
    if (!box?.parentElement) return;
    const measure = () => (tableLayout.tableTop = box.offsetTop);
    const ro = new ResizeObserver(measure);
    ro.observe(box.parentElement);
    ro.observe(box);
    for (const bar of box.parentElement.children) if (bar !== box) ro.observe(bar);
    measure();
    return () => ro.disconnect();
  });

  // ---- columns: one layout drives header, rows and skeleton -------------------------------------

  /** Widths while a resize handle is dragged; saved when it is let go. */
  let drafts = $state<Record<string, number>>({});
  const layout = $derived(withoutGrouped(cleanupView.columns.map((c) => (drafts[c.id] ? { ...c, width: drafts[c.id] } : c)), cleanupView.tableGroup));
  const shown = $derived(layout.filter((c) => c.visible).map((c) => c.id as ColumnId));
  const template = $derived(gridTemplate(layout));
  const tableMin = $derived(minTableWidth(layout));
  // Without its column the author goes next to the subject, unless the group header names it.
  const authorShown = $derived(shown.includes("author") || cleanupView.tableGroup === "Author");

  // Menus load on first open; the table does not need them to show.
  const menus = () => import("./tableMenus");
  const menuCtx = () => ({ online, shown, colLabel, facetLabel });
  const headMenu = (id: ColumnId) => menus().then((m) => m.headMenu(menuCtx(), id));

  // ---- rows -------------------------------------------------------------------------------------

  const deletableKeys = $derived([...cleanupView.deletableKeys]);
  const rows = $derived(cleanupView.tableRows);

  const groups = $derived([
    { id: "None" as TableGroup, label: t.cleanup.groupNone },
    { id: "Folder" as TableGroup, label: t.cleanup.groupFolder },
    { id: "Repo" as TableGroup, label: t.cleanup.groupRepo },
    { id: "Prefix" as TableGroup, label: t.cleanup.groupPrefix },
    { id: "Name" as TableGroup, label: t.cleanup.groupName },
    { id: "Verdict" as TableGroup, label: t.cleanup.groupVerdict },
    { id: "Author" as TableGroup, label: t.cleanup.groupAuthor },
  ]);

  function groupMenu(e: MouseEvent) {
    openBelow(
      e.currentTarget as HTMLElement,
      [
        { heading: t.cleanup.groupBy },
        ...groups.map((g) => ({ label: g.label, checked: cleanupView.tableGroup === g.id, run: () => settings.setUi({ tableGroup: g.id }) })),
      ],
      t.cleanup.groupBy,
    );
  }

  const groupIds = $derived([...new Set(rows.filter((r) => r.kind === "group").map((r) => (r as { id: string }).id))]);
  const anyGroupOpen = $derived(rows.some((r) => r.kind === "group" && r.open));
  const foldGroups = (open: boolean) => settings.setUi({ collapsedGroups: open ? [] : groupIds });

  function groupHeaderMenu(g: { name: string | null; items: AnyBranch[]; markable: string[] }): MenuEntries {
    const fold: MenuEntry = anyGroupOpen
      ? { label: t.cleanup.collapseGroups, icon: FoldVertical, keys: "Alt+←", run: () => foldGroups(false) }
      : { label: t.cleanup.expandGroups, icon: UnfoldVertical, keys: "Alt+→", run: () => foldGroups(true) };
    // Marking, as every group offers selecting: this group's branches, all of the table, none.
    const keys = g.markable;
    const marked = keys.filter((k) => cleanupView.checked.has(k)).length;
    const marks: MenuEntry[] = [
      { group: t.select.group },
      ...(keys.length && marked < keys.length ? [{ label: t.cleanup.markThisGroup(keys.length), icon: CheckCheck, run: () => keys.forEach((k) => cleanupView.checked.add(k)) }] : []),
      ...(marked ? [{ label: t.cleanup.unmarkThisGroup, icon: Minus, run: () => keys.forEach((k) => cleanupView.checked.delete(k)) }] : []),
      ...(cleanupView.checked.size > marked ? [{ label: t.cleanup.unmarkAll, icon: SquareDashed, run: () => cleanupView.checked.clear() }] : []),
    ];
    if (!g.name) return [fold, ...marks];
    const name = g.name;
    if (!nameGroups) return [{ heading: name }, fold, ...marks, ...copyBranchEntries(name)];
    return menus().then((m) => [{ heading: name }, fold, ...marks, ...copyBranchEntries(name), ...m.nameGroupEntries(name, g.items as BranchReport[])]);
  }
  // Grouped by branch name, a header stands for one branch in several repos and carries their actions.
  const nameGroups = $derived(!online && cleanupView.tableGroup === "Name");

  const activeIndex = $derived(rows.findIndex((r) => r.key === cleanupView.selectedKey));

  function prefixMenu(e: MouseEvent) {
    openBelow(e.currentTarget as HTMLElement, menus().then((m) => m.prefixEntries()), t.cleanup.prefixFilter);
  }

  // The distribution at a glance, without opening the menu.
  const prefixTip = $derived.by((): TooltipContent => {
    const stats = cleanupView.prefixCounts;
    return {
      text: t.cleanup.prefixFilterTip,
      sections: [{ bars: stats.slice(0, 8).map((s) => ({ label: s.prefix ?? t.cleanup.noPrefix, count: s.count, color: s.prefix ? prefixColor(s.prefix) : "var(--faint)" })) }],
    };
  });

  function tagMenu(e: MouseEvent) {
    openBelow(e.currentTarget as HTMLElement, menus().then((m) => m.tagEntries()), t.cleanup.tagFilter);
  }

  function reportMenu(e: MouseEvent) {
    openBelow(e.currentTarget as HTMLElement, menus().then((m) => m.reportEntries(online, visibleCount, total)), t.cleanup.report);
  }

  const allChecked = $derived(deletableKeys.length > 0 && deletableKeys.every((k) => cleanupView.checked.has(k)));
  const someChecked = $derived(!allChecked && deletableKeys.some((k) => cleanupView.checked.has(k)));
  const total = $derived(online ? (scanResults.allOnline?.length ?? 0) : cleanupView.localInView.length);
  const visibleCount = $derived(
    online
      ? cleanupView.onlineVisible.length + cleanupView.onlineIgnored.length + cleanupView.onlineLocked.length
      : cleanupView.visible.length + cleanupView.visibleIgnored.length + cleanupView.visibleLocked.length,
  );

  /** Column filters as removable pills; prefixes and tags keep their own colours. */
  const facetPills = $derived.by(() => {
    const out: { facet: Facet; value: string; column: string }[] = [];
    const add = (facet: Facet, values: string[], column: string) => values.forEach((value) => out.push({ facet, value, column }));
    // A selected repo group is one pill of its own, not one per repo.
    if (!identities.activeRepoGroup && !identities.activeFolder) add("repo", repoSelection.repos, t.cleanup.colRepo);
    add("author", cleanupView.filters.authors, t.cleanup.colAuthor);
    add("age", cleanupView.filters.ages, t.cleanup.colCommit);
    add("pr", cleanupView.filters.prStates, t.cleanup.colPr);
    if (online) add("local", cleanupView.filters.local, t.cleanup.colLocal);
    return out;
  });
  const hasFilter = $derived(
    !!cleanupView.filters.focus ||
      cleanupView.filters.search !== "" ||
      cleanupView.filters.tags.length > 0 ||
      cleanupView.filters.prefixes.length > 0 ||
      (!online && cleanupView.filters.upstreams.length > 0) ||
      cleanupView.filters.onlyMine ||
      facetPills.length > 0 ||
      !!identities.activeRepoGroup ||
      !!identities.activeFolder ||
      (online ? cleanupView.filters.onlineVerdicts.length > 0 : cleanupView.filters.verdicts.length > 0),
  );

  // Skeleton only while the first data is on its way, and only if that takes longer than 150 ms.
  const waiting = $derived(online ? scanResults.allOnline === null && (scanner.scanning || !scanResults.loaded) : !scanResults.loaded || (scanner.scanning && total === 0));
  const showSkeleton = delayed(() => waiting);

  function toggleAll() {
    if (allChecked) deletableKeys.forEach((k) => cleanupView.checked.delete(k));
    else deletableKeys.forEach((k) => cleanupView.checked.add(k));
  }

  function requestDelete(r: Row) {
    // git never deletes the branch checked out in the main worktree: say so instead of a dialog that cannot be confirmed.
    if (r.kind === "local" && r.b.worktree?.isMain) toasts.toast("info", t.failure.CurrentBranch.title, { detail: t.failure.CurrentBranch.hint });
    else if (r.kind === "local") deletes.openDelete([r.b], needsForce(r.b));
    else if (r.kind === "online") deletes.openOnlineDelete([r.b], needsForce(r.b));
  }

  function resetFilters() {
    toolbar?.clearSearch();
    cleanupView.resetFilters();
  }

  function onKey(e: KeyboardEvent) {
    const r = rows[activeIndex];
    if (e.key === "ArrowDown" || e.key === "j") cleanupView.moveSelection(1);
    else if (e.key === "ArrowUp" || e.key === "k") cleanupView.moveSelection(-1);
    else if (e.key === " " && r && canMark(r)) cleanupView.toggleChecked(r.key);
    else if (e.key === "Delete" && r && (r.kind === "local" || r.kind === "online") && !r.b.locked) requestDelete(r);
    else return;
    e.preventDefault();
  }

  export function focusSearch() {
    toolbar?.focusSearch();
  }

  // Ignored branches are not part of "delete all safe", but can still be marked one by one.
  function canMark(r: Row): r is Branch {
    if (r.kind === "section" || r.kind === "group" || r.b.locked) return false;
    return cleanupView.deletableKeys.has(r.key) || (r.b.ignored && isDeletable(r.b));
  }
</script>

<section class="@container flex min-w-0 flex-1 flex-col bg-bg">
  <!-- Scope: its own row, the same tab style as the Git perspective; state and report on the right. -->
  <div class="flex shrink-0 items-center gap-1 px-4" role="tablist" aria-label={t.cleanup.scopeLocal}>
    {#each [{ id: "Local", label: t.cleanup.scopeLocal, tip: t.cleanup.scopeLocalTip, icon: Laptop, count: cleanupView.localInView.length }, { id: "Online", label: t.cleanup.scopeOnline, tip: t.cleanup.scopeOnlineTip, icon: GitGraph, count: scanResults.allOnline?.length }] as s (s.id)}
      {@const on = cleanupView.scope === s.id}
      <button
        type="button"
        role="tab"
        aria-selected={on}
        use:tooltip={s.tip}
        class="-mb-px inline-flex h-10 items-center gap-2 border-b-2 px-3 text-base transition-colors
          {on ? 'border-accent font-medium text-fg' : 'border-transparent text-muted hover:text-fg'}"
        onclick={() => cleanupView.setScope(s.id as "Local" | "Online")}
      >
        <s.icon size={14} class={on ? "text-accent" : ""} />
        {s.label}
        {#if s.count !== undefined}
          <span class="rounded bg-panel-2 px-1.5 text-xs tabular-nums text-muted">{s.count}</span>
        {:else if scanner.onlinePending}
          <Skeleton class="h-3 w-5" />
        {/if}
      </button>
    {/each}
    <div class="ml-auto flex items-center gap-2">
      {#if online && scanResults.onlineState}
        {@const st = scanResults.onlineState}
        {#if st.offline.length}
          <span class="inline-flex items-center gap-1 text-sm text-review" use:tooltip={{ title: t.cleanup.offline, text: t.cleanup.offlineTip(st.offline.join(", ")) }}>
            <TriangleAlert size={13} />{t.cleanup.offline}
          </span>
        {/if}
        <span class="t-meta" use:tooltip={absoluteTime(st.at)}>{t.cleanup.onlineAt(relativeTime(st.at, clock.now))}</span>
      {/if}
      <!-- What is shown (filters) apart from how it is shown (view): two groups. -->
      <ToolGroup label={t.cleanup.filterGroup}>
        <Button size="sm" variant="ghost" icon={GitBranch} aria-haspopup="menu" aria-label={iconsOnly ? t.cleanup.prefixFilter : undefined} tip={prefixTip} count={cleanupView.filters.prefixes.length} onclick={prefixMenu}>
          {#if !iconsOnly}{t.cleanup.prefixFilter}{/if}
        </Button>
        <Button size="sm" variant="ghost" icon={Tags} aria-haspopup="menu" aria-label={iconsOnly ? t.cleanup.tagFilter : undefined} tip={t.cleanup.tagFilterTip} count={cleanupView.filters.tags.length} onclick={tagMenu}>
          {#if !iconsOnly}{t.cleanup.tagFilter}{/if}
        </Button>
      </ToolGroup>
      <ToolGroup label={t.menu.view}>
        <Button size="sm" variant="ghost" icon={Group} aria-haspopup="menu" aria-label={iconsOnly ? t.cleanup.group : undefined} tip={t.cleanup.groupTip} onclick={groupMenu}>
          {#if !iconsOnly}{cleanupView.tableGroup === "None" ? t.cleanup.group : groups.find((g) => g.id === cleanupView.tableGroup)?.label}{/if}
        </Button>
        <IconButton icon={FileDown} label={t.cleanup.report} aria-haspopup="menu" disabled={visibleCount === 0} onclick={reportMenu} />
      </ToolGroup>
    </div>
  </div>

  {#if online && rules.excludedRepos.length}
    <div class="mx-3 mb-2 flex h-8 shrink-0 items-center gap-3 rounded-lg border border-line bg-panel px-3 t-meta">
      <GlobeLock size={13} class="shrink-0" />
      <span class="min-w-0 truncate">{t.cleanup.excludedNote(rules.excludedRepos.map((r) => r.name).join(", "))}</span>
      <Button size="sm" variant="ghost" onclick={() => rules.excludedRepos.forEach((r) => repoActions.setOnlineExcluded(r.path, false))}>{t.cleanup.enableOnline}</Button>
    </div>
  {/if}

  <TableToolbar bind:this={toolbar} bind:level={compactLevel} />

  {#if hasFilter}
    <FilterPills {online} pills={facetPills} visible={visibleCount} {total} onreset={resetFilters} />
  {/if}

  <!-- Header and body share one grid template and scroll sideways together when the columns need more
       room than there is; the body alone scrolls down. Next to a floating detail it ends where it would beside
       the docked one. -->
  <div
    bind:this={listBox}
    data-table-list
    class="mx-3 mb-3 flex min-h-0 flex-1 flex-col overflow-x-auto overflow-y-hidden rounded-xl border border-line bg-panel"
    style:margin-right={detailInset ? `calc(0.75rem + ${detailInset}px)` : undefined}
  >
    <div class="flex min-h-0 flex-1 flex-col" style="min-width: {tableMin}px; --cols: {template}">
      <TableHead {layout} {shown} {colLabel} menu={headMenu} bind:drafts {allChecked} {someChecked} markDisabled={deletableKeys.length === 0} ontoggleall={toggleAll} />

      {#if showSkeleton.value}
        <!-- Skeleton rows in the exact column layout, so nothing moves when the data arrives. -->
        <div class="min-h-0 flex-1 overflow-hidden" aria-busy="true">
          {#each [0, 1, 2, 3, 4, 5, 6, 7] as i (i)}
            <div class="mbf-grid" style="height: {ROW}px">
              <span></span>
              {#each shown as id (id)}
                <div class="min-w-0">
                  {#if id === "status"}<Skeleton class="h-5 w-16 rounded-full" />
                  {:else if id === "branch"}<Skeleton class={i % 2 ? "h-3 w-2/3" : "h-3 w-1/2"} /><Skeleton class="mt-2 h-2.5 w-1/3" />
                  {:else}<Skeleton class="h-3 w-3/4" />{/if}
                </div>
              {/each}
              <span></span>
            </div>
          {/each}
        </div>
      {:else if waiting}
        <div class="min-h-0 flex-1"></div>
      {:else}
        <VirtualList items={rows} rowHeight={ROW} key={(r) => r.key} activeKey={cleanupView.selectedKey} class="flex-1 pop-in" label={t.cleanup.colBranch} onkeydown={onKey}>
          {#snippet row(r)}
            {#if r.kind === "group"}
              <TableGroupHead {r} rowHeight={ROW} anyOpen={anyGroupOpen} {nameGroups} menu={() => groupHeaderMenu(r)} onfoldall={foldGroups} />
            {:else if r.kind === "section"}
              {@const open = cleanupView.sectionOpen[r.section]}
              {@const Icon = r.section === "locked" ? Lock : EyeOff}
              <button
                type="button"
                class="flex w-full items-center gap-2 border-b border-line bg-panel-2 px-4 text-left t-section hover:text-fg"
                style="height: {ROW}px"
                aria-expanded={open}
                use:tooltip={r.section === "locked" ? t.cleanup.lockedSectionTip : t.cleanup.ignoredSectionTip}
                onclick={() => (cleanupView.sectionOpen[r.section] = !open)}
              >
                <ChevronRight size={14} class="transition-transform {open ? 'rotate-90' : ''}" />
                <Icon size={12} />
                {r.section === "locked" ? t.cleanup.lockedSection : t.cleanup.ignoredSection}
                <span class="mbf-count normal-case">{r.count}</span>
              </button>
            {:else}
              <BranchRow {r} {shown} {authorShown} markable={canMark(r)} rowHeight={ROW} ondelete={requestDelete} />
            {/if}
          {/snippet}
          {#snippet empty()}
            {#if online && scanResults.allOnline === null && !settings.config?.scanOnline}
              <EmptyState title={t.cleanup.onlineOff} text={t.cleanup.onlineOffText}>
                <Button size="sm" onclick={() => dialogs.openSettings("online")}>{t.top.settings}</Button>
              </EmptyState>
            {:else if total === 0}
              {@const others = online || !cleanupView.orphanedOnly ? 0 : scanResults.allBranches.length}
              <EmptyState
                title={online ? t.cleanup.emptyOnline : cleanupView.orphanedOnly ? t.cleanup.emptyLocal : t.cleanup.emptyLocalAll}
                text={online ? t.cleanup.emptyOnlineText : t.cleanup.emptyLocalText(others)}
              >
                {#if others}<Button size="sm" onclick={() => settings.setUi({ orphanedOnly: false })}>{t.cleanup.showAllLocal}</Button>{/if}
              </EmptyState>
            {:else if cleanupView.filters.focus}
              <!-- The branches a step named are gone: deleted, pushed or merged since. -->
              <EmptyState title={t.cleanup.focusDone} text={t.cleanup.focusDoneText}>
                <Button size="sm" onclick={() => (cleanupView.filters.focus = null)}>{t.cleanup.removeFocus}</Button>
              </EmptyState>
            {:else}
              <EmptyState title={t.cleanup.noMatch}>
                <Button size="sm" onclick={resetFilters}>{t.common.resetFilter}</Button>
              </EmptyState>
            {/if}
          {/snippet}
        </VirtualList>
      {/if}
    </div>
  </div>
</section>
