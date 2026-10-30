// Selecting from a menu: the repos of a folder or a group, alone, added or taken out. All and none live
// on the section head and on Ctrl+A and Esc; a menu offers only what applies to this group right now.
import { FoldVertical, ListChecks, ListMinus, ListPlus, UnfoldVertical } from "@lucide/svelte";
import { t } from "$lib/i18n/index.svelte";
import { sidebarSelection } from "$lib/stores/sidebarSelection.svelte";
import type { MenuEntry, MenuItem } from "$lib/ui/menu.svelte";

export function selectEntries(paths: string[]): MenuEntry[] {
  if (!paths.length) return [];
  const chosen = paths.filter((p) => sidebarSelection.has(p)).length;
  const others = sidebarSelection.items.length > chosen;
  return [
    { group: t.select.group },
    ...(chosen < paths.length || others ? [{ label: t.select.these(paths.length), icon: ListChecks, run: () => sidebarSelection.apply({ kind: "set", ids: paths, mode: "only" }) }] : []),
    ...(others && chosen < paths.length ? [{ label: t.select.add, icon: ListPlus, keys: "Ctrl+Klick", run: () => sidebarSelection.apply({ kind: "set", ids: paths, mode: "add" }) }] : []),
    ...(chosen ? [{ label: t.select.remove, icon: ListMinus, run: () => sidebarSelection.apply({ kind: "set", ids: paths, mode: "remove" }) }] : []),
  ];
}

/** Folding all groups of a list: one entry that says what it will do now. */
export function foldEntry(anyOpen: boolean, run: (open: boolean) => void, labels: { fold: string; unfold: string }): MenuItem {
  return anyOpen ? { label: labels.fold, icon: FoldVertical, keys: "Alt+←", run: () => run(false) } : { label: labels.unfold, icon: UnfoldVertical, keys: "Alt+→", run: () => run(true) };
}
