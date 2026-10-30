// What the rows of the sidebar's folder list share: how a click selects, which clicks belong to a
// control inside the row, and which worktree has its branch switcher open.
import { sidebarSelection } from "$lib/stores/sidebarSelection.svelte";

// As in a file manager: a click selects one (again: none), Ctrl adds or removes, Shift spans from the
// last click. Repos, worktrees and group members alike; Git opens the one in front.
export function selectCopy(path: string, e: MouseEvent) {
  // The second click of a double click opens the folder; it must not undo the selection.
  if (e.detail >= 2) return;
  sidebarSelection.click(path, e);
}

/** A click on a row selects it, unless it went to a button or a window inside the row. */
export function rowClick(path: string, e: MouseEvent) {
  if (!(e.target as HTMLElement).closest("button, [role=dialog]")) selectCopy(path, e);
}

// Double clicks on the branch dropdown or its window belong to them, not to the folder.
export const isControl = (e: MouseEvent) => !!(e.target as HTMLElement).closest("[aria-haspopup], [role=dialog]");

// Menus load on first open; the list does not need them to show.
export const copyMenuOf = (path: string, switchBranch?: () => void) => import("./copyMenu").then((m) => m.copyMenu(path, { switchBranch }));

/** The worktree whose branch switcher is open, opened from its context menu: one at a time. */
export const worktreeSwitch = $state({ path: null as string | null });
