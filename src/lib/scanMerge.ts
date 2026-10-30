// How the scan's answers become the loaded results, as plain functions: the lock and ignore flags always
// come from the config, a batch lands as one write, and a server answer replaces what the last one said.
import type { Config } from "./bindings/Config";
import type { OnlineScanned } from "./bindings/OnlineScanned";
import type { RepoInfo } from "./bindings/RepoInfo";
import type { RepoResult } from "./bindings/RepoResult";
import type { RepoWarning } from "./bindings/RepoWarning";
import { isIgnored, isLocked } from "./ignores";

export interface RepoEntry {
  info: RepoInfo;
  result: RepoResult | null;
}

/**
 * The result with the lock and ignore flags of the config. A scan result can have been computed before the
 * latest lock or ignore was saved, and arrive after it: the flags always come from the config. A branch
 * whose flags stay keeps its object, and so does a result where none changes.
 */
export function flagsFor(r: RepoResult, rules: Pick<Config, "locks" | "ignores">, now: number): RepoResult {
  const id = r.repo.identity;
  const flag = <B extends { name: string; locked: boolean; ignored: boolean }>(list: B[], online: boolean): B[] => {
    let changed = false;
    const out = list.map((b) => {
      const [locked, ignored] = [isLocked(rules.locks, id, b.name), isIgnored(rules.ignores, id, b.name, online, now)];
      if (locked === b.locked && ignored === b.ignored) return b;
      changed = true;
      return { ...b, locked, ignored };
    });
    return changed ? out : list;
  };
  const branches = flag(r.branches, false);
  const online = r.online && flag(r.online, true);
  return branches === r.branches && online === r.online ? r : { ...r, branches, online };
}

/**
 * The entries with a batch of fresh results in place, a repo not listed yet at the end, and the repos the
 * scan still owes an answer for. Each result passes `flag` on its way in.
 */
export function mergeBatch(
  entries: readonly RepoEntry[],
  batch: readonly RepoResult[],
  pending: ReadonlySet<string>,
  flag: (r: RepoResult) => RepoResult,
): { entries: RepoEntry[]; pending: Set<string> } {
  const next = [...entries];
  const at = new Map(next.map((r, i) => [r.info.path, i]));
  const left = new Set(pending);
  for (const fresh of batch) {
    const result = flag(fresh);
    const idx = at.get(result.repo.path);
    if (idx !== undefined) next[idx] = { info: result.repo, result };
    else at.set(result.repo.path, next.push({ info: result.repo, result }) - 1);
    left.delete(result.repo.path);
  }
  return { entries: next, pending: left };
}

/**
 * A server answer applied to a result. One warning per cause: each answer replaces what the last one said
 * (`lastAdded`) instead of piling up, and a server branch that failed like a local one is reported once.
 * The branches change only with an answer that did not fail; they pass `flag`. `added`: what this answer said.
 */
export function mergeOnlineWarnings(
  r: RepoResult,
  e: OnlineScanned,
  lastAdded: readonly RepoWarning[],
  flag: (r: RepoResult) => RepoResult,
): { result: RepoResult; added: RepoWarning[] } {
  const key = (w: RepoWarning) => JSON.stringify(w);
  const last = new Set(lastAdded.map(key));
  const kept = r.warnings.filter((w) => w.code !== "OnlineFailed" && !last.has(key(w)));
  const seen = new Set(kept.map(key));
  const added = (e.error ? [{ code: "OnlineFailed", p: { detail: e.error } } as RepoWarning] : e.warnings).filter((w) => !seen.has(key(w)) && !!seen.add(key(w)));
  const warned = { ...r, warnings: [...kept, ...added] };
  const result = e.error ? warned : flag({ ...warned, online: e.branches, onlineAt: e.at, onlineFetched: e.fetched });
  return { result, added };
}
