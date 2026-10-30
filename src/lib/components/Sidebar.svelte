<script lang="ts">
  import { gitStatus } from "$lib/stores/gitStatus.svelte";
  import { fold } from "$lib/stores/fold.svelte";
  import { sidebarSelection } from "$lib/stores/sidebarSelection.svelte";
  import { roving } from "$lib/ui/roving";
  import SectionTools from "./SectionTools.svelte";
  import { FolderPlus, Layers, Plus, Search } from "@lucide/svelte";
  import { onMount } from "svelte";
  import IconButton from "$lib/ui/IconButton.svelte";
  import { sortable, type SortState } from "$lib/ui/sortable";
  import { borrowedWorktrees, NO_ROOT, sidebarGroups, type SidebarGroup } from "$lib/groups";
  import type { RepoEntry } from "$lib/stores/scanResults.svelte";
  import { t } from "$lib/i18n/index.svelte";
  import Input from "$lib/ui/Input.svelte";
  import Skeleton from "$lib/ui/Skeleton.svelte";
  import { sidebarUi } from "$lib/stores/sidebarUi.svelte";
  import { headSums } from "$lib/headSums";
  import { tooltip } from "$lib/ui/tooltip";
  import BorrowedCard from "./BorrowedCard.svelte";
  import FolderHead from "./FolderHead.svelte";
  import RepoCard from "./RepoCard.svelte";
  import { settings } from "$lib/stores/settings.svelte";
  import { scanResults } from "$lib/stores/scanResults.svelte";
  import { repoSelection } from "$lib/stores/repoSelection.svelte";
  import { repoActions } from "$lib/services/repoActions.svelte";

  let query = $state("");

  const groups = $derived(sidebarGroups(scanResults.repos, query, fold.foldedSet("roots"), t.sidebar.other, settings.config?.roots ?? []));
  const searching = $derived(query.trim() !== "");

  /**
   * Per folder, once per change instead of once per use: the worktrees lent to it (linked worktrees below
   * it whose repo is listed under another folder), its members as a set like a repo group's, and what its
   * head sums up of the working copies it shows.
   */
  const folderInfo = $derived.by(() => {
    const q = query.trim().toLowerCase();
    const matches = (w: { path: string; owner: RepoEntry }) => !q || w.path.toLowerCase().includes(q) || w.owner.info.name.toLowerCase().includes(q);
    return new Map(
      groups.map((g) => {
        const lent = g.root === NO_ROOT ? [] : borrowedWorktrees(g.root, scanResults.repos, (r) => gitStatus.statuses.get(r.info.path)?.worktrees ?? []).filter(matches);
        const members = [...g.repos.map((r) => r.info.path), ...lent.map((w) => w.path)];
        const linked = g.repos.flatMap((r) => (gitStatus.statuses.get(r.info.path)?.worktrees ?? []).filter((w) => !w.isMain && !w.foreign).map((w) => w.path));
        return [g.root, { lent, members, sums: headSums([...members, ...linked], gitStatus.statuses) }] as const;
      }),
    );
  });
  const membersOf = (g: SidebarGroup<RepoEntry>) => folderInfo.get(g.root)?.members ?? [];
  const NO_SUMS = { dirty: 0, ahead: 0, behind: 0 };

  // Groups move by dragging their header; the order is the order of the roots.
  let moving = $state<SortState | null>(null);

  async function pickRoots() {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const picked = await open({ directory: true, multiple: true, title: t.settings.pickRoot });
    if (picked) await repoActions.addRoots(Array.isArray(picked) ? picked : [picked]);
  }

  // Menus load on first open; the list does not need them to show.
  const menuCtx = () => ({ roots: groups.map((x) => x.root), pickRoots });
  const folderMenu = (g: SidebarGroup<RepoEntry>) => import("./sidebarMenus").then((m) => m.folderMenu(menuCtx(), g, membersOf(g)));

  /** Every member selected: the head shows it like a group head does. */
  const allChosen = (members: string[]) => members.length > 0 && members.every((p) => sidebarSelection.has(p));
  // A folder head selects like a group head: its members alone (again: none), Ctrl adds or takes them out,
  // Shift spans from the last click over them.
  function selectFolder(g: SidebarGroup<RepoEntry>, e: MouseEvent) {
    sidebarSelection.apply({ kind: "group", ids: membersOf(g), ctrl: e.ctrlKey || e.metaKey, shift: e.shiftKey });
  }

  // Folders dragged in from the file manager arrive as a native drop on the window, not as a DOM
  // event: the webview reports them with their paths.
  let dropping = $state(false);
  onMount(() => {
    let stop: (() => void) | undefined;
    let gone = false;
    import("@tauri-apps/api/webview")
      .then(({ getCurrentWebview }) =>
        getCurrentWebview().onDragDropEvent((e) => {
          const p = e.payload;
          if (p.type === "enter" || p.type === "over") dropping = true;
          else if (p.type === "leave") dropping = false;
          else if (p.type === "drop") {
            dropping = false;
            repoActions.addRoots(p.paths);
          }
        }),
      )
      .then((un) => (gone ? un() : (stop = un)))
      // Outside the app (tests, audit) there is no webview to listen to.
      .catch(() => {});
    return () => {
      gone = true;
      stop?.();
    };
  });

  // The repos show as soon as the scan names them, before their first result: name and folder are known.
  const listed = $derived(scanResults.loaded || scanResults.repos.length > 0);
  const foldAllRoots = (open: boolean) => fold.setAll("roots", groups.map((x) => x.root), open);
  const anyRootOpen = $derived(groups.some((x) => x.open));
  // In the Git perspective the sidebar selects exactly one repo instead of filtering.
  const gitMode = $derived(settings.config?.ui.perspective === "Git");

  // Keys of the list: the arrows move (roving), these act on what is focused or on all of it.
  function onListKey(e: KeyboardEvent) {
    const target = e.target as HTMLElement;
    if (target.closest("input, textarea")) return;
    const row = target.closest<HTMLElement>("[data-sel-path]");
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === "a") sidebarSelection.apply({ kind: "all" });
    else if (e.key === "Escape" && sidebarSelection.items.length > (gitMode ? 1 : 0)) sidebarSelection.apply({ kind: "none" });
    else if (row && e.key === " " && target === row) sidebarSelection.apply({ kind: "toggle", id: row.dataset.selPath! });
    else if (row && e.key === "Enter" && target === row) sidebarSelection.apply({ kind: "click", id: row.dataset.selPath!, shift: e.shiftKey, ctrl: mod });
    else if (row && e.key === "ArrowLeft" && target === row) {
      // Up one level: from a row to the head of the group it is in.
      const head = row.parentElement?.closest("[data-rg-id], [data-sort-id], [data-fold-group]")?.querySelector<HTMLElement>("[data-fold-head]");
      head?.focus();
    } else return;
    e.preventDefault();
  }

  /** The members of every folder shown, folded ones too, as the groups section counts its groups. */
  const folderPaths = () => [...new Set(groups.flatMap(membersOf))];

  function arrive(row: HTMLElement, e: KeyboardEvent) {
    const path = row.dataset.selPath;
    // Ctrl moves only the focus; a head is a place to stand, not a selection.
    if (!path || e.ctrlKey || e.metaKey) return;
    if (e.shiftKey) sidebarSelection.step({ kind: "click", id: path, shift: true });
    else if (!(sidebarSelection.items.length === 1 && sidebarSelection.has(path))) sidebarSelection.step({ kind: "click", id: path });
  }
