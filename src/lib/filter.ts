import type { BranchReport } from "./bindings/BranchReport";
import type { OnlineVerdict } from "./bindings/OnlineVerdict";
import type { RemoteBranchReport } from "./bindings/RemoteBranchReport";
import type { UpstreamState } from "./bindings/UpstreamState";
import type { Verdict } from "./bindings/Verdict";
import { prefixOf } from "./branchName";
import { i18n } from "./i18n/index.svelte";

// The order of the verdicts, as a record: a verdict added to the backend that is missing here does not compile.
const VERDICT_ORDER = { Safe: 0, Review: 1, Blocked: 2, Unsafe: 3 } satisfies Record<Verdict, number>;
export const VERDICTS = Object.keys(VERDICT_ORDER) as Verdict[];

/** Its upstream was deleted on the server: what the sidebar badges count and the list starts with. */
export const isOrphaned = (b: { upstreamState: UpstreamState }) => b.upstreamState === "Gone";
/** A gone branch that counts as stale: locked and ignored ones are left out, as bell and table leave them out. */
export const countsAsGone = (b: { upstreamState: UpstreamState; locked: boolean; ignored?: boolean }) => !b.locked && !b.ignored && isOrphaned(b);
const ONLINE_ORDER = { Merged: 0, Inactive: 1, Active: 2 } satisfies Record<OnlineVerdict, number>;
export const ONLINE_VERDICTS = Object.keys(ONLINE_ORDER) as OnlineVerdict[];
/** What "delete all safe" and the marks take: Safe locally, Merged on the server. */
export const isDeletable = (b: BranchReport | RemoteBranchReport) => ("remote" in b ? b.verdict === "Merged" : b.verdict === "Safe");
/** Everything else can only be deleted with force: the dialog asks for it and says what is lost. */
export const needsForce = (b: BranchReport | RemoteBranchReport) => !isDeletable(b);

/** The gone branches among these that count, and how many of them are Unsafe: what the sidebar's badges say. */
export function goneCount(branches: Iterable<{ upstreamState: UpstreamState; locked: boolean; ignored?: boolean; verdict: string }>) {
  let gone = 0;
  let unsafe = 0;
  for (const b of branches) {
    if (!countsAsGone(b)) continue;
    gone++;
    if (b.verdict === "Unsafe") unsafe++;
  }
  return { gone, unsafe };
}

export type SortKey = "verdict" | "name" | "repo" | "author" | "lastCommitAt";

/** What a column can be filtered and counted by. */
export type Facet = "verdict" | "prefix" | "repo" | "author" | "age" | "pr" | "local";
export type AgeBucket = "week" | "month" | "quarter" | "older";
export const AGE_BUCKETS: AgeBucket[] = ["week", "month", "quarter", "older"];
export type PrFacet = "Open" | "Merged" | "Closed" | "None";
export const PR_FACETS: PrFacet[] = ["Open", "Merged", "Closed", "None"];
export type LocalFacet = "with" | "without";

/**
 * Search, "mine" and the column filters apply to both scopes; each scope has its own status chips.
 * Every list is "any of these"; empty means no filter.
 */
export interface Filters {
  search: string;
  onlyMine: boolean;
  verdicts: Verdict[];
  onlineVerdicts: OnlineVerdict[];
  /** Working-copy paths. */
  repos: string[];
  /** Branch or its repository. */
  tags: string[];
  /** Name prefixes ("feature", …); "" stands for names without one. */
  prefixes: string[];
  /** Author of the last commit. */
  authors: string[];
  ages: AgeBucket[];
  prStates: PrFacet[];
  /** Server branches with or without a local branch tracking them. */
  local: LocalFacet[];
  /** Local branches by the state of their upstream; a lens sets it so the table shows what it counted. */
  upstreams: UpstreamState[];
  /** Exactly these branches (`branchKey` / `onlineKey`): what a step of the dashboard names, and why. */
  focus: { label: string; keys: string[] } | null;
}

export const emptyFilters = (): Filters => ({
  search: "",
  onlyMine: false,
  verdicts: [],
  onlineVerdicts: [],
  repos: [],
  tags: [],
  prefixes: [],
  authors: [],
  ages: [],
  prStates: [],
  local: [],
  upstreams: [],
  focus: null,
});

/** The filters of the cleanup table itself; the repos come from the selection both perspectives share. */
export type ViewFilters = Omit<Filters, "repos">;

/** The filters without the repo selection, as the table keeps them. */
export function viewFilters(f: Filters): ViewFilters {
  const { repos: _, ...rest } = f;
  return rest;
}

/** What filtering needs besides the branch: the clock, and for server branches their local copies. */
export interface FilterContext {
  now: number;
  localCount?: (b: RemoteBranchReport) => number;
}
const defaultContext = (): FilterContext => ({ now: Date.now() / 1000 });

