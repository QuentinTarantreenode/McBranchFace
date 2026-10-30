import type { CommitInfo } from "$lib/bindings/CommitInfo";

/**
 * Commits whose subject, author or SHA contain the text (case-insensitive), authored on or after
 * `from` and on or before `to` (local calendar days, `YYYY-MM-DD` as a date input gives them).
 */
export function filterCommits(list: CommitInfo[], query: string, from = "", to = ""): CommitInfo[] {
  const q = query.trim().toLowerCase();
  const start = from ? new Date(`${from}T00:00:00`).getTime() / 1000 : -Infinity;
  const end = to ? new Date(`${to}T23:59:59`).getTime() / 1000 : Infinity;
  return list.filter(
    (c) =>
      c.authoredAt >= start &&
      c.authoredAt <= end &&
      (!q || c.subject.toLowerCase().includes(q) || c.authorEmail.toLowerCase().includes(q) || c.sha.toLowerCase().startsWith(q)),
  );
}

/** Oldest and newest authoring time, for the head line of a list. */
export function span(list: CommitInfo[]): { first: number; last: number } | null {
  if (!list.length) return null;
  const times = list.map((c) => c.authoredAt);
  return { first: Math.min(...times), last: Math.max(...times) };
}
