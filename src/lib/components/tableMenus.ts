// Menus of the branch table. They load on the first open: nothing here is needed to show the table.
import {
  ArrowDown, ArrowDownToLine, ArrowRightLeft, ArrowUp, ArrowUpFromLine, Columns3, GitBranchPlus, Copy, CopyPlus, ExternalLink, EyeOff, FileDown, FolderOpen, Funnel, GitGraph, GitPullRequest, Group, History, Lock, LockOpen, RotateCcw, SquareTerminal, Trash2,
} from "@lucide/svelte";
import { api } from "$lib/api";
import { branchUrl } from "$lib/links";
import { AGE_BUCKETS, facetField, needsForce, ONLINE_VERDICTS, PR_FACETS, repoName, VERDICTS, type Facet } from "$lib/filter";
import { t } from "$lib/i18n/index.svelte";
import { prefixColor } from "$lib/branchName";
import { columnDef, layoutFor, shiftColumn, toggleColumn, type ColumnId } from "$lib/table/columns";
import type { MenuEntry } from "$lib/ui/menu.svelte";
import type { Report } from "$lib/report";
import type { BranchReport } from "$lib/bindings/BranchReport";
import type { RemoteBranchReport } from "$lib/bindings/RemoteBranchReport";
import { ignoreItem } from "./ignoreMenu";
import { openInGit } from "./openInGit";
import { commandsItem } from "./commandMenu";
import { promptItem } from "./promptMenu";
import { createIn, fastForwardAll, groupTargets, pushAll, repoLabel, switchAll } from "$lib/services/groupActions";
import { toasts } from "$lib/stores/toasts.svelte";
import { settings } from "$lib/stores/settings.svelte";
import { dialogs } from "$lib/stores/dialogs.svelte";
import { scanResults } from "$lib/stores/scanResults.svelte";
import { rules } from "$lib/stores/rules.svelte";
import { cleanupView } from "$lib/stores/cleanupView.svelte";
import { navigation } from "$lib/services/navigation";
import { deletes } from "$lib/stores/deletes.svelte";
import { repoActions } from "$lib/services/repoActions.svelte";

export interface TableMenuContext {
  online: boolean;
  /** Visible columns in their order. */
  shown: ColumnId[];
  colLabel: (id: string) => string;
  facetLabel: (facet: Facet, value: string) => string;
}

// Fixed orders where the values have one; the rest by count.
const facetOrder: Partial<Record<Facet, string[]>> = { age: AGE_BUCKETS, pr: PR_FACETS };

function filterItems(ctx: TableMenuContext, facet: Facet): MenuEntry[] {
  const counts = cleanupView.facetCounts(facet);
  const order = facet === "verdict" ? (ctx.online ? ONLINE_VERDICTS : VERDICTS) : facetOrder[facet];
  if (order) counts.sort((a, b) => (order as string[]).indexOf(a.value) - (order as string[]).indexOf(b.value));
  const max = Math.max(1, ...counts.map((c) => c.count));
  const field = cleanupView.all[facetField(facet, ctx.online)] as string[];
  if (!counts.length) return [{ label: t.cleanup.noValues, disabled: true, run: () => {} }];
  return counts.map((c) => ({
    label: ctx.facetLabel(facet, c.value),
    count: c.count,
    bar: { ratio: c.count / max, color: facet === "prefix" && c.value ? prefixColor(c.value) : "var(--accent)" },
    checked: field.includes(c.value),
    keepOpen: true,
    run: () => cleanupView.toggleFacet(facet, c.value),
  }));
}

export function headMenu(ctx: TableMenuContext, id: ColumnId): MenuEntry[] {
  const def = columnDef(id)!;
  const sortKey = def.sort;
  const all = layoutFor(cleanupView.scope, cleanupView.columns);
  const i = ctx.shown.indexOf(id);
  return [
    { heading: ctx.colLabel(id) },
    {
      tiles: [
        ...(sortKey
          ? [
              { label: t.cleanup.sortAscTile, icon: ArrowDown, run: () => (cleanupView.sort = { key: sortKey, dir: 1 }) },
              { label: t.cleanup.sortDescTile, icon: ArrowUp, run: () => (cleanupView.sort = { key: sortKey, dir: -1 }) },
            ]
          : []),
        { label: t.cleanup.hideColumn, icon: EyeOff, disabled: id === "branch", run: () => cleanupView.setColumns(toggleColumn(cleanupView.columns, id)) },
      ],
    },
    ...(def.facet ? [{ label: t.cleanup.filterBy, icon: Funnel, submenu: filterItems(ctx, def.facet), run: () => {} }] : []),
    ...(def.group
      ? [{ label: t.cleanup.groupByColumn, icon: Group, checked: cleanupView.tableGroup === def.group, run: () => settings.setUi({ tableGroup: cleanupView.tableGroup === def.group ? "None" : def.group }) }]
      : []),
    "sep",
    { label: t.cleanup.moveLeft, disabled: i <= 0, run: () => cleanupView.setColumns(shiftColumn(cleanupView.columns, id, -1)) },
    { label: t.cleanup.moveRight, disabled: i < 0 || i >= ctx.shown.length - 1, run: () => cleanupView.setColumns(shiftColumn(cleanupView.columns, id, 1)) },
    {
      label: t.cleanup.columnsMenu,
      icon: Columns3,
      submenu: all.map((c) => ({ label: ctx.colLabel(c.id), checked: c.visible, disabled: c.id === "branch", keepOpen: true, run: () => cleanupView.setColumns(toggleColumn(cleanupView.columns, c.id)) })),
      run: () => {},
    },
    { label: t.cleanup.resetColumns, icon: RotateCcw, run: () => cleanupView.setColumns([]) },
  ];
}

