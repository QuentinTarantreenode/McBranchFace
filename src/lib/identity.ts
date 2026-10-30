import type { BranchReport } from "./bindings/BranchReport";
import type { RemoteBranchReport } from "./bindings/RemoteBranchReport";
import type { RepoInfo } from "./bindings/RepoInfo";
import type { RepoResult } from "./bindings/RepoResult";

const PALETTE = 8;

/** Several working copies of one repository: which paths belong together, and their colour. */
export interface CopyGroup {
  identity: string;
  paths: string[];
  /** CSS colour variable; only groups with more than one copy get one. */
  color: string;
  /** Short name per path that tells the copies apart, e.g. the folder they live in. */
  labels: Record<string, string>;
}

const segments = (p: string) => p.replace(/\\/g, "/").replace(/\/+$/, "").split("/");

/**
 * What tells the copies apart: a copy's own folder name where no other copy has the same one,
 * otherwise the nearest parent folders that differ among the copies sharing that name (two clones
 * called "core" below "feature1" and "feature2", next to a "core-agent-1").
 */
export function copyLabels(paths: string[]): Record<string, string> {
  const segs = paths.map(segments);
  const own = segs.map((s) => s[s.length - 1]);
  const labels = [...own];
  for (const name of new Set(own)) {
    const idx = own.flatMap((o, i) => (o === name ? [i] : []));
    if (idx.length < 2) continue;
    const max = Math.max(...idx.map((i) => segs[i].length));
    let found = false;
    for (let depth = 1; depth < max && !found; depth++) {
      const names = idx.map((i) => segs[i].slice(Math.max(0, segs[i].length - 1 - depth), segs[i].length - 1).join("/"));
      if (new Set(names).size === names.length) {
        idx.forEach((i, k) => (labels[i] = names[k]));
        found = true;
      }
    }
    if (!found) idx.forEach((i) => (labels[i] = paths[i]));
  }
  // A parent label may equal another copy's own name; then only full paths are unambiguous.
  if (new Set(labels).size !== labels.length) return Object.fromEntries(paths.map((p) => [p, p]));
  return Object.fromEntries(paths.map((p, i) => [p, labels[i]]));
}

/** Colours are handed out in identity order, so up to eight groups never share one. */
export function copyGroups(repos: Pick<RepoInfo, "path" | "identity">[]): Map<string, CopyGroup> {
  const byId = new Map<string, string[]>();
  for (const r of repos) {
    if (!r.identity) continue;
    const list = byId.get(r.identity) ?? [];
    list.push(r.path);
    byId.set(r.identity, list);
  }
  const multi = [...byId.entries()].filter(([, p]) => p.length > 1).sort(([a], [b]) => a.localeCompare(b));
  return new Map(
    multi.map(([identity, paths], i) => {
      const sorted = [...paths].sort();
      return [identity, { identity, paths: sorted, color: `var(--id-${i % PALETTE})`, labels: copyLabels(sorted) }];
    }),
  );
}

export interface LocalCopy {
  repoPath: string;
  branch: string;
  ahead: number;
  behind: number;
  gone: boolean;
  checkedOut: boolean;
}

type Tracked = Pick<RepoResult, "repo" | "tracking">;
const copyKey = (identity: string, remote: string, branch: string) => `${identity}|${remote}|${branch}`;
// Built once per result list: every row of the server list asks, and walking every repo's tracking
// for each of them grew with rows times repos. A new scan result means a new list.
const copyIndex = new WeakMap<readonly Tracked[], Map<string, LocalCopy[]>>();

function indexOf(results: readonly Tracked[]): Map<string, LocalCopy[]> {
  let index = copyIndex.get(results);
  if (index) return index;
  index = new Map();
  for (const r of results) {
    for (const t of r.tracking) {
      const key = copyKey(r.repo.identity, t.remote, t.remoteBranch);
      const copy = { repoPath: r.repo.path, branch: t.branch, ahead: t.ahead, behind: t.behind, gone: t.gone, checkedOut: t.checkedOut };
      const list = index.get(key);
      if (list) list.push(copy);
      else index.set(key, [copy]);
    }
  }
  copyIndex.set(results, index);
  return index;
}

/** Local branches (in any working copy of the same repository) that track a server branch. Shared: read only. */
export function localCopies(remote: RemoteBranchReport, results: readonly Tracked[], identity: string): LocalCopy[] {
  return indexOf(results).get(copyKey(identity, remote.remote, remote.name)) ?? [];
}

/** Other working copies in which the same local branch is gone as well. */
export function siblingGone(b: BranchReport, all: BranchReport[], identityOf: (path: string) => string | undefined): string[] {
  const id = identityOf(b.repoPath);
  if (!id || b.upstreamState !== "Gone") return [];
  return all
    .filter((o) => o.name === b.name && o.repoPath !== b.repoPath && o.upstreamState === "Gone" && identityOf(o.repoPath) === id)
    .map((o) => o.repoPath);
}
