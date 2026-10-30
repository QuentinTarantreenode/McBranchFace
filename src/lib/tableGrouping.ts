// How the cleanup table groups its rows: the key and the head of a row's group by each column, and the
// grouping by name, where only names several repos share get a head of their own.
import type { TableGroup } from "./bindings/TableGroup";
import { prefixOf } from "./branchName";
import { folderLabel, groupId, SINGLE_NAMES, type Grouped } from "./groups";

/** What a table row needs to be grouped by any column. */
export type Groupable = { repoPath: string; name: string; verdict: string; lastCommitAuthor: string };

/** What the repo of a row is known by. */
export interface RepoFacts {
  rootOf(path: string): string | undefined;
  identityOf(path: string): string | undefined;
  /** The name a repo goes by across its working copies, by identity. */
  nameOf(identity: string): string | undefined;
}

/** The texts of heads that are not a value of the row. */
export interface GroupTexts {
  other: string;
  noPrefix: string;
  verdict(key: string): string | undefined;
}

/** Every column the table can group by. */
export const GROUPINGS: TableGroup[] = ["Folder", "Repo", "Prefix", "Name", "Verdict", "Author"];

/** Group of a row: its root folder, its repo across working copies, its name prefix or whole name, verdict or author. */
export function groupKeyOf(b: Groupable, by: TableGroup, repo: RepoFacts): string {
  switch (by) {
    case "Folder":
      return repo.rootOf(b.repoPath) ?? "";
    case "Prefix":
      return prefixOf(b.name) ?? "";
    case "Name":
      return b.name;
    case "Verdict":
      return b.verdict;
    case "Author":
      return b.lastCommitAuthor;
    default:
      return repo.identityOf(b.repoPath) ?? b.repoPath;
  }
}

export function groupLabelOf(key: string, by: TableGroup, repo: RepoFacts, texts: GroupTexts): string {
  switch (by) {
    case "Folder":
      return key ? folderLabel(key) : texts.other;
    case "Prefix":
      return key || texts.noPrefix;
    case "Name":
    case "Author":
      return key;
    case "Verdict":
      return texts.verdict(key) ?? key;
    default:
      return repo.nameOf(key) ?? key;
  }
}

/**
 * Groups by name: the point is the branch several repos share, largest first. A name in one repo only would
 * be a head repeating its single row: those go together into one last group.
 */
export function withNameSingles<T>(groups: Grouped<T>[], label: string, collapsed: ReadonlySet<string>): Grouped<T>[] {
  const shared = groups.filter((g) => g.items.length > 1).sort((a, b) => b.items.length - a.items.length);
  const single = groups.filter((g) => g.items.length === 1).flatMap((g) => g.items);
  if (!single.length) return shared;
  return [...shared, { key: SINGLE_NAMES, label, items: single, open: !collapsed.has(groupId("Name", SINGLE_NAMES)) }];
}

/** Every group a row can be in, by any grouping: the folds worth keeping. */
export function tableGroupIds(rows: Groupable[], repo: RepoFacts): Set<string> {
  const ids = new Set(GROUPINGS.flatMap((by) => rows.map((b) => groupId(by, groupKeyOf(b, by, repo)))));
  ids.add(groupId("Name", SINGLE_NAMES));
  return ids;
}
