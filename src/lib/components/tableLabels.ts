// How the branch table names its columns and filter values: the heads, the menus and the filter pills
// read the same words.
import type { Facet } from "$lib/filter";
import { t } from "$lib/i18n/index.svelte";
import { repoLabel } from "$lib/repoLabel";

export const colLabel = (id: string): string =>
  ({
    status: t.cleanup.colStatus,
    branch: t.cleanup.colBranch,
    repo: t.cleanup.colRepo,
    author: t.cleanup.colAuthor,
    commit: t.cleanup.colCommit,
    pr: t.cleanup.colPr,
    local: t.cleanup.colLocal,
    source: t.cleanup.colSource,
  })[id] ?? id;

/** How a facet value reads in menus and filter pills. */
export function facetLabel(facet: Facet, value: string): string {
  switch (facet) {
    case "verdict":
      return (t.verdict as Record<string, { label: string }>)[value]?.label ?? (t.onlineVerdict as Record<string, { label: string }>)[value]?.label ?? value;
    case "prefix":
      return value || t.cleanup.noPrefix;
    case "repo":
      return repoLabel(value);
    case "age":
      return t.cleanup.age[value as keyof typeof t.cleanup.age] ?? value;
    case "pr":
      return value === "None" ? t.cleanup.noPr : ((t.prState as Record<string, string>)[value] ?? value);
    case "local":
      return value === "with" ? t.cleanup.localWith : t.cleanup.localWithout;
    default:
      return value;
  }
}
