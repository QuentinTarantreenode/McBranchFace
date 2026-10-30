// What is selected in the sidebar: repos, worktrees and group members by their exact path. The filters of
// the table follow from it (the owning repos); a selection set elsewhere (a group head, "All") shows here
// as the repos it names, so there is one truth and no second list to keep in step.
import { emptySelection, nextSelection, type SelectAction, type Selection } from "$lib/selection";
import { folderKey, sameFolder } from "$lib/roots";
import { timers, type TimerHandle } from "$lib/timers";
import { gitStatus } from "./gitStatus.svelte";
import { settings } from "./settings.svelte";
import { repoSelection } from "./repoSelection.svelte";

/**
 * Arrow keys held down repeat every 30 ms or so: the filter, and with it the table and the Git view, follows
 * once they rest this long, while the highlight follows every step.
 */
const SETTLE_MS = 150;

const sameSet = (a: string[], b: string[]) => {
  if (a.length !== b.length) return false;
  const keys = new Set(b.map(folderKey));
  return a.every((x) => keys.has(folderKey(x)));
};

class SidebarSelection {
  private own = $state<Selection>(emptySelection);
  /** A selection made by the arrow keys whose filter is not written yet: it is the truth until then. */
  private settling = $state(false);
  private settleTimer: TimerHandle | undefined;
  /** The container whose `[data-sel-path]` rows give the order, as shown. */
  root: HTMLElement | null = null;

  resetForTests() {
    timers.cancel(this.settleTimer);
    this.own = emptySelection;
    this.settling = false;
  }

  private get gitMode() {
    return settings.config?.ui.perspective === "Git";
  }

  /**
   * The exact paths selected: our own list while the filter still matches it, else what the filter names.
   * Worked out once per change: every row asks, and a large selection asked per row was quadratic.
   */
  readonly items: string[] = $derived.by(() => {
    if (this.settling) return this.own.items;
    const owners = [...new Set(this.own.items.map((p) => gitStatus.ownerOf(p)))];
    if (this.own.items.length && sameSet(owners, repoSelection.repos)) return this.own.items;
    return repoSelection.repos;
  });
  private chosen = $derived(new Set(this.items.map(folderKey)));

  get focus(): string | null {
    if (this.settling) return this.own.focus;
    return this.gitMode ? repoSelection.gitRepo : repoSelection.focusRepo;
  }

  // Git selects several repos too (the changes of all of them, a group's branches); the one in front is
  // the repo Git has open, and with nothing selected that one alone counts as selected.
  has(path: string) {
    if (this.gitMode && !this.items.length) return !!repoSelection.gitRepo && sameFolder(repoSelection.gitRepo, path);
    return this.chosen.has(folderKey(path));
  }

  /** The one in front of several: Git's open repo, else the last one clicked. */
  isFront(path: string) {
    const f = this.focus;
    return this.items.length > 1 && !!f && sameFolder(f, path);
  }

  /** The selectable rows as shown, folded groups left out, each path once. */
  order(): string[] {
    const rows = this.root ? [...this.root.querySelectorAll<HTMLElement>("[data-sel-path]")] : [];
    return [...new Set(rows.map((r) => r.dataset.selPath!))];
  }

  apply(action: SelectAction) {
    timers.cancel(this.settleTimer);
    const next = this.next(action);
    this.settling = false;
    this.write(next);
    if (next.focus) this.reveal(next.focus);
  }

  /** The arrow keys: the highlight moves at once, the filter once the keys rest (see SETTLE_MS). */
  step(action: SelectAction) {
    const next = this.next(action);
    this.own = next;
    this.settling = true;
    timers.cancel(this.settleTimer);
    this.settleTimer = timers.after(SETTLE_MS, () => {
      this.settling = false;
      this.write(next);
    });
  }

  private next(action: SelectAction): Selection {
    const current: Selection = { items: this.items, anchor: this.own.anchor, focus: this.focus };
    const next = nextSelection(current, action, this.order());
    // In Git one repo is always open: a click never leaves nothing, and "none" keeps the open one.
    if (this.gitMode && !next.items.length) {
      const keep = action.kind === "click" ? action.id : repoSelection.gitRepo;
      return keep ? { items: [keep], anchor: keep, focus: keep } : next;
    }
    return next;
  }

  private write(next: Selection) {
    this.own = next;
    repoSelection.repos = [...new Set(next.items.map((p) => gitStatus.ownerOf(p)))];
    repoSelection.focusRepo = next.focus;
    if (this.gitMode && next.focus) repoSelection.gitRepo = next.focus;
  }

  /** Mouse: the modifiers decide. */
  click(path: string, e: MouseEvent | KeyboardEvent) {
    this.apply({ kind: "click", id: path, ctrl: e.ctrlKey || e.metaKey, shift: e.shiftKey });
  }

  /** Keyboard focus follows the selection's front row. */
  private reveal(path: string) {
    const row = this.root?.querySelector<HTMLElement>(`[data-sel-path="${CSS.escape(path)}"]`);
    if (row && this.root?.contains(document.activeElement)) row.focus({ preventScroll: false });
  }
}

export const sidebarSelection = new SidebarSelection();
