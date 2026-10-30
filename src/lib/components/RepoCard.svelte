<script lang="ts">
  import { CircleAlert, FolderGit2, FolderTree, GitFork, GlobeLock, LoaderCircle, Lock, StickyNote, Trash2, TriangleAlert } from "@lucide/svelte";
  import { tagColor } from "$lib/annotations";
  import { api } from "$lib/api";
  import { goneCount } from "$lib/filter";
  import { groupByPrefix } from "$lib/groups";
  import { t } from "$lib/i18n/index.svelte";
  import { copyLabelIn } from "$lib/repoLabel";
  import type { BackgroundWork, RepoEntry } from "$lib/stores/scanResults.svelte";
  import { fold } from "$lib/stores/fold.svelte";
  import { gitStatus } from "$lib/stores/gitStatus.svelte";
  import { identities } from "$lib/stores/identities.svelte";
  import { sidebarSelection } from "$lib/stores/sidebarSelection.svelte";
  import { mergedBranches } from "$lib/worktrees";
  import { dragTo } from "$lib/ui/dragTo.svelte";
  import { doubleClick } from "$lib/ui/gestures";
  import { CHIP_INK, type ChipTone } from "$lib/ui/IconChip.svelte";
  import { contextmenu } from "$lib/ui/menu.svelte";
  import Part from "$lib/ui/Part.svelte";
  import RootBadge from "$lib/ui/RootBadge.svelte";
  import Skeleton from "$lib/ui/Skeleton.svelte";
  import StatusChip from "$lib/ui/StatusChip.svelte";
  import TagPill from "$lib/ui/TagPill.svelte";
  import { tooltip, type TooltipContent, type TooltipInput } from "$lib/ui/tooltip";
  import { warningText } from "$lib/warnings";
  import PrBadge from "./PrBadge.svelte";
  import ProviderMark from "./ProviderMark.svelte";
  import QuickSwitch from "./QuickSwitch.svelte";
  import { repoDragOptions } from "./repoGroupDrop.svelte";
  import { copyMenuOf, isControl, rowClick, selectCopy } from "./sidebarRows.svelte";
  import WorktreeRow from "./WorktreeRow.svelte";
  import { toasts } from "$lib/stores/toasts.svelte";
  import { settings } from "$lib/stores/settings.svelte";
  import { scanResults } from "$lib/stores/scanResults.svelte";
  import { rules } from "$lib/stores/rules.svelte";
  import { repoActions } from "$lib/services/repoActions.svelte";

  /**
   * One card per repo: the repo row and, below a hairline, the worktrees that belong to it. A card of its
   * own so a status tick recomputes the cards it reaches, not the whole list.
   */
  let { r, groupRoot }: { r: RepoEntry; /** The folder it is listed under: a copy label that only repeats it is left out. */ groupRoot: string } = $props();

  // From this many worktrees on, a repo shows them folded into one line, grouped by branch prefix.
  const WORKTREES_FOLD = 5;

  const path = $derived(r.info.path);
  const gone = $derived(goneCount(r.result?.branches ?? []));
  const problem = $derived(issue(r));
  const active = $derived(sidebarSelection.has(path));
  const current = $derived(sidebarSelection.isFront(path));
  const st = $derived(gitStatus.statuses.get(path));
  const failed = $derived(gitStatus.statusFailed.has(path));
  const pending = $derived(scanResults.isPending(path));
  const group = $derived(scanResults.groupOf(path));
  const tint = $derived(identities.repoColor(path));
  const edge = $derived(identities.tintOf(path));
  const rootBadge = $derived(identities.markOf(path));
  const missing = $derived(r.result?.errorKind === "RepoMissing");
  const note = $derived(rules.annotationOf(path, null));
  const label = $derived(copyLabelIn(path, groupRoot));
  const extra = $derived((st?.worktrees ?? []).filter((w) => !w.isMain));
  const worktrees = $derived(extra.filter((w) => !w.foreign));
  const background = $derived(scanResults.backgroundFailures.get(path));
  const flags = $derived(flagsOf(r, note, problem, extra.length - worktrees.length, background));
  // Once per scan instead of once per worktree line.
  const doneBranches = $derived(mergedBranches(r.result));
  const mergedIn = (branch: string | null) => !!branch && doneBranches.has(branch);

  function issue(r: RepoEntry): { error: boolean; tip: TooltipContent } | null {
    const res = r.result;
    if (!res) return null;
    if (res.errorKind === "RepoMissing") return { error: true, tip: { title: t.sidebar.unreachable, text: t.sidebar.unreachableHint } };
    if (res.error) return { error: true, tip: { title: t.failure[res.errorKind ?? "Other"].title, text: res.error } };
    const lines = res.warnings.map((w) => warningText(w).text);
    if (res.fetchError) lines.unshift(`${t.sidebar.fetchFailed}: ${t.failure[res.fetchErrorKind ?? "Other"].title}`);
    return lines.length ? { error: false, tip: { text: lines.join("\n") } } : null;
  }

  type Flag = { id: string; icon: typeof StickyNote; tone: ChipTone; tip: TooltipInput; label: string };
  /** Status icons by importance; the row shows two and counts the rest. */
  function flagsOf(
    r: RepoEntry,
    note: { note: string },
    problem: { error: boolean; tip: TooltipContent } | null,
    foreign: number,
    background: Partial<Record<BackgroundWork, string>> | undefined,
  ): Flag[] {
    const out: Flag[] = [];
    if (foreign) out.push({ id: "foreign", icon: GitFork, tone: "review", tip: t.quick.foreign(foreign), label: t.quick.foreign(foreign) });
    if (problem) out.push({ id: "problem", icon: problem.error ? CircleAlert : TriangleAlert, tone: problem.error ? "unsafe" : "review", tip: problem.tip, label: problem.tip.title ?? problem.tip.text ?? "" });
    if (background?.rescan || background?.fetch) {
      const why = (s: string) => s.replace(/\.$/, "");
      const lines = [background.rescan && t.sidebar.backgroundRescanFailed(why(background.rescan)), background.fetch && t.sidebar.backgroundFetchFailed(why(background.fetch))];
      const text = lines.filter(Boolean).join("\n");
      out.push({ id: "background", icon: TriangleAlert, tone: "review", tip: { title: t.sidebar.backgroundFailed, text }, label: t.sidebar.backgroundFailed });
    }
    if (rules.isRepoLocked(r.info.path)) out.push({ id: "locked", icon: Lock, tone: "neutral", tip: t.sidebar.repoLocked, label: t.sidebar.repoLocked });
    if (note.note) out.push({ id: "note", icon: StickyNote, tone: "neutral", tip: { title: t.sidebar.note, text: note.note }, label: t.sidebar.note });
    if (settings.config?.onlineExcluded.includes(r.info.identity)) out.push({ id: "online", icon: GlobeLock, tone: "neutral", tip: t.sidebar.onlineExcluded, label: t.sidebar.onlineExcluded });
    return out;
  }

  // Many worktrees start folded, so the list of this scope holds the opened repos, not the folded ones:
  // opening adds the repo, which fold.set expresses as "not open".
  const toggleWorktrees = (open: boolean) => fold.set("worktrees", path, open);
