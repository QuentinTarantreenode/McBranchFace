import type { Component } from "svelte";
import { t } from "$lib/i18n/index.svelte";
import { addGestureHint } from "./gestures";

export interface MenuItem {
  label: string;
  icon?: Component<{ size?: number; class?: string }>;
  /** Second line in the faint colour, e.g. what a lens contains. */
  hint?: string;
  keys?: string;
  count?: number;
  /** Share of the largest entry, drawn as a bar under the label; the count is then neutral, not an alert. */
  bar?: { ratio: number; color: string };
  danger?: boolean;
  /** true, or the reason shown as tooltip-free hint line. */
  disabled?: boolean | string;
  checked?: boolean;
  /** A colour dot in the icon column, for colour choices. */
  swatch?: string;
  /** Opens a second menu beside this item instead of running it. */
  submenu?: MenuEntry[];
  /** Multiple choice: the menu stays open and the check mark follows. */
  keepOpen?: boolean;
  run: () => unknown;
}
/** A large button in the row at the top of a menu, for the most frequent actions. */
export interface MenuTile {
  label: string;
  icon?: Component<{ size?: number; class?: string }>;
  /** How many it acts on, beside the label (Pull 2). */
  count?: number;
  /** What the tile does, beside the menu while it is under the pointer. */
  hint?: string;
  disabled?: boolean;
  run: () => unknown;
}
/**
 * `heading`: the menu's subject (a branch, a repo), shown as it is. `group`: a fixed label above
 * the items that follow. `tiles`: the tile row, first in the menu.
 */
export type MenuEntry = MenuItem | "sep" | { heading: string } | { group: string } | { tiles: MenuTile[] };
/** Entries built on open; a promise lets rarely used menus load their code on first use. */
export type MenuEntries = MenuEntry[] | Promise<MenuEntry[]>;

// Arrays show at once, so a menu opened by a synchronous event is there in the same tick.
function when(entries: MenuEntries, show: (list: MenuEntry[]) => void) {
  if (Array.isArray(entries)) show(entries);
  else void entries.then(show);
}

interface OpenMenu {
  x: number;
  y: number;
  /** Opened from a button: aligned to its edge instead of the cursor. */
  anchor?: DOMRect;
  /** The button that opened it: pressing it again closes the menu instead of counting as outside. */
  trigger?: HTMLElement;
  /** What it was opened on (a row, a card): scrolling that away closes the menu. */
  source?: HTMLElement;
  entries: MenuEntry[];
  label?: string;
  returnFocus: HTMLElement | null;
  /** Opened over a modal dialog: everything outside that dialog is inert, so the menu joins the top layer. */
  modal: boolean;
}

/** The submenu beside an item of the open menu; one level deep. */
interface OpenSub {
  x: number;
  y: number;
  entries: MenuEntry[];
  label: string;
  /** Index of the parent item that opened it. */
  from: number;
}

const actionable = (e: MenuEntry) => typeof e === "object" && ("run" in e || ("tiles" in e && e.tiles.length > 0));

/** Drops separators at the ends and doubled, and group labels with nothing below them. */
function tidy(entries: MenuEntry[]): MenuEntry[] {
  const out = entries.filter((e, i, all) => {
    if (typeof e === "object" && "group" in e) {
      const next = all.slice(i + 1).find((x) => x === "sep" || (typeof x === "object" && ("group" in x || "run" in x)));
      return !!next && typeof next === "object" && "run" in next;
    }
    return true;
  });
  return out.filter((e, i, all) => e !== "sep" || (i > 0 && i < all.length - 1 && all[i - 1] !== "sep"));
}

class MenuStore {
  current = $state<OpenMenu | null>(null);
  sub = $state<OpenSub | null>(null);

  show(m: Omit<OpenMenu, "returnFocus" | "modal">) {
    const entries = tidy(m.entries);
    if (!entries.some(actionable)) return;
    this.sub = null;
    const modal = !!document.querySelector("dialog[open]:not([data-menu-host])");
    this.current = { ...m, entries, modal, returnFocus: document.activeElement as HTMLElement | null };
  }

  openSub(s: OpenSub) {
    this.sub = { ...s, entries: tidy(s.entries) };
  }

  closeSub() {
    this.sub = null;
  }

  close(restoreFocus = true) {
    const f = this.current?.returnFocus;
    this.current = null;
    this.sub = null;
    if (restoreFocus) f?.focus?.();
  }
}

export const menu = new MenuStore();

export const isItem = (e: MenuEntry): e is MenuItem => typeof e === "object" && "run" in e;

/** Right click, Shift+F10 or the context-menu key on the element open its menu. */
export function contextmenu(node: HTMLElement, entries: () => MenuEntries) {
  let get = entries;
  const open = (x: number, y: number) => when(get(), (list) => menu.show({ x, y, entries: list, source: node }));
  // Whatever is still loading has nothing to act on yet.
  const loading = () => !!node.closest("[inert], [aria-busy='true']");
  const onContext = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!loading()) open(e.clientX, e.clientY);
  };
  const onKey = (e: KeyboardEvent) => {
    if ((e.key === "ContextMenu" || (e.shiftKey && e.key === "F10")) && !loading()) {
      e.preventDefault();
      const target = (document.activeElement as HTMLElement | null) ?? node;
      const r = (node.contains(target) ? target : node).getBoundingClientRect();
      open(r.left + 12, r.top + Math.min(r.height, 28));
    }
  };
  node.addEventListener("contextmenu", onContext);
  node.addEventListener("keydown", onKey);
  node.dataset.menu = "";
  const unhint = addGestureHint(node, () => t.common.rightClickHint);
  return {
    update(next: () => MenuEntries) {
      get = next;
    },
    destroy() {
      unhint();
      delete node.dataset.menu;
      node.removeEventListener("contextmenu", onContext);
      node.removeEventListener("keydown", onKey);
    },
  };
}

/**
 * A small menu of its own for a piece of data (a branch name) – unless an ancestor has a menu: that one
 * opens instead and carries the same entries, so a row never loses its menu to the name inside it.
 */
interface DataMenu {
  entries: () => MenuEntry[];
  /** What tooltips over the element say about the right click. */
  hint: () => string;
}

export function dataMenu(node: HTMLElement, params: DataMenu) {
  let p = params;
  // A popover inside a row (a branch picker) is a scope of its own: the row's menu is not about its items.
  const owns = () => {
    const host = node.parentElement?.closest<HTMLElement>("[data-menu], [data-menu-scope]");
    return !host || !("menu" in host.dataset);
  };
  const onContext = (e: MouseEvent) => {
    if (!owns()) return;
    e.preventDefault();
    e.stopPropagation();
    menu.show({ x: e.clientX, y: e.clientY, entries: p.entries() });
  };
  node.addEventListener("contextmenu", onContext);
  const unhint = addGestureHint(node, () => (owns() ? p.hint() : ""));
  return {
    update(next: DataMenu) {
      p = next;
    },
    destroy() {
      unhint();
      node.removeEventListener("contextmenu", onContext);
    },
  };
}

/** Dropdown from a button: opens below it, left edges aligned; the same button closes it again. */
export function openBelow(button: HTMLElement, entries: MenuEntries, label?: string) {
  if (menu.current?.trigger === button) return menu.close();
  const r = button.getBoundingClientRect();
  when(entries, (list) => menu.show({ x: r.left, y: r.bottom + 4, anchor: r, trigger: button, entries: list, label }));
}
