// What the diff viewer shows, as plain data: rows for one column or side by side, the pieces of a line
// with their marks, the chosen lines as picks for the backend, and where the hunks and hits are.
import type { DiffLine } from "$lib/bindings/DiffLine";
import type { DiffSource } from "$lib/bindings/DiffSource";
import type { FileDiff } from "$lib/bindings/FileDiff";
import type { HunkPick } from "$lib/bindings/HunkPick";
import type { Hunk } from "$lib/bindings/Hunk";

/** A line of a hunk, with its place in it: the backend picks lines by these indexes. */
export interface LineRef {
  hunk: number;
  index: number;
  line: DiffLine;
}

export type UnifiedRow = { kind: "hunk"; key: string; hunk: number; h: Hunk } | ({ kind: "line"; key: string } & LineRef);
export type SplitRow =
  | { kind: "hunk"; key: string; hunk: number; h: Hunk }
  | { kind: "pair"; key: string; hunk: number; left: LineRef | null; right: LineRef | null };

export function unifiedRows(diff: FileDiff): UnifiedRow[] {
  const out: UnifiedRow[] = [];
  diff.hunks.forEach((h, hunk) => {
    out.push({ kind: "hunk", key: `h${hunk}`, hunk, h });
    h.lines.forEach((line, index) => out.push({ kind: "line", key: `h${hunk}l${index}`, hunk, index, line }));
  });
  return out;
}

/**
 * Side by side: unchanged lines on both sides, a run of deletions next to the run of additions that
 * follows it, line by line; the shorter run is padded with empty cells. Meta lines ("no newline")
 * stay on the side of the line they belong to.
 */
export function splitRows(diff: FileDiff): SplitRow[] {
  const out: SplitRow[] = [];
  diff.hunks.forEach((h, hunk) => {
    out.push({ kind: "hunk", key: `h${hunk}`, hunk, h });
    const ref = (index: number): LineRef => ({ hunk, index, line: h.lines[index] });
    let i = 0;
    let n = 0;
    const push = (left: LineRef | null, right: LineRef | null) => out.push({ kind: "pair", key: `h${hunk}p${n++}`, hunk, left, right });
    while (i < h.lines.length) {
      const kind = h.lines[i].kind;
      if (kind === "Context") {
        push(ref(i), ref(i));
        i++;
        continue;
      }
      if (kind === "Meta") {
        const prev = h.lines[i - 1]?.kind;
        push(prev === "Add" ? null : ref(i), prev === "Del" ? null : ref(i));
        i++;
        continue;
      }
      const dels: number[] = [];
      const adds: number[] = [];
      while (i < h.lines.length && h.lines[i].kind === "Del") dels.push(i++);
      while (i < h.lines.length && h.lines[i].kind === "Add") adds.push(i++);
      for (let k = 0; k < Math.max(dels.length, adds.length); k++) push(k < dels.length ? ref(dels[k]) : null, k < adds.length ? ref(adds[k]) : null);
    }
  });
  return out;
}

/** Columns a line takes in a monospace font, tabs to the next stop. */
export function columns(text: string, tab = 8): number {
  let n = 0;
  for (const c of text) n = c === "\t" ? n + tab - (n % tab) : n + 1;
  return n;
}

/** The line a side of a pair shows: the old side has no additions, the new side no deletions. */
export const sideOf = (r: SplitRow & { kind: "pair" }, side: 0 | 1): LineRef | null => {
  const ref = side === 0 ? r.left : r.right;
  return ref && (side === 0 ? ref.line.kind !== "Add" : ref.line.kind !== "Del") ? ref : null;
};

/**
 * Per side of the split view, the widest line and whether a line-ending mark shows: the width a side
 * can scroll sideways is measured from this one line instead of from every row.
 */
export function widest(rows: SplitRow[]): [{ text: string; eol: boolean }, { text: string; eol: boolean }] {
  const out: [{ text: string; eol: boolean; cols: number }, { text: string; eol: boolean; cols: number }] = [
    { text: "", eol: false, cols: 0 },
    { text: "", eol: false, cols: 0 },
  ];
  for (const r of rows) {
    if (r.kind !== "pair") continue;
    for (const s of [0, 1] as const) {
      const ref = sideOf(r, s);
      if (!ref) continue;
      const cols = columns(ref.line.text);
      if (cols > out[s].cols) Object.assign(out[s], { text: ref.line.text, cols });
      if (ref.line.eol) out[s].eol = true;
    }
  }
  return [
    { text: out[0].text, eol: out[0].eol },
    { text: out[1].text, eol: out[1].eol },
  ];
}

export interface Span {
  text: string;
  /** Syntax colour class, empty for plain text. */
  cls: string;
  /** Inside a changed word range. */
  changed: boolean;
}

/**
 * A line as spans: its syntax pieces (or the plain text) cut again at the changed ranges, which are
 * UTF-16 offsets as JS slices strings. Pieces that do not add up to the text are ignored.
 */
