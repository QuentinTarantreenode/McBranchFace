<script lang="ts">
  import { ArrowDown, ArrowRightLeft, ArrowUp, ArrowUpDown, Broom, FoldVertical, UnfoldVertical, CheckCheck, Copy, CopyPlus, Ellipsis, ExternalLink, Funnel, GitFork, Group, Search, SquareDashed, X } from "@lucide/svelte";
  import { api } from "$lib/api";
  import { branchUrl } from "$lib/links";
  import { branchKey, emptyFilters, repoName } from "$lib/filter";
  import { absoluteTime, relativeTime } from "$lib/format";
  import { t } from "$lib/i18n/index.svelte";
  import BranchName from "$lib/ui/BranchName.svelte";
  import { splitRemote } from "$lib/branchName";
  import Button from "$lib/ui/Button.svelte";
  import GroupHead from "$lib/ui/GroupHead.svelte";
  import IconButton from "$lib/ui/IconButton.svelte";
  import Input from "$lib/ui/Input.svelte";
  import Resizer from "$lib/ui/Resizer.svelte";
  import Segmented from "$lib/ui/Segmented.svelte";
  import Skeleton from "$lib/ui/Skeleton.svelte";
  import { contextmenu, openBelow, type MenuEntry } from "$lib/ui/menu.svelte";
  import { fullText, tooltip } from "$lib/ui/tooltip";
  import UpstreamState from "$lib/components/UpstreamState.svelte";
  import { fold } from "$lib/stores/fold.svelte";
  import { emptySelection, nextSelection, type Selection } from "$lib/selection";
  import { MAX_WIDTH, minWidth, resize, template, toggle, validLayout, type GridSpec } from "$lib/table/gridModel";
  import type { ColumnPref } from "$lib/bindings/ColumnPref";
  import { emptyBranchFilter, filterRows, groupRows, listRows, sortRows, type BranchFilter, type BranchGroup, type BranchSort, type ListRow, type UpstreamFilter, type WorktreeFilter } from "./branchList";
  import GitError from "./GitError.svelte";
  import { gitStore } from "./gitStore.svelte";
  import { toasts } from "$lib/stores/toasts.svelte";
  import { settings } from "$lib/stores/settings.svelte";
  import { dialogs } from "$lib/stores/dialogs.svelte";
  import { clock } from "$lib/stores/clock.svelte";
  import { scanResults } from "$lib/stores/scanResults.svelte";
  import { repoSelection } from "$lib/stores/repoSelection.svelte";
  import { cleanupView } from "$lib/stores/cleanupView.svelte";

  // ---- columns: one model for header, rows and placeholders -------------------------------------
  type ColId = "branch" | "upstream" | "worktree" | "age";
  const SPEC: GridSpec<{ id: ColId; width: number; min: number; flex?: boolean; sort: BranchSort }> = {
    defs: [
      { id: "branch", width: 260, min: 160, flex: true, sort: "name" },
      { id: "upstream", width: 190, min: 110, sort: "upstream" },
      { id: "worktree", width: 160, min: 90, sort: "worktree" },
      { id: "age", width: 140, min: 80, sort: "age" },
    ],
    required: "branch",
    lead: 10,
    trail: 150,
  };
  const layout = $derived(validLayout(SPEC, settings.config?.ui.tableLayout?.branches ?? []));
  let drafts = $state<Record<string, number>>({});
  const shownLayout = $derived(layout.map((c) => (drafts[c.id] ? { ...c, width: drafts[c.id] } : c)));
  const cols = $derived(template(SPEC, shownLayout));
  const visible = $derived(shownLayout.filter((c) => c.visible).map((c) => c.id as ColId));
  function saveLayout(next: ColumnPref[]) {
    const current = settings.config?.ui.tableLayout ?? { local: [], online: [], branches: [] };
    settings.setUi({ tableLayout: { ...current, branches: next } });
  }
  function commitWidth(id: string, w: number) {
    delete drafts[id];
    saveLayout(resize(SPEC, layout, id, w));
  }
  const colLabel = (id: ColId) => t.git.branchCols[id];

  // ---- what is shown: filter, order, groups ------------------------------------------------------
  let filter = $state<BranchFilter>(emptyBranchFilter());
  let sort = $state<{ key: BranchSort; dir: 1 | -1 }>({ key: "name", dir: 1 });
  const groupBy = $derived((settings.config?.ui.gitBranchGroup ?? "None") as BranchGroup);
  const all = $derived(gitStore.branches ? listRows(gitStore.branches.local, gitStore.branches.remote) : []);
  const rows = $derived(sortRows(filterRows(all, filter), sort.key, sort.dir));
  const groups = $derived(groupRows(rows, groupBy, groupLabel));
  const filtered = $derived(filter.kind !== "all" || filter.upstream !== "all" || filter.worktree !== "all" || filter.mine);
  const links = $derived(gitStore.repo ? scanResults.repoByPath.get(gitStore.repo)?.links : undefined);
  const groupId = (key: string) => `${gitStore.repo}|${groupBy}|${key}`;
  const shownRows = $derived(groups.flatMap((g) => (groupBy === "None" || fold.isOpen("gitBranchGroups", groupId(g.key)) ? g.rows : [])));

  function groupLabel(by: BranchGroup, key: string): string {
    if (by === "Worktree") return key === "with" ? t.git.withWorktree : t.git.withoutWorktree;
    if (by === "Upstream") return t.git.upstreamKind[key as keyof typeof t.git.upstreamKind] ?? key;
    if (by === "Prefix") return t.sidebar.worktreeOthers;
    return key || "–";
  }

  function setSort(key: BranchSort) {
    sort = sort.key === key ? { key, dir: sort.dir === 1 ? -1 : 1 } : { key, dir: 1 };
  }

  // ---- selection: as in every list ---------------------------------------------------------------
  let picked = $state<Selection>(emptySelection);
  const order = $derived(shownRows.map((b) => b.fullRef));
  const chosen = $derived(picked.items.filter((k) => order.includes(k)));
  const chosenRows = () => rows.filter((b) => chosen.includes(b.fullRef));
  function pick(b: ListRow, e: MouseEvent) {
    const mod = e.ctrlKey || e.metaKey;
    picked = nextSelection({ ...picked, items: chosen }, { kind: "click", id: b.fullRef, ctrl: mod, shift: e.shiftKey }, order);
  }
  function onKey(e: KeyboardEvent) {
    const mod = e.ctrlKey || e.metaKey;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") picked = nextSelection({ ...picked, items: chosen }, { kind: "move", delta: e.key === "ArrowDown" ? 1 : -1, shift: e.shiftKey }, order);
    else if (mod && e.key.toLowerCase() === "a") picked = nextSelection(picked, { kind: "all" }, order);
    else if (e.key === "Escape" && chosen.length) picked = emptySelection;
    else return;
    e.preventDefault();
  }

  /** Checked out in another worktree of this repo. */
  const elsewhere = (b: ListRow) => !!b.worktreePath && !b.isHead;

  /** The marked branches go to the cleanup view, marked there: deleting runs through its checks and backup. */
  function showInCleanup(list: ListRow[]) {
    const repo = gitStore.repo;
    if (!repo || !list.length) return;
    cleanupView.setFilters({ ...emptyFilters(), repos: [repo] });
    settings.setUi({ perspective: "Cleanup", cleanupScope: "Local", ...(list.every((b) => b.gone) ? {} : { orphanedOnly: false }) });
    cleanupView.checked.clear();
    for (const b of list) cleanupView.checked.add(branchKey({ repoPath: repo, name: b.name }));
    cleanupView.selectKey(branchKey({ repoPath: repo, name: list[0].name }));
  }

  function menuFor(b: ListRow): MenuEntry[] {
    const many = chosen.length > 1 && chosen.includes(b.fullRef) ? chosenRows() : null;
    if (many) {
      const locals = many.filter((x) => !x.remote);
      return [
        { heading: t.git.branchesChosen(many.length) },
        { label: t.git.showChosenInCleanup(locals.length), icon: Broom, disabled: !locals.length, run: () => showInCleanup(locals) },
        { label: t.common.copyNames, icon: Copy, run: () => toasts.copy(many.map((x) => x.name).join("\n")) },
        "sep",
        { label: t.select.none, icon: SquareDashed, keys: "Esc", run: () => (picked = emptySelection) },
      ];
    }
    const serverName = !b.remote ? (b.upstream && !b.gone ? b.upstream.slice(b.upstream.indexOf("/") + 1) : null) : b.name.slice(b.name.indexOf("/") + 1);
    const url = links && serverName ? branchUrl(links, serverName) : null;
    return [
      { heading: b.name },
      {
        tiles: [
          ...(!b.isHead
            ? [elsewhere(b)
                ? { label: t.git.openWorktree, icon: GitFork, run: () => (repoSelection.gitRepo = b.worktreePath!) }
                : { label: t.git.switchTo, icon: ArrowRightLeft, disabled: gitStore.locked, run: () => gitStore.switchTo(b.name, b.remote) }]
            : []),
          ...(url ? [{ label: t.provider.openBranch, icon: ExternalLink, run: () => toasts.safely(() => api.openUrl(url)) }] : []),
          { label: t.common.copyName, icon: Copy, run: () => toasts.copy(b.name) },
        ],
      },
      { group: t.menu.branch },
      ...(!b.remote ? [{ label: t.git.showInCleanup, icon: Broom, run: () => showInCleanup([b]) }] : []),
      { label: t.copies.menu, icon: CopyPlus, run: () => dialogs.openCopies(gitStore.repo!, b.remote ? splitRemote(b.name).name : b.name) },
    ];
  }

  // ---- toolbar menus -----------------------------------------------------------------------------
  const choice = <V extends string>(value: V, current: V, label: string, set: (v: V) => void): MenuEntry => ({ label, checked: value === current, run: () => set(value) });
  function filterMenu(e: MouseEvent) {
    const up: UpstreamFilter[] = ["all", "localOnly", "gone", "ahead", "behind", "even"];
    const wt: WorktreeFilter[] = ["all", "with", "without"];
    openBelow(e.currentTarget as HTMLElement, [
      { group: t.git.filterUpstream },
      ...up.map((u) => choice(u, filter.upstream, u === "all" ? t.git.filterAll : t.git.upstreamKind[u], (v) => (filter.upstream = v))),
      { group: t.git.filterWorktree },
      ...wt.map((w) => choice(w, filter.worktree, w === "all" ? t.git.filterAll : w === "with" ? t.git.withWorktree : t.git.withoutWorktree, (v) => (filter.worktree = v))),
      "sep",
      { label: t.git.onlyMine, checked: filter.mine, run: () => (filter.mine = !filter.mine) },
      { label: t.git.resetFilter, icon: X, disabled: !filtered, run: () => (filter = { ...emptyBranchFilter(), query: filter.query }) },
    ], t.git.filter);
  }
  function groupMenu(e: MouseEvent) {
    const by: BranchGroup[] = ["None", "Prefix", "Worktree", "Upstream", "Author"];
    openBelow(e.currentTarget as HTMLElement, [{ heading: t.cleanup.groupBy }, ...by.map((g) => choice(g, groupBy, t.git.groupBy[g], (v) => settings.setUi({ gitBranchGroup: v })))], t.cleanup.groupBy);
  }
  function headMenu(id: ColId): MenuEntry[] {
    return [
      { heading: colLabel(id) },
      { group: t.git.columnsGroup },
      ...SPEC.defs.map((d) => ({ label: colLabel(d.id), checked: layout.find((c) => c.id === d.id)?.visible ?? true, disabled: d.id === "branch", keepOpen: true, run: () => saveLayout(toggle(SPEC, layout, d.id)) })),
    ];
  }

  const groupIds = $derived(groups.map((g) => groupId(g.key)));
  const anyGroupOpen = $derived(groupIds.some((id) => fold.isOpen("gitBranchGroups", id)));
