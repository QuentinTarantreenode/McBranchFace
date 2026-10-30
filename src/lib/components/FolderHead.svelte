<script lang="ts">
  import { ChevronRight, Ellipsis } from "@lucide/svelte";
  import { api } from "$lib/api";
  import type { SidebarGroup } from "$lib/groups";
  import type { HeadSums } from "$lib/headSums";
  import { t } from "$lib/i18n/index.svelte";
  import type { RepoEntry } from "$lib/stores/scanResults.svelte";
  import { fold } from "$lib/stores/fold.svelte";
  import { identities } from "$lib/stores/identities.svelte";
  import { foldKeys } from "$lib/ui/foldKeys";
  import { doubleClick } from "$lib/ui/gestures";
  import IconButton from "$lib/ui/IconButton.svelte";
  import { contextmenu, openBelow, type MenuEntry } from "$lib/ui/menu.svelte";
  import RootBadge from "$lib/ui/RootBadge.svelte";
  import StatusChip from "$lib/ui/StatusChip.svelte";
  import { tooltip } from "$lib/ui/tooltip";
  import { toasts } from "$lib/stores/toasts.svelte";

  /**
   * Folder head, built like a repo group's: the chevron folds, the name selects the folder's repos, "…"
   * opens its menu. It sticks while its repos scroll by and drags the whole block.
   */
  let {
    g,
    real,
    sortId,
    lent,
    chosen,
    sums,
    searching,
    menu,
    onfoldall,
    onselect,
  }: {
    g: SidebarGroup<RepoEntry>;
    /** A configured root, not the group of repos without one. */
    real: boolean;
    sortId: string | undefined;
    /** Worktrees of repos listed elsewhere that lie below this folder. */
    lent: number;
    chosen: boolean;
    sums: HeadSums;
    searching: boolean;
    menu: () => Promise<MenuEntry[]>;
    onfoldall: (open: boolean) => void;
    onselect: (e: MouseEvent) => void;
  } = $props();

  const badge = $derived(identities.rootBadges.get(g.root));
  /** "demo/ws" → "demo/": the part of a folder label shown dimmed before the folder name. */
  const parent = $derived(g.label.slice(0, g.label.lastIndexOf("/") + 1));
  const onkeydown = (e: KeyboardEvent) => foldKeys(e, { open: g.open, toggle: () => fold.set("roots", g.root, !g.open), all: onfoldall });
  const headTip = $derived(`${t.sidebar.groupTip(g.total, g.gone, g.unsafe, lent)} ${t.sidebar.headClickTip}`);
</script>

<div
  class="sticky top-0 z-10 mt-4 flex h-8 items-center rounded-lg border {chosen ? 'mbf-selected-card' : 'border-group-line bg-group'}"
  style={real && badge ? `border-left: 3px solid ${badge.color} !important` : undefined}
  data-group-head={sortId ? "" : undefined}
  data-folder-head={g.root}
  use:contextmenu={menu}
>
  <button
    type="button"
    class="grid h-full w-7 shrink-0 place-items-center text-fg"
    aria-expanded={g.open}
    aria-label={g.label}
    disabled={searching}
    use:tooltip={{ title: g.open ? t.common.fold : t.common.unfold, text: t.common.foldAllHint, keys: "← →" }}
    onclick={(e) => (e.altKey ? onfoldall(!g.open) : fold.toggle("roots", g.root))}
    {onkeydown}
  >
    <ChevronRight size={14} class="transition-transform {g.open ? 'rotate-90' : ''}" />
  </button>
  <button
    type="button"
    class="flex h-full min-w-0 flex-1 items-center gap-1.5 pr-1 text-left text-sm"
    data-fold-head
    aria-pressed={chosen}
    use:tooltip={real ? { path: g.root, text: headTip, foot: t.sidebar.moveGroupTip, gestures: true } : headTip}
    use:doubleClick={{ run: () => real && toasts.safely(() => api.openFolder(g.root)), hint: () => t.sidebar.openHint }}
    onclick={(e) => e.detail < 2 && onselect(e)}
    {onkeydown}
  >
    {#if badge}<RootBadge {badge} root={g.root} tip={false} />{/if}
    <!-- Reversed and wrapping: the parent folder shows in full or not at all – when it does not fit
         beside the name it moves to a second line that the fixed height hides; the tip has the path. -->
    <span class="flex h-5 min-w-0 flex-1 flex-row-reverse flex-wrap content-start items-baseline justify-end overflow-hidden">
      <span class="min-w-0 max-w-full truncate font-semibold text-fg">{g.label.slice(parent.length)}</span>
      {#if parent}<span class="shrink-0 text-xs whitespace-nowrap text-faint">{parent}</span>{/if}
    </span>
    <span class="mbf-count shrink-0 normal-case">
      {searching ? t.sidebar.someOf(g.repos.length, g.total) : g.total + lent}
    </span>
    <!-- The same sign as on the cards below, so the header sums up what they show. -->
    {#if g.gone}<StatusChip kind="gone" count={g.gone} alert={g.unsafe > 0} />{/if}
    {#if sums.dirty}<StatusChip kind="dirty" count={sums.dirty} tip={t.sidebar.headDirty(sums.dirty)} />{/if}
    {#if sums.ahead}<StatusChip kind="ahead" count={sums.ahead} tip={t.sidebar.headAhead(sums.ahead)} />{/if}
    {#if sums.behind}<StatusChip kind="behind" count={sums.behind} tip={t.sidebar.headBehind(sums.behind)} />{/if}
  </button>
  <span class="mr-1 flex shrink-0 items-center">
    <IconButton icon={Ellipsis} size="sm" class="!size-6" label={t.sidebar.folderActions} aria-haspopup="menu" onclick={(e) => openBelow(e.currentTarget as HTMLElement, menu(), g.label)} />
  </span>
</div>
