<script lang="ts">
  import { Check, ChevronRight } from "@lucide/svelte";
  import { onDestroy, onMount, tick } from "svelte";
  import { onDismiss } from "./dismiss";
  import { fullText, tooltip } from "./tooltip";
  import { isItem, menu, type MenuEntry, type MenuItem, type MenuTile } from "./menu.svelte";

  // Tiles and items in reading order: what the arrow keys step through.
  type Target = { tile: MenuTile } | { item: MenuItem };
  const targetsOf = (entries: MenuEntry[]): Target[] =>
    entries.flatMap((e): Target[] => (typeof e === "object" && "tiles" in e ? e.tiles.map((tile) => ({ tile })) : isItem(e) ? [{ item: e }] : []));
  const disabled = (t: Target | undefined) => !t || ("tile" in t ? !!t.tile.disabled : !!t.item.disabled);
  const indexIn = (list: Target[], x: MenuItem | MenuTile) => list.findIndex((t) => ("tile" in t ? t.tile : t.item) === x);

  // Hover intent: a submenu opens after a short rest and closes only after the pointer has left
  // for a moment, so crossing another item on the way into it does not close it.
  const OPEN_DELAY = 120;
  const CLOSE_DELAY = 250;

  let rootEl: HTMLDivElement | undefined = $state();
  let subEl: HTMLDivElement | undefined = $state();
  let active = $state(-1);
  let subActive = $state(-1);
  let pos = $state({ x: 0, y: 0 });
  let subPos = $state({ x: 0, y: 0 });
  let openTimer: ReturnType<typeof setTimeout> | undefined;
  let closeTimer: ReturnType<typeof setTimeout> | undefined;
  onDestroy(() => {
    clearTimeout(openTimer);
    clearTimeout(closeTimer);
  });

  const m = $derived(menu.current);
  const s = $derived(menu.sub);
  const targets = $derived(m ? targetsOf(m.entries) : []);
  const subTargets = $derived(s ? targetsOf(s.entries) : []);
  const firstEnabled = (list: Target[]) => list.findIndex((t) => !disabled(t));

  // Room to every window edge, also when the menu fits neither below nor above its button.
  const EDGE = 8;
  const clamp = (v: number, size: number, room: number) => Math.max(EDGE, Math.min(v, room - EDGE - size));

  // Clamp into the viewport; a menu opened from a button that would overflow opens above it. From the
  // requested point every time: the entries may load after the first layout and make the menu bigger.
  function place() {
    if (!m || !rootEl) return;
    const w = rootEl.offsetWidth;
    const h = rootEl.offsetHeight;
    let { x, y } = m;
    if (x + w > innerWidth - EDGE) x = (m.anchor ? m.anchor.right : x) - w;
    if (y + h > innerHeight - EDGE) y = (m.anchor ? m.anchor.top - 4 : y) - h;
    pos = { x: Math.round(clamp(x, w, innerWidth)), y: Math.round(clamp(y, h, innerHeight)) };
  }

  $effect(() => {
    if (!m) return;
    pos = { x: m.x, y: m.y };
    // Opened by the pointer, nothing is preselected: a stray Enter runs nothing, the first arrow key picks.
    // Opened by the keyboard, the first entry is ready.
    active = performance.now() - lastPointerDown < 600 ? -1 : firstEnabled(targets);
    tick().then(() => {
      place();
      rootEl?.focus();
    });
  });

  $effect(() => {
    if (!rootEl) return;
    const watch = new ResizeObserver(place);
    watch.observe(rootEl);
    return () => watch.disconnect();
  });

  $effect(() => {
    if (!s) return;
    subPos = { x: s.x, y: s.y };
    tick().then(() => {
      if (!subEl || !rootEl) return;
      // Beside the parent; on its left where the right edge of the window is too close.
      const box = rootEl.getBoundingClientRect();
      const w = subEl.offsetWidth;
      const h = subEl.offsetHeight;
      let { x, y } = subPos;
      if (x + w > innerWidth - EDGE) x = box.left - w + 4;
      subPos = { x: Math.round(clamp(x, w, innerWidth)), y: Math.round(clamp(y, h, innerHeight)) };
    });
  });

  // The tip of an entry stands beside the menu at the entry's height, never over the entries.
  const hintOf = (text: string | undefined) => (text ? { text, beside: "[role=menu]" } : null);

  function openSub(i: MenuItem, from: number, focus: boolean) {
    clearTimeout(openTimer);
    clearTimeout(closeTimer);
    if (!i.submenu || !rootEl) return;
    if (menu.sub?.from !== from) {
      const r = rootEl.querySelector<HTMLElement>(`[data-idx="${from}"]`)?.getBoundingClientRect();
      const box = rootEl.getBoundingClientRect();
      menu.openSub({ x: box.right - 4, y: (r?.top ?? box.top) - 5, entries: i.submenu, label: i.label, from });
    }
    subActive = focus ? firstEnabled(targetsOf(i.submenu)) : -1;
    if (focus) tick().then(() => subEl?.focus());
  }

  function closeSub(focusParent: boolean) {
    clearTimeout(openTimer);
    clearTimeout(closeTimer);
    menu.closeSub();
    if (focusParent) rootEl?.focus();
  }

  function run(t: Target, level: 0 | 1, idx: number) {
    if (disabled(t)) return;
    if ("tile" in t) {
      menu.close(false);
      t.tile.run();
      return;
    }
    const i = t.item;
    if (i.submenu && level === 0) return openSub(i, idx, true);
    if (i.keepOpen) {
      i.run();
      if (i.checked !== undefined) i.checked = !i.checked;
      return;
    }
    menu.close(false);
    i.run();
  }

  function hoverRoot(t: Target, idx: number) {
    if (disabled(t)) return;
    active = idx;
    clearTimeout(openTimer);
    if ("item" in t && t.item.submenu) {
      clearTimeout(closeTimer);
      const item = t.item;
      openTimer = setTimeout(() => openSub(item, idx, false), OPEN_DELAY);
    } else if (menu.sub) {
      clearTimeout(closeTimer);
      closeTimer = setTimeout(() => closeSub(false), CLOSE_DELAY);
    }
  }

  function step(list: Target[], from: number, delta: number) {
    if (!list.length) return from;
    let n = from;
    for (let k = 0; k < list.length; k++) {
      n = (n + delta + list.length) % list.length;
      if (!disabled(list[n])) break;
    }
    return n;
  }

  const isTile = (t: Target | undefined) => !!t && "tile" in t;

  function onKey(e: KeyboardEvent) {
    const t = targets[active];
    if (active < 0 && ["ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight"].includes(e.key)) active = firstEnabled(targets);
    else if (e.key === "ArrowDown") active = step(targets, active, 1);
    else if (e.key === "ArrowUp") active = step(targets, active, -1);
    else if (e.key === "Home") active = firstEnabled(targets);
    else if (e.key === "End") active = targets.findLastIndex((x) => !disabled(x));
    // Within the tile row the arrows go sideways; on an item with a submenu, right opens it.
    else if (e.key === "ArrowRight" && isTile(t) && isTile(targets[active + 1])) active = step(targets, active, 1);
    else if (e.key === "ArrowLeft" && isTile(t) && isTile(targets[active - 1])) active = step(targets, active, -1);
    else if (e.key === "ArrowRight" && t && "item" in t && t.item.submenu) openSub(t.item, active, true);
    else if (e.key === "Enter" || e.key === " ") t && run(t, 0, active);
    // A submenu opened by hovering leaves the focus here: Esc closes the innermost menu first.
    else if (e.key === "Escape" && s) closeSub(true);
    else if (e.key === "Escape" || e.key === "Tab") menu.close();
    else return;
    e.preventDefault();
    e.stopPropagation();
  }

  // Esc with the focus outside both menus: also one level at a time.
  function onWindowKey(e: KeyboardEvent) {
    if (e.key !== "Escape" || !m || rootEl?.contains(document.activeElement) || subEl?.contains(document.activeElement)) return;
    if (s) {
      closeSub(true);
      // Taken: no dialog, the menu's own modal host included, may close on the same key.
      e.preventDefault();
    } else menu.close(false);
  }

  function onSubKey(e: KeyboardEvent) {
    if (e.key === "ArrowDown") subActive = step(subTargets, subActive, 1);
    else if (e.key === "ArrowUp") subActive = step(subTargets, subActive, -1);
    else if (e.key === "Home") subActive = firstEnabled(subTargets);
    else if (e.key === "End") subActive = subTargets.findLastIndex((x) => !disabled(x));
    else if (e.key === "Enter" || e.key === " ") subTargets[subActive] && run(subTargets[subActive], 1, subActive);
    else if (e.key === "ArrowLeft" || e.key === "Escape") closeSub(true);
    else if (e.key === "Tab") menu.close();
    else return;
    e.preventDefault();
    e.stopPropagation();
  }

  // Over a modal dialog the page is inert: a modal host of its own lifts the menu above it, and its
  // cancel (Esc) closes the menu, not the dialog below.
  function topLayer(node: HTMLDialogElement) {
    node.showModal?.();
    return { destroy: () => node.open && node.close() };
  }

  // Only a scroll that moves what the menu belongs to closes it: a list restoring its position after a
  // refresh, or a scroll inside the menu, leaves it open.
  function onScroll(e: Event) {
    if (!m) return;
    const target = e.target instanceof Document ? e.target.documentElement : (e.target as Node);
    const owner = m.trigger ?? m.source;
    if ([rootEl, subEl].some((x) => x?.contains(target))) return;
    if (!owner || target.contains(owner)) menu.close(false);
  }

  let lastPointerDown = -Infinity;
  function outside(e: PointerEvent) {
    lastPointerDown = performance.now();
    // A press on the opening button is left to its click, which closes the menu; closing here would
    // let that click open it again at once.
    const inside = [rootEl, subEl, m?.trigger].some((x) => x?.contains(e.target as Node));
    if (m && !inside) menu.close(false);
  }

  // A press on the title bar or a moved window: the page sees neither, the signal does.
  onMount(() => onDismiss(() => m && menu.close(false)));