</script>

<div
  style={edge ? `border-left: 3px solid ${edge} !important` : undefined}
  class="mbf-lazy mt-2 overflow-hidden rounded-lg border outline-none focus-visible:ring-2 focus-visible:ring-accent/60 {active ? 'mbf-selected-card' : 'border-line bg-panel'} {current ? 'mbf-current' : ''} {missing ? 'opacity-55' : ''}"
  data-sel-path={path}
  role="option"
  aria-selected={active}
  tabindex="-1"
>
<!-- The whole upper part selects the repo; the branch line holds its own dropdown. -->
<!-- A colour chosen for the repo tints this part; the card's left edge carries the colour, its frame the selection. -->
<div
  role="presentation"
  class="transition-colors {tint?.chosen ? 'bg-(--tint)' : ''} {active ? '' : 'hover:bg-hover/70'}"
  style={tint?.chosen ? `--tint: color-mix(in oklab, ${tint.color} 7%, transparent)` : undefined}
  onclick={(e) => rowClick(path, e)}
  use:doubleClick={{ run: () => toasts.safely(() => api.openFolder(path)), hint: () => t.sidebar.openHint, skip: isControl }}
  use:contextmenu={() => copyMenuOf(path)}
  use:dragTo={repoDragOptions(path, null)}
  data-repo={path}
