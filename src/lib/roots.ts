/** The folder list (`config.roots`): adding, removing and ordering. Pure. */

import { pathKey } from "./paths";

export const folderKey = (p: string) => pathKey(p);

export const sameFolder = (a: string, b: string) => folderKey(a) === folderKey(b);

/** `inner` is `outer` or lies somewhere below it. */
export const isWithin = (inner: string, outer: string) => (folderKey(inner) + "/").startsWith(folderKey(outer) + "/");

export type SkipReason = "file" | "present" | "inside";

export interface RootPlan {
  add: string[];
  skipped: { path: string; reason: SkipReason; root?: string }[];
}

/**
 * Which of the dropped or picked paths become new roots. A folder that is already a root, or lies
 * inside one, would only find the same repos again; a file is no folder to scan.
 */
export function planRootAdds(roots: string[], candidates: { path: string; dir: boolean }[]): RootPlan {
  const plan: RootPlan = { add: [], skipped: [] };
  for (const c of candidates) {
    if (!c.dir) {
      plan.skipped.push({ path: c.path, reason: "file" });
      continue;
    }
    const known = [...roots, ...plan.add];
    const same = known.find((r) => sameFolder(r, c.path));
    if (same) {
      plan.skipped.push({ path: c.path, reason: "present", root: same });
      continue;
    }
    const outer = known.find((r) => isWithin(c.path, r));
    if (outer) {
      plan.skipped.push({ path: c.path, reason: "inside", root: outer });
      continue;
    }
    plan.add.push(c.path.replace(/[\\/]+$/, "") || c.path);
  }
  return plan;
}

export const withoutRoot = (roots: string[], root: string) => roots.filter((r) => !sameFolder(r, root));

/** `root` moved to the place of `over`, before or after it. Unknown names leave the list as it is. */
export function moveRoot(roots: string[], root: string, over: string, after: boolean): string[] {
  const from = roots.findIndex((r) => sameFolder(r, root));
  if (from < 0 || !roots.some((r) => sameFolder(r, over)) || sameFolder(root, over)) return roots;
  const rest = roots.filter((_, i) => i !== from);
  const at = rest.findIndex((r) => sameFolder(r, over)) + (after ? 1 : 0);
  return [...rest.slice(0, at), roots[from], ...rest.slice(at)];
}

/** Position of a group's root in the configured order; unknown roots after all known ones. */
export function rootRank(roots: string[], root: string): number {
  const i = roots.findIndex((r) => sameFolder(r, root));
  return i < 0 ? roots.length : i;
}
