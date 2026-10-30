// What a folder or group head sums up of its working copies: how many have changes, commits to push,
// commits to pull. Counted per working copy, so a head reads like the cards below it.
import type { RepoStatus } from "$lib/bindings/RepoStatus";

export interface HeadSums {
  dirty: number;
  ahead: number;
  behind: number;
}

export function headSums(paths: Iterable<string>, statuses: Pick<ReadonlyMap<string, RepoStatus>, "get">): HeadSums {
  const sums: HeadSums = { dirty: 0, ahead: 0, behind: 0 };
  for (const p of new Set(paths)) {
    const st = statuses.get(p);
    if (!st) continue;
    if (st.entries.length) sums.dirty++;
    if (st.head.ahead) sums.ahead++;
    if (st.head.behind) sums.behind++;
  }
  return sums;
}
