<script lang="ts" module>
  import type { BranchScope } from "$lib/switchPlan";

  // Kept across openings: whoever looks for their own branches once usually does so again.
  let scope = $state<BranchScope>("all");
</script>

<script lang="ts">
  import { toggled } from "$lib/lists";
  import { gitStatus } from "$lib/stores/gitStatus.svelte";
  import { onMount } from "svelte";
  import { ArrowLeft, Check, GitBranchPlus, GitFork, Search, TriangleAlert } from "@lucide/svelte";
  import { api } from "$lib/api";
  import { t } from "$lib/i18n/index.svelte";
  import { repoName } from "$lib/filter";
  import { shortSha } from "$lib/format";
  import { splitRemote } from "$lib/branchName";
  import { companions, mergeLists, runnable, stepFor, switchItems, type SwitchItem, type SwitchStep } from "$lib/switchPlan";
  import { infoFor, switchRepos } from "$lib/services/quickSwitch";
  import { createMissing } from "$lib/services/groupActions";
  import { pooled } from "$lib/pool";
  import { repoLabel as labelOf } from "$lib/repoLabel";
  import type { BranchList } from "$lib/bindings/BranchList";
  import type { CarryMode } from "$lib/bindings/CarryMode";
  import BranchName from "$lib/ui/BranchName.svelte";
  import Button from "$lib/ui/Button.svelte";
  import Checkbox from "$lib/ui/Checkbox.svelte";
  import Segmented from "$lib/ui/Segmented.svelte";
  import StatusChip from "$lib/ui/StatusChip.svelte";
  import RepoName from "./RepoName.svelte";
  import { openInGit } from "./openInGit";
  import { tooltip } from "$lib/ui/tooltip";
  import { portal } from "$lib/ui/portal";
  import { onDismiss } from "$lib/ui/dismiss";
  import { toasts } from "$lib/stores/toasts.svelte";
  import { settings } from "$lib/stores/settings.svelte";
  import { scanResults } from "$lib/stores/scanResults.svelte";
  import { repoSelection } from "$lib/stores/repoSelection.svelte";

  /** The dropdown of QuickSwitch; it loads on the first opening, so the sidebar starts without it. */
  let {
    path,
    branch,
    sha,
    unreferenced = 0,
    trigger,
    onclose,
    group = null,
    create = false,
    adopt = false,
  }: {
    path: string;
    branch: string | null;
    sha: string | null;
    unreferenced?: number;
    trigger: HTMLElement;
    onclose: () => void;
    /** A repo group: one branch for all its repos, every one of them a step of its own. */
    group?: { name: string; paths: string[] } | null;
    /** Opened to create a branch: the field asks for the new name. */
    create?: boolean;
    /** Opened to take a branch some repos have over to the others: the list starts with those. */
    adopt?: boolean;
  } = $props();

  let panel: HTMLDivElement | undefined = $state();
  let input: HTMLInputElement | undefined = $state();
  let place = $state("");
  let query = $state("");
  let active = $state(0);
  let branches = $state<BranchList | null>(null);
  // For a group: in how many of its repos each branch exists.
  let have = $state<Map<string, number> | null>(null);

  // Second step: what happens, where, and with which changes.
  let chosen = $state<{ name: string; create: boolean } | null>(null);
  let others = $state<Record<string, BranchList> | null>(null);
  let picked = $state<string[]>([]);
  let carry = $state<CarryMode>("Bring");
  let base = $state<"head" | "default">("head");

  const short = $derived(shortSha(sha ?? ""));
  const dirtyOf = (p: string) => gitStatus.statuses.get(p)?.entries.length ?? 0;

  type Item = SwitchItem;
  // Suggestions for several repos: branches some of them have and the others lack.
  const partial = (i: Item) => !!have && !!group && !i.create && (have.get(i.name) ?? 0) < group.paths.length;
  const listed = $derived(branches ? switchItems(branches, query, scope === "partial" ? "all" : scope) : null);
  const partialCount = $derived(listed?.items.filter(partial).length ?? 0);
  const items = $derived((listed?.items ?? []).filter((i) => scope !== "partial" || partial(i) || i.create));
  // Headings only where both kinds are in the list; a single kind is named by the segment.
  const sections = $derived(items.some((i) => i.remote) && items.some((i) => !i.remote && !i.create));

  const here = $derived(chosen && branches && !group ? stepFor(path, chosen.name, branches) : null);
  // A group has no repo of its own: all of its repos are offered, all that can are picked.
  const offered = $derived(chosen && others ? companions(chosen.name, group ? "" : path, others, group?.paths ?? repoSelection.repos) : []);
  const steps = $derived.by((): SwitchStep[] => {
    if (!here && !group) return [];
    return [...(here ? [here] : []), ...offered.filter((o) => picked.includes(o.step.path)).map((o) => o.step)].filter(runnable);
  });
  const anyDirty = $derived(steps.some((s) => dirtyOf(s.path) > 0));
  // Repos that lack an existing branch get it created: where from is a choice, not a silent HEAD.
  const creates = $derived(steps.filter((s) => s.kind === "create"));
  const missingOnly = $derived(!!group && !!chosen && !chosen.create && creates.length > 0);
  const defaultRef = $derived(infoFor(path)?.defaultBranch ?? null);

  const PANEL_MAX = 460;
  // Several repos add "not everywhere" to the scopes and a repo list to the second step: more room.
  const WIDTH_ONE = 380;
  const WIDTH_GROUP = 460;
  const panelWidth = $derived(group ? WIDTH_GROUP : WIDTH_ONE);

  function position() {
    // Opened for a button scrolled out of view (from a menu, by keyboard): bring it in first, the panel hangs from it.
    const seen = trigger.getBoundingClientRect();
    if (seen.top < 0 || seen.bottom > innerHeight) {
      // That scroll is the panel's own: it must not close the panel as a scroll of the list would.
      ownScrollUntil = performance.now() + 400;
      trigger.scrollIntoView({ block: "nearest" });
    }
    const r = trigger.getBoundingClientRect();
    const width = panelWidth;
    const left = Math.max(8, Math.min(r.left, innerWidth - width - 8));
    // Towards the side with more room once the full height does not fit below, and never taller than
    // that room: from a card in the middle of the window the list ran out at the bottom.
    const below = innerHeight - r.bottom - 12;
    const above = r.top - 12;
    const up = below < PANEL_MAX && above > below;
    const room = Math.max(160, Math.min(PANEL_MAX, up ? above : below));
    place = up ? `left:${left}px; bottom:${innerHeight - r.top + 4}px; max-height:${room}px` : `left:${left}px; top:${r.bottom + 4}px; max-height:${room}px`;
  }

  // Mounted fresh on every opening: the list is always the current one.
  onMount(async () => {
    // Taking a branch over starts with the suggestions; "not everywhere" exists for several repos only.
    if (adopt) scope = "partial";
    else if (!group && scope === "partial") scope = "all";
    position();
    queueMicrotask(() => input?.focus());
    try {
      if (group) {
        others = await branchLists(group.paths);
        const merged = mergeLists(Object.values(others));
        have = merged.have;
        branches = merged.list;
      } else branches = await api.branchList(path);
    } catch (err) {
      toasts.fail(err);
      onclose();
    }
  });

  const close = () => onclose();
  // A press on the title bar or a moved window closes it like a click beside it.
  onMount(() => onDismiss(close));

  /** The branches of each repo that answers, in the order asked, a few repos at a time. */
  async function branchLists(paths: string[]): Promise<Record<string, BranchList>> {
    const found = new Map<string, BranchList>();
    await pooled(paths, settings.config?.concurrency ?? 4, (p) => api.branchList(p).then((l) => found.set(p, l)));
    return Object.fromEntries(paths.filter((p) => found.has(p)).map((p) => [p, found.get(p)!]));
  }

  async function loadOthers() {
    const paths = scanResults.repos.map((r) => r.info.path).filter((p) => p !== path && scanResults.resultOf(p)?.errorKind !== "RepoMissing");
    others = await branchLists(paths);
  }

  async function choose(i: Item) {
    if (i.current) return;
    // Checked out in another worktree: git would refuse the switch, so that worktree opens in Git.
    if (i.elsewhere) {
      close();
      openInGit(i.elsewhere);
      return;
    }
    chosen = { name: i.name, create: !!i.create };
    base = "head";
    carry = "Bring";
    if (group) {
      picked = offered.filter((o) => o.preselected).map((o) => o.step.path);
      queueMicrotask(() => panel?.querySelector<HTMLElement>("[data-go]")?.focus());
      return;
    }
    await loadOthers();
    picked = offered.filter((o) => o.preselected).map((o) => o.step.path);
    // Nothing to decide: one repo, no changes in the way, an existing branch.
    if (!offered.length && !dirtyOf(path) && !i.create) run();
    else queueMicrotask(() => panel?.querySelector<HTMLElement>("[data-go]")?.focus());
  }

  function run() {
    if (!chosen || !steps.length) return;
    const name = chosen.name;
    const todo = steps;
    close();
    switchRepos(name, todo, carry, base);
  }

  // Takes the branch over where it is missing, without switching any repo to it.
  function createWhereMissing() {
    if (!chosen || !creates.length) return;
    const name = chosen.name;
    const paths = creates.map((s) => s.path);
    close();
    createMissing(name, paths, base);
  }

  function togglePick(p: string) {
    picked = toggled(picked, p);
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === "Escape") chosen ? (chosen = null) : close();
    else if (chosen) return;
    else if (e.key === "ArrowDown") active = Math.min(items.length - 1, active + 1);
    else if (e.key === "ArrowUp") active = Math.max(0, active - 1);
    else if (e.key === "Enter" && items[active]) choose(items[active]);
    else return;
    e.preventDefault();
  }

  // A context menu opened from inside the panel (a branch name) belongs to it: using it keeps the panel.
  function outside(e: PointerEvent) {
    const target = e.target as Element;
    if (panel && !panel.contains(target) && !trigger.contains(target) && !target.closest?.("[role=menu], dialog[data-menu-host]")) close();
  }
  // The sidebar scrolls under a fixed panel; closing is clearer than following the row. Only a
  // scroll that moves the trigger counts: the table restores its position after every refresh.
  let ownScrollUntil = 0;
  function onScroll(e: Event) {
    if (performance.now() < ownScrollUntil) return;
    const target = e.target instanceof Document ? e.target.documentElement : (e.target as Node);
    if (target.contains(trigger)) close();
  }
