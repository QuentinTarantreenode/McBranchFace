// The branch list of the Git perspective as data: which rows, in which order, under which heads. Pure.
import type { BranchRow } from "$lib/bindings/BranchRow";
import { groupByPrefix } from "$lib/groups";
import { withoutRemote } from "$lib/switchPlan";

export interface ListRow extends BranchRow {
  remote: boolean;
}

export type Kind = "all" | "local" | "remote";
export type UpstreamFilter = "all" | "localOnly" | "gone" | "ahead" | "behind" | "even";
export type WorktreeFilter = "all" | "with" | "without";
export type BranchGroup = "None" | "Prefix" | "Worktree" | "Upstream" | "Author";
export type BranchSort = "name" | "upstream" | "worktree" | "age";

export interface BranchFilter {
  kind: Kind;
  upstream: UpstreamFilter;
  worktree: WorktreeFilter;
  mine: boolean;
  query: string;
}

export const emptyBranchFilter = (): BranchFilter => ({ kind: "all", upstream: "all", worktree: "all", mine: false, query: "" });

/** A local branch and the server branches without a local counterpart: those are reached through the local one. */
export function listRows(local: BranchRow[], remote: BranchRow[]): ListRow[] {
  const names = new Set(local.map((b) => b.name));
  return [...local.map((b) => ({ ...b, remote: false })), ...remote.filter((r) => !names.has(withoutRemote(r.name))).map((b) => ({ ...b, remote: true }))];
}

export function upstreamOf(b: ListRow): Exclude<UpstreamFilter, "all"> | "remote" {
  if (b.remote) return "remote";
  if (b.gone) return "gone";
  if (!b.upstream) return "localOnly";
  if (b.ahead) return "ahead";
  if (b.behind) return "behind";
  return "even";
}

export function filterRows(rows: ListRow[], f: BranchFilter): ListRow[] {
  const q = f.query.trim().toLowerCase();
  return rows.filter(
    (b) =>
      (f.kind === "all" || (f.kind === "remote") === b.remote) &&
      (f.upstream === "all" || upstreamOf(b) === f.upstream) &&
      (f.worktree === "all" || (f.worktree === "with") === !!b.worktreePath) &&
      (!f.mine || b.isMine) &&
      (!q || b.name.toLowerCase().includes(q) || b.subject.toLowerCase().includes(q) || b.author.toLowerCase().includes(q)),
  );
}

/** The checked-out branch first, then by the chosen key; ties by name, so the order never jumps. */
export function sortRows(rows: ListRow[], key: BranchSort, dir: 1 | -1): ListRow[] {
  const by = (b: ListRow): string | number =>
    key === "age" ? -b.committedAt : key === "upstream" ? upstreamOf(b) : key === "worktree" ? (b.worktreePath ?? "￿") : b.name.toLowerCase();
  return [...rows].sort((a, b) => {
    if (a.isHead !== b.isHead) return a.isHead ? -1 : 1;
    const x = by(a);
    const y = by(b);
    const c = x < y ? -1 : x > y ? 1 : 0;
    return c * dir || a.name.localeCompare(b.name);
  });
}

export interface RowGroup {
  key: string;
  label: string;
  rows: ListRow[];
}

/** `label(kind, key)` words a head; the prefix groups come with their shared prefix as label. */
export function groupRows(rows: ListRow[], by: BranchGroup, label: (by: BranchGroup, key: string) => string): RowGroup[] {
  if (by === "None") return [{ key: "", label: "", rows }];
  if (by === "Prefix")
    return groupByPrefix(rows, (b) => withoutRemote(b.name)).map((g) => {
      const name = withoutRemote(g.items[0].name);
      const sep = g.label ? name.charAt(g.label.length) : "";
      return { key: g.key, label: g.label ? `${g.label}${sep === "/" || sep === "-" ? sep : ""}` : label(by, ""), rows: g.items };
    });
  const keyOf = (b: ListRow) => (by === "Worktree" ? (b.worktreePath ? "with" : "without") : by === "Upstream" ? upstreamOf(b) : b.author || "");
  const map = new Map<string, ListRow[]>();
  for (const b of rows) map.set(keyOf(b), [...(map.get(keyOf(b)) ?? []), b]);
  return [...map.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0])).map(([key, list]) => ({ key, label: label(by, key), rows: list }));
}
