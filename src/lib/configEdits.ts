// Edits of the settings as plain functions: the stores save what these return.
import type { Annotation } from "./bindings/Annotation";
import type { Config } from "./bindings/Config";
import { sameFolder, withoutRoot } from "./roots";

type Size = { width: number; height: number };

/** The saved dialog sizes with the one of `id` set, or forgotten when `size` is null. */
export function withDialogSize(sizes: Record<string, Size>, id: string, size: Size | null): Record<string, Size> {
  const next = { ...sizes };
  if (size) next[id] = size;
  else delete next[id];
  return next;
}

/** The locks with one set or taken away; a lock holds for every working copy of the repository. */
export function withLock(locks: Config["locks"], identity: string, branch: string | null, locked: boolean): Config["locks"] {
  const others = locks.filter((l) => !(l.identity === identity && l.branch === branch));
  return locked ? [...others, { identity, branch }] : others;
}

/** The notes with one changed; an empty note without tags is no note. */
export function withAnnotation(annotations: Config["annotations"], key: string, a: Annotation): Config["annotations"] {
  const next = { ...annotations };
  if (!a.note.trim() && a.tags.length === 0) delete next[key];
  else next[key] = { note: a.note, tags: [...a.tags] };
  return next;
}

/**
 * What removing a root changes: the roots, its fold, and the repo groups, which lose its repos (they are no
 * longer scanned and would only show as unreachable). `gone`: the repos below the root.
 */
export function planRootRemoval(
  config: Pick<Config, "roots" | "ui" | "repoGroups">,
  root: string,
  repos: { path: string; root: string }[],
  ownerOf: (path: string) => string,
): { patch: Pick<Config, "roots" | "ui" | "repoGroups">; gone: Set<string> } {
  const gone = new Set(repos.filter((r) => sameFolder(r.root, root)).map((r) => r.path));
  const ui = { ...config.ui, collapsedRoots: config.ui.collapsedRoots.filter((r) => !sameFolder(r, root)) };
  const repoGroups = config.repoGroups.map((g) => ({ ...g, paths: g.paths.filter((p) => !gone.has(ownerOf(p))) }));
  return { patch: { roots: withoutRoot(config.roots, root), ui, repoGroups }, gone };
}
