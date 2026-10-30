/** Which repo statuses a finished scan makes stale. Pure. */
import type { RepoResult } from "./bindings/RepoResult";

/**
 * What of a scan result the status bar also shows: ahead/behind and gone per tracking branch, which
 * branch is checked out where. File changes and branch switches come through the watcher anyway.
 */
export function statusFingerprint(r: RepoResult | null): string {
  if (!r) return "";
  const tracking = r.tracking.map((t) => `${t.branch}:${t.ahead}:${t.behind}:${t.gone ? 1 : 0}:${t.checkedOut ? 1 : 0}`);
  const worktrees = r.branches.filter((b) => b.worktree).map((b) => `${b.name}@${b.worktree!.path}`);
  return [r.errorKind ?? "", ...tracking, "|", ...worktrees].join("\n");
}

/** Paths without a status yet, or whose fingerprint changed since the last refresh. */
export function staleStatuses(paths: string[], hasStatus: (path: string) => boolean, last: ReadonlyMap<string, string>, now: ReadonlyMap<string, string>): string[] {
  return paths.filter((p) => !hasStatus(p) || last.get(p) !== now.get(p));
}

/** The order statuses are read at the start: the repo open in Git first, then as the sidebar lists them. */
export function statusOrder(paths: string[], first: string | null): string[] {
  return first && paths.includes(first) ? [first, ...paths.filter((p) => p !== first)] : paths;
}
