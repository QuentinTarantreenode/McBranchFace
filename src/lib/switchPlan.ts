// What switching one or more repos to a branch means for each of them. Pure, so the dropdown shows
// exactly what will happen before anything runs.
import type { BranchList } from "$lib/bindings/BranchList";

/**
 * - current: already on the branch
 * - local: switch to the existing local branch
 * - remote: create the tracking branch from the server branch `ref`
 * - create: the branch does not exist here and is created
 * - elsewhere: checked out in another worktree, which git forbids to switch to
 */
export type SwitchKind = "current" | "local" | "remote" | "create" | "elsewhere";

export interface SwitchStep {
  path: string;
  kind: SwitchKind;
  /** Local name, or the remote-tracking name (`origin/feature/x`) for kind remote. */
  ref: string;
  /** Worktree that has the branch checked out, for kind elsewhere. */
  elsewhere: string | null;
}

/** `origin/feature/x` → `feature/x`. */
export const withoutRemote = (name: string) => name.slice(name.indexOf("/") + 1);

export function stepFor(path: string, name: string, list: BranchList): SwitchStep {
  const local = list.local.find((b) => b.name === name);
  if (local?.isHead) return { path, kind: "current", ref: name, elsewhere: null };
  if (local?.worktreePath) return { path, kind: "elsewhere", ref: name, elsewhere: local.worktreePath };
  if (local) return { path, kind: "local", ref: name, elsewhere: null };
  const remote = list.remote.find((b) => withoutRemote(b.name) === name);
  if (remote) return { path, kind: "remote", ref: remote.name, elsewhere: null };
  return { path, kind: "create", ref: name, elsewhere: null };
}

/** Steps that change something; current and elsewhere are shown, but never run. */
export const runnable = (s: SwitchStep) => s.kind === "local" || s.kind === "remote" || s.kind === "create";

/**
 * The other repos worth offering for the same branch: those that have it (locally or on the server),
 * plus – for a branch that is created – the repos marked in the sidebar. Marked repos come first
 * and are preselected.
 */
export function companions(
  name: string,
  here: string,
  lists: Record<string, BranchList>,
  marked: string[],
): { step: SwitchStep; preselected: boolean }[] {
  const out: { step: SwitchStep; preselected: boolean }[] = [];
  for (const [path, list] of Object.entries(lists)) {
    if (path === here) continue;
    const step = stepFor(path, name, list);
    const isMarked = marked.includes(path);
    if (step.kind === "create" && !isMarked) continue;
    out.push({ step, preselected: isMarked && runnable(step) });
  }
  return out.sort((a, b) => Number(b.preselected) - Number(a.preselected));
}

/** "partial": for several repos, the branches some of them lack. The panel filters those itself. */
export type BranchScope = "all" | "local" | "remote" | "mine" | "partial";

export interface SwitchItem {
  name: string;
  /** The server branch (`origin/x`) for an item that exists only there. */
  remote: string | null;
  current: boolean;
  ahead: number;
  behind: number;
  elsewhere: string | null;
  mine: boolean;
  create?: boolean;
}

const inScope = (i: SwitchItem, scope: BranchScope) =>
  scope === "all" || (scope === "local" ? !i.remote : scope === "remote" ? !!i.remote : i.mine);

/**
 * The dropdown list: local branches first, then those only on the server. A server branch with a
 * local counterpart is reached through the local one. Counts follow the search, so each segment says
 * what it would show. A typed name that exists nowhere is offered for creation in every scope.
 */
export function switchItems(list: BranchList, query: string, scope: BranchScope): { items: SwitchItem[]; counts: Record<BranchScope, number> } {
  const q = query.trim().toLowerCase();
  const locals = new Set(list.local.map((l) => l.name));
  const local: SwitchItem[] = list.local.map((l) => ({
    name: l.name, remote: null, current: l.isHead, ahead: l.ahead, behind: l.behind, elsewhere: l.isHead ? null : l.worktreePath, mine: l.isMine,
  }));
  const remote: SwitchItem[] = list.remote
    .filter((r) => !locals.has(withoutRemote(r.name)))
    .map((r) => ({ name: withoutRemote(r.name), remote: r.name, current: false, ahead: 0, behind: 0, elsewhere: null, mine: r.isMine }));
  const found = [...local, ...remote].filter((i) => !q || i.name.toLowerCase().includes(q));
  const counts = { all: found.length, local: 0, remote: 0, mine: 0, partial: 0 };
  for (const i of found) {
    counts[i.remote ? "remote" : "local"]++;
    if (i.mine) counts.mine++;
  }
  const items = found.filter((i) => inScope(i, scope));
  const typed = query.trim();
  const exact = local.some((i) => i.name === typed) || remote.some((i) => i.name === typed);
  if (typed && !exact) items.push({ name: typed, remote: null, current: false, ahead: 0, behind: 0, elsewhere: null, mine: false, create: true });
  return { items, counts };
}

/**
 * The branches of several repos as one list, for switching a whole group: every local branch once,
 * current only where all repos already stand on it, and nothing counted ahead, behind or elsewhere –
 * those differ per repo and show in the second step. `have` says in how many repos a name exists,
 * locally or on the server.
 */
export function mergeLists(lists: BranchList[]): { list: BranchList; have: Map<string, number> } {
  const local = new Map<string, BranchList["local"][number]>();
  const heads = new Map<string, number>();
  const remote = new Map<string, BranchList["remote"][number]>();
  const have = new Map<string, number>();
  for (const l of lists) {
    const names = new Set<string>();
    for (const b of l.local) {
      if (!local.has(b.name)) local.set(b.name, { ...b, isHead: false, ahead: 0, behind: 0, worktreePath: null });
      if (b.isHead) heads.set(b.name, (heads.get(b.name) ?? 0) + 1);
      names.add(b.name);
    }
    for (const b of l.remote) {
      if (!remote.has(b.name)) remote.set(b.name, b);
      names.add(withoutRemote(b.name));
    }
    for (const n of names) have.set(n, (have.get(n) ?? 0) + 1);
  }
  for (const [name, b] of local) b.isHead = heads.get(name) === lists.length;
  return { list: { local: [...local.values()], remote: [...remote.values()] }, have };
}