/** A "Branch name" group: the same branch in several repos, handled in all of them at once. */
export function nameGroupEntries(name: string, items: BranchReport[]): MenuEntry[] {
  const to = groupTargets(items);
  const none = (list: unknown[]) => (list.length ? undefined : t.groupOps.nothing);
  const create: MenuEntry[] = to.missing.map((p) => ({ label: repoLabel(p), run: () => createIn(name, [p]) }));
  if (to.missing.length > 1) create.push("sep", { label: t.groupOps.createAll(to.missing.length), run: () => createIn(name, to.missing) });
  return [
    { group: t.groupOps.title(items.length) },
    { label: t.groupOps.fastForward(to.behind.length), icon: ArrowDownToLine, disabled: none(to.behind), run: () => fastForwardAll(name, to.behind) },
    { label: t.groupOps.switchTo(to.notCheckedOut.length), icon: ArrowRightLeft, hint: t.groupOps.switchHint, disabled: none(to.notCheckedOut), run: () => switchAll(name, to.notCheckedOut) },
    { label: t.groupOps.push(to.unpushed.length), icon: ArrowUpFromLine, disabled: none(to.unpushed), run: () => pushAll(name, to.unpushed) },
    { label: t.groupOps.create, icon: GitBranchPlus, hint: t.groupOps.createHint, disabled: none(to.missing), submenu: create, run: () => {} },
  ];
}

export function rowMenu(b: BranchReport | RemoteBranchReport): MenuEntry[] {
  const repo = scanResults.repoByPath.get(b.repoPath);
  const lockItem: MenuEntry = b.locked
    ? { label: t.common.unlock, icon: LockOpen, hint: t.detail.unlockTip, run: () => rules.setLock(b.repoPath, b.name, false) }
    : { label: t.common.lock, icon: Lock, hint: t.detail.lockTip, run: () => rules.setLock(b.repoPath, b.name, true) };
  const lockedReason = b.locked ? t.detail.lockedNote : undefined;
  // Everyday actions as tiles; the branch's own actions in groups; deleting always last.
  if (!("remote" in b)) {
    const where = b.worktree?.path ?? b.repoPath;
    return [
      { heading: b.name },
      {
        tiles: [
          { label: t.common.openFolder, icon: FolderOpen, run: () => toasts.safely(() => api.openFolder(where)) },
          { label: t.common.openTerminal, icon: SquareTerminal, run: () => toasts.safely(() => api.openTerminal(where)) },
          { label: t.menu.git, icon: GitGraph, run: () => openInGit(b.repoPath) },
          { label: t.menu.copyName, icon: Copy, run: () => toasts.copy(b.name) },
        ],
      },
      { group: t.menu.branch },
      { label: t.menu.log, icon: History, run: () => navigation.openHistory(b.repoPath, { rev: `refs/heads/${b.name}` }) },
      ...(b.behind ? [{ label: t.cleanup.fastForward(b.behind), icon: ArrowDownToLine, hint: t.cleanup.fastForwardHint, run: () => repoActions.fastForward(b) }] : []),
      { label: t.copies.menu, icon: CopyPlus, run: () => dialogs.openCopies(b.repoPath, b.name) },
      commandsItem([b.repoPath], b.name),
      promptItem(b),
      { group: t.menu.protect },
      lockItem,
      ignoreItem(b, false),
      "sep",
      !needsForce(b)
        ? { label: t.cleanup.delete, icon: Trash2, danger: true, keys: "Del", disabled: lockedReason, run: () => deletes.openDelete([b]) }
        : { label: t.cleanup.forceDelete, icon: Trash2, danger: true, keys: "Del", disabled: lockedReason ?? (b.worktree?.isMain ? t.failure.CurrentBranch.hint : undefined), run: () => deletes.openDelete([b], true) },
    ];
  }
  const url = repo?.links ? branchUrl(repo.links, b.name) : undefined;
  const pr = b.pullRequest;
  return [
    { heading: `${b.remote}/${b.name}` },
    {
      tiles: [
        ...(url ? [{ label: t.menu.online, icon: ExternalLink, run: () => toasts.safely(() => api.openUrl(url)) }] : []),
        ...(pr ? [{ label: `PR ${pr.id}`, icon: GitPullRequest, run: () => toasts.safely(() => api.openUrl(pr.url)) }] : []),
        { label: t.menu.git, icon: GitGraph, run: () => openInGit(b.repoPath) },
        { label: t.menu.copyName, icon: Copy, run: () => toasts.copy(b.name) },
      ],
    },
    { group: t.menu.branch },
    {
      label: t.menu.log,
      icon: History,
      hint: `${b.remote}/${b.name}`,
      run: () => navigation.openHistory(b.repoPath, { rev: `refs/remotes/${b.remote}/${b.name}` }),
    },
    { label: t.copies.menu, icon: CopyPlus, run: () => dialogs.openCopies(b.repoPath, b.name) },
    commandsItem([b.repoPath], b.name),
    promptItem(b),
    { group: t.menu.protect },
    lockItem,
    ignoreItem(b, true),
    "sep",
    {
      label: t.cleanup.deleteOnline,
      icon: Trash2,
      danger: true,
      disabled: lockedReason,
      run: () => deletes.openOnlineDelete([b], needsForce(b)),
    },
  ];
}

