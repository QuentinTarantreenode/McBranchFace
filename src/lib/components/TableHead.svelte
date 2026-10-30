<script lang="ts">
  import { ArrowDown, ArrowUp, ArrowUpDown, Ellipsis, Funnel } from "@lucide/svelte";
  import type { ColumnPref } from "$lib/bindings/ColumnPref";
  import { t } from "$lib/i18n/index.svelte";
  import { COLUMNS, columnDef, MAX_WIDTH, moveColumnBeside, resizeColumn, type ColumnId } from "$lib/table/columns";
  import Checkbox from "$lib/ui/Checkbox.svelte";
  import IconButton from "$lib/ui/IconButton.svelte";
  import IconChip from "$lib/ui/IconChip.svelte";
  import { contextmenu, openBelow, type MenuEntry } from "$lib/ui/menu.svelte";
  import Resizer from "$lib/ui/Resizer.svelte";
  import { sortable, type SortState } from "$lib/ui/sortable";
  import { tooltip } from "$lib/ui/tooltip";
  import { cleanupView } from "$lib/stores/cleanupView.svelte";

  /** The column heads: sort, filter mark, menu, width; dragged onto another head a column moves there. */
  let {
    layout,
    shown,
    colLabel,
    menu,
    drafts = $bindable(),
    allChecked,
    someChecked,
    markDisabled,
    ontoggleall,
  }: {
    layout: ColumnPref[];
    shown: ColumnId[];
    colLabel: (id: string) => string;
    menu: (id: ColumnId) => Promise<MenuEntry[]>;
    /** Widths while a resize handle is dragged; saved when it is let go. */
    drafts: Record<string, number>;
    allChecked: boolean;
    someChecked: boolean;
    markDisabled: boolean;
    ontoggleall: () => void;
  } = $props();

  // Moving a column: drag its head onto another; the line shows on which side it lands.
  let moving = $state<SortState | null>(null);
  const labels: Record<string, HTMLElement | undefined> = {};

  const colText = (id: string): string | undefined =>
    id === "commit" ? t.cleanup.commitTip : id === "pr" ? t.cleanup.colPrTip : id === "local" ? t.cleanup.colLocalTip : id === "source" ? t.cleanup.colSourceTip : undefined;
  // Every head says it can be dragged: the gesture has no other sign until it is tried.
  // The head names the column too: a narrow column cuts its label.
  const colTip = (id: string) => () => {
    const label = labels[id];
    const cut = !!label && label.scrollWidth > label.clientWidth + 1;
    return { title: cut ? colLabel(id) : undefined, text: colText(id), foot: t.cleanup.dragColumnHint, gestures: true };
  };

  function openMenu(e: MouseEvent, id: ColumnId) {
    e.stopPropagation();
    openBelow(e.currentTarget as HTMLElement, menu(id), t.cleanup.columnMenu(colLabel(id)));
  }

  function commitWidth(id: string, width: number) {
    cleanupView.setColumns(resizeColumn(cleanupView.columns, id, width));
    delete drafts[id];
  }
</script>

<div
  class="mbf-grid mbf-head h-9 shrink-0 border-b border-line bg-panel-2 t-section"
  role="row"
  use:sortable={{ axis: "x", items: "[data-sort-id]", onchange: (s) => (moving = s), ondrop: (id, over, after) => cleanupView.setColumns(moveColumnBeside(cleanupView.columns, id, over, after)) }}
>
  <span class="inline-flex w-4">
    <Checkbox checked={allChecked} indeterminate={someChecked} disabled={markDisabled} ariaLabel={t.cleanup.markAll} tip={t.cleanup.markAllTip} onchange={ontoggleall} />
  </span>
  {#each shown as id (id)}
    {@const def = columnDef(id)!}
    {@const w = layout.find((c) => c.id === id)!.width}
    {@const filtered = def.facet ? cleanupView.facetActive(def.facet) : false}
    <div
      class="group/head relative flex h-full min-w-0 cursor-grab items-center gap-1 select-none {moving?.id === id ? 'opacity-50' : ''}
        {moving?.over === id ? (moving.after ? 'shadow-[inset_-2px_0_0_var(--accent)]' : 'shadow-[inset_2px_0_0_var(--accent)]') : ''}"
      data-sort-id={id}
      role="columnheader"
      tabindex="-1"
      aria-sort={def.sort && cleanupView.sort.key === def.sort ? (cleanupView.sort.dir === 1 ? "ascending" : "descending") : undefined}
      use:contextmenu={() => menu(id)}
      use:tooltip={colTip(id)}
    >
      {#if def.sort}
        {@const key = def.sort}
        <button type="button" class="-mx-1 inline-flex min-w-0 items-center gap-1 rounded px-1 uppercase transition-colors hover:bg-hover hover:text-fg" onclick={() => cleanupView.setSort(key)}>
          <span class="truncate" bind:this={labels[id]}>{colLabel(id)}</span>
          {#if cleanupView.sort.key === key}
            {#if cleanupView.sort.dir === 1}<ArrowDown size={11} class="shrink-0" />{:else}<ArrowUp size={11} class="shrink-0" />{/if}
          {:else}
            <!-- Says "this head sorts" before it is clicked. -->
            <ArrowUpDown size={11} class="shrink-0 opacity-50" />
          {/if}
        </button>
      {:else}
        <span class="truncate" bind:this={labels[id]}>{colLabel(id)}</span>
      {/if}
      {#if filtered}<IconChip icon={Funnel} tone="accent" tip={t.cleanup.filterBy} />{/if}
      <span class="ml-auto shrink-0 opacity-0 transition-opacity group-hover/head:opacity-100 focus-within:opacity-100">
        <IconButton icon={Ellipsis} size="sm" label={t.cleanup.columnMenu(colLabel(id))} aria-haspopup="menu" onclick={(e) => openMenu(e, id)} />
      </span>
      <Resizer
        width={w}
        min={def.min}
        max={MAX_WIDTH}
        side="right"
        label={t.cleanup.resizeColumn(colLabel(id))}
        oninput={(v) => (drafts[id] = v)}
        onend={(v) => commitWidth(id, v)}
        onreset={() => commitWidth(id, COLUMNS.find((c) => c.id === id)!.width)}
      />
    </div>
  {/each}
  <span></span>
</div>
{#if moving}
  <!-- The column in hand follows the pointer, so the drag is visible from its first pixel. -->
  <div
    class="pointer-events-none fixed z-50 rounded-md border border-accent/50 mbf-popover px-2 py-1 text-xs font-semibold tracking-wider text-fg uppercase shadow-panel"
    style="left: {moving.x + 12}px; top: {moving.y + 12}px"
  >
    {colLabel(moving.id)}
  </div>
{/if}
