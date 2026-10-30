<script lang="ts">
  import { gitStatus } from "$lib/stores/gitStatus.svelte";
  import { identities } from "$lib/stores/identities.svelte";
  import { ChevronRight, Ellipsis, Plus } from "@lucide/svelte";
  import { fold } from "$lib/stores/fold.svelte";
  import { sidebarSelection } from "$lib/stores/sidebarSelection.svelte";
  import SectionTools from "./SectionTools.svelte";
  import type { RepoGroup } from "$lib/bindings/RepoGroup";
  import { t } from "$lib/i18n/index.svelte";
  import { sameFolder } from "$lib/roots";
  import { goneCount, repoName } from "$lib/filter";
  import StatusChip from "$lib/ui/StatusChip.svelte";
  import { headSums } from "$lib/headSums";
  import { newGroupId, nextGroupName, withGroup, withMoved, withRenamed } from "$lib/repoGroups";
  import IconButton from "$lib/ui/IconButton.svelte";
  import Skeleton from "$lib/ui/Skeleton.svelte";
  import { contextmenu, openBelow } from "$lib/ui/menu.svelte";
  import { drag, dragTo } from "$lib/ui/dragTo.svelte";
  import { sortable, type SortState } from "$lib/ui/sortable";
  import { foldKeys } from "$lib/ui/foldKeys";
  import { tooltip } from "$lib/ui/tooltip";
  import { doubleClick } from "$lib/ui/gestures";
  import Resizer from "$lib/ui/Resizer.svelte";
  import QuickSwitch from "./QuickSwitch.svelte";
  import GroupMark from "./GroupMark.svelte";
  import RepoName from "./RepoName.svelte";
  import { groupTarget, groupUi, openSwitch as openGroupSwitch, repoDragOptions, targetGroup, type RepoDrag, type SwitchMode } from "./repoGroupDrop.svelte";
  import { settings } from "$lib/stores/settings.svelte";
  import { scanResults } from "$lib/stores/scanResults.svelte";
  import { repoActions } from "$lib/services/repoActions.svelte";

  /** The sidebar's search: a group shows the members it finds, a group whose name matches shows all. */
  let { query = "" }: { query?: string } = $props();

  /** The user's repo groups above the folders: a head per group that filters and carries the actions, the repos below. */
  const allGroups = $derived(settings.config?.repoGroups ?? []);
  const q = $derived(query.trim().toLowerCase());
  const matches = (p: string) => repoName(p).toLowerCase().includes(q) || p.toLowerCase().includes(q) || (scanResults.copyLabel(p) ?? "").toLowerCase().includes(q);
  const groups = $derived(
    q ? allGroups.map((g) => (g.name.toLowerCase().includes(q) ? g : { ...g, paths: g.paths.filter(matches) })).filter((g) => g.paths.length) : allGroups,
  );
  const searching = $derived(q !== "");
  const totalOf = (id: string) => allGroups.find((g) => g.id === id)?.paths.length ?? 0;
  const anyOpen = $derived(groups.some((g) => fold.isOpen("repoGroups", g.id)));
  const foldAll = (open: boolean) => fold.setAll("repoGroups", groups.map((g) => g.id), open);
  const headKey = (e: KeyboardEvent, g: RepoGroup, open: boolean) => foldKeys(e, { open, toggle: () => fold.set("repoGroups", g.id, !open), all: foldAll });
  /** Gone branches of the group's repos, as the folder heads sum up their cards. */
  const goneOf = (g: RepoGroup) => goneCount([...new Set(g.paths.map((x) => gitStatus.ownerOf(x)))].flatMap((p) => scanResults.resultOf(p)?.branches ?? []));
  /** How much of a group the sidebar has selected: the head shows it, and a click completes or clears it. */
  const groupState = (g: RepoGroup): "all" | "some" | "none" => {
    const live = g.paths.filter(known);
    const n = live.filter((p) => sidebarSelection.has(p)).length;
    return n && n === live.length ? "all" : n ? "some" : "none";
  };
  const dragging = $derived(drag.current as (typeof drag.current & { payload: RepoDrag }) | null);
  const over = $derived(dragging?.target ?? null);

  let moving = $state<SortState | null>(null);
  const heads: Record<string, HTMLElement> = {};

  const menus = () => import("./repoGroupMenus");
  const menuCtx = () => ({ openSwitch, rename: (g: RepoGroup) => (groupUi.editing = g.id), ids: groups.map((g) => g.id) });
  const copyMenu = (path: string, g: RepoGroup) => import("./copyMenu").then((m) => m.copyMenu(path, { group: allGroups.find((x) => x.id === g.id) ?? g }));
  /** A worktree is reached through the repo that lists it; a path that is neither is not reachable. */
  function headOf(path: string) {
    const own = gitStatus.statuses.get(path);
    if (own) return { branch: own.head.branch, sha: own.head.oid, unreferenced: own.head.unreferenced };
    const w = gitStatus.statuses.get(gitStatus.ownerOf(path))?.worktrees.find((x) => sameFolder(x.path, path));
    return w ? { branch: w.branch, sha: w.head, unreferenced: w.unreferenced } : null;
  }
  const known = (path: string) => scanResults.repoByPath.has(path) || gitStatus.ownerOf(path) !== path || !!gitStatus.statuses.get(path);

  // A click on the head selects the members (again: none); Ctrl adds them or takes them out, Shift spans to them.
  function filterTo(g: RepoGroup, e?: MouseEvent) {
    // Only the rows that can be chosen: a member whose status could not be read shows as unreachable.
    const rows = g.paths.filter((p) => known(p) && !gitStatus.statusFailed.has(gitStatus.ownerOf(p)));
    sidebarSelection.apply({ kind: "group", ids: rows, ctrl: !!(e?.ctrlKey || e?.metaKey), shift: !!e?.shiftKey });
  }

  function openSwitch(group: RepoGroup, mode: SwitchMode) {
    openGroupSwitch({ name: group.name, paths: group.paths.filter(known) }, mode, heads[group.id] ?? null);
  }

  function createEmpty() {
    const id = newGroupId();
    const name = nextGroupName(groups, t.repoGroups.defaultName);
    groupUi.editing = id;
    repoActions.setRepoGroups(withGroup(allGroups, { id, name, paths: [] }));
  }

  // Esc leaves the field first; a blur from its removal must not save what Esc threw away.
  function commitName(g: RepoGroup, value: string) {
    if (groupUi.editing !== g.id) return;
    groupUi.editing = null;
    if (value.trim() && value.trim() !== g.name) repoActions.setRepoGroups(withRenamed(allGroups, g.id, value));
  }

  function focusInput(node: HTMLInputElement) {
    node.focus();
    node.select();
  }

  // What the label at the pointer says: where the repos would go.
  const aim = $derived.by(() => {
    if (!dragging) return "";
    const to = dragging.target;
    if (to === "new") return t.repoGroups.newZone;
    if (to === "out") return dragging.payload.from ? t.repoGroups.takeOut : "";
    const id = targetGroup(to);
    const g = id ? allGroups.find((x) => x.id === id) : null;
    if (!g || g.id === dragging.payload.from) return "";
    return dragging.shift && dragging.payload.from ? t.repoGroups.moveTo(g.name) : t.repoGroups.addTo(g.name);
  });
  const lit = (target: string) => over === target && !!aim;

  // Repo name and branch as two columns; one edge for all groups, so the columns line up.
  const SPLIT_MIN = 30;
  const SPLIT_MAX = 70;
  const clampSplit = (v: number) => Math.round(Math.min(SPLIT_MAX, Math.max(SPLIT_MIN, v)));
  let listWidth = $state(0);
  let liveSplit = $state<number | null>(null);
  const split = $derived(liveSplit ?? clampSplit(settings.config?.ui.groupSplit ?? 50));
  // The width both columns share: the list less its indent, the row padding and the gap.
  const inner = $derived(Math.max(0, listWidth - 16.5 - 14 - 8));

  function saveSplit(v: number) {
    liveSplit = null;
    settings.setUi({ groupSplit: clampSplit(v) });
  }