export function prefixEntries(): MenuEntry[] {
  const stats = cleanupView.prefixCounts;
  const max = Math.max(1, ...stats.map((s) => s.count));
  if (!stats.length) return [{ label: t.cleanup.noPrefixes, disabled: true, run: () => {} }];
  return stats.map((s) => ({
    label: s.prefix ?? t.cleanup.noPrefix,
    count: s.count,
    bar: { ratio: s.count / max, color: s.prefix ? prefixColor(s.prefix) : "var(--faint)" },
    checked: cleanupView.filters.prefixes.includes(s.prefix ?? ""),
    keepOpen: true,
    run: () => cleanupView.togglePrefixFilter(s.prefix),
  }));
}

export function tagEntries(): MenuEntry[] {
  return rules.tags.length
    ? rules.tags.map((tag) => ({ label: tag, checked: cleanupView.filters.tags.includes(tag), keepOpen: true, run: () => cleanupView.toggleTagFilter(tag) }))
    : [{ label: t.cleanup.noTags, disabled: t.cleanup.noTagsHint, run: () => {} }];
}

function reportData(online: boolean, isoDate: (s: number) => string): Report {
  const list: (BranchReport | RemoteBranchReport)[] = online
    ? [...cleanupView.onlineVisible, ...cleanupView.onlineIgnored, ...cleanupView.onlineLocked]
    : [...cleanupView.visible, ...cleanupView.visibleIgnored, ...cleanupView.visibleLocked];
  const scope = online ? t.cleanup.scopeOnline : t.cleanup.scopeLocal;
  return {
    headers: [...t.cleanup.reportHeaders],
    rows: list.map((b) => {
      const status = "remote" in b ? t.onlineVerdict[b.verdict].label : t.verdict[b.verdict].label;
      const ev = b.mergeEvidence ? `${t.mergeKind[b.mergeEvidence.kind]} → ${b.mergeEvidence.target.replace(/^refs\/remotes\//, "")}` : "";
      const a = rules.annotate(b);
      const section = b.locked ? t.cleanup.lockedSection : b.ignored ? t.cleanup.ignoredSection : null;
      return [
        scope,
        section ? `${status} (${section})` : status,
        b.name,
        "remote" in b ? "" : t.cleanup.upstreamState[b.upstreamState],
        repoName(b.repoPath),
        scanResults.copyLabel(b.repoPath) ?? "",
        b.lastCommitAuthor,
        isoDate(b.lastCommitAt),
        b.pullRequest ? `#${b.pullRequest.id}` : "",
        ev,
        a.tags.join(", "),
        a.note.replace(/\s+/g, " "),
      ];
    }),
  };
}

async function saveCsv(online: boolean) {
  const [{ save: saveDialog }, { isoDate, toCsv }] = await Promise.all([import("@tauri-apps/plugin-dialog"), import("$lib/report")]);
  const path = await saveDialog({ defaultPath: "stale-branches.csv", filters: [{ name: t.cleanup.reportFilter, extensions: ["csv"] }] });
  if (!path) return;
  try {
    await api.exportReport(path, toCsv(reportData(online, isoDate)));
    toasts.toast("success", t.cleanup.reportSaved(path));
  } catch (e) {
    toasts.fail(e);
  }
}

export function reportEntries(online: boolean, visibleCount: number, total: number): MenuEntry[] {
  return [
    { heading: t.common.visibleOf(visibleCount, total) },
    {
      label: t.cleanup.reportMd,
      icon: Copy,
      run: () =>
        toasts.safely(async () => {
          const { isoDate, toMarkdown } = await import("$lib/report");
          await navigator.clipboard.writeText(toMarkdown(reportData(online, isoDate)));
          toasts.toast("success", t.cleanup.reportCopied);
        }),
    },
    { label: t.cleanup.reportCsv, icon: FileDown, run: () => saveCsv(online) },
  ];
}