>
<!-- One grid for every line: icon · name, branch, tags · status, sync. All lines share the
     columns, so the right-hand values sit on the lines they belong to. -->
<div class="grid w-full grid-cols-[28px_minmax(0,1fr)_auto] items-start gap-x-2 px-3 pt-2">
<button
  type="button"
  class="col-span-2 grid grid-cols-subgrid items-start text-left"
  onclick={(e) => selectCopy(path, e)}
  use:tooltip={() => import("./repoTip").then((m) => m.repoTip(path, true, true))}
>
  <!-- Spinner while scanning, else the badge of the folder, as everywhere the repo is named. -->
  <span class="grid h-5 place-items-center">
    {#if pending}
      <span class="grid place-items-center" use:tooltip={t.sidebar.scanningTip}><LoaderCircle size={14} class="animate-spin text-accent" /></span>
    {:else if rootBadge}
      <RootBadge badge={rootBadge.badge} root={rootBadge.root} tip={rootBadge.own ? { title: rootBadge.badge.name, text: t.identity.repoMarkTip(identities.rootBadges.get(rootBadge.root)?.text ?? ""), path: rootBadge.root } : true} />
    {:else}
      <FolderGit2 size={14} class="text-faint" />
    {/if}
  </span>
  <span class="flex h-5 min-w-0 items-center gap-1.5">
    <!-- The name gives way first: the label is what tells two copies apart. -->
    <span class="min-w-[6ch] shrink-[10] truncate text-base font-medium">{r.info.name}</span>
    {#if group && label}
      <!-- Two copies below one root: the label tells them apart, in the colour of the folder's badge. -->
      <span
        class="mbf-copy-pill mbf-truncate-start max-w-[60%] min-w-[7ch] shrink rounded px-1.5 text-xs font-medium"
        style="--pill: {rootBadge?.badge.color ?? group.color}"
        use:tooltip={t.sidebar.copyLabelTip(label, r.info.name)}
      >
        <bdi>{label}</bdi>
      </span>
    {/if}
  </span>
</button>
  <span class="flex h-5 items-center gap-1.5">
    <!-- One frame for all signs of the repo: two show, the rest count; the name keeps its room. -->
    {#if flags.length}
      <span class="inline-flex h-5 shrink-0 items-center gap-1 rounded-md border border-line-strong px-1">
        {#each flags.slice(0, 2) as f (f.id)}
          <span class={CHIP_INK[f.tone]} use:tooltip={f.tip}><f.icon size={12} /></span>
        {/each}
        {#if flags.length > 2}
          <span class="text-xs text-muted tabular-nums" use:tooltip={flags.slice(2).map((f) => f.label).join(" · ")}>+{flags.length - 2}</span>
        {/if}
      </span>
    {/if}
    <PrBadge {path} />
    <Part ready={!!r.result || !pending}>
      {#if gone.gone > 0}
        <StatusChip kind="gone" count={gone.gone} tip={{ title: t.sidebar.gone(gone.gone, gone.unsafe), text: t.sidebar.goneHint }} />
      {/if}
    </Part>
  </span>
</div>
<div class="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2 px-3 pt-1.5 {note.tags.length ? '' : 'pb-2'} {pending ? 'mbf-refreshing' : ''}">
  <span class="flex h-[24px] min-w-0 items-center gap-1.5">
    <ProviderMark {path} size="xs" />
    {#if st}
      <QuickSwitch {path} branch={st.head.branch} sha={st.head.oid} unreferenced={st.head.unreferenced} />
    {:else if missing || failed}
      <span class="truncate font-mono text-xs text-faint">{t.sidebar.unreachable}</span>
    {:else}
      <!-- The branch is on its way: a placeholder of the button's size, nothing to press yet. -->
      <span class="contents" aria-busy="true"><Skeleton class="h-[24px] w-28 rounded-md" /></span>
    {/if}
  </span>
  {#if !st && !missing && !failed}
    <Part ready={false} shape="h-5 w-14 rounded-md"><span></span></Part>
  {:else if st && (st.head.ahead || st.head.behind || st.entries.length || st.stashes)}
    <span class="flex h-[24px] items-center gap-1 whitespace-nowrap {gitStatus.isRefreshing(path) ? 'mbf-refreshing rounded-md' : ''}">
      {#if st.head.ahead}<StatusChip kind="ahead" count={st.head.ahead} tip={t.sidebar.aheadTip(st.head.ahead, st.head.upstream)} />{/if}
      {#if st.head.behind}<StatusChip kind="behind" count={st.head.behind} tip={t.sidebar.behindTip(st.head.behind, st.head.upstream)} />{/if}
      {#if st.entries.length}
        {@const files = st.entries}
        <StatusChip
          kind="dirty"
          count={files.length}
          tip={() => ({
            title: t.sidebar.dirtyTip(files.length),
            rows: files.slice(0, 6).map((e) => ({ value: e.path, kind: "path" as const })),
            foot: files.length > 6 ? t.sidebar.moreFiles(files.length - 6) : undefined,
          })}
        />
      {/if}
      {#if st.stashes}<StatusChip kind="stash" count={st.stashes} tip={{ title: t.sidebar.stashTip(st.stashes), text: t.sidebar.stashHint }} />{/if}
    </span>
  {:else}
    <span></span>
  {/if}
</div>
{#if note.tags.length}
  <div class="flex px-3 pt-1 pb-2">
    <span class="flex min-w-0 items-center gap-1 overflow-hidden">
      {#each note.tags.slice(0, 3) as tag (tag)}<TagPill {tag} />{/each}
      {#if note.tags.length > 3}<span class="mbf-count shrink-0" use:tooltip={{ pills: note.tags.slice(3).map((tag) => ({ text: tag, color: tagColor(tag) })) }}>+{note.tags.length - 3}</span>{/if}
    </span>
  </div>
{/if}
</div>
{#if worktrees.length}
<div class="mbf-guide-wt border-t border-line/70 py-0.5">
{#if worktrees.length < WORKTREES_FOLD}
  {#each worktrees as w (w.path)}<WorktreeRow {w} done={mergedIn(w.branch)} />{/each}
{:else}
  <!-- Many worktrees (agents at work): one folded line, inside it grouped by what their branches start with.
       The group head loads with the first such repo, not with the start. -->
  {#await import("$lib/ui/GroupHead.svelte") then { default: GH }}
  {@const merged = worktrees.filter((w) => mergedIn(w.branch))}
  {@const wtOpen = fold.foldedSet("worktrees").has(path)}
  <GH
    level={3}
    title={t.sidebar.worktreeCount(worktrees.length)}
    open={wtOpen}
    ontoggle={() => toggleWorktrees(wtOpen)}
    menu={() => (merged.length ? [{ label: t.sidebar.removeMergedWorktrees(merged.length), icon: Trash2, danger: true, run: () => repoActions.removeWorktrees(path, merged.map((w) => w.path)) }] : [])}
  >
    {#snippet label()}
      <FolderTree size={12} class="shrink-0 text-faint" /><span class="truncate">{t.sidebar.worktreeCount(worktrees.length)}</span>
      {#if merged.length}<span class="shrink-0 rounded px-1 text-xs font-normal text-safe-ink ring-1 ring-safe/40" use:tooltip={t.sidebar.worktreeMergedTip}>{t.sidebar.worktreesMerged(merged.length)}</span>{/if}
    {/snippet}
    {@const parts = groupByPrefix(worktrees, (w) => w.branch)}
    {#each parts as p (p.key)}
      {@const id = `${path}|${p.key}`}
      <GH
        level={3}
        title={p.label || t.sidebar.worktreeOthers}
        count={p.items.length}
        open={fold.isOpen("worktreeGroups", id)}
        ontoggle={() => fold.toggle("worktreeGroups", id)}
        foldAll={{ anyOpen: parts.some((x) => fold.isOpen("worktreeGroups", `${path}|${x.key}`)), run: (open) => fold.setAll("worktreeGroups", parts.map((x) => `${path}|${x.key}`), open) }}
        class="font-mono font-normal"
      >
        {#each p.items as w (w.path)}<WorktreeRow {w} done={mergedIn(w.branch)} />{/each}
      </GH>
    {/each}
  </GH>
  {/await}
{/if}
</div>
{/if}
</div>