export function styled(line: DiffLine, pieces?: { text: string; cls: string }[]): Span[] {
  const base = pieces?.length && pieces.map((p) => p.text).join("") === line.text ? pieces : [{ text: line.text, cls: "" }];
  const out: Span[] = [];
  let at = 0;
  for (const p of base) {
    let s = 0;
    while (s < p.text.length) {
      const pos = at + s;
      const inside = line.changed.find(([a, b]) => pos >= a && pos < b);
      const next = inside ? inside[1] : (line.changed.find(([a]) => a > pos)?.[0] ?? Infinity);
      const len = Math.min(p.text.length - s, next - pos);
      out.push({ text: p.text.slice(s, s + len), cls: p.cls, changed: !!inside });
      s += len;
    }
    at += p.text.length;
  }
  return out;
}

export const lineKey = (hunk: number, index: number) => `${hunk}:${index}`;
export const isChange = (l: DiffLine) => l.kind === "Add" || l.kind === "Del";

/** Chosen lines as picks: per hunk the line indexes, or the whole hunk where every change is chosen. */
export function picksFor(diff: FileDiff, chosen: Set<string>): HunkPick[] {
  const out: HunkPick[] = [];
  diff.hunks.forEach((h, hunk) => {
    const changes = h.lines.map((l, i) => (isChange(l) ? i : -1)).filter((i) => i >= 0);
    const lines = changes.filter((i) => chosen.has(lineKey(hunk, i)));
    if (!lines.length) return;
    out.push({ hunk, header: h.header, lines: lines.length === changes.length ? null : lines });
  });
  return out;
}

/**
 * What the chosen lines refer to. The diff is fetched again on every refresh; while this stays the same,
 * the choice is still valid and must survive.
 */
export const choiceScope = (diff: FileDiff, source: DiffSource | null) =>
  [diff.path, source ?? "", ...diff.hunks.map((h) => h.header + "\n" + h.lines.map((l) => l.kind + l.text).join("\n"))].join("\0");

export const hunkPick =(diff: FileDiff, hunk: number): HunkPick => ({ hunk, header: diff.hunks[hunk].header, lines: null });

/** Why lines of this diff cannot be staged one by one, or null when they can. */
export function partialBlock(diff: FileDiff, source: DiffSource | null, whitespace: string): "source" | "whitespace" | "truncated" | "wholeFile" | null {
  if (!source || (source !== "Unstaged" && source !== "Staged") || diff.conflict || diff.binary) return "source";
  if (whitespace !== "Keep") return "whitespace";
  if (diff.truncated) return "truncated";
  // Added or deleted files: git moves them as a whole.
  if (diff.hunks.some((h) => (h.oldStart === 0 && h.oldLines === 0) || (h.newStart === 0 && h.newLines === 0))) return "wholeFile";
  return null;
}

/** Row indexes where a hunk starts, for next/previous. */
export const hunkRows = (rows: { kind: string }[]) => rows.flatMap((r, i) => (r.kind === "hunk" ? [i] : []));

/** The next start after `at`, or the previous one before it; stays put at the ends. */
export function step(starts: number[], at: number, dir: 1 | -1): number | null {
  if (!starts.length) return null;
  if (dir === 1) return starts.find((s) => s > at) ?? null;
  return [...starts].reverse().find((s) => s < at) ?? null;
}

/** Rows whose text contains the query, case-insensitively. */
export function hits(rows: (UnifiedRow | SplitRow)[], query: string): number[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const has = (r: LineRef | null) => !!r && r.line.text.toLowerCase().includes(q);
  return rows.flatMap((r, i) => (r.kind === "line" ? has(r) : r.kind === "pair" ? has(r.left) || has(r.right) : false) ? [i] : []);
}

/** The marker strip has only so many pixels; rows share a mark per slot. */
const SLOTS = 400;

/**
 * Where changes sit in the file, as fractions of its rows: the strip beside the scrollbar. One mark
 * per slot; a deletion wins, it is the change that loses something.
 */
export function markers(rows: (UnifiedRow | SplitRow)[]): { at: number; kind: "Add" | "Del" }[] {
  const n = rows.length || 1;
  const bySlot = new Map<number, "Add" | "Del">();
  rows.forEach((r, i) => {
    const kinds = r.kind === "line" ? [r.line.kind] : r.kind === "pair" ? [r.left?.line.kind, r.right?.line.kind] : [];
    const kind = kinds.includes("Del") ? "Del" : kinds.includes("Add") ? "Add" : null;
    if (!kind) return;
    const slot = Math.floor((i / n) * SLOTS);
    if (bySlot.get(slot) !== "Del") bySlot.set(slot, kind);
  });
  return [...bySlot].map(([slot, kind]) => ({ at: slot / SLOTS, kind }));
}

/** A hunk, or the chosen lines of it, as patch text for the clipboard. */
export function patchText(diff: FileDiff, hunk: number, chosen?: Set<string>): string {
  const h = diff.hunks[hunk];
  const body = h.lines
    .map((l, i) => {
      const on = !chosen || chosen.has(lineKey(hunk, i));
      if (l.kind === "Meta") return l.text;
      if (l.kind === "Context") return ` ${l.text}`;
      if (!on) return l.kind === "Del" ? ` ${l.text}` : null;
      return `${l.kind === "Add" ? "+" : "-"}${l.text}`;
    })
    .filter((l): l is string => l !== null);
  return [h.header, ...body].join("\n") + "\n";
}