export function ageBucket(ageSecs: number): AgeBucket {
  const d = ageSecs / 86_400;
  return d < 7 ? "week" : d < 31 ? "month" : d < 92 ? "quarter" : "older";
}

type Faceted = { repoPath: string; name: string; lastCommitAuthor: string; lastCommitAt: number; pullRequest: { state: string } | null; verdict: string };

/** The value a branch has for a facet, as shown in the column's filter list. */
function facetValue(b: Faceted, facet: Facet, ctx: FilterContext): string {
  switch (facet) {
    case "verdict":
      return b.verdict;
    case "prefix":
      return prefixOf(b.name) ?? "";
    case "repo":
      return b.repoPath;
    case "author":
      return b.lastCommitAuthor;
    case "age":
      return ageBucket(ctx.now - b.lastCommitAt);
    case "pr":
      return b.pullRequest?.state ?? "None";
    case "local":
      return "remote" in b && (ctx.localCount?.(b as unknown as RemoteBranchReport) ?? 0) > 0 ? "with" : "without";
  }
}

/** Branches per value, largest first; the order a filter menu lists them in. */
export function facetCounts(list: Faceted[], facet: Facet, ctx: FilterContext): { value: string; count: number }[] {
  const m = new Map<string, number>();
  for (const b of list) {
    const v = facetValue(b, facet, ctx);
    m.set(v, (m.get(v) ?? 0) + 1);
  }
  return [...m].map(([value, count]) => ({ value, count })).sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
}

/** The fields of the filters that hold a list of values. */
export type ListField = "verdicts" | "onlineVerdicts" | "prefixes" | "repos" | "authors" | "ages" | "prStates" | "local";

/** The filter field a facet is stored in; status has one per scope. */
export function facetField(facet: Facet, online: boolean): ListField {
  const fields: Record<Facet, ListField> = {
    verdict: online ? "onlineVerdicts" : "verdicts",
    prefix: "prefixes",
    repo: "repos",
    author: "authors",
    age: "ages",
    pr: "prStates",
    local: "local",
  };
  return fields[facet];
}

/** The filters without one facet: what that facet's counts are based on. */
export function withoutFacet(f: Filters, facet: Facet, online: boolean): Filters {
  return { ...f, [facetField(facet, online)]: [] };
}

/** Note and tags of a branch including those of its repository, for search and the tag filter. */
export type Annotate = (b: { repoPath: string; name: string }) => { tags: string[]; note: string };
const none: Annotate = () => ({ tags: [], note: "" });

export interface Sort {
  key: SortKey;
  dir: 1 | -1;
}

export const branchKey = (b: Pick<BranchReport, "repoPath" | "name">) => `${b.repoPath}::${b.name}`;
export const onlineKey = (b: Pick<RemoteBranchReport, "repoPath" | "name">) => `${b.repoPath}::online::${b.name}`;
/** The repo of a `branchKey` or `onlineKey`. */
export const repoOfKey = (key: string) => key.split("::")[0];

export const repoName = (path: string) => path.replace(/[\\/]+$/, "").split(/[\\/]/).pop() ?? path;

interface Searchable {
  repoPath: string;
  name: string;
  lastCommitSubject: string;
  lastCommitAuthor: string;
  isMine: boolean;
  pullRequest: { id: number; state: string } | null;
}

const any = <T>(list: T[], v: T) => list.length === 0 || list.includes(v);

/** The filters without status chips and prefixes: one pass with these, the chips and prefix counts taken from it. */
export const withoutChips = (f: Filters): Filters => ({ ...f, verdicts: [], onlineVerdicts: [], prefixes: [] });
export const verdictMatches = (f: Filters, b: Pick<BranchReport, "verdict">) => any(f.verdicts, b.verdict);
export const onlineVerdictMatches = (f: Filters, b: Pick<RemoteBranchReport, "verdict">) => any(f.onlineVerdicts, b.verdict);
export const prefixMatches = (f: Filters, name: string) => f.prefixes.length === 0 || f.prefixes.includes(prefixOf(name) ?? "");

