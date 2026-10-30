<script lang="ts">
  import { tick, untrack } from "svelte";
  import { ChevronDown, ChevronUp, Columns2, Copy, FileQuestion, Pilcrow, Search, UnfoldVertical, X } from "@lucide/svelte";
  import type { ApplyAction } from "$lib/bindings/ApplyAction";
  import type { DiffSource } from "$lib/bindings/DiffSource";
  import type { FileDiff } from "$lib/bindings/FileDiff";
  import type { HunkPick } from "$lib/bindings/HunkPick";
  import type { Whitespace } from "$lib/bindings/Whitespace";
  import { t } from "$lib/i18n/index.svelte";
  import Button from "$lib/ui/Button.svelte";
  import EmptyState from "$lib/ui/EmptyState.svelte";
  import IconButton from "$lib/ui/IconButton.svelte";
  import Skeleton from "$lib/ui/Skeleton.svelte";
  import VirtualList from "$lib/ui/VirtualList.svelte";
  import { delayed } from "$lib/ui/delay.svelte";
  import { openBelow } from "$lib/ui/menu.svelte";
  import { fullText, tooltip } from "$lib/ui/tooltip";
  import { gitStore } from "./gitStore.svelte";
  import { Latest } from "$lib/latest";
  import type { Piece } from "./diffHighlight";
  import { choiceScope, hits, hunkPick,hunkRows, isChange, lineKey, markers, partialBlock, patchText, picksFor, sideOf, splitRows, step, styled, unifiedRows, widest, type LineRef, type SplitRow, type UnifiedRow } from "./diffModel";
  import { toasts } from "$lib/stores/toasts.svelte";
  import { settings } from "$lib/stores/settings.svelte";

  /**
   * A file diff in one column or side by side. In the Changes view (`source` set) hunks and single
   * lines can be staged, unstaged and discarded; everywhere it searches, jumps between hunks and
   * colours the syntax once the highlighter has loaded.
   */
  let {
    diff,
    loading = false,
    source = null,
    stale = false,
    onloadfull,
  }: {
    diff: FileDiff | null;
    loading?: boolean;
    source?: DiffSource | null;
    /** The diff shown is not that of the selected file (its answer is on its way or failed). */
    stale?: boolean;
    onloadfull?: () => void;
  } = $props();

  const ROW = 20;
  const showSkeleton = delayed(() => loading && !diff);
  const split = $derived(!!settings.config?.ui.diffSplit);
  const rows = $derived<(UnifiedRow | SplitRow)[]>(diff ? (split ? splitRows(diff) : unifiedRows(diff)) : []);
  const starts = $derived(hunkRows(rows));
  const block = $derived(diff ? partialBlock(diff, source, gitStore.diffOptions.whitespace) : "source");
  const blockText = $derived(block && block !== "source" ? t.git.partialBlock[block] : undefined);
  const actions = $derived<{ action: ApplyAction; label: string }[]>(
    source === "Unstaged"
      ? [
          { action: "Stage", label: t.git.stageHunk },
          { action: "Discard", label: t.git.discardHunk },
        ]
      : source === "Staged"
        ? [{ action: "Unstage", label: t.git.unstageHunk }]
        : [],
  );

  // Syntax colours load with the first diff; a newer diff makes a late answer void.
  let syntax = $state<Map<string, Piece[]> | null>(null);
  const highlights = new Latest();
  $effect(() => {
    const d = diff;
    const current = highlights.next();
    syntax = null;
    if (!d) return;
    import("./diffHighlight")
      .then((m) => m.highlightDiff(d))
      .then((s) => {
        if (current()) syntax = s;
      })
      .catch(() => {});
  });
  const spans = (r: LineRef) => styled(r.line, syntax?.get(lineKey(r.hunk, r.index)));

  // ---- split view: each side shifts its text sideways ------------------------------------------
  // Rows are virtual, so no row may scroll by itself: one offset per side moves the text of every
  // row as a transform, driven by a thin scrollbar under the side and by a sideways wheel over it.
  const GUTTER = 48;
  let shiftX = $state([0, 0]);
  let bars = $state<(HTMLDivElement | undefined)[]>([undefined, undefined]);
  let listBox: HTMLDivElement | undefined = $state();
  const wide = $derived(split ? widest(rows as SplitRow[]) : null);
  // Measured from the widest line alone, once per diff, by hidden copies below.
  let textW = $state([0, 0]);
  let eolW = $state(0);
  const scrollW = (s: number) => textW[s] + (wide?.[s].eol ? eolW : 0);

  const place = $derived(diff ? `${diff.path}\0${split}` : "");
  $effect(() => {
    void place;
    shiftX = [0, 0];
    untrack(() => bars.forEach((b) => b && (b.scrollLeft = 0)));
  });

  $effect(() => {
    const el = listBox;
    if (!el || !split) return;
    const onWheel = (e: WheelEvent) => {
      const unit = e.deltaMode === 1 ? ROW : e.deltaMode === 2 ? el.clientWidth : 1;
      // A diagonal touchpad swipe that is mostly vertical stays a vertical scroll.
      const dx = (e.shiftKey ? e.deltaX || e.deltaY : Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : 0) * unit;
      const right = bars[1];
      if (!dx || !right) return;
      const bar = bars[e.clientX < right.getBoundingClientRect().left - GUTTER ? 0 : 1];
      if (!bar) return;
      bar.scrollLeft += dx;
      e.preventDefault();
    };
    // Not passive: the wheel must not also scroll the list vertically.
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  });

  // ---- choosing lines --------------------------------------------------------------------------
  let chosen = $state(new Set<string>());
  let anchor: { hunk: number; index: number } | null = null;
  let dragging = false;
  const scope = $derived(diff ? choiceScope(diff, source) : "");
  $effect(() => {
    void scope;
    chosen = new Set();
    anchor = null;
  });
  const choosable = (r: LineRef | null) => !!r && block === null && isChange(r.line);
  // Hunks and lines index the diff on screen: while another answer is on its way they may not match it.
  const frozen = $derived(loading || stale);
  const isChosen = (r: LineRef) => chosen.has(lineKey(r.hunk, r.index));

  function choose(r: LineRef, e: PointerEvent) {
    if (!diff || !choosable(r)) return;
    const next = new Set(chosen);
    if (e.shiftKey && anchor && anchor.hunk === r.hunk) {
      const [a, b] = [Math.min(anchor.index, r.index), Math.max(anchor.index, r.index)];
      diff.hunks[r.hunk].lines.forEach((l, i) => {
        if (i >= a && i <= b && isChange(l)) next.add(lineKey(r.hunk, i));
      });
    } else {
      const k = lineKey(r.hunk, r.index);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      anchor = { hunk: r.hunk, index: r.index };
    }
    chosen = next;
    dragging = true;
  }
  function dragOver(r: LineRef) {
    if (dragging && choosable(r) && !isChosen(r)) chosen = new Set(chosen).add(lineKey(r.hunk, r.index));
  }

  // No clearing here: a change that lands changes the diff and with it the scope; one that fails
  // or is cancelled leaves the choice for another try.
  function apply(action: ApplyAction, picks: HunkPick[]) {
    gitStore.applySelection(picks, action);
  }

  // ---- moving around ---------------------------------------------------------------------------
  let top = $state(0);
  let active = $state<string | null>(null);
  async function reveal(index: number) {
    const r = rows[index];
    if (!r) return;
    // The list scrolls only when the key changes; the same place again needs a fresh one.
    active = null;
    await tick();
    active = r.key;
  }
  function go(dir: 1 | -1) {
    const at = step(starts, top, dir);
    if (at !== null) reveal(at);
  }
  // The hunk the reader is in: the one whose rows are at the top of the view.
  const currentHunk = $derived(rows[top]?.hunk ?? null);
  const stickyHunk = $derived(rows[top] && rows[top].kind !== "hunk" ? rows[top].hunk : null);

  let searching = $state(false);
  let query = $state("");
  let hitAt = $state(0);
  let searchInput: HTMLInputElement | undefined = $state();
  const found = $derived(hits(rows, query));
  const hitRows = $derived(new Set(found));
  async function openSearch() {
    searching = true;
    await tick();
    searchInput?.select();
  }
  function nextHit(dir: 1 | -1) {
    if (!found.length) return;
    hitAt = (hitAt + dir + found.length) % found.length;
    reveal(found[hitAt]);
  }
  function onQuery() {
    hitAt = 0;
    if (found.length) reveal(found[0]);
  }

  function onKey(e: KeyboardEvent) {
    if ((e.target as HTMLElement).closest("input, textarea")) {
      if (e.key === "Escape") searching = false;
      else if (e.key === "Enter") nextHit(e.shiftKey ? -1 : 1);
      else return;
      e.preventDefault();
      return;
    }
    const plain = !e.ctrlKey && !e.altKey && !e.metaKey;
    // The table search owns Ctrl+F elsewhere; inside the diff it searches the diff.
    if (e.ctrlKey && e.key.toLowerCase() === "f") openSearch();
    else if ((e.altKey && e.key === "ArrowDown") || (plain && e.key === "n")) go(1);
    else if ((e.altKey && e.key === "ArrowUp") || (plain && e.key === "p")) go(-1);
    else if (plain && e.key === "s" && source === "Unstaged" && block === null && !frozen && diff && currentHunk !== null) apply("Stage", [hunkPick(diff, currentHunk)]);
    else if (plain && e.key === "u" && source === "Staged" && block === null && !frozen && diff && currentHunk !== null) apply("Unstage", [hunkPick(diff, currentHunk)]);
    else if (e.key === "Escape" && chosen.size) chosen = new Set();
    else return;
    e.preventDefault();
    e.stopPropagation();
  }

  // ---- options -------------------------------------------------------------------------------
  const WHOLE = 1_000_000;
  function whitespaceMenu(e: MouseEvent) {
    const set = (whitespace: Whitespace) => gitStore.setDiffOptions({ whitespace });
    const w = gitStore.diffOptions.whitespace;
    openBelow(
      e.currentTarget as HTMLElement,
      [
        { label: t.git.wsKeep, checked: w === "Keep", run: () => set("Keep") },
        { label: t.git.wsChange, checked: w === "IgnoreChange", run: () => set("IgnoreChange") },
        { label: t.git.wsAll, checked: w === "IgnoreAll", run: () => set("IgnoreAll") },
      ],
      t.git.whitespace,
    );
  }
  function contextMenu(e: MouseEvent) {
    const c = gitStore.diffOptions.context;
    openBelow(
      e.currentTarget as HTMLElement,
      [
        ...[3, 10, 25].map((n) => ({ label: t.git.contextLines(n), checked: c === n, run: () => gitStore.setDiffOptions({ context: n }) })),
        { label: t.git.contextFile, checked: c === WHOLE, run: () => gitStore.setDiffOptions({ context: WHOLE }) },
      ],
      t.git.context,
    );
  }

  const tone = { Add: "mbf-diff-add", Del: "mbf-diff-del", Context: "", Meta: "text-faint italic" } as const;
  const sign = { Add: "+", Del: "−", Context: " ", Meta: " " } as const;
  const signTone = { Add: "text-safe", Del: "text-unsafe", Context: "text-faint", Meta: "text-faint" } as const;
