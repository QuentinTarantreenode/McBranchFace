/** Edits of the user's repo groups (`config.repoGroups`) and what an action on a group would touch. Pure. */
import type { RepoGroup } from "./bindings/RepoGroup";
import type { RepoStatus } from "./bindings/RepoStatus";
import { sameFolder } from "./roots";

export const newGroupId = () => `g${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/** "Gruppe 3": the first number no group of that pattern uses yet. */
export function nextGroupName(groups: RepoGroup[], base: (n: number) => string): string {
  const taken = new Set(groups.map((g) => g.name));
  let n = groups.length + 1;
  while (taken.has(base(n))) n++;
  return base(n);
}

const has = (g: RepoGroup, path: string) => g.paths.some((p) => sameFolder(p, path));

export const withGroup = (groups: RepoGroup[], group: RepoGroup): RepoGroup[] => [...groups, { ...group, paths: unique(group.paths) }];

function unique(paths: string[]): string[] {
  const out: string[] = [];
  for (const p of paths) if (!out.some((o) => sameFolder(o, p))) out.push(p);
  return out;
}

/** The paths join the group at its end; those already in it stay where they are. */
export const withAdded = (groups: RepoGroup[], id: string, paths: string[]): RepoGroup[] =>
  groups.map((g) => (g.id === id ? { ...g, paths: unique([...g.paths, ...paths]) } : g));

export const withRemoved = (groups: RepoGroup[], id: string, paths: string[]): RepoGroup[] =>
  groups.map((g) => (g.id === id ? { ...g, paths: g.paths.filter((p) => !paths.some((x) => sameFolder(x, p))) } : g));

export const withRenamed = (groups: RepoGroup[], id: string, name: string): RepoGroup[] =>
  groups.map((g) => (g.id === id ? { ...g, name: name.trim() || g.name } : g));

export const withoutGroup = (groups: RepoGroup[], id: string): RepoGroup[] => groups.filter((g) => g.id !== id);

/** `id` moved to the place of `over`, before or after it; unknown ids leave the list as it is. */
export function withMoved(groups: RepoGroup[], id: string, over: string, after: boolean): RepoGroup[] {
  const from = groups.findIndex((g) => g.id === id);
  if (from < 0 || id === over || !groups.some((g) => g.id === over)) return groups;
  const rest = groups.filter((_, i) => i !== from);
  const at = rest.findIndex((g) => g.id === over) + (after ? 1 : 0);
  return [...rest.slice(0, at), groups[from], ...rest.slice(at)];
}

/** Paths of the drop that are new to the group: the count the drop reports, and nothing when all are in. */
export const newTo = (group: RepoGroup, paths: string[]) => unique(paths).filter((p) => !has(group, p));

export interface RemoteTargets {
  /** Every reachable working copy. */
  fetch: string[];
  /** On a branch with an upstream. */
  pull: { path: string; branch: string }[];
  /** On a branch with commits the server lacks, or with no upstream yet (the first push sets it). */
  push: { path: string; branch: string }[];
  /** Working copies left out, with why. */
  skipped: { path: string; why: "missing" | "detached" }[];
}

/**
 * What Fetch, Pull and Push would do in each working copy of the group, from the last known status.
 * A path without status is not reachable (removed, or its root is gone).
 */
export function remoteTargets(paths: string[], statuses: Record<string, RepoStatus | undefined>): RemoteTargets {
  const out: RemoteTargets = { fetch: [], pull: [], push: [], skipped: [] };
  for (const path of paths) {
    const st = statuses[path];
    if (!st) {
      out.skipped.push({ path, why: "missing" });
      continue;
    }
    out.fetch.push(path);
    const branch = st.head.branch;
    if (!branch) {
      out.skipped.push({ path, why: "detached" });
      continue;
    }
    if (st.head.upstream) out.pull.push({ path, branch });
    if (!st.head.upstream || st.head.ahead > 0) out.push.push({ path, branch });
  }
  return out;
}
