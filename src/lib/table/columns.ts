/** Columns of the cleanup table: one model for header, rows and skeleton. Pure. */
import type { CleanupScope } from "$lib/bindings/CleanupScope";
import type { ColumnPref } from "$lib/bindings/ColumnPref";
import type { TableGroup } from "$lib/bindings/TableGroup";
import type { Facet, SortKey } from "$lib/filter";
import { minWidth, move, resize, shift, template, toggle, validLayout, type GridSpec } from "./gridModel";

export type ColumnId = "status" | "branch" | "repo" | "author" | "commit" | "pr" | "local" | "source";

export interface ColumnDef {
  id: ColumnId;
  /** Default width; for the flexible branch column its minimum share. */
  width: number;
  min: number;
  /** Takes the remaining width. */
  flex?: boolean;
  sort?: SortKey;
  facet?: Facet;
  group?: TableGroup;
  /** Shown in this scope only. */
  scope?: CleanupScope;
  /** Off until the user shows it. */
  hidden?: boolean;
}

export const COLUMNS: readonly ColumnDef[] = [
  { id: "status", width: 92, min: 60, sort: "verdict", facet: "verdict", group: "Verdict" },
  { id: "branch", width: 220, min: 160, flex: true, sort: "name", facet: "prefix", group: "Prefix" },
  { id: "repo", width: 150, min: 80, sort: "repo", facet: "repo", group: "Repo" },
  { id: "author", width: 150, min: 80, sort: "author", facet: "author", group: "Author" },
  { id: "commit", width: 104, min: 72, sort: "lastCommitAt", facet: "age" },
  { id: "pr", width: 72, min: 56, facet: "pr" },
  { id: "local", width: 112, min: 72, facet: "local", scope: "Online" },
  { id: "source", width: 150, min: 96, scope: "Online", hidden: true },
];

export { MAX_WIDTH } from "./gridModel";

/** Checkbox and row actions are fixed, outside the model: they belong to the row, not to data. */
const SPEC: GridSpec<ColumnDef> = { defs: COLUMNS, required: "branch", lead: 16, trail: 28 };

export const columnDef = (id: string) => COLUMNS.find((c) => c.id === id);
const inScope = (d: ColumnDef, scope: CleanupScope) => !d.scope || d.scope === scope;

/** The saved layout made valid for a scope: known columns once each, new columns at their default place. */
export const layoutFor = (scope: CleanupScope, saved: ColumnPref[]) => validLayout(SPEC, saved, COLUMNS.filter((d) => inScope(d, scope)));

/**
 * The layout as shown while grouped: the column the rows are grouped by says in every row what the
 * group header already says, so it steps aside. The branch column stays; a row is about its branch.
 */
export function withoutGrouped(layout: ColumnPref[], group: TableGroup): ColumnPref[] {
  const id = COLUMNS.find((d) => d.group === group && d.id !== "branch")?.id;
  return id ? layout.map((c) => (c.id === id ? { ...c, visible: false } : c)) : layout;
}

export const gridTemplate = (layout: ColumnPref[]) => template(SPEC, layout);
/** Width below which the table scrolls sideways instead of squeezing columns. */
export const minTableWidth = (layout: ColumnPref[]) => minWidth(SPEC, layout);
export const moveColumn = move;
/** A column dropped on another: before or after it, as the drag line showed. */
export const moveColumnBeside = (layout: ColumnPref[], id: string, over: string, after: boolean) =>
  move(layout, id, layout.filter((c) => c.id !== id).findIndex((c) => c.id === over) + (after ? 1 : 0));
export const resizeColumn = (layout: ColumnPref[], id: string, width: number) => resize(SPEC, layout, id, width);
export const toggleColumn = (layout: ColumnPref[], id: string) => toggle(SPEC, layout, id);
export const shiftColumn = shift;
