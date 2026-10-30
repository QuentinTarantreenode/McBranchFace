import type { UpstreamState } from "./bindings/UpstreamState";
import { goneCount } from "./filter";
import type { TableGroup } from "./bindings/TableGroup";
import { folderKey, rootRank } from "./roots";

/** Last two segments of a folder path: enough to tell roots apart, short enough for a header. */
export const folderLabel = (path: string) =>
  path
    .replace(/[\\/]+$/, "")
    .split(/[\\/]/)
    .slice(-2)
    .join("/");

export interface RepoLike {
  info: { path: string; name: string; root: string };
  result: { branches: { locked: boolean; ignored?: boolean; verdict: string; upstreamState: UpstreamState }[] } | null;
}

export interface SidebarGroup<R> {
  root: string;
  label: string;
  repos: R[];
  total: number;
  gone: number;
  unsafe: number;
  open: boolean;
}

/** The key of the group of repos without a root: fixed, so its fold state survives a language switch. */
export const NO_ROOT = "";

/**
 * Repos by root folder, in the order of `roots`. A search opens every group with a hit and counts
 * "k of n"; without a search, folded groups stay folded and a root without repos shows as an empty
 * group, so it can still be removed. Repos without a root go to `NO_ROOT`, labelled `other`, last.
 */
export function sidebarGroups<R extends RepoLike>(repos: R[], query: string, collapsed: ReadonlySet<string>, other: string, roots: string[] = []): SidebarGroup<R>[] {
  const q = query.trim().toLowerCase();
  const byRoot = new Map<string, R[]>();
  for (const r of repos) {
    const k = r.info.root || NO_ROOT;
    if (!byRoot.has(k)) byRoot.set(k, []);
    byRoot.get(k)!.push(r);
  }
  const seen = new Set([...byRoot.keys()].map(folderKey));
  if (!q) for (const r of roots) if (!seen.has(folderKey(r))) byRoot.set(r, []);
  const out: SidebarGroup<R>[] = [];
  for (const [root, all] of byRoot) {
    const shown = q ? all.filter((r) => r.info.name.toLowerCase().includes(q) || r.info.path.toLowerCase().includes(q)) : all;
    if (!shown.length && q) continue;
    const { gone, unsafe } = goneCount(shown.flatMap((r) => r.result?.branches ?? []));
    out.push({
      root,
      label: root === NO_ROOT ? other : folderLabel(root),
      repos: shown,
      total: all.length,
      gone,
      unsafe,
      open: !!q || !collapsed.has(root),
    });
  }
  const rank = (g: SidebarGroup<R>) => (g.root === NO_ROOT ? Infinity : rootRank(roots, g.root));
  return out.sort((a, b) => rank(a) - rank(b));
}

export interface Grouped<T> {
  key: string;
  label: string;
  items: T[];
  open: boolean;
}

/**
 * Table rows by folder or repo, in order of first appearance, so the sort within a group is the
 * table's sort. `None` gives one open group without a header.
 */
export function groupRows<T>(list: T[], by: TableGroup, keyOf: (t: T, by: TableGroup) => string, labelOf: (key: string, by: TableGroup) => string, collapsed: ReadonlySet<string>): Grouped<T>[] {
  if (by === "None") return [{ key: "", label: "", items: list, open: true }];
  const m = new Map<string, T[]>();
  for (const t of list) {
    const k = keyOf(t, by);
    if (!m.has(k)) m.set(k, []);
    m.get(k)!.push(t);
  }
  return [...m.entries()].map(([key, items]) => ({ key, label: labelOf(key, by), items, open: !collapsed.has(groupId(by, key)) }));
}

export const groupId = (by: TableGroup, key: string) => `${by}:${key}`;

/** Group key of the branch names only one repo has; git allows no space in a branch name, so none clashes. */
export const SINGLE_NAMES = " single";

export interface BorrowedWorktree<R> {
  owner: R;
  path: string;
  branch: string | null;
  head: string | null;
  unreferenced: number;
}

/**
 * Linked worktrees that lie below `root` while their repo lies below another root. The repo is listed
 * once, under its own folder; without this, a folder of such worktrees would look empty.
 */
export function borrowedWorktrees<R extends RepoLike>(
  root: string,
  repos: R[],
  worktreesOf: (repo: R) => { path: string; branch: string | null; head: string | null; isMain: boolean; foreign: boolean; unreferenced: number }[],
): BorrowedWorktree<R>[] {
  const inside = (p: string) => (folderKey(p) + "/").startsWith(folderKey(root) + "/");
  return repos
    .filter((r) => !inside(r.info.path))
    .flatMap((owner) =>
      worktreesOf(owner)
        .filter((w) => !w.isMain && !w.foreign && inside(w.path))
        .map((w) => ({ owner, path: w.path, branch: w.branch, head: w.head, unreferenced: w.unreferenced })),
    )
    .sort((a, b) => a.path.localeCompare(b.path));
}

/** A generated part of a name (an agent's hash, a number): where a shared prefix ends. */
const generated = (token: string) => /^[0-9a-f]{6,}$/i.test(token) || /^a?[0-9a-f]{8,}$/i.test(token) || /^\d+$/.test(token);

/** The first word of a branch name: before the first "/", else before the first "-". */
export function prefixOf(name: string | null): string {
  if (!name) return "";
  const slash = name.indexOf("/");
  return slash > 0 ? name.slice(0, slash) : name.split("-")[0];
}

/**
 * Many worktrees of one repo, grouped by the first word of their branch: agents' worktrees together,
 * one feature's together. The label is what the members share ("worktree-agent", "r2"); a word only one
 * worktree has goes into a last group of the rest. Largest groups first.
 */
export function groupByPrefix<T>(list: T[], nameOf: (t: T) => string | null): { key: string; label: string; items: T[] }[] {
  const map = new Map<string, T[]>();
  for (const t of list) {
    const k = prefixOf(nameOf(t));
    map.set(k, [...(map.get(k) ?? []), t]);
  }
  const shared = (items: T[]) => {
    const parts = items.map((t) => (nameOf(t) ?? "").split(/[-/]/));
    const out: string[] = [];
    for (let i = 0; i < parts[0].length; i++) {
      const w = parts[0][i];
      if (generated(w) || !parts.every((p) => p[i] === w) || parts.some((p) => p.length <= i + 1)) break;
      out.push(w);
    }
    return out.join("-") || prefixOf(nameOf(items[0]));
  };
  const groups = [...map.entries()].filter(([k, items]) => k && items.length > 1).map(([key, items]) => ({ key, label: shared(items), items }));
  groups.sort((a, b) => b.items.length - a.items.length || a.label.localeCompare(b.label));
  const rest = [...map.entries()].filter(([k, items]) => !k || items.length === 1).flatMap(([, items]) => items);
  return rest.length ? [...groups, { key: "", label: "", items: rest }] : groups;
}
