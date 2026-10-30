<script lang="ts">
  import { CloudOff, Search, Trash2, UserRound } from "@lucide/svelte";
  import { tick, untrack } from "svelte";
  import { ONLINE_VERDICTS, VERDICTS } from "$lib/filter";
  import { i18n, t } from "$lib/i18n/index.svelte";
  import { ONLINE_TONE, VERDICT_TONE } from "$lib/verdict";
  import type { OnlineVerdict } from "$lib/bindings/OnlineVerdict";
  import type { Verdict } from "$lib/bindings/Verdict";
  import type { BranchReport } from "$lib/bindings/BranchReport";
  import type { RemoteBranchReport } from "$lib/bindings/RemoteBranchReport";
  import Button from "$lib/ui/Button.svelte";
  import FilterSegments from "$lib/ui/FilterSegments.svelte";
  import IconButton from "$lib/ui/IconButton.svelte";
  import Input from "$lib/ui/Input.svelte";
  import Switch from "$lib/ui/Switch.svelte";
  import { debounced } from "$lib/ui/delay.svelte";
  import { COMPACT_MAX, nextCompactLevel } from "$lib/table/compact";
  import { settings } from "$lib/stores/settings.svelte";
  import { cleanupView } from "$lib/stores/cleanupView.svelte";
  import { deletes } from "$lib/stores/deletes.svelte";

  /** `level`: how far the bar gave up to fit; the bar above the table follows it with icon-only buttons. */
  let { level = $bindable(0) }: { level?: number } = $props();

  const online = $derived(cleanupView.scope === "Online");

  let searchEl: HTMLInputElement | undefined = $state();
  let searchText = $state(cleanupView.filters.search);

  // Typing stays instant; the list filters once the user pauses.
  debounced(() => searchText, 100, (text) => cleanupView.filters.search !== text && (cleanupView.filters.search = text), { flush: true });
  // Follows a reset from outside only; reading searchText here would undo every keystroke.
  $effect(() => {
    if (cleanupView.filters.search === "") untrack(() => searchText !== "" && (searchText = ""));
  });

  export function focusSearch() {
    searchEl?.focus();
    searchEl?.select();
  }

  /** Clears the field at once, before the filter reset reaches it through the store. */
  export function clearSearch() {
    searchText = "";
  }

  // The toolbar must stay on one line. Labels differ by language, counts and scope, so it is measured
  // rather than budgeted: each level gives up a little more (switches to icon toggles, chips to dot +
  // count, narrow search and delete count only, icons only) until the content fits. The chips keep their
  // names longest: a dot with a number says nothing without them.
  const compactSwitches = $derived(level >= 1);
  const compactChips = $derived(level >= 2);
  const compactAll = $derived(level >= 3);
  const iconsOnly = $derived(level >= COMPACT_MAX);
  // Content width per level; only valid as long as the content stays the same.
  let compactWidths: (number | undefined)[] = [];
  let compactFrame = 0;

  /** Width the bar's content needs, without the free space its auto margin takes up. */
  function neededWidth(bar: HTMLElement): number {
    const cs = getComputedStyle(bar);
    const kids = [...bar.children] as HTMLElement[];
    let sum = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight) + (parseFloat(cs.columnGap) || 0) * Math.max(kids.length - 1, 0);
    for (const k of kids) {
      const ks = getComputedStyle(k);
      sum += k.getBoundingClientRect().width + parseFloat(ks.marginRight) + (k.classList.contains("ml-auto") ? 0 : parseFloat(ks.marginLeft));
    }
    return sum;
  }

  // Coalesces every trigger into one frame; the steps settle before the frame is painted, so no
  // intermediate level is ever seen.
  function scheduleCompact(reset: boolean) {
    if (reset) compactWidths = [];
    if (compactFrame) return;
    compactFrame = requestAnimationFrame(async () => {
      for (let step = 0; step < 2 * (COMPACT_MAX + 1); step++) {
        const bar = barEl;
        if (!bar) break;
        const needed = neededWidth(bar);
        compactWidths[level] = needed;
        const next = nextCompactLevel({ level, max: COMPACT_MAX, available: bar.clientWidth, needed, widths: compactWidths });
        if (next === level) break;
        level = next;
        await tick();
      }
      compactFrame = 0;
    });
  }

  let barEl = $state<HTMLElement>();
  $effect(() => {
    const bar = barEl;
    if (!bar) return;
    const ro = new ResizeObserver(() => scheduleCompact(false));
    ro.observe(bar);
    return () => {
      ro.disconnect();
      cancelAnimationFrame(compactFrame);
      compactFrame = 0;
    };
  });
  // Whatever changes the width of a label or count invalidates the measured widths.
  $effect(() => {
    void [
      i18n.lang,
      i18n.dict,
      i18n.more,
      cleanupView.scope,
      online ? ONLINE_VERDICTS.map((v) => cleanupView.onlineCounts[v]) : VERDICTS.map((v) => cleanupView.counts[v]),
      checkedCount,
      ticked,
      targetCount,
      cleanupView.filters.prefixes.length,
      cleanupView.filters.tags.length,
      cleanupView.tableGroup,
    ];
    untrack(() => scheduleCompact(true));
  });

  // The status filter of the scope: the same pill locally and on the server, with the scope's verdicts.
  const segments = $derived(
    online
      ? {
          total: ONLINE_VERDICTS.reduce((s, v) => s + cleanupView.onlineCounts[v], 0),
          options: ONLINE_VERDICTS.map((v) => ({ id: v as string, label: t.onlineVerdict[v].label, count: cleanupView.onlineCounts[v], dot: ONLINE_TONE[v].dot, tip: t.onlineVerdict[v].hint })),
          selected: cleanupView.filters.onlineVerdicts as string[],
          ontoggle: (v: string) => cleanupView.toggleOnlineVerdict(v as OnlineVerdict),
          onall: () => (cleanupView.filters.onlineVerdicts = []),
        }
      : {
          total: VERDICTS.reduce((s, v) => s + cleanupView.counts[v], 0),
          options: VERDICTS.map((v) => ({ id: v as string, label: t.verdict[v].label, count: cleanupView.counts[v], dot: VERDICT_TONE[v].dot, tip: t.verdict[v].hint })),
          selected: cleanupView.filters.verdicts as string[],
          ontoggle: (v: string) => cleanupView.toggleVerdict(v as Verdict),
          onall: () => (cleanupView.filters.verdicts = []),
        },
  );
  const lockedCount = $derived(online ? cleanupView.onlineLocked.length : cleanupView.visibleLocked.length);

  const deletable = $derived(cleanupView.deletable);
  const checkedCount = $derived(online ? cleanupView.checkedOnline.length : cleanupView.checkedSafe.length);
  const targetCount = $derived(checkedCount || deletable.length);
  // On the server a bulk delete ticks only your own branches (deleteFlow.ts): the button counts those,
  // the dialog lists the others unticked.
  const ticked = $derived(
    online && !checkedCount && deletable.length > 1 ? (deletable as RemoteBranchReport[]).filter((b) => b.isMine).length : targetCount,
  );
  // Fewer ticked than the chip counts: the label says whose, so 29 beside "Merged 81" is not a riddle.
  const mergedLabel = (c: number) => (c < deletable.length ? t.cleanup.deleteMergedMine(c) : t.cleanup.deleteMerged(c));

  function deleteTargets() {
    if (online) deletes.openOnlineDelete(cleanupView.checkedOnline.length ? cleanupView.checkedOnline : (deletable as RemoteBranchReport[]));
    else deletes.openDelete(cleanupView.checkedSafe.length ? cleanupView.checkedSafe : (deletable as BranchReport[]));
  }