</script>

<!-- One row of the grid: the same columns as the head, the actions at the end. -->
{#snippet row(b: ListRow)}
  {@const n = b.remote ? splitRemote(b.name) : { remote: null, name: b.name }}
  {@const sel = chosen.includes(b.fullRef)}
  <!-- Keys belong to the list: arrows and shortcuts in the list's handler. -->
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <div
    class="mbf-grid mbf-lazy group h-[52px] cursor-pointer border-b border-line/50 {sel ? 'mbf-selected' : b.isHead ? 'bg-accent/8' : 'hover:bg-hover/50'}"
    style="--cols: {cols}; contain-intrinsic-size: auto 52px"
    role="option"
    aria-selected={sel}
    tabindex="-1"
    onclick={(e) => !(e.target as HTMLElement).closest("button") && pick(b, e)}
    use:contextmenu={() => menuFor(b)}
    use:tooltip={() => ({ text: t.git.branchRowTip, gestures: true })}
  >
    <span>{#if b.isHead}<span class="block size-2 rounded-full bg-accent" use:tooltip={t.git.current}></span>{/if}</span>
    {#each visible as id (id)}
      {#if id === "branch"}
        <div class="flex min-w-0 flex-col justify-center gap-0.5 overflow-hidden">
          <div class="flex min-w-0"><BranchName name={n.name} remote={n.remote} class={b.isHead ? "font-semibold" : ""} /></div>
          <div class="truncate text-sm text-faint" use:fullText={[b.subject, b.author].filter(Boolean).join(" · ")}>{[b.subject, b.author].filter(Boolean).join(" · ")}</div>
        </div>
      {:else if id === "upstream"}
        <div class="flex min-w-0 items-center gap-1 overflow-hidden text-xs">
          {#if b.remote}<span class="t-meta">{t.git.onServer}</span>{:else}
            <UpstreamState upstream={b.upstream} gone={b.gone} />
            {#if !b.gone && b.ahead}<span class="text-accent" use:tooltip={t.git.notPushed(b.ahead)}>↑{b.ahead}</span>{/if}
            {#if !b.gone && b.behind}<span class="text-blocked" use:tooltip={t.git.notPulled(b.behind)}>↓{b.behind}</span>{/if}
          {/if}
        </div>
      {:else if id === "worktree"}
        <div class="min-w-0 truncate text-sm text-muted" use:tooltip={b.worktreePath ? { path: b.worktreePath } : null}>{b.worktreePath ? repoName(b.worktreePath) : ""}</div>
      {:else}
        <div class="truncate text-sm text-muted" use:tooltip={absoluteTime(b.committedAt)}>{relativeTime(b.committedAt, clock.now)}</div>
      {/if}
    {/each}
    <!-- The row's actions on hover and for the chosen row: a column of the same button on every row was the loudest thing in the list. -->
    <div class="flex justify-end gap-1 transition-opacity {sel ? '' : 'opacity-0 group-hover:opacity-100 focus-within:opacity-100'}">
      {#if b.gone}
        <IconButton size="sm" icon={Broom} label={t.git.cleanup} hint={t.git.cleanupTip} onclick={() => showInCleanup([b])} />
      {/if}
      {#if elsewhere(b)}
        <!-- git checks a branch out in one worktree only: switching here would be refused. -->
        <Button size="sm" icon={GitFork} tip={{ title: t.git.inWorktree, path: b.worktreePath! }} onclick={() => (repoSelection.gitRepo = b.worktreePath!)}>{t.git.openWorktree}</Button>
      {:else if !b.isHead}
        <Button size="sm" icon={ArrowRightLeft} disabled={gitStore.locked} tip={b.remote ? t.git.switchRemoteTip : t.git.switchLocalTip} onclick={() => gitStore.switchTo(b.name, b.remote)}>{t.git.switchTo}</Button>
      {/if}
    </div>
  </div>
{/snippet}

<div class="flex min-h-0 flex-1 flex-col">
  <!-- What is shown, how it is grouped: one bar, the same as the cleanup table's. -->
  <div class="flex shrink-0 flex-wrap items-center gap-2 px-3 py-2">
    <Segmented
      label={t.git.branchKind}
      value={filter.kind}
      options={[
        { id: "all", label: t.git.filterAll, count: all.length },
        { id: "local", label: t.git.local, count: all.filter((b) => !b.remote).length },
        { id: "remote", label: t.git.remoteBranches, count: all.filter((b) => b.remote).length },
      ]}
      onchange={(v) => (filter.kind = v)}
    />
    <Button size="sm" variant="ghost" icon={Funnel} aria-haspopup="menu" onclick={filterMenu}>
      {t.git.filter}{#if filtered}<span class="ml-0.5 rounded bg-accent/15 px-1 text-xs text-accent-ink">●</span>{/if}
    </Button>
    <Button size="sm" variant="ghost" icon={Group} aria-haspopup="menu" onclick={groupMenu}>{groupBy === "None" ? t.cleanup.group : t.git.groupBy[groupBy]}</Button>
    {#if groupBy !== "None"}
      <IconButton icon={anyGroupOpen ? FoldVertical : UnfoldVertical} size="sm" label={anyGroupOpen ? t.common.foldAll : t.common.unfoldAll} keys="Alt+← →" onclick={() => fold.setAll("gitBranchGroups", groupIds, !anyGroupOpen)} />
    {/if}
    <span class="flex-1"></span>
    {#if chosen.length > 1}
      <span class="t-meta">{t.git.branchesChosen(chosen.length)}</span>
      <IconButton icon={Ellipsis} size="sm" label={t.git.chosenActions} aria-haspopup="menu" onclick={(e) => openBelow(e.currentTarget as HTMLElement, menuFor(chosenRows()[0]), t.git.chosenActions)} />
    {/if}
    <IconButton icon={CheckCheck} size="sm" label={t.select.all} keys="Ctrl+A" onclick={() => (picked = nextSelection(picked, { kind: "all" }, order))} />
    <div class="w-64 min-w-0">
      <Input bind:value={filter.query} icon={Search} placeholder={t.git.searchBranches} aria-label={t.git.searchBranches} clearable />
    </div>
  </div>

  <GitError of={["branches"]} class="mx-3 mb-2" />
  <div class="mx-3 mb-3 flex min-h-0 flex-1 flex-col overflow-x-auto overflow-y-hidden rounded-xl border border-line bg-panel">
    <div class="flex min-h-0 flex-1 flex-col" style="min-width: {minWidth(SPEC, shownLayout)}px">
      <div class="mbf-grid mbf-head h-9 shrink-0 border-b border-line bg-panel-2 t-section" style="--cols: {cols}" role="row">
        <span></span>
        {#each visible as id (id)}
          {@const def = SPEC.defs.find((d) => d.id === id)!}
          <div class="relative flex h-full min-w-0 items-center" role="columnheader" tabindex="-1" aria-sort={sort.key === def.sort ? (sort.dir === 1 ? "ascending" : "descending") : undefined} use:contextmenu={() => headMenu(id)}>
            <button type="button" class="-mx-1 inline-flex min-w-0 items-center gap-1 rounded px-1 uppercase transition-colors hover:bg-hover hover:text-fg" onclick={() => setSort(def.sort)}>
              <span class="truncate" use:fullText={colLabel(id)}>{colLabel(id)}</span>
              {#if sort.key === def.sort}{#if sort.dir === 1}<ArrowDown size={11} class="shrink-0" />{:else}<ArrowUp size={11} class="shrink-0" />{/if}{:else}<ArrowUpDown size={11} class="shrink-0 opacity-50" />{/if}
            </button>
            <Resizer
              width={shownLayout.find((c) => c.id === id)!.width}
              min={def.min}
              max={MAX_WIDTH}
              side="right"
              label={t.cleanup.resizeColumn(colLabel(id))}
              oninput={(v) => (drafts[id] = v)}
              onend={(v) => commitWidth(id, v)}
              onreset={() => commitWidth(id, def.width)}
            />
          </div>
        {/each}
        <span></span>
      </div>

      {#if gitStore.branches}
        <div class="min-h-0 flex-1 overflow-y-auto outline-none pop-in" tabindex="0" role="listbox" aria-multiselectable="true" aria-label={t.git.branchList} onkeydown={onKey}>
          {#if groupBy === "None"}
            {#each rows as b (b.fullRef)}{@render row(b)}{/each}
          {:else}
            {#each groups as g (g.key)}
              {@const id = groupId(g.key)}
              <GroupHead
                level={2}
                title={g.label}
                count={g.rows.length}
                open={fold.isOpen("gitBranchGroups", id)}
                ontoggle={() => fold.toggle("gitBranchGroups", id)}
                foldAll={{ anyOpen: anyGroupOpen, run: (open) => fold.setAll("gitBranchGroups", groupIds, open) }}
                guide={false}
                class="sticky top-0 z-[1] bg-panel-2 px-2 font-mono"
                menu={() => [
                  { group: t.select.group },
                  { label: t.git.selectGroupBranches(g.rows.length), icon: CheckCheck, run: () => (picked = nextSelection(picked, { kind: "set", ids: g.rows.map((b) => b.fullRef), mode: "only" }, order)) },
                  { label: t.select.none, icon: SquareDashed, disabled: !chosen.length, run: () => (picked = emptySelection) },
                ]}
              >
                {#each g.rows as b (b.fullRef)}{@render row(b)}{/each}
              </GroupHead>
            {/each}
          {/if}
          {#if !rows.length}<p class="px-4 py-4 t-meta">{t.common.noMatch}</p>{/if}
        </div>
      {:else}
        <!-- The shape of the list while the branches are read: head and filters are there already. -->
        <div class="min-h-0 flex-1" aria-busy="true">
          {#each [0, 1, 2, 3, 4, 5] as i (i)}
            <div class="mbf-grid h-[52px] border-b border-line/50" style="--cols: {cols}">
              <span></span>
              {#each visible as id (id)}
                {#if id === "branch"}<div><Skeleton class={i % 2 ? "h-3 w-1/3" : "h-3 w-1/2"} /><Skeleton class="mt-1.5 h-2.5 w-1/4" /></div>{:else}<Skeleton class="h-3 w-2/3" />{/if}
              {/each}
              <span></span>
            </div>
          {/each}
        </div>
      {/if}
    </div>
  </div>
</div>