</script>

<!-- Esc also when the focus left the menu: its own key handler would not see it then. A press beside
     it is heard in the capture phase: an element that stops the event (a resize handle) cannot keep the
     menu open. -->
<svelte:window
  onpointerdowncapture={outside}
  onscrollcapture={onScroll}
  onresize={() => m && menu.close(false)}
  onblur={() => m && menu.close(false)}
  onkeydown={onWindowKey}
/>

{#snippet itemButton(e: MenuItem, list: Target[], current: number, level: 0 | 1)}
  {@const idx = indexIn(list, e)}
  {@const off = !!e.disabled}
  {@const open = level === 0 && !!e.submenu && menu.sub?.from === idx}
  <button
    type="button"
    role={e.checked === undefined ? "menuitem" : "menuitemcheckbox"}
    aria-checked={e.checked}
    aria-haspopup={e.submenu ? "menu" : undefined}
    aria-expanded={e.submenu ? open : undefined}
    data-idx={idx}
    aria-disabled={off || undefined}
    tabindex="-1"
    class="flex w-full items-start gap-2.5 rounded-md px-2.5 py-1 text-left
      {(idx === current || open) && !off ? (e.danger ? 'bg-unsafe/12' : 'bg-hover') : ''}
      {off ? 'cursor-default opacity-45' : e.danger ? 'text-unsafe' : ''}"
    onpointerenter={() => (level === 0 ? hoverRoot({ item: e }, idx) : !off && (subActive = idx))}
    use:tooltip={hintOf(typeof e.disabled === "string" ? e.disabled : e.hint)}
    onclick={() => run({ item: e }, level, idx)}
  >
    <!-- Fixed icon column, so labels of items with and without icon share one left edge. -->
    <span class="mt-0.5 grid size-4 shrink-0 place-items-center {e.danger ? '' : 'text-faint'}">
      {#if e.swatch}<span class="size-3 rounded-full {e.checked ? 'ring-2 ring-fg/70 ring-offset-1 ring-offset-panel' : ''}" style="background: {e.swatch}"></span>{:else if e.checked}<Check size={14} class="text-accent" />{:else if e.icon}<e.icon size={14} />{/if}
    </span>
    <span class="min-w-0 flex-1">
      <span class="block truncate" use:fullText={e.label}>{e.label}</span>
      {#if e.hint || typeof e.disabled === "string"}<span class="sr-only">{typeof e.disabled === "string" ? e.disabled : e.hint}</span>{/if}

      {#if e.bar}
        <span class="mt-1 block h-1 overflow-hidden rounded-full bg-line"><span class="block h-full rounded-full" style="width: {Math.max(4, Math.round(e.bar.ratio * 100))}%; background: {e.bar.color}"></span></span>
      {/if}
    </span>
    {#if e.count !== undefined}
      <span class="mt-px rounded-md px-1.5 text-sm font-semibold tabular-nums {e.bar ? 'bg-panel-2 text-muted' : e.count ? 'bg-unsafe/12 text-unsafe-ink' : 'bg-panel-2 text-faint'}">{e.count}</span>
    {/if}
    {#if e.keys}<kbd class="mt-px font-mono text-xs text-faint">{e.keys}</kbd>{/if}
    {#if e.submenu}<ChevronRight size={14} class="mt-0.5 shrink-0 text-faint" />{/if}
  </button>
{/snippet}

{#snippet tileRow(tiles: MenuTile[], list: Target[], current: number, level: 0 | 1)}
  <div class="grid auto-cols-fr grid-flow-col gap-0.5 rounded-lg bg-(--popover-2) p-0.5">
    {#each tiles as tile (tile.label)}
      {@const idx = indexIn(list, tile)}
      <button
        type="button"
        role="menuitem"
        data-idx={idx}
        aria-disabled={tile.disabled || undefined}
        tabindex="-1"
        class="flex min-w-[64px] flex-col items-center gap-1 rounded-md border px-1.5 py-1.5 text-xs
          {idx === current && !tile.disabled ? 'border-line-strong bg-hover text-fg' : 'border-transparent text-muted'} {tile.disabled ? 'cursor-default opacity-45' : ''}"
        onpointerenter={() => (level === 0 ? hoverRoot({ tile }, idx) : (subActive = idx))}
        use:tooltip={hintOf(tile.hint)}
        onclick={() => run({ tile }, level, idx)}
      >
        {#if tile.icon}<tile.icon size={16} />{/if}
        <span class="flex max-w-full items-center gap-1"><span class="truncate">{tile.label}</span>{#if tile.count !== undefined}<span class="mbf-count">{tile.count}</span>{/if}</span>
      </button>
    {/each}
  </div>
{/snippet}

{#snippet panel(entries: MenuEntry[], list: Target[], current: number, level: 0 | 1)}
  {#each entries as e, n (n)}
    {#if e === "sep"}
      <div class="my-1 h-px bg-line" role="separator"></div>
    {:else if "heading" in e}
      <!-- Headings carry data (branch, repo), so no uppercase transform that would falsify them. -->
      {#if n === 0}
        <div class="-mx-1 -mt-1 mb-1 truncate rounded-t-xl border-b border-(--popover-line) bg-(--popover-2) px-3.5 py-2 text-sm font-semibold text-fg">{e.heading}</div>
      {:else}
        <div class="truncate px-2.5 pt-1.5 pb-1 text-xs font-semibold text-faint">{e.heading}</div>
      {/if}
    {:else if "group" in e}
      <div class="mx-1 mt-1 border-t border-line/70 px-1.5 pt-1.5 pb-0.5 text-xs font-medium text-faint">{e.group}</div>
    {:else if "tiles" in e}
      {@render tileRow(e.tiles, list, current, level)}
    {:else}
      {@render itemButton(e, list, current, level)}
    {/if}
  {/each}
{/snippet}

{#snippet menus(m: NonNullable<typeof menu.current>)}
  <div
    bind:this={rootEl}
    role="menu"
    tabindex="-1"
    aria-label={m.label}
    class="fixed z-[90] min-w-[220px] max-w-[360px] rounded-xl mbf-popover p-1 text-base text-fg outline-none surface-glow"
    style="left: {pos.x}px; top: {pos.y}px"
    onkeydown={onKey}
  >
    {@render panel(m.entries, targets, active, 0)}
  </div>
  {#if s}
    <div
      bind:this={subEl}
      role="menu"
      tabindex="-1"
      aria-label={s.label}
      class="fixed z-[91] min-w-[200px] max-w-[340px] rounded-xl mbf-popover p-1 text-base text-fg outline-none"
      style="left: {subPos.x}px; top: {subPos.y}px"
      onkeydown={onSubKey}
      onpointerenter={() => {
        clearTimeout(closeTimer);
        clearTimeout(openTimer);
      }}
    >
      {@render panel(s.entries, subTargets, subActive, 1)}
    </div>
  {/if}
{/snippet}

{#if m}
  {#if m.modal}
    <dialog
      class="mbf-menu-host"
      data-menu-host
      use:topLayer
      oncancel={(e) => {
        e.preventDefault();
        if (s) closeSub(true);
        else menu.close();
      }}
    >
      {@render menus(m)}
    </dialog>
  {:else}
    {@render menus(m)}
  {/if}
{/if}