</script>

<!-- Items keep their natural width so an overflow can be measured; only at the last level may the
     search give way instead of being cut. -->
<div bind:this={barEl} class="flex h-12 shrink-0 flex-nowrap items-center gap-2 overflow-hidden px-4 {iconsOnly ? '' : '*:shrink-0'}">
  <FilterSegments
    label={t.cleanup.verdictFilter}
    allLabel={t.cleanup.all}
    allTip={lockedCount ? t.cleanup.allLockedTip(lockedCount) : t.cleanup.allTip}
    total={segments.total}
    options={segments.options}
    selected={segments.selected}
    compact={compactChips}
    ontoggle={segments.ontoggle}
    onall={segments.onall}
  />
  <div class="mx-1 h-5 w-px shrink-0 bg-line"></div>
  {#if compactSwitches}
    <IconButton
      icon={UserRound}
      label={t.cleanup.onlyMine}
      hint={t.cleanup.onlyMineTip}
      active={cleanupView.filters.onlyMine}
      onclick={() => (cleanupView.filters.onlyMine = !cleanupView.filters.onlyMine)}
    />
  {:else}
    <Switch bind:checked={cleanupView.filters.onlyMine} label={t.cleanup.onlyMine} tip={t.cleanup.onlyMineTip} />
  {/if}
  {#if !online}
    <!-- A remembered view setting, not a filter of the moment: it lives in the config and survives a reset. -->
    {#if compactSwitches}
      <IconButton
        icon={CloudOff}
        label={t.cleanup.orphanedOnly}
        hint={t.cleanup.orphanedOnlyTip.text}
        active={cleanupView.orphanedOnly}
        onclick={() => settings.setUi({ orphanedOnly: !cleanupView.orphanedOnly })}
      />
    {:else}
      <Switch bind:checked={() => cleanupView.orphanedOnly, (v) => settings.setUi({ orphanedOnly: v })} label={t.cleanup.orphanedOnly} tip={t.cleanup.orphanedOnlyTip} />
    {/if}
  {/if}

  <div class="ml-auto flex min-w-0 items-center gap-2">
    <Input
      bind:element={searchEl}
      bind:value={searchText}
      icon={Search}
      placeholder={compactAll ? t.cleanup.searchShort : t.cleanup.search}
      aria-label={t.cleanup.search}
      class="{compactAll ? 'w-[180px]' : 'w-[236px]'} min-w-0"
      tip={{ keys: "Ctrl F" }}
      clearable
      clearLabel={t.cleanup.searchClear}
    />
    <Button
      variant="delete"
      icon={Trash2}
      disabled={targetCount === 0 || cleanupView.busy.size > 0}
      tip={checkedCount ? t.cleanup.deleteMarkedTip : online ? t.cleanup.deleteVisibleOnlineTip : t.cleanup.deleteVisibleTip}
      aria-label={compactAll ? (checkedCount ? t.cleanup.deleteMarked(checkedCount) : online ? mergedLabel(ticked) : t.cleanup.deleteSafe(targetCount)) : undefined}
      onclick={deleteTargets}
    >
      {#if compactAll}
        {ticked}
      {:else if checkedCount}
        {t.cleanup.deleteMarked(checkedCount)}
      {:else if online}
        {mergedLabel(ticked)}
      {:else}
        {t.cleanup.deleteSafe(targetCount)}
      {/if}
    </Button>
  </div>
</div>
