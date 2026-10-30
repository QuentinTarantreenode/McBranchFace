import type { ChangeType } from "$lib/bindings/ChangeType";
import type { DiffSource } from "$lib/bindings/DiffSource";
import type { StatusEntry } from "$lib/bindings/StatusEntry";

export interface ChangeRow {
  path: string;
  origPath: string | null;
  source: DiffSource;
  change: ChangeType | "Untracked" | "Conflict";
}

export type GroupId = "conflicts" | "staged" | "unstaged" | "untracked";

export interface ChangeGroup {
  id: GroupId;
  rows: ChangeRow[];
}

/** One entry can appear twice (staged part and unstaged part), exactly as git sees it. */
export function groupChanges(entries: StatusEntry[], filter = ""): ChangeGroup[] {
  const q = filter.trim().toLowerCase();
  const g: Record<GroupId, ChangeRow[]> = { conflicts: [], staged: [], unstaged: [], untracked: [] };
  for (const e of entries) {
    if (q && !e.path.toLowerCase().includes(q)) continue;
    if (e.conflicted) g.conflicts.push({ path: e.path, origPath: null, source: "Conflict", change: "Conflict" });
    else if (e.untracked) g.untracked.push({ path: e.path, origPath: null, source: "Untracked", change: "Untracked" });
    else {
      if (e.staged) g.staged.push({ path: e.path, origPath: e.origPath, source: "Staged", change: e.staged });
      if (e.unstaged) g.unstaged.push({ path: e.path, origPath: e.origPath, source: "Unstaged", change: e.unstaged });
    }
  }
  const byPath = (a: ChangeRow, b: ChangeRow) => a.path.localeCompare(b.path);
  const order: GroupId[] = ["conflicts", "staged", "unstaged", "untracked"];
  return order.map((id) => ({ id, rows: g[id].sort(byPath) })).filter((x) => x.rows.length > 0);
}

/** The files of a group under the directory they sit in, files at the top level first. */
export function byDirectory(rows: ChangeRow[]): { dir: string; rows: ChangeRow[] }[] {
  const map = new Map<string, ChangeRow[]>();
  for (const r of rows) {
    const dir = splitPath(r.path).dir;
    const list = map.get(dir);
    if (list) list.push(r);
    else map.set(dir, [r]);
  }
  return [...map.entries()].sort(([a], [b]) => (a === "" ? -1 : b === "" ? 1 : a.localeCompare(b))).map(([dir, rows]) => ({ dir, rows }));
}

/** Paths with a staged and an unstaged part: they show in both groups, and say so. */
export function partlyStaged(entries: StatusEntry[]): Set<string> {
  return new Set(entries.filter((e) => e.staged && e.unstaged && !e.conflicted).map((e) => e.path));
}

/** Letter and colour of a change; the wording is in the dictionaries (git.change). */
export const CHANGE_META: Record<ChangeRow["change"], { short: string; tone: string }> = {
  Added: { short: "A", tone: "text-safe" },
  Modified: { short: "M", tone: "text-review" },
  Deleted: { short: "D", tone: "text-unsafe" },
  Renamed: { short: "R", tone: "text-blocked" },
  Copied: { short: "C", tone: "text-blocked" },
  TypeChanged: { short: "T", tone: "text-review" },
  Untracked: { short: "U", tone: "text-faint" },
  Conflict: { short: "!", tone: "text-unsafe" },
};

export function splitPath(path: string) {
  const i = path.lastIndexOf("/");
  return i < 0 ? { dir: "", name: path } : { dir: path.slice(0, i + 1), name: path.slice(i + 1) };
}

/** Small least-recently-used cache for results that never change (commit details, commit diffs). */
export class Lru<V> {
  private map = new Map<string, V>();
  constructor(private readonly size: number) {}

  get(key: string): V | undefined {
    const v = this.map.get(key);
    if (v !== undefined) {
      this.map.delete(key);
      this.map.set(key, v);
    }
    return v;
  }

  set(key: string, value: V) {
    this.map.delete(key);
    this.map.set(key, value);
    if (this.map.size > this.size) this.map.delete(this.map.keys().next().value!);
  }

  clear() {
    this.map.clear();
  }
}
