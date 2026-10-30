// The rows of the branch table as data: branches, group heads and the ignored and locked sections, in
// the order the list shows them. Pure, so the shape of the list is tested without a DOM.
import type { BranchReport } from "$lib/bindings/BranchReport";
import type { OnlineVerdict } from "$lib/bindings/OnlineVerdict";
import type { RemoteBranchReport } from "$lib/bindings/RemoteBranchReport";
import type { TableGroup } from "$lib/bindings/TableGroup";
import type { Verdict } from "$lib/bindings/Verdict";
import { branchKey, onlineKey, ONLINE_VERDICTS, VERDICTS } from "$lib/filter";
import { groupId, SINGLE_NAMES, type Grouped } from "$lib/groups";

export type AnyBranch = BranchReport | RemoteBranchReport;
export type Section = "ignored" | "locked";

/**
 * `grouped`: inside a group, drawn with its bar; `underName`: in a group of one branch name, whose
 * header already says the name.
 */
type Place = { alt: boolean; grouped: boolean; underName: boolean };
export type BranchRow = ({ kind: "local"; b: BranchReport; key: string } & Place) | ({ kind: "online"; b: RemoteBranchReport; key: string } & Place);
export type VerdictCount = { verdict?: Verdict; online?: OnlineVerdict; n: number };
export interface GroupRow {
  kind: "group";
  id: string;
  label: string;
  title: string;
  items: AnyBranch[];
  open: boolean;
  key: string;
  name: string | null;
  /** The keys of its branches that "delete all" would take, so they can be marked together. */
  markable: string[];
  /** How many of its branches have each verdict, in the order of the status filter. */
  counts: VerdictCount[];
}
export type Row = BranchRow | { kind: "section"; section: Section; count: number; key: string } | GroupRow;

export const rowKey = (b: AnyBranch) => ("remote" in b ? onlineKey(b) : branchKey(b));

// Zebra counts per group, so every group starts on the same shade.
export const toRows = (list: AnyBranch[], grouped = false, underName = false): BranchRow[] =>
  list.map((b, n) => {
    const place = { alt: n % 2 === 1, grouped, underName };
    return "remote" in b ? { kind: "online", b, key: onlineKey(b), ...place } : { kind: "local", b, key: branchKey(b), ...place };
  });

export function verdictCounts(list: AnyBranch[], online: boolean): VerdictCount[] {
  const n = new Map<string, number>();
  for (const b of list) n.set(b.verdict, (n.get(b.verdict) ?? 0) + 1);
  return online ? ONLINE_VERDICTS.map((v) => ({ online: v, n: n.get(v) ?? 0 })) : VERDICTS.map((v) => ({ verdict: v, n: n.get(v) ?? 0 }));
}

export interface RowContext {
  by: TableGroup;
  online: boolean;
  grouped: (list: AnyBranch[]) => Grouped<AnyBranch>[];
  /** Keys of the branches "delete all" takes. */
  deletable: ReadonlySet<string>;
}

function withGroups(list: AnyBranch[], where: string, ctx: RowContext): Row[] {
  const { by } = ctx;
  return ctx.grouped(list).flatMap((g): Row[] => {
    if (by === "None") return toRows(g.items);
    const id = groupId(by, g.key);
    const title = by === "Folder" ? g.key : g.label;
    // Grouped by name, a header stands for one branch in several repos; the "one repo only" group does not.
    const name = by === "Name" && g.key !== SINGLE_NAMES ? g.label : null;
    const head: GroupRow = {
      kind: "group",
      id,
      label: g.label,
      title,
      items: g.items,
      open: g.open,
      key: `::group::${where}::${id}`,
      name,
      markable: g.items.map(rowKey).filter((k) => ctx.deletable.has(k)),
      counts: verdictCounts(g.items, ctx.online),
    };
    return [head, ...(g.open ? toRows(g.items, true, !!name) : [])];
  });
}

/** The active rows first, then each section that has branches: its head, and its rows while open. */
export function tableRows(lists: { main: AnyBranch[]; ignored: AnyBranch[]; locked: AnyBranch[] }, sectionOpen: Record<Section, boolean>, ctx: RowContext): Row[] {
  const out = withGroups(lists.main, "main", ctx);
  for (const section of ["ignored", "locked"] as const) {
    const list = lists[section];
    if (!list.length) continue;
    out.push({ kind: "section", section, count: list.length, key: `::${section}` });
    if (sectionOpen[section]) out.push(...withGroups(list, section, ctx));
  }
  return out;
}
