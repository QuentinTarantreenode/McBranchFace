// What a repo dropped on a repo group does. Shared by the cards of the folder list and the rows of the
// groups, so both drag the same thing.
import { t } from "$lib/i18n/index.svelte";
import { newGroupId, newTo, nextGroupName, withAdded, withGroup, withRemoved } from "$lib/repoGroups";
import type { DragOptions } from "$lib/ui/dragTo.svelte";
import { repoName } from "$lib/filter";
import { toasts } from "$lib/stores/toasts.svelte";
import { settings } from "$lib/stores/settings.svelte";
import { repoSelection } from "$lib/stores/repoSelection.svelte";
import { repoActions } from "$lib/services/repoActions.svelte";

export interface RepoDrag {
  paths: string[];
  /** The group the rows were taken from; null for cards of the folder list. */
  from: string | null;
}

const GROUP_TARGET = "group:";
/** The drop target of a repo group; the others are `new` (the zone that makes a group) and `out` (the folder list, away from a group). */
export const groupTarget = (id: string) => GROUP_TARGET + id;
/** The repo group a drop target stands for, or null for the other targets. */
export const targetGroup = (target: string | null | undefined) => (target?.startsWith(GROUP_TARGET) ? target.slice(GROUP_TARGET.length) : null);

export const groupUi = $state({
  editing: null as string | null,
  /** The branch panel for several repos at once: a repo group or a folder of the sidebar. */
  switching: null as { group: { name: string; paths: string[] }; mode: SwitchMode; trigger: HTMLElement } | null,
});

/** Switch all to one branch, create a new one in all, or take a branch some of them have over to the rest. */
export type SwitchMode = "switch" | "create" | "adopt";

export function openSwitch(group: { name: string; paths: string[] }, mode: SwitchMode, trigger: HTMLElement | null) {
  if (trigger && group.paths.length) groupUi.switching = { group, mode, trigger };
}

export function dropRepos(d: RepoDrag, target: string, shift: boolean) {
  const groups = settings.config?.repoGroups ?? [];
  if (target === "new") {
    const id = newGroupId();
    const name = nextGroupName(groups, t.repoGroups.defaultName);
    groupUi.editing = id;
    const rest = shift && d.from ? withRemoved(groups, d.from, d.paths) : groups;
    return repoActions.setRepoGroups(withGroup(rest, { id, name, paths: d.paths }), t.repoGroups.created(name));
  }
  if (target === "out") {
    const from = groups.find((g) => g.id === d.from);
    if (!from) return;
    return repoActions.setRepoGroups(withRemoved(groups, from.id, d.paths), t.repoGroups.takenOut(d.paths.length, from.name));
  }
  const id = targetGroup(target);
  const to = groups.find((g) => g.id === id);
  if (!to || id === d.from) return;
  const fresh = newTo(to, d.paths);
  if (!fresh.length) return toasts.toast("info", t.repoGroups.alreadyIn(to.name));
  const move = shift && !!d.from;
  const added = withAdded(groups, to.id, fresh);
  const next = move && d.from ? withRemoved(added, d.from, d.paths) : added;
  return repoActions.setRepoGroups(next, move ? t.repoGroups.moved(fresh.length, to.name) : t.repoGroups.added(fresh.length, to.name));
}

/**
 * Drag options for a repo: the marked repos come along when it is one of them (Ctrl+click marks),
 * otherwise it goes alone.
 */
export function repoDragOptions(path: string, from: string | null, others: () => string[] = () => repoSelection.repos): DragOptions<RepoDrag> {
  const paths = () => {
    const marked = others();
    return marked.length > 1 && marked.includes(path) ? marked : [path];
  };
  return {
    payload: () => ({ paths: paths(), from }),
    label: () => (paths().length > 1 ? t.repoGroups.dragging(paths().length) : repoName(path)),
    ondrop: (d, target, shift) => void dropRepos(d, target, shift),
    skip: "[aria-haspopup], [role=dialog], input",
  };
}