</script>

<!-- Esc also when the focus went elsewhere, and leaving the window closes it like the context menu. -->
<svelte:window
  onpointerdowncapture={outside}
  onscrollcapture={onScroll}
  onresize={position}
  onblur={close}
  onkeydown={(e) => e.key === "Escape" && panel && !panel.contains(document.activeElement) && !document.querySelector("dialog[open]") && (e.preventDefault(), close())}
/>

<div
  bind:this={panel}
  use:portal
  data-quick-switch
  class="fixed z-50 flex flex-col overflow-hidden rounded-xl mbf-popover text-left"
  style="{place}; width: {panelWidth}px"
  role="dialog"
  data-menu-scope
  aria-label={group ? t.repoGroups.panelLabel(group.name) : t.quick.label(repoName(path))}
  tabindex="-1"
  onkeydown={onKey}
>
  {#if !chosen}
    <label class="flex h-10 shrink-0 items-center gap-2 border-b border-(--popover-line) bg-(--popover-2) px-3">
      <Search size={14} class="text-faint" />
      <input
        bind:this={input}
        bind:value={query}
        oninput={() => (active = 0)}
        placeholder={create ? t.repoGroups.createPlaceholder : t.quick.search}
        aria-label={create ? t.repoGroups.createPlaceholder : t.quick.search}
        class="min-w-0 flex-1 bg-transparent font-mono text-base outline-none placeholder:text-faint"
      />
    </label>
    {#if listed}
      <div class="flex shrink-0 border-b border-line px-3 py-1.5">
        <Segmented
          label={t.quick.scope}
          value={scope}
          onchange={(v) => ((scope = v), (active = 0))}
          options={[
            { id: "all", label: t.quick.scopeAll, count: listed.counts.all },
            { id: "local", label: t.quick.scopeLocal, count: listed.counts.local, tip: t.quick.scopeLocalTip },
            { id: "remote", label: t.quick.scopeRemote, count: listed.counts.remote, tip: t.quick.scopeRemoteTip },
            { id: "mine", label: t.quick.scopeMine, count: listed.counts.mine, tip: t.quick.scopeMineTip },
            ...(group ? [{ id: "partial" as const, label: t.quick.scopePartial, count: partialCount, tip: t.quick.scopePartialTip }] : []),
          ]}
        />
      </div>
    {/if}
    {#if !branch && !group}
      <p class="flex shrink-0 gap-2 border-b border-line bg-review/8 px-3 py-2 text-sm {unreferenced ? 'text-unsafe' : 'text-muted'}">
        <TriangleAlert size={14} class="mt-0.5 shrink-0" />
        {unreferenced ? t.quick.stranded(short, unreferenced) : t.quick.detached(short)}
      </p>
    {/if}
    <ul class="min-h-0 flex-1 overflow-y-auto py-1" role="listbox" aria-label={group ? t.repoGroups.panelLabel(group.name) : t.quick.label(repoName(path))}>
      {#each items as i, n (i.remote ?? (i.create ? `+${i.name}` : i.name))}
        {@const bn = i.remote ? splitRemote(i.remote) : { remote: null, name: i.name }}
        {#if sections && !i.create && (n === 0 || !!items[n - 1].remote !== !!i.remote)}
          <li role="presentation" class="t-meta px-3 pt-2 pb-1">{i.remote ? t.quick.sectionRemote : t.quick.sectionLocal}</li>
        {/if}
        <li role="option" aria-selected={n === active} class={n === active ? "mbf-selected" : ""}>
          <button
            type="button"
            class="flex h-8 w-full items-center gap-2 px-3 text-left font-mono text-sm {n === active ? '' : 'hover:bg-hover/60'}"
            onmouseenter={() => (active = n)}
            onclick={() => choose(i)}
          >
            <span class="w-4 shrink-0 text-accent">{#if i.current}<Check size={13} />{:else if i.create}<GitBranchPlus size={13} />{/if}</span>
            {#if i.create}
              <span class="min-w-0 flex-1 truncate font-sans text-accent">{t.quick.newBranch(i.name)}</span>
            {:else}
              <span class="flex min-w-0 flex-1"><BranchName name={bn.name} remote={bn.remote} size="sm" /></span>
            {/if}
            {#if i.elsewhere}<span class="inline-flex shrink-0 items-center gap-1 font-sans text-xs text-faint" use:tooltip={{ title: t.quick.openElsewhere, path: i.elsewhere }}><GitFork size={11} />{t.quick.elsewhere}</span>{/if}
            {#if have && group && !i.create}
              {@const n = have.get(i.name) ?? 0}
              <span class="mbf-count shrink-0 font-sans" use:tooltip={t.repoGroups.inReposTip(n, group.paths.length)}>{t.repoGroups.inRepos(n, group.paths.length)}</span>
            {/if}
            {#if i.ahead}<span class="shrink-0 text-xs text-accent">↑{i.ahead}</span>{/if}
            {#if i.behind}<span class="shrink-0 text-xs text-blocked">↓{i.behind}</span>{/if}
          </button>
        </li>
      {:else}
        <li class="px-3 py-3 text-sm text-faint">{branches ? t.common.noMatch : t.git.loadingBranches}</li>
      {/each}
    </ul>
  {:else}
    <div class="flex shrink-0 items-center gap-2 border-b border-(--popover-line) bg-(--popover-2) px-3 py-2">
      <span class="shrink-0 text-sm text-muted">{chosen.create ? t.quick.createTitle : t.quick.switchTitle}</span>
      <span class="flex min-w-0 flex-1"><BranchName name={chosen.name} size="sm" /></span>
    </div>
    <div class="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-3 py-3">
      {#if chosen.create || creates.length}
        <div class="flex flex-col gap-1.5">
          <span class="t-meta">{chosen.create ? t.quick.base : t.quick.baseMissing(creates.length)}</span>
          <Segmented
            label={t.quick.base}
            value={base}
            onchange={(v) => (base = v)}
            options={[
              { id: "head", label: t.quick.baseHead },
              { id: "default", label: (!group && defaultRef) || t.quick.baseDefault, tip: t.quick.baseDefaultTip((!group && defaultRef) || t.quick.baseDefault) },
            ]}
          />
        </div>
      {/if}
      {#if offered.length}
        <div class="flex flex-col gap-1">
          <span class="t-meta">{group ? t.repoGroups.inGroup(group.name) : chosen.create ? t.quick.alsoCreate : t.quick.alsoSwitch}</span>
          {#each offered as o (o.step.path)}
            {@const can = runnable(o.step)}
            <div class="flex min-w-0 items-center gap-2">
              <Checkbox checked={picked.includes(o.step.path)} disabled={!can} ariaLabel={labelOf(o.step.path)} tip={can ? t.quick.pickTip : undefined} onchange={() => togglePick(o.step.path)} />
              <span class="flex min-w-0 flex-1 text-sm"><RepoName path={o.step.path} /></span>
              <span class="shrink-0 text-xs {can ? 'text-faint' : 'text-review'}">{t.quick.kind[o.step.kind]}</span>
              {#if dirtyOf(o.step.path)}<StatusChip kind="dirty" count={dirtyOf(o.step.path)} tip={t.sidebar.dirtyTip(dirtyOf(o.step.path))} />{/if}
            </div>
          {/each}
        </div>
      {/if}
      {#if anyDirty}
        <div class="flex flex-col gap-1.5">
          <span class="t-meta" use:tooltip={t.quick.carryTip}>{t.quick.carry} · {t.quick.changed(steps.reduce((sum, s) => sum + dirtyOf(s.path), 0))}</span>
          <Segmented
            label={t.quick.carry}
            value={carry}
            onchange={(v) => (carry = v)}
            options={[
              { id: "Bring", label: t.quick.carryBring },
              { id: "Stash", label: t.quick.carryStash },
            ]}
          />
        </div>
      {/if}
    </div>
    <div class="flex shrink-0 items-center justify-between gap-2 border-t border-line px-3 py-2">
      <Button variant="ghost" size="sm" icon={ArrowLeft} onclick={() => (chosen = null)}>{t.quick.back}</Button>
      <span class="flex-1"></span>
      {#if missingOnly}
        <Button variant="secondary" size="sm" tip={t.quick.createOnlyTip} onclick={createWhereMissing}>{t.quick.createOnly(creates.length)}</Button>
      {/if}
      <Button variant="primary" size="sm" data-go disabled={!steps.length} onclick={run}>
        {chosen.create ? t.quick.goCreate(steps.length) : t.quick.go(steps.length)}
      </Button>
    </div>
  {/if}
</div>
