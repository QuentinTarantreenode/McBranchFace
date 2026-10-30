// Which groups of which list are folded. One place for every list, saved with the layout, so a group
// the user folded stays folded after a restart and every list folds the same way.
import type { UiPrefs } from "$lib/bindings/UiPrefs";
import { settings } from "./settings.svelte";

/** Lists whose folds predate the shared map keep their own field; the rest share `collapsed`. */
const OWN_FIELD = {
  roots: "collapsedRoots",
  repoGroups: "collapsedRepoGroups",
  tableGroups: "collapsedGroups",
} as const satisfies Record<string, keyof UiPrefs>;

const SHARED = ["changesFolders", "changesRepos", "changesStatus", "changesDirs", "changesClean", "tableSections", "worktrees", "worktreeGroups", "gitBranchGroups"] as const;

export type FoldScope = keyof typeof OWN_FIELD | (typeof SHARED)[number];

function foldedList(scope: FoldScope): string[] {
  const ui = settings.config?.ui;
  if (!ui) return [];
  const own = OWN_FIELD[scope as keyof typeof OWN_FIELD];
  return own ? ui[own] : (ui.collapsed?.[scope] ?? []);
}

/** The folded ids of one list as a set, built once per change of that list: every row asks. */
class FoldedSet {
  readonly ids: ReadonlySet<string>;
  constructor(scope: FoldScope) {
    this.ids = $derived(new Set(foldedList(scope)));
  }
}

class Fold {
  private sets = Object.fromEntries([...Object.keys(OWN_FIELD), ...SHARED].map((s) => [s, new FoldedSet(s as FoldScope)])) as Record<FoldScope, FoldedSet>;

  folded(scope: FoldScope): string[] {
    return foldedList(scope);
  }

  /** The folded ids of a list, for lookups in loops. */
  foldedSet(scope: FoldScope): ReadonlySet<string> {
    return this.sets[scope].ids;
  }

  isOpen(scope: FoldScope, id: string) {
    return !this.foldedSet(scope).has(id);
  }

  private write(scope: FoldScope, list: string[]) {
    const own = OWN_FIELD[scope as keyof typeof OWN_FIELD];
    if (own) return settings.setUi({ [own]: list });
    const all = { ...(settings.config?.ui.collapsed ?? {}) };
    if (list.length) all[scope] = list;
    else delete all[scope];
    settings.setUi({ collapsed: all });
  }

  toggle(scope: FoldScope, id: string) {
    this.set(scope, id, !this.isOpen(scope, id));
  }

  set(scope: FoldScope, id: string, open: boolean) {
    if (open === this.isOpen(scope, id)) return;
    const list = this.folded(scope);
    this.write(scope, open ? list.filter((x) => x !== id) : [...list, id]);
  }

  /** Folds or unfolds the given groups of a list at once; groups of the list not named keep their state. */
  setAll(scope: FoldScope, ids: string[], open: boolean) {
    const list = this.folded(scope);
    const named = new Set(ids);
    const next = open ? list.filter((x) => !named.has(x)) : [...new Set([...list, ...ids])];
    if (next.length !== list.length || next.some((x, i) => x !== list[i])) this.write(scope, next);
  }

  /** Forgets the folds of groups that no longer exist, so the list does not grow with every group ever folded. */
  prune(scope: FoldScope, exists: (id: string) => boolean) {
    const list = this.folded(scope);
    const next = list.filter(exists);
    if (next.length !== list.length) this.write(scope, next);
  }
}

export const fold = new Fold();
