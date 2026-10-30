/**
 * The column model of every list with columns: order, width and visibility as saved, made valid against
 * the list's own definitions, and the grid template that header, rows and placeholders share. Pure.
 */
import type { ColumnPref } from "$lib/bindings/ColumnPref";

export interface GridColumn {
  id: string;
  /** Default width; for the flexible column its minimum share. */
  width: number;
  min: number;
  /** Takes the remaining width. */
  flex?: boolean;
  /** Off until the user shows it. */
  hidden?: boolean;
}

export interface GridSpec<D extends GridColumn> {
  defs: readonly D[];
  /** The column a row is about: always shown. */
  required: string;
  /** Fixed parts before and after the data columns (a checkbox, row actions), outside the model. */
  lead: number;
  trail: number;
  gap?: number;
  pad?: number;
}

/** Only a guard against a broken layout file; the user may make a column as wide as they like. */
export const MAX_WIDTH = 4000;

const clamp = (d: GridColumn, w: number) => Math.round(Math.min(MAX_WIDTH, Math.max(d.min, w)));

/** The saved layout made valid: known columns once each, new columns at their default place. */
export function validLayout<D extends GridColumn>(spec: GridSpec<D>, saved: ColumnPref[], defs: readonly D[] = spec.defs): ColumnPref[] {
  const out: ColumnPref[] = [];
  for (const p of saved) {
    const d = defs.find((x) => x.id === p.id);
    if (!d || out.some((o) => o.id === p.id)) continue;
    out.push({ id: d.id, width: clamp(d, p.width), visible: d.id === spec.required || p.visible });
  }
  for (const [i, d] of defs.entries()) {
    if (out.some((o) => o.id === d.id)) continue;
    // After the nearest column that precedes it by default, else first.
    const prev = defs.slice(0, i).reverse().find((x) => out.some((o) => o.id === x.id));
    const at = prev ? out.findIndex((o) => o.id === prev.id) + 1 : 0;
    out.splice(at, 0, { id: d.id, width: d.width, visible: !d.hidden });
  }
  return out;
}

export function template<D extends GridColumn>(spec: GridSpec<D>, layout: ColumnPref[]): string {
  const cols = layout.filter((c) => c.visible).map((c) => (spec.defs.find((d) => d.id === c.id)?.flex ? `minmax(${c.width}px, 1fr)` : `${c.width}px`));
  return [...(spec.lead ? [`${spec.lead}px`] : []), ...cols, ...(spec.trail ? [`${spec.trail}px`] : [])].join(" ");
}

/** Width below which the list scrolls sideways instead of squeezing columns. */
export function minWidth<D extends GridColumn>(spec: GridSpec<D>, layout: ColumnPref[]): number {
  const visible = layout.filter((c) => c.visible);
  const gap = spec.gap ?? 12;
  return (spec.pad ?? 32) + spec.lead + spec.trail + visible.reduce((s, c) => s + c.width, 0) + gap * (visible.length + 1);
}

export function move(layout: ColumnPref[], id: string, to: number): ColumnPref[] {
  const from = layout.findIndex((c) => c.id === id);
  if (from < 0) return layout;
  const out = [...layout];
  const [c] = out.splice(from, 1);
  out.splice(Math.max(0, Math.min(out.length, to)), 0, c);
  return out;
}

export function resize<D extends GridColumn>(spec: GridSpec<D>, layout: ColumnPref[], id: string, width: number): ColumnPref[] {
  const d = spec.defs.find((x) => x.id === id);
  return d ? layout.map((c) => (c.id === id ? { ...c, width: clamp(d, width) } : c)) : layout;
}

export function toggle<D extends GridColumn>(spec: GridSpec<D>, layout: ColumnPref[], id: string): ColumnPref[] {
  // The column a row is about stays; without it the list says nothing.
  if (id === spec.required) return layout;
  return layout.map((c) => (c.id === id ? { ...c, visible: !c.visible } : c));
}

/** One step left or right past the next visible column; hidden columns keep their place. */
export function shift(layout: ColumnPref[], id: string, dir: -1 | 1): ColumnPref[] {
  const i = layout.findIndex((c) => c.id === id);
  if (i < 0) return layout;
  let j = i + dir;
  while (j >= 0 && j < layout.length && !layout[j].visible) j += dir;
  if (j < 0 || j >= layout.length) return layout;
  return move(layout, id, j);
}