</script>

<svelte:window onpointerup={() => (dragging = false)} />

<!-- Kept on single lines: the text sits in white-space: pre, so template indentation would render. -->
{#snippet text(r: LineRef, eol: boolean)}{#each spans(r) as s, i (i)}<span class="{s.cls} {s.changed ? 'mbf-diff-word' : ''}">{s.text}</span>{/each}{#if eol && r.line.eol}{@render eolMark("")}{/if}{/snippet}
{#snippet eolMark(extra: string)}<span class="ml-2 rounded bg-review/14 px-1.5 font-sans text-[10px] text-review-ink {extra}" use:tooltip={t.git.eolTip}>{t.git.eolOnly}</span>{/snippet}

<!-- A line number; on a changed line of the Changes view it is the handle that chooses the line. -->
{#snippet gutter(r: LineRef | null, no: number | null)}
  {#if r && choosable(r)}
    <button
      type="button"
      class="mbf-diff-gutter w-[48px] shrink-0 cursor-pointer pr-2 text-right text-faint select-none hover:text-fg"
      aria-pressed={isChosen(r)}
      aria-label={t.git.chooseLine}
      use:tooltip={t.git.chooseTip}
      onpointerdown={(e) => choose(r, e)}
      onpointerenter={() => dragOver(r)}>{no ?? ""}</button
    >
  {:else}
    <span class="mbf-diff-gutter w-[48px] shrink-0 pr-2 text-right text-faint select-none">{no ?? ""}</span>
  {/if}
{/snippet}

{#snippet hunkBar(hunk: number)}
  {@const h = diff!.hunks[hunk]}
  <div class="mbf-diff-hunk flex w-full min-w-0 items-center gap-3 px-3 font-sans text-xs" style="height: {ROW}px">
    {#if diff!.conflict}
      <span class="truncate">{t.git.conflictLegend}</span>
    {:else}
      <span class="shrink-0 font-mono opacity-80">−{h.oldStart},{h.oldLines} +{h.newStart},{h.newLines}</span>
      {#if h.section}<span class="min-w-0 truncate font-mono" use:fullText={h.section}>{h.section}</span>{/if}
      <span class="ml-auto flex shrink-0 items-center gap-1">
        {#if block !== "source" && block !== "wholeFile"}
          {#each actions as a (a.action)}
            <button
              type="button"
              class="h-[16px] rounded border border-current/30 px-1.5 leading-none transition-colors hover:bg-panel/60 disabled:opacity-50"
              disabled={block !== null || gitStore.locked || frozen}
              use:tooltip={blockText}
              onclick={() => apply(a.action, [hunkPick(diff!, hunk)])}>{a.label}</button
            >
          {/each}
        {/if}
        <!-- The tip on a wrapper, as IconButton does: the button's own name is its label. -->
        <span class="inline-flex" use:tooltip={t.git.copyPatch}>
          <button
            type="button"
            class="grid h-[16px] w-[20px] place-items-center rounded border border-current/30 transition-colors hover:bg-panel/60"
            aria-label={t.git.copyPatch}
            onclick={() => toasts.copy(patchText(diff!, hunk))}><Copy size={10} /></button
          >
        </span>
      </span>
    {/if}
  </div>
{/snippet}

<div class="relative flex h-full min-h-0 flex-col" role="presentation" onkeydown={onKey}>
  {#if diff}
    <div class="flex h-10 shrink-0 items-center gap-2 border-b border-line px-3 text-sm">
      <div class="min-w-[120px] flex-1">
        <div class="truncate font-mono" use:fullText={diff.path}>{diff.path}</div>
        {#if diff.oldPath || (diff.oldMode && diff.newMode)}
          {@const from = [diff.oldPath ? t.git.renamedFrom(diff.oldPath, diff.similarity) : "", diff.oldMode && diff.newMode ? t.git.modeChange(diff.oldMode, diff.newMode) : ""].filter(Boolean).join(" · ")}
          <div class="truncate text-xs text-faint" use:fullText={from}>
            {#if diff.oldPath}{t.git.renamedFrom(diff.oldPath, diff.similarity)}{/if}
            {#if diff.oldPath && diff.oldMode && diff.newMode}<span class="mx-1.5">·</span>{/if}
            {#if diff.oldMode && diff.newMode}{t.git.modeChange(diff.oldMode, diff.newMode)}{/if}
          </div>
        {/if}
      </div>
      {#if !diff.binary}
        <span class="shrink-0 font-mono text-safe" data-naked-ok>+{diff.added}</span>
        <span class="shrink-0 font-mono text-unsafe" data-naked-ok>−{diff.removed}</span>
        <!-- One toggle, not a labelled switch: the header shares its width with the path. -->
        <IconButton icon={Columns2} size="sm" label={t.git.viewSplit} active={split} aria-pressed={split} onclick={() => settings.setUi({ diffSplit: !split })} />
        <IconButton icon={Pilcrow} size="sm" label={t.git.whitespace} hint={t.git.wsTip} active={gitStore.diffOptions.whitespace !== "Keep"} aria-haspopup="menu" onclick={whitespaceMenu} />
        <IconButton icon={UnfoldVertical} size="sm" label={t.git.context} hint={t.git.contextTip} active={gitStore.diffOptions.context !== 3} aria-haspopup="menu" onclick={contextMenu} />
        <IconButton icon={ChevronUp} size="sm" label={t.git.prevHunk} keys="p" disabled={!starts.length} onclick={() => go(-1)} />
        <IconButton icon={ChevronDown} size="sm" label={t.git.nextHunk} keys="n" disabled={!starts.length} onclick={() => go(1)} />
        <IconButton icon={Search} size="sm" label={t.git.searchDiff} keys="Ctrl F" active={searching} onclick={() => (searching ? (searching = false) : openSearch())} />
      {/if}
    </div>
    {#if searching}
      <div class="flex h-9 shrink-0 items-center gap-2 border-b border-line bg-panel-2 px-3">
        <Search size={13} class="text-faint" />
        <input
          bind:this={searchInput}
          bind:value={query}
          oninput={onQuery}
          placeholder={t.git.searchDiff}
          aria-label={t.git.searchDiff}
          class="min-w-0 flex-1 bg-transparent font-mono text-sm outline-none placeholder:text-faint"
        />
        <span class="shrink-0 text-xs text-faint tabular-nums">{query ? (found.length ? t.git.hitOf(hitAt + 1, found.length) : t.git.noHits) : ""}</span>
        <IconButton icon={ChevronUp} size="sm" label={t.git.prevHit} keys="Shift+Enter" disabled={!found.length} onclick={() => nextHit(-1)} />
        <IconButton icon={ChevronDown} size="sm" label={t.git.nextHit} keys="Enter" disabled={!found.length} onclick={() => nextHit(1)} />
        <IconButton icon={X} size="sm" label={t.common.close} keys="Esc" onclick={() => (searching = false)} />
      </div>
    {/if}
  {/if}

  {#if loading && !diff}
    {#if showSkeleton.value}
      <div class="flex flex-col gap-2 p-3" aria-busy="true">
        <Skeleton class="h-3 w-1/3" />
        {#each [0, 1, 2, 3, 4, 5, 6, 7] as i (i)}<Skeleton class={i % 3 ? "h-3 w-3/5" : "h-3 w-4/5"} />{/each}
      </div>
    {/if}
  {:else if !diff}
    <EmptyState icon={FileQuestion} title={t.git.noFile} text={t.git.noFileText} />
  {:else if diff.binary}
    <EmptyState title={t.git.binary} text={t.git.binaryText} />
  {:else if rows.length === 0}
    <EmptyState title={t.git.noContent} text={t.git.noContentText} />
  {:else}
    <div class="relative min-h-0 flex-1" bind:this={listBox}>
      <VirtualList items={rows} rowHeight={ROW} key={(r) => r.key} activeKey={active} ontop={(i) => (top = i)} class="h-full font-mono text-sm {split ? 'overflow-x-hidden' : 'overflow-x-auto'}" label="Diff">
        {#snippet row(r, i)}
          {@const hit = hitRows.has(i) ? (found[hitAt] === i ? "outline outline-2 -outline-offset-2 outline-accent" : "outline outline-1 -outline-offset-1 outline-accent/50") : ""}
          {#if r.kind === "hunk"}
            {@render hunkBar(r.hunk)}
          {:else if r.kind === "line"}
            {@const l = r.line}
            <div class="flex w-max min-w-full {tone[l.kind]} {isChosen(r) ? 'mbf-diff-chosen' : ''} {hit}" style="height: {ROW}px; line-height: {ROW}px">
              {@render gutter(l.kind === "Add" ? null : r, l.oldNo)}
              {@render gutter(l.kind === "Del" ? null : r, l.newNo)}
              <span class="w-5 shrink-0 text-center select-none {signTone[l.kind]}">{sign[l.kind]}</span>
              <span class="selectable pr-6 whitespace-pre">{@render text(r, true)}</span>
            </div>
          {:else}
            <!-- Two halves of equal width; each shifts its text by its own offset, the gutter stays. -->
            <div class="grid w-full grid-cols-[48px_minmax(0,1fr)_48px_minmax(0,1fr)] {hit}" style="height: {ROW}px; line-height: {ROW}px">
              {#each [0, 1] as const as s (s)}
                {@const own = sideOf(r, s)}
                {#if own}
                  {@const cls = `${tone[own.line.kind]} ${isChosen(own) ? "mbf-diff-chosen" : ""}`}
                  <div class="flex {cls}">{@render gutter(own, s === 0 ? own.line.oldNo : own.line.newNo)}</div>
                  <div class="flex min-w-0 items-center {cls}">
                    <div class="min-w-0 overflow-hidden" data-hscroll><div class="selectable w-max pr-4 whitespace-pre" style:transform={shiftX[s] ? `translateX(-${shiftX[s]}px)` : undefined}>{@render text(own, false)}</div></div>
                    {#if own.line.eol}{@render eolMark("mbf-diff-eol shrink-0")}{/if}
                  </div>
                {:else}
                  <span class="mbf-diff-empty"></span><span class="mbf-diff-empty"></span>
                {/if}
              {/each}
            </div>
          {/if}
        {/snippet}
      </VirtualList>
      {#if stickyHunk !== null}
        <!-- The hunk the reader is in stays named while its lines scroll past. -->
        <div class="absolute inset-x-0 top-0 z-10 shadow-sm">{@render hunkBar(stickyHunk)}</div>
      {/if}
      <!-- Where the changes are in the whole file, scaled to the rows when they do not fill the view; a click goes there. -->
      <div class="absolute top-0 right-0 bottom-0 w-2">
        {#each markers(rows) as m (m.at)}
          <button
            type="button"
            tabindex="-1"
            class="absolute right-0 h-[3px] w-2 {m.kind === 'Add' ? 'bg-safe' : 'bg-unsafe'}"
            style="top: min({m.at * 100}%, {m.at * rows.length * ROW}px)"
            aria-label={m.kind === "Add" ? t.git.markerAdd : t.git.markerDel}
            use:tooltip={() => ({ title: m.kind === "Add" ? t.git.markerAdd : t.git.markerDel, text: t.git.markerTip })}
            onclick={() => reveal(Math.round(m.at * rows.length))}
          ></button>
        {/each}
      </div>
    </div>
    {#if wide}
      <!-- One scrollbar per side, as wide as its widest line; shown only where a side overflows. -->
      <div class="mbf-diff-hbars grid shrink-0 grid-cols-[48px_minmax(0,1fr)_48px_minmax(0,1fr)]">
        {#each [0, 1] as s (s)}
          <span></span>
          <div bind:this={bars[s]} class="overflow-x-auto overflow-y-hidden" onscroll={(e) => (shiftX[s] = e.currentTarget.scrollLeft)}><div class="h-px" style="width: {scrollW(s)}px"></div></div>
        {/each}
      </div>
      <div class="pointer-events-none invisible absolute top-0 left-0 h-0 overflow-hidden font-mono text-sm" aria-hidden="true">
        {#each wide as w, s (s)}<div class="w-max pr-4 whitespace-pre" bind:clientWidth={textW[s]}>{w.text}</div>{/each}
        <div class="w-max" bind:clientWidth={eolW}><span class="ml-2 rounded px-1.5 font-sans text-[10px]">{t.git.eolOnly}</span></div>
      </div>
    {/if}
    {#if chosen.size}
      {@const picks = picksFor(diff, chosen)}
      <!-- The chosen lines and what can happen with them, floating over the diff. -->
      <div class="absolute bottom-3 left-1/2 z-20 flex -translate-x-1/2 items-center gap-2 rounded-xl border border-line bg-panel px-3 py-2 shadow-panel">
        <span class="text-sm text-muted">{t.git.chosen(chosen.size)}</span>
        {#if source === "Unstaged"}
          <Button size="sm" variant="primary" disabled={gitStore.locked || frozen} onclick={() => apply("Stage", picks)}>{t.git.stageLines}</Button>
          <Button size="sm" variant="danger-outline" disabled={gitStore.locked || frozen} onclick={() => apply("Discard", picks)}>{t.git.discardLines}</Button>
        {:else if source === "Staged"}
          <Button size="sm" variant="primary" disabled={gitStore.locked || frozen} onclick={() => apply("Unstage", picks)}>{t.git.unstageLines}</Button>
        {/if}
        <IconButton icon={Copy} size="sm" label={t.git.copyPatch} onclick={() => toasts.copy(picks.map((p) => patchText(diff!, p.hunk, chosen)).join(""))} />
        <IconButton icon={X} size="sm" label={t.git.clearChoice} keys="Esc" onclick={() => (chosen = new Set())} />
      </div>
    {/if}
    {#if diff.truncated}
      <div class="flex shrink-0 items-center gap-3 border-t border-line bg-review/8 px-3 py-2 text-sm">
        <span class="text-review">{t.git.truncated}</span>
        {#if onloadfull}<Button size="sm" onclick={onloadfull}>{t.git.loadAll}</Button>{/if}
      </div>
    {/if}
  {/if}
</div>
