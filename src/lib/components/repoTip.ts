import { commonParent, relativeTo } from "$lib/paths";
import { t } from "$lib/i18n/index.svelte";
import { tagColor } from "$lib/annotations";
import { groupByPrefix } from "$lib/groups";
import { repoName } from "$lib/filter";
import { shortSha } from "$lib/format";
import type { TooltipContent, TooltipPill, TooltipRow, TooltipSection } from "$lib/ui/tooltip";
import { identities } from "$lib/stores/identities.svelte";
import { gitStatus } from "$lib/stores/gitStatus.svelte";
import { isMergedBranch } from "$lib/worktrees";
import { scanResults } from "$lib/stores/scanResults.svelte";
import { rules } from "$lib/stores/rules.svelte";

const providerName = (p: string) => (p === "Azure" ? t.provider.azure : p === "GitHub" ? t.provider.github : "");

/**
 * Everything about a repository the row cannot show: branch and upstream, sync, changes, default
 * branch, provider, worktrees, the other working copies, note. One tip for the sidebar card and
 * the repo cell of the table. `titled`: the head names the repo, where the element does not.
 * `card`: the sidebar card shows branch, sync, changes and worktrees itself; the tip leaves them out.
 */
export function repoTip(path: string, titled: boolean, card = false): TooltipContent {
  const info = scanResults.repoByPath.get(path);
  const st = gitStatus.statuses.get(path);
  const a = rules.annotationOf(path, null);
  // What is checked out here: the branch and where it pushes to, as the Git view writes it (main → origin/main),
  // each on a line of its own, so long names do not break inside a narrow value column.
  const lines: TooltipRow[] = [];
  if (st && !card) lines.push({ value: st.head.branch ?? t.common.detached, kind: st.head.branch ? "branch" : "text", tone: st.head.branch ? undefined : "review" });
  if (st) lines.push({ lead: card ? t.branchTip.upstream : "→", value: st.head.upstream ?? t.branchTip.localOnly, kind: st.head.upstream ? "branch" : "text" });
  const state: TooltipRow[] = [];
  if (st && !card) {
    if (st.head.ahead || st.head.behind) state.push({ label: t.sidebar.sync, value: t.sidebar.aheadBehind(st.head.ahead, st.head.behind) });
    state.push({ label: t.sidebar.changes, value: t.sidebar.changed(st.entries.length), tone: st.entries.length ? "review" : undefined });
    if (st.stashes) state.push({ label: t.sidebar.stashes, value: String(st.stashes) });
  }
  // The repository itself, the same in every working copy.
  const def = info?.defaultBranch ?? null;
  const repo: TooltipRow[] = [{ label: t.sidebar.defaultBranch, value: def ?? t.common.none, kind: def ? "branch" : "text" }];
  if (info && providerName(info.provider)) repo.push({ label: t.sidebar.provider, value: providerName(info.provider) });
  const extra = card ? [] : (st?.worktrees ?? []).filter((w) => !w.isMain && !w.foreign);
  // A repo with dozens of agent worktrees made the tip taller than the screen: a few that need
  // attention, one line each, and the rest only counted by branch prefix.
  const scan = scanResults.resultOf(path);
  const merged = (branch: string | null) => isMergedBranch(scan, branch);
  const dirty = (p: string) => (gitStatus.statuses.get(p)?.entries.length ?? 0) > 0;
  const cap = capWorktrees(extra, (w) => w.branch, (w) => (dirty(w.path) ? 2 : merged(w.branch) ? 0 : 1));
  const worktrees: TooltipRow[] = cap.shown.map((w) =>
    w.branch
      ? { value: w.branch, kind: "branch" }
      : { label: repoName(w.path), value: w.head ? shortSha(w.head) : t.common.detached, kind: "mono", tone: "review" },
  );
  if (cap.rest) worktrees.push({ value: t.sidebar.moreWorktrees(cap.rest, prefixSummary(cap.prefixes)), tone: "muted" });
  const copies = copiesSection(path);
  return {
    title: titled ? repoName(path) : undefined,
    path,
    pills: card ? undefined : a.tags.map((tag) => ({ text: tag, color: tagColor(tag) })),
    wide: true,
    sections: [
      { title: t.sidebar.checkedOut, lines, rows: state },
      { title: t.sidebar.repository, rows: repo },
      { title: t.sidebar.worktrees, rows: worktrees },
      ...(copies ? [copies] : []),
      { title: t.sidebar.note, text: a.note },
    ],
    // What the element under it does (double click, context menu) is said by the element itself.
    gestures: true,
  };
}

export const WORKTREE_TIP_LIMIT = 5;
const PREFIX_SUMMARY_LIMIT = 4;

/**
 * The most relevant worktrees (higher `relevance` first, else in the given order) up to `limit`, and
 * the rest counted by what their branches share ("worktree-agent", "r2"), largest first. Worktrees
 * that share nothing with another are counted last, under "".
 */
export function capWorktrees<T>(
  list: T[],
  nameOf: (item: T) => string | null,
  relevance: (item: T) => number,
  limit = WORKTREE_TIP_LIMIT,
): { shown: T[]; rest: number; prefixes: [string, number][] } {
  const ranked = list.map((item, i) => ({ item, i, r: relevance(item) })).sort((a, b) => b.r - a.r || a.i - b.i);
  const shown = ranked.slice(0, limit).map((x) => x.item);
  const hidden = ranked.slice(limit).map((x) => x.item);
  const prefixes = groupByPrefix(hidden, nameOf).map((g): [string, number] => [g.label, g.items.length]);
  return { shown, rest: hidden.length, prefixes };
}

function prefixSummary(prefixes: [string, number][]): string {
  const named = prefixes.filter(([p]) => p);
  const top = named.slice(0, PREFIX_SUMMARY_LIMIT).map(([p, c]) => `${c} ${p}`);
  const other = [...named.slice(PREFIX_SUMMARY_LIMIT), ...prefixes.filter(([p]) => !p)].reduce((s, [, c]) => s + c, 0);
  if (other) top.push(t.sidebar.otherWorktrees(other));
  return top.join(", ");
}

/** A working copy as a pill: its folder's badge, and its label where two copies share that folder. */
export function copyPill(path: string): TooltipPill | null {
  const badge = identities.rootBadgeOf(path)?.badge;
  const label = scanResults.copyLabel(path);
  if (!badge) return scanResults.groupOf(path) && label ? { text: label, color: scanResults.groupOf(path)!.color } : null;
  return { text: label && label !== badge.name ? `${badge.text} · ${label}` : badge.text, color: badge.color };
}

/**
 * Every working copy of the same repository, this one marked: which folder it is, and where. Relative
 * to the folder they share, which the note names.
 */
function copiesSection(path: string): TooltipSection | null {
  const group = scanResults.groupOf(path);
  if (!group) return null;
  const base = commonParent(group.paths);
  return {
    title: t.sidebar.copiesAll(group.paths.length),
    note: base || undefined,
    noteKind: "path",
    // The relative path names the copy already: a label would only say its first folder again.
    rows: group.paths.map((p) => ({
      pill: copyPill(p) ?? undefined,
      value: relativeTo(base, p),
      kind: "path" as const,
      current: p === path ? t.sidebar.thisCopy : undefined,
    })),
  };
}
