<script lang="ts" module>
  import type { TooltipInput } from "$lib/ui/tooltip";

  export interface MiniColumn<T> {
    id: string;
    label: string;
    /** A grid track: "minmax(0,1fr)", "5rem", "auto". */
    width: string;
    /** Numbers line up at the right edge. */
    end?: boolean;
    tip?: TooltipInput;
    /** Sortable by a click on its head. */
    sort?: (a: T, b: T) => number;
  }

  /** A heading over the rows of one group: its title, and what the group holds. */
  export interface MiniGroup {
    title: string;
    tip?: TooltipInput;
    count?: number;
  }
</script>

<script lang="ts" generics="T">
  // A small table for a tile: column heads that sort, rows that open what they name, groups with a heading,
  // rows that unfold their details, a limit that unfolds. The full grid of the cleanup table (resizable,
  // movable columns) would be too much for a tile.
  import { ArrowDown, ArrowUp, ChevronRight } from "@lucide/svelte";
  import type { Snippet } from "svelte";
  import { t } from "$lib/i18n/index.svelte";
  import Button from "$lib/ui/Button.svelte";
  import { tooltip } from "$lib/ui/tooltip";

  let {
    label,
    columns,
    rows,
    key,
    cell,
    onrow,
    rowTip,
    group,
    groupOf,
    detail,
    hasDetail = () => true,
    detailTip,
    limit = 6,
    empty,
  }: {
    label: string;
    columns: MiniColumn<T>[];
    rows: T[];
    key: (row: T) => string;
    cell: Snippet<[T, MiniColumn<T>]>;
    onrow?: (row: T) => void;
    /** Every clickable row says in its tip what a click does. */
    rowTip?: (row: T) => TooltipInput;
    /** The group of a row; groups keep the order in which their first row comes. */
    group?: (row: T) => string;
    groupOf?: (id: string, rows: T[]) => MiniGroup;
    /** What a row unfolds below itself. */
    detail?: Snippet<[T]>;
    /** Rows without details have no chevron. */
    hasDetail?: (row: T) => boolean;
    /** What the chevron of a row unfolds, in a sentence. */
    detailTip?: (row: T) => string;
    limit?: number;
    empty: string;
  } = $props();

  let sortBy = $state<{ id: string; dir: 1 | -1 } | null>(null);
  let expanded = $state(false);
  let unfolded = $state<string[]>([]);
  // The chevron gets a column of its own, so the content columns line up with or without details.
  const template = $derived([...(detail ? ["20px"] : []), ...columns.map((c) => c.width)].join(" "));
  const sorted = $derived.by(() => {
    const col = sortBy && columns.find((c) => c.id === sortBy!.id);
    const list = col?.sort ? [...rows].sort((a, b) => col.sort!(a, b) * sortBy!.dir) : rows;
    if (!group) return list;
    // Sorting by a column sorts inside each group; the groups stay where they are.
    const order = [...new Set(rows.map(group))];
    return [...list].sort((a, b) => order.indexOf(group(a)) - order.indexOf(group(b)));
  });
  const shown = $derived(expanded ? sorted : sorted.slice(0, limit));
  const sections = $derived.by(() => {
    if (!group) return [{ id: "", rows: shown }];
    const out: { id: string; rows: T[] }[] = [];
    for (const r of shown) {
      const id = group(r);
      const last = out[out.length - 1];
      if (last?.id === id) last.rows.push(r);
      else out.push({ id, rows: [r] });
    }
    return out;
  });

  function toggleSort(id: string) {
    sortBy = sortBy?.id === id ? (sortBy.dir === 1 ? { id, dir: -1 } : null) : { id, dir: 1 };
  }
  function unfold(row: T) {
    const k = key(row);
    unfolded = unfolded.includes(k) ? unfolded.filter((x) => x !== k) : [...unfolded, k];
  }
  // A button inside the row (open in browser, remove, the chevron) does its own thing, not the row's.
  function open(e: MouseEvent | KeyboardEvent, row: T) {
    if ((e.target as Element).closest("button, a")) return;
    if (e instanceof KeyboardEvent && e.key !== "Enter" && e.key !== " ") return;
    e.preventDefault();
    onrow?.(row);
  }
</script>

