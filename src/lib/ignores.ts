import type { Ignore } from "./bindings/Ignore";
import type { IgnoreScope } from "./bindings/IgnoreScope";
import type { Lock } from "./bindings/Lock";

const side = (online: boolean): IgnoreScope => (online ? "Online" : "Local");
const live = (i: Ignore, now: number) => i.until === null || i.until > now;

/**
 * Same rule as the backend (Config::is_locked): a lock without a branch holds the whole repository. Branch
 * names compare without case: a server may treat two spellings as one branch, and a lock that missed one
 * would let it into a delete.
 */
export function isLocked(locks: Lock[], identity: string, branch: string | null): boolean {
  const name = branch?.toLowerCase();
  return locks.some((l) => l.identity === identity && (l.branch === null || l.branch.toLowerCase() === name));
}

/** Same rule as the backend (Config::is_ignored). */
export function isIgnored(ignores: Ignore[], identity: string, branch: string, online: boolean, now: number): boolean {
  return ignores.some(
    (i) => i.identity === identity && i.branch === branch && (i.scope === "Both" || i.scope === side(online)) && live(i, now),
  );
}

/**
 * Ignoring a branch on one side while the other side is still ignored widens the entry to both,
 * so ignoring the online copy never silently ends the ignore of the local one.
 */
export function withIgnore(ignores: Ignore[], identity: string, branch: string, online: boolean, until: number | null, now: number): Ignore[] {
  const same = (i: Ignore) => i.identity === identity && i.branch === branch;
  const old = ignores.find(same);
  const scope: IgnoreScope = old && live(old, now) && old.scope !== side(online) ? "Both" : side(online);
  return [...ignores.filter((i) => !same(i)), { identity, branch, scope, until }];
}

/** Ends the ignore on one side only; an entry for both sides keeps the other one. */
export function withoutIgnore(ignores: Ignore[], identity: string, branch: string, online: boolean): Ignore[] {
  return ignores.flatMap((i) => {
    if (i.identity !== identity || i.branch !== branch) return [i];
    if (i.scope === "Both") return [{ ...i, scope: side(!online) }];
    return i.scope === side(online) ? [] : [i];
  });
}