</script>

<nav class="relative flex h-full flex-col surface-glow" aria-label={t.sidebar.label}>
  {#if dropping}
    <div class="pointer-events-none absolute inset-1.5 z-30 grid place-items-center rounded-xl border-2 border-dashed border-accent/70 bg-accent/10 p-4 text-center text-base font-medium text-accent-ink">
      <span class="flex flex-col items-center gap-2"><FolderPlus size={22} />{t.sidebar.dropHere}</span>
    </div>
  {/if}
  <div class="shrink-0 p-3 pb-2">
    <Input bind:value={query} icon={Search} placeholder={t.sidebar.search} aria-label={t.sidebar.search} clearable />
  </div>

  <div
    class="min-h-0 flex-1 overflow-y-auto px-3 pb-3"
    bind:this={sidebarSelection.root}
    role="listbox"
    tabindex="-1"
    aria-multiselectable="true"
    aria-label={t.sidebar.listLabel}
    use:roving={{ rows: "[data-sel-path], [data-fold-head]", onarrive: arrive }}
    onkeydown={onListKey}
    use:sortable={{ axis: "y", items: "[data-sort-id]", handle: "[data-group-head]", onchange: (s) => (moving = s), ondrop: (id, over, after) => repoActions.moveRoot(id, over, after) }}
  >
    {#if !gitMode}
      <button
        type="button"
        class="mt-1 flex h-8 w-full items-center gap-2.5 rounded-lg px-2.5 text-base transition-colors
          {repoSelection.repos.length === 0 ? 'mbf-selected font-medium text-fg' : 'text-muted hover:bg-hover/70'}"
        aria-pressed={repoSelection.repos.length === 0}
        onclick={() => sidebarSelection.apply({ kind: "none" })}
      >
        <Layers size={14} class="shrink-0" /> {t.sidebar.all}
        <span class="ml-auto mbf-count">{scanResults.repos.length}</span>
      </button>
    {/if}

    <!-- After the first paint: the folders are what the start shows, the groups follow a moment later. -->
    {#if listed}{#await import("./RepoGroups.svelte") then m}<m.default {query} />{/await}{/if}

    {#if !listed}
      <!-- Skeleton in the shape of the list: a root heading and repo rows. -->
      <div class="mt-4 flex flex-col gap-3 px-2.5" aria-busy="true">
        <Skeleton class="h-2.5 w-24" />
        {#each [0, 1, 2, 3] as i (i)}
          <div class="flex items-center gap-2.5"><Skeleton class="size-3.5" /><div class="flex-1"><Skeleton class="h-3 w-3/4" /><Skeleton class="mt-1.5 h-2.5 w-1/2" /></div></div>
        {/each}
      </div>
    {/if}

    <!-- Away from the groups: a repo dragged out of a group and dropped here leaves it. -->
    <!-- The folders as a section of their own, headed like the repo groups above, with the same "+". -->
    {#if listed}
      <div class="mt-3 flex h-8 items-center justify-between pl-1">
        <span class="t-section" use:tooltip={t.sidebar.foldersTip}>{t.sidebar.folders}</span>
        <span class="flex items-center gap-1">
          <SectionTools anyOpen={anyRootOpen} onfold={foldAllRoots} anySelected={sidebarSelection.items.length > 0} onselect={(all) => sidebarSelection.apply(all ? { kind: "set", ids: folderPaths(), mode: "only" } : { kind: "none" })} />
          <IconButton icon={Plus} size="sm" class="!size-6" label={t.sidebar.addRoot} hint={t.sidebar.addRootTip} onclick={pickRoots} />
        </span>
      </div>
    {/if}
    <div data-drop="out">
    {#each groups as g (g.root)}
      {@const real = g.root !== NO_ROOT}
      {@const sortId = real && !searching ? g.root : undefined}
      {@const info = folderInfo.get(g.root)}
      {@const lent = info?.lent ?? []}
      <!-- One block per folder: the header drags the whole block, the line shows where it lands. -->
      <div
        data-sort-id={sortId}
        data-fold-group
        class="rounded-lg {moving?.id === g.root ? 'opacity-50' : ''}
          {moving?.over === g.root ? (moving.after ? 'shadow-[0_2px_0_var(--accent)]' : 'shadow-[0_-2px_0_var(--accent)]') : ''}"
      >
      <FolderHead
        {g}
        {real}
        {sortId}
        lent={lent.length}
        chosen={allChosen(info?.members ?? [])}
        sums={info?.sums ?? NO_SUMS}
        {searching}
        menu={() => folderMenu(g)}
        onfoldall={foldAllRoots}
        onselect={(e) => selectFolder(g, e)}
      />
      {#if g.open && !g.repos.length && !lent.length}
        <p class="px-2.5 pt-1.5 t-meta">{t.sidebar.emptyRoot}</p>
      {/if}
      {#if g.open}
      <div class="mbf-guide-cards">
      {#each g.repos as r (r.info.path)}
        <RepoCard {r} groupRoot={g.root} />
      {/each}
      {#each lent as w (w.path)}
        <BorrowedCard {w} />
      {/each}
      </div>
      {/if}
      </div>
    {:else}
      {#if scanResults.loaded && query}
        <p class="px-2.5 py-3 t-meta">{t.common.noMatch}</p>
      {/if}
    {/each}
    </div>
  </div>

</nav>

{#if sidebarUi.annotating}
  {@const repo = sidebarUi.annotating}
  {#await import("./RepoNoteDialog.svelte") then m}<m.default {repo} onclose={() => (sidebarUi.annotating = null)} />{/await}
{/if}