{#if rows.length}
  <!-- One grid for the whole table, every row a subgrid of it: a column as wide as its content
       (a button, a number with its unit) is equally wide in every row, so everything lines up. -->
  <div role="table" aria-label={label} class="grid gap-x-3 text-sm" style="grid-template-columns: {template}">
    <div role="row" class="col-span-full grid grid-cols-subgrid items-end border-b border-line px-2 pb-1">
      {#if detail}<div role="columnheader"><span class="sr-only">{t.dashboard.details}</span></div>{/if}
      {#each columns as c (c.id)}
        <div role="columnheader" class="min-w-0 {c.end ? 'text-right' : ''}" aria-sort={sortBy?.id === c.id ? (sortBy.dir === 1 ? "ascending" : "descending") : undefined}>
          {#if c.sort}
            <button type="button" class="inline-flex max-w-full items-center gap-1 rounded t-section hover:text-fg" use:tooltip={c.tip ?? null} onclick={() => toggleSort(c.id)}>
              <span class="truncate">{c.label}</span>
              {#if sortBy?.id === c.id}{#if sortBy.dir === 1}<ArrowDown size={11} class="shrink-0" />{:else}<ArrowUp size={11} class="shrink-0" />{/if}{/if}
            </button>
          {:else}
            <span class="block truncate t-section" use:tooltip={c.tip ?? null}>{c.label}</span>
          {/if}
        </div>
      {/each}
    </div>
    {#each sections as sec (sec.id)}
      {#if group && groupOf}
        {@const g = groupOf(sec.id, rows.filter((r) => group(r) === sec.id))}
        <div role="row" class="col-span-full px-2 pt-3 pb-0.5">
          <div role="cell" class="flex items-center gap-2">
            <span class="text-xs font-semibold text-muted" use:tooltip={g.tip ?? null}>{g.title}</span>
            {#if g.count !== undefined}<span class="mbf-count">{g.count}</span>{/if}
          </div>
        </div>
      {/if}
      {#each sec.rows as row (key(row))}
        {@const more = !!detail && hasDetail(row)}
        {@const isOpen = more && unfolded.includes(key(row))}
        <div
          role="row"
          tabindex={onrow ? 0 : undefined}
          aria-expanded={more ? isOpen : undefined}
          class="col-span-full mt-0.5 grid min-h-8 grid-cols-subgrid items-center rounded-md border border-transparent px-2 py-1 {onrow ? 'cursor-pointer hover:border-line-strong hover:bg-hover/60 focus-visible:border-accent/60 focus-visible:outline-none' : ''} {isOpen ? 'bg-hover/40' : ''}"
          use:tooltip={rowTip?.(row) ?? null}
          onclick={(e) => open(e, row)}
          onkeydown={(e) => open(e, row)}
        >
          {#if detail}
            <div role="cell" class="grid place-items-center">
              {#if more}
                <button
                  type="button"
                  class="grid size-5 shrink-0 place-items-center rounded text-faint hover:bg-hover hover:text-fg"
                  aria-expanded={isOpen}
                  aria-label={isOpen ? t.dashboard.hideDetails : t.dashboard.showDetails}
                  use:tooltip={{ title: isOpen ? t.dashboard.hideDetails : t.dashboard.showDetails, text: detailTip?.(row) }}
                  onclick={() => unfold(row)}
                >
                  <ChevronRight size={14} class="transition-transform {isOpen ? 'rotate-90' : ''}" />
                </button>
              {/if}
            </div>
          {/if}
          {#each columns as c (c.id)}
            <div role="cell" class="min-w-0 {c.end ? 'text-right tabular-nums' : ''}">{@render cell(row, c)}</div>
          {/each}
        </div>
        {#if isOpen && detail}
          <!-- Below the row, in its own box: a click here reads the details, it does not open the row. -->
          <div role="row" class="col-span-full mb-1 ml-[30px] mr-2 rounded-md border border-line bg-panel-2/60 p-2">
            <div role="cell">{@render detail(row)}</div>
          </div>
        {/if}
      {/each}
    {/each}
    {#if rows.length > limit}
      <div class="col-span-full px-2 pt-2">
        <Button size="sm" onclick={() => (expanded = !expanded)}>{expanded ? t.dashboard.showLess : t.dashboard.showAll(rows.length)}</Button>
      </div>
    {/if}
  </div>
{:else}
  <p class="px-2 py-2 t-meta">{empty}</p>
{/if}