/** The search as typed, prepared once per pass instead of once per row. */
interface Query {
  text: string;
  /** "#qa" searches the tag "qa". */
  tag: string;
}
// "feature › x" finds "feature/x": people type what the segments look like.
function query(search: string): Query {
  const text = search.trim().toLowerCase().replace(/\s*›\s*/g, "/");
  return { text, tag: text.replace(/^#/, "") };
}

function matches(b: Searchable & Faceted, f: Filters, qy: Query, annotate: Annotate, ctx: FilterContext, authors: string[] = [b.lastCommitAuthor]): boolean {
  const q = qy.text;
  const a = f.tags.length || q ? annotate(b) : { tags: [], note: "" };
  const tags = a.tags.map((t) => t.toLowerCase());
  return (
    (!f.onlyMine || b.isMine) &&
    any(f.repos, b.repoPath) &&
    any(f.authors, b.lastCommitAuthor) &&
    (f.ages.length === 0 || f.ages.includes(ageBucket(ctx.now - b.lastCommitAt))) &&
    (f.prStates.length === 0 || f.prStates.includes((b.pullRequest?.state ?? "None") as PrFacet)) &&
    (f.tags.length === 0 || f.tags.some((t) => tags.includes(t.toLowerCase()))) &&
    prefixMatches(f, b.name) &&
    (q === "" ||
      tags.some((t) => t.includes(qy.tag)) ||
      a.note.toLowerCase().includes(q) ||
      b.name.toLowerCase().includes(q) ||
      b.lastCommitSubject.toLowerCase().includes(q) ||
      repoName(b.repoPath).toLowerCase().includes(q) ||
      authors.some((a) => a.toLowerCase().includes(q)) ||
      (b.pullRequest !== null && `#${b.pullRequest.id}`.includes(q)))
  );
}

export function filterBranches(list: BranchReport[], f: Filters, annotate: Annotate = none, ctx: FilterContext = defaultContext()): BranchReport[] {
  const q = query(f.search);
  const focus = f.focus ? new Set(f.focus.keys) : null;
  return list.filter((b) => (!focus || focus.has(branchKey(b))) && verdictMatches(f, b) && any(f.upstreams, b.upstreamState) && matches(b, f, q, annotate, ctx, b.authors));
}

export function filterOnline(list: RemoteBranchReport[], f: Filters, annotate: Annotate = none, ctx: FilterContext = defaultContext()): RemoteBranchReport[] {
  const q = query(f.search);
  const focus = f.focus ? new Set(f.focus.keys) : null;
  return list.filter(
    (b) => (!focus || focus.has(onlineKey(b))) && onlineVerdictMatches(f, b) && (f.local.length === 0 || f.local.includes(facetValue(b, "local", ctx) as LocalFacet)) && matches(b, f, q, annotate, ctx),
  );
}

// One collator per language: setting one up costs more than a whole sort of a short list.
let collator: { locale: string; compare: Intl.Collator["compare"] } | null = null;
function compareText(): Intl.Collator["compare"] {
  const locale = i18n.locale;
  if (collator?.locale !== locale) collator = { locale, compare: new Intl.Collator(locale).compare };
  return collator.compare;
}

function sorter<T extends { name: string; repoPath: string; lastCommitAt: number; lastCommitAuthor: string }>(rank: (b: T) => number) {
  return (list: T[], s: Sort): T[] => {
    const value = (b: T): string | number => {
      switch (s.key) {
        case "verdict":
          return rank(b);
        case "name":
          return b.name.toLowerCase();
        case "repo":
          return repoName(b.repoPath).toLowerCase();
        case "author":
          return b.lastCommitAuthor.toLowerCase();
        case "lastCommitAt":
          return b.lastCommitAt;
      }
    };
    // Keys once per item, not twice per comparison; the collator follows the language of the texts.
    const keyed = list.map((b) => ({ b, v: value(b) }));
    const compare = compareText();
    keyed.sort((x, y) => {
      if (x.v < y.v) return -s.dir;
      if (x.v > y.v) return s.dir;
      return compare(x.b.name, y.b.name) || compare(x.b.repoPath, y.b.repoPath);
    });
    return keyed.map((k) => k.b);
  };
}

export const sortBranches = sorter<BranchReport>((b) => VERDICTS.indexOf(b.verdict));
export const sortOnline = sorter<RemoteBranchReport>((b) => ONLINE_VERDICTS.indexOf(b.verdict));

export function countByVerdict(list: BranchReport[]): Record<Verdict, number> {
  const c: Record<Verdict, number> = { Safe: 0, Review: 0, Blocked: 0, Unsafe: 0 };
  for (const b of list) c[b.verdict]++;
  return c;
}

export function countOnline(list: RemoteBranchReport[]): Record<OnlineVerdict, number> {
  const c: Record<OnlineVerdict, number> = { Merged: 0, Inactive: 0, Active: 0 };
  for (const b of list) c[b.verdict]++;
  return c;
}

/**
 * Same rule as the backend (online::classify), re-applied when the inactivity threshold changes.
 * Both sides are tested against src-tauri/tests/fixtures/online-rules.json.
 */
export function classifyOnline(merged: boolean, openPr: boolean | null, ageSecs: number, staleDays: number): OnlineVerdict {
  if (openPr === true) return "Active";
  if (merged) return "Merged";
  // Pull requests not known: the branch may have an open one, so age alone never makes it inactive.
  if (openPr === null) return "Active";
  return ageSecs > staleDays * 86_400 ? "Inactive" : "Active";
}