</script>

<section class="mt-3" aria-label={t.repoGroups.title}>
  <div class="relative flex h-8 items-center justify-between pl-1">
    <span class="t-section" use:tooltip={t.repoGroups.titleTip}>{t.repoGroups.title}</span>
    <span class="flex items-center gap-1">
      {#if groups.length}
        <SectionTools
          {anyOpen}
          onfold={foldAll}
          anySelected={sidebarSelection.items.length > 0}
          onselect={(all) => sidebarSelection.apply(all ? { kind: "set", ids: [...new Set(groups.flatMap((g) => g.paths.filter(known)))], mode: "only" } : { kind: "none" })}
        />
      {/if}
      <IconButton icon={Plus} size="sm" class="!size-6" label={t.repoGroups.create} hint={t.repoGroups.empty} onclick={createEmpty} />
    </span>
  </div>

  <div
    bind:clientWidth={listWidth}
    use:sortable={{
      axis: "y",
      items: "[data-rg-id]",
      handle: "[data-rg-head]",
      onchange: (s) => (moving = s),
      ondrop: (id, target, after) => repoActions.setRepoGroups(withMoved(allGroups, id, target, after)),
    }}
  >
    {#each groups as g (g.id)}
      {@const open = searching || fold.isOpen("repoGroups", g.id)}
      {@const sum = goneOf(g)}
      {@const sums = headSums(g.paths, gitStatus.statuses)}
      {@const active = groupState(g) === "all"}
      {@const target = groupTarget(g.id)}
      <div
        data-rg-id={g.id}
        data-drop={target}
        class="mt-1.5 rounded-lg {moving?.id === g.id ? 'opacity-50' : ''}
          {moving?.over === g.id ? (moving.after ? 'shadow-[0_2px_0_var(--accent)]' : 'shadow-[0_-2px_0_var(--accent)]') : ''}
          {lit(target) ? 'bg-accent/8 ring-2 ring-accent/60' : ''}"
      >
        <div
          bind:this={heads[g.id]}
          data-rg-head
          class="flex h-8 items-center rounded-lg border {active ? 'mbf-selected-card' : 'border-group-line bg-group'}"
          style={identities.groupColor(g.id) ? `border-left: 3px solid ${identities.groupColor(g.id)} !important` : undefined}
          use:contextmenu={() => menus().then((m) => m.groupMenu(menuCtx(), g))}
        >
          <button
            type="button"
            class="grid h-full w-7 shrink-0 place-items-center text-fg"
            aria-expanded={open}
            aria-label={g.name}
            use:tooltip={{ title: open ? t.common.fold : t.common.unfold, text: t.common.foldAllHint, keys: "← →" }}
            disabled={searching}
            onclick={(e) => (e.altKey ? foldAll(!open) : fold.toggle("repoGroups", g.id))}
            onkeydown={(e) => headKey(e, g, open)}
          >
            <ChevronRight size={14} class="transition-transform {open ? 'rotate-90' : ''}" />
          </button>
          {#if groupUi.editing === g.id}
            <input
              class="mr-1 h-6 min-w-0 flex-1 rounded-md border border-accent/60 bg-panel px-1.5 text-sm outline-none"
              aria-label={t.repoGroups.nameLabel}
              value={g.name}
              use:focusInput
              onkeydown={(e) => {
                if (e.key === "Enter") commitName(g, e.currentTarget.value);
                else if (e.key === "Escape") {
                  e.stopPropagation();
                  groupUi.editing = null;
                }
              }}
              onblur={(e) => commitName(g, e.currentTarget.value)}
            />
          {:else}
            <button
              type="button"
              class="flex h-full min-w-0 flex-1 items-center gap-1.5 pr-1 text-left text-sm"
              aria-pressed={active}
              data-fold-head
              use:tooltip={{ title: g.name, text: t.repoGroups.headTip(g.paths.length), foot: t.repoGroups.moveGroupTip, gestures: true }}
              use:doubleClick={{ run: () => (groupUi.editing = g.id), hint: () => t.repoGroups.renameHint }}
              onclick={(e) => e.detail < 2 && filterTo(g, e)}
              onkeydown={(e) => (e.key === "F2" ? (e.preventDefault(), (groupUi.editing = g.id)) : headKey(e, g, open))}
            >
              <GroupMark id={g.id} {active} />
              <span class="min-w-0 truncate font-semibold text-fg">{g.name}</span>
              <span class="mbf-count shrink-0">{searching ? t.sidebar.someOf(g.paths.length, totalOf(g.id)) : g.paths.length}</span>
              {#if sum.gone}<StatusChip kind="gone" count={sum.gone} alert={sum.unsafe > 0} />{/if}
              {#if sums.dirty}<StatusChip kind="dirty" count={sums.dirty} tip={t.sidebar.headDirty(sums.dirty)} />{/if}
              {#if sums.ahead}<StatusChip kind="ahead" count={sums.ahead} tip={t.sidebar.headAhead(sums.ahead)} />{/if}
              {#if sums.behind}<StatusChip kind="behind" count={sums.behind} tip={t.sidebar.headBehind(sums.behind)} />{/if}
            </button>
          {/if}
          <span class="mr-1 flex shrink-0 items-center gap-0.5">
            <IconButton
              icon={Ellipsis}
              size="sm"
              class="!size-6"
              label={t.repoGroups.actions}
              aria-haspopup="menu"
              onclick={(e) => openBelow(e.currentTarget as HTMLElement, menus().then((m) => m.groupMenu(menuCtx(), g)), g.name)}
            />
          </span>
        </div>
        {#if open}
          <div class="mbf-guide flex flex-col gap-px py-0.5">
            {#each g.paths as p (p)}
              {@const head = headOf(p)}
              {@const missing = !known(p) || gitStatus.statusFailed.has(gitStatus.ownerOf(p))}
              {@const loading = !head && !missing}
              {@const chosen = sidebarSelection.has(p)}
              {@const edge = identities.tintOf(p)}
              <!-- Keys belong to the list: roving focus, Enter and Space in the sidebar's handler. -->
              <!-- svelte-ignore a11y_click_events_have_key_events -->
              <div
                role="option"
                aria-selected={chosen}
                tabindex="-1"
                data-sel-path={missing ? undefined : p}
                aria-label={p}
                class="relative grid cursor-pointer items-center gap-x-2 rounded-md py-0.5 pr-1.5 pl-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-accent/60 {chosen ? 'mbf-selected' : 'hover:bg-hover/70'} {missing ? 'opacity-55' : ''} {head && gitStatus.isRefreshing(p) ? 'mbf-refreshing' : ''} {edge ? 'mbf-tint-edge' : ''}"
                onclick={(e) => e.detail < 2 && !missing && !(e.target as HTMLElement).closest("button, input, [role=separator], [role=dialog]") && sidebarSelection.click(p, e)}
                style="grid-template-columns: calc((100% - 8px) * {split / 100}) minmax(0, 1fr); --tint-line: {edge ?? 'transparent'}"
                use:dragTo={repoDragOptions(p, g.id, () => [])}
                use:contextmenu={() => copyMenu(p, g)}
                use:tooltip={() => ({ title: repoName(p), path: p, text: missing ? t.repoGroups.missingTip : t.sidebar.selectRepoTip, gestures: true })}
              >
                <span class="flex min-w-0 items-center"><RepoName path={p} /></span>
                <!-- The column edge sits in the gap; every row carries it, so it is where the eye already is. -->
                {#if inner > 0 && !loading}
                  <span class="absolute inset-y-0 w-0" style="left: {8 + (inner * split) / 100 + 4}px">
                    {#if liveSplit !== null}<span class="absolute inset-y-0 -left-px w-px bg-accent"></span>{/if}
                    <Resizer
                      width={(inner * split) / 100}
                      min={(inner * SPLIT_MIN) / 100}
                      max={(inner * SPLIT_MAX) / 100}
                      side="right"
                      label={t.repoGroups.splitLabel}
                      oninput={(w) => (liveSplit = (w / inner) * 100)}
                      onend={(w) => saveSplit((w / inner) * 100)}
                      onreset={() => saveSplit(50)}
                    />
                  </span>
                {/if}
                {#if head}
                  <span class="flex min-w-0"><QuickSwitch path={p} branch={head.branch} sha={head.sha} unreferenced={head.unreferenced} size="xs" fill /></span>
                {:else if missing}
                  <span class="t-meta" use:tooltip={t.repoGroups.missingTip}>{t.repoGroups.missing}</span>
                {:else}
                  <!-- There, but its status is still on its way (start, slow git status): hold the place. -->
                  <span class="contents" aria-busy="true"><Skeleton class="h-[22px] w-full rounded-md" /></span>
                {/if}
              </div>
            {:else}
              <p class="px-2 py-1 t-meta">{t.repoGroups.empty}</p>
            {/each}
          </div>
        {/if}
      </div>
    {/each}
  </div>
  <!-- The way to a new group is always there, below the last one: a drag starts without anything moving. -->
  <div
    data-drop="new"
    class="flex items-center gap-2 rounded-lg border border-dashed px-2.5 text-sm transition-colors mt-1.5 min-h-8 py-1.5
      {lit('new') ? 'border-accent bg-accent/12 text-accent-ink' : dragging ? 'border-accent/50 bg-panel text-muted' : 'border-line-strong text-faint'}"
  >
    <Plus size={13} class="shrink-0" />
    <span class="min-w-0">{dragging ? t.repoGroups.newZone : t.repoGroups.empty}</span>
  </div>
</section>

{#if dragging}
  <!-- Follows the pointer: what is dragged, and where it would go. -->
  <div
    class="pointer-events-none fixed z-[95] flex max-w-[280px] flex-col rounded-lg mbf-popover px-2.5 py-1.5 text-sm"
    style="left: {dragging.x + 14}px; top: {dragging.y + 14}px"
    aria-hidden="true"
  >
    <span class="truncate font-medium">{dragging.label}</span>
    {#if aim}<span class="truncate text-accent-ink">{aim}</span>{/if}
    {#if dragging.payload.from && !dragging.shift}<span class="text-xs text-faint">{t.repoGroups.moveHint}</span>{/if}
  </div>
{/if}

<!-- Keyed: the panel loads its lists when it mounts, so another group needs a panel of its own. -->
{#key groupUi.switching}
  {#if groupUi.switching}
    {@const s = groupUi.switching}
    {#await import("./QuickSwitchPanel.svelte") then m}
      <m.default path={s.group.paths[0] ?? ""} branch="" sha={null} trigger={s.trigger} group={s.group} create={s.mode === "create"} adopt={s.mode === "adopt"} onclose={() => (groupUi.switching = null)} />
    {/await}
  {/if}
{/key}
