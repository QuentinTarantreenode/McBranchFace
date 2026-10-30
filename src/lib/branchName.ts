/** Branch names as segments ("feature/checklist-ui" → feature › checklist-ui) and their prefix statistics. Pure. */

/** Segments between slashes; empty pieces from doubled or edge slashes are dropped. */
export function segments(name: string): string[] {
  return name.split("/").filter(Boolean);
}

export interface NameParts {
  /** Leading segments without letters ("2.4", "1/3"): a version or numeric namespace, not a kind of work. */
  namespace: string | null;
  /** The kind of work ("feature", "bugfix"), when more follows it. */
  prefix: string | null;
  /** Everything after the prefix, as one name: its slashes are part of it, not further categories. */
  rest: string;
}

const hasLetter = (s: string) => /\p{L}/u.test(s);

export function nameParts(name: string): NameParts {
  const s = segments(name);
  let n = 0;
  while (n < s.length - 1 && !hasLetter(s[n])) n++;
  const tail = s.slice(n);
  const prefix = tail.length > 1 ? tail[0] : null;
  return {
    namespace: n ? s.slice(0, n).join("/") : null,
    prefix,
    rest: (prefix ? tail.slice(1) : tail).join("/") || name,
  };
}

/** The kind of work, lower-cased so "Feature/x" and "feature/y" count together; null without one. */
export function prefixOf(name: string): string | null {
  return nameParts(name).prefix?.toLowerCase() ?? null;
}

export interface PrefixCount {
  /** null: names without a prefix. */
  prefix: string | null;
  count: number;
}

/** Names per prefix, largest first; names without a prefix come last. */
export function prefixStats(names: Iterable<string>): PrefixCount[] {
  const counts = new Map<string | null, number>();
  for (const n of names) {
    const p = prefixOf(n);
    counts.set(p, (counts.get(p) ?? 0) + 1);
  }
  return [...counts]
    .map(([prefix, count]) => ({ prefix, count }))
    .sort((a, b) => (a.prefix === null ? 1 : b.prefix === null ? -1 : b.count - a.count || a.prefix.localeCompare(b.prefix)));
}

// Common conventions get fixed colours, so "fix" looks the same in every repo.
const KNOWN: Record<string, number> = {
  feature: 2,
  feat: 2,
  features: 2,
  bugfix: 3,
  fix: 3,
  bug: 3,
  hotfix: 1,
  release: 4,
  releases: 4,
  spike: 6,
  experiment: 6,
  poc: 6,
  chore: 5,
  docs: 5,
  refactor: 7,
  test: 7,
  user: 0,
  users: 0,
};

/** Colour of a prefix from the identity palette; unknown prefixes get a stable one by hash. */
export function prefixColor(prefix: string): string {
  let i = KNOWN[prefix.toLowerCase()];
  if (i === undefined) {
    let h = 0;
    for (const c of prefix.toLowerCase()) h = (h * 31 + c.charCodeAt(0)) >>> 0;
    i = h % 8;
  }
  return `var(--id-${i})`;
}

/** "origin/feature/x" → remote "origin", name "feature/x"; git lists remote branches with their remote. */
export function splitRemote(ref: string): { remote: string | null; name: string } {
  const i = ref.indexOf("/");
  return i > 0 ? { remote: ref.slice(0, i), name: ref.slice(i + 1) } : { remote: null, name: ref };
}

/** Remote names that a short ref such as `origin/team/main` starts with; others are taken as a local name. */
const KNOWN_REMOTES = ["origin", "upstream"];

/**
 * Any ref as the app meets it – `refs/heads/x`, `refs/remotes/origin/x`, `origin/x`, `x` – as remote
 * and branch name, so it can be shown as segments. Without the `refs/` form only known remotes are
 * split off: `feature/x` must not become remote "feature".
 */
export function refParts(ref: string, remotes: string[] = KNOWN_REMOTES): { remote: string | null; name: string } {
  if (ref.startsWith("refs/heads/")) return { remote: null, name: ref.slice("refs/heads/".length) };
  if (ref.startsWith("refs/remotes/")) return splitRemote(ref.slice("refs/remotes/".length));
  const s = splitRemote(ref);
  return s.remote && remotes.includes(s.remote) ? s : { remote: null, name: ref };
}
