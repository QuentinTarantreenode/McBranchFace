import { gestureHints } from "./gestures";
import { currentHome, homeRelative, pathPieces, setHome } from "$lib/paths";
import { nameParts, prefixColor, refParts } from "$lib/branchName";

/**
 * Tooltip as a Svelte action: `use:tooltip={"Text"}` or `use:tooltip={{ title, text, sections, … }}`.
 * One shared element that follows the cursor. Rules (see ui-layout skill): only when the element
 * does not explain itself (icon only, collapsed, truncated) or there is something to explain.
 * Rich tips have a head (title, keys, path, pills) and cards below it, one card per kind of content.
 */
export type TooltipTone = "safe" | "review" | "unsafe" | "blocked" | "accent" | "muted";

/** How a value is set: paths and URLs break only after a separator, counts are tabular, branches show their prefix pill. */
export type TooltipValueKind = "text" | "mono" | "path" | "url" | "count" | "branch";

export interface TooltipPill {
  text: string;
  color: string;
}

export interface TooltipRow {
  label?: string;
  value: string;
  kind?: TooltipValueKind;
  tone?: TooltipTone;
  /** Coloured label in front of the value, e.g. the working-copy label. */
  pill?: TooltipPill;
  /** Marks the entry the tip belongs to, in a list of its siblings. */
  current?: string;
  /** A faint word or arrow in front of the value, e.g. "→" before an upstream. */
  lead?: string;
}

export interface TooltipBar {
  label: string;
  count: number;
  color: string;
}

export interface TooltipSection {
  /** Small caps heading of the card. */
  title?: string;
  /** Faint line under the heading, e.g. the folder a list of relative paths is below. */
  note?: string;
  noteKind?: TooltipValueKind;
  text?: string;
  /** Full-width lines before the rows, for values too long for the value column (branch → upstream). */
  lines?: TooltipRow[];
  rows?: (TooltipRow | [string, string])[];
  /** Values of tuple rows are paths, refs or SHAs. */
  mono?: boolean;
  /** Horizontal bars for a distribution, scaled to the largest count. */
  bars?: TooltipBar[];
}

export interface TooltipContent {
  /** Header line, bold. */
  title?: string;
  /**
   * Keep clear of what it explains: still at the cursor's height, but beside the element ("element") or
   * beside the box around it (a selector, e.g. "[role=menu]") wherever there is room.
   */
  beside?: "element" | string;
  /** Path of the thing, once, in the head. */
  path?: string;
  keys?: string;
  /** Coloured labels in the head, e.g. tags or the working-copy label. */
  pills?: TooltipPill[];
  /** Body text under the head. */
  text?: string;
  /** Small two-column table: label, value. */
  rows?: (TooltipRow | [string, string])[];
  /** Cards below the head, one per kind of content. */
  sections?: TooltipSection[];
  /** Last, faint hint line. Not for data: data belongs in the head or a card. */
  foot?: string;
  /**
   * The gestures of the element and its ancestors (double click, context menu) join the foot, as they
   * registered themselves: a tip says what an element does only when it does it (see gestures.ts).
   */
  gestures?: boolean;
  /** Up to 420 px instead of 340 px, for content with paths. */
  wide?: boolean;
  /** Only while the element's own text is cut off (see fullText). */
  overflow?: boolean;
}
export type TooltipInput = string | TooltipContent | null | undefined;
/**
 * A function is called only when the tip shows: rows of a long list must not each build theirs. It may
 * answer with a promise, so a large builder loads on the first hover instead of with the start page.
 * `wanted` says whether the pointer is still there: a builder that would read from git asks it first, so a
 * pointer passing over many rows starts nothing.
 */
export type TooltipSource = TooltipInput | ((wanted: () => boolean) => TooltipInput | Promise<TooltipInput>);

const OFFSET = { x: 14, y: 20 };
const MARGIN = 6;

let tip: HTMLDivElement | null = null;
let owner: HTMLElement | null = null;
let cursor = { x: 0, y: 0 };
let frame = 0;
/** Paths below this folder show as `~\…`, in tips and in PathText. */
export const setTooltipHome = setHome;

const hasSection = (s: TooltipSection) => !!(s.text || s.rows?.length || s.bars?.length);

function normalize(input: TooltipInput): TooltipContent | null {
  if (!input) return null;
  const c = typeof input === "string" ? { text: input } : input;
  return c.title || c.path || c.text || c.rows?.length || c.pills?.length || c.keys || c.sections?.some(hasSection) || c.foot ? c : null;
}

/** Below-right of the cursor; flips to the other side where the viewport ends. Pure, unit-tested. */
export function place(
  at: { x: number; y: number },
  size: { w: number; h: number },
  view: { w: number; h: number },
): { x: number; y: number } {
  let x = at.x + OFFSET.x;
  let y = at.y + OFFSET.y;
  if (x + size.w > view.w - MARGIN) x = at.x - OFFSET.x - size.w;
  if (y + size.h > view.h - MARGIN) y = at.y - OFFSET.y / 2 - size.h;
  // The anchor itself can lie beyond an edge (keyboard focus on a row cut off at the bottom).
  x = Math.max(MARGIN, Math.min(x, view.w - MARGIN - size.w));
  y = Math.max(MARGIN, Math.min(y, view.h - MARGIN - size.h));
  return { x: Math.round(x), y: Math.round(y) };
}

/**
 * Beside a box, at the cursor's height: right of it, else left of it; where neither side has room, at the
 * cursor as usual. Pure, unit-tested.
 */
export function placeBeside(
  at: { x: number; y: number },
  size: { w: number; h: number },
  view: { w: number; h: number },
  box: { left: number; right: number },
): { x: number; y: number } {
  const gap = 8;
  const y = Math.round(Math.max(MARGIN, Math.min(at.y - size.h / 2, view.h - MARGIN - size.h)));
  if (box.right + gap + size.w <= view.w - MARGIN) return { x: Math.round(box.right + gap), y };
  if (box.left - gap - size.w >= MARGIN) return { x: Math.round(box.left - gap - size.w), y };
  return place(at, size, view);
}

let watching = false;
function watchScroll() {
  if (watching) return;
  watching = true;
  const quiet = () => {
    if (owner) hide();
  };
  window.addEventListener("wheel", quiet, { capture: true, passive: true });
  window.addEventListener("scroll", quiet, { capture: true, passive: true });
}

function element(): HTMLDivElement {
  // A reloaded module (hot reload) finds the element it made before instead of adding a second one.
  tip ??= document.querySelector<HTMLDivElement>("body > .mbf-tooltip");
  if (!tip) {
    tip = document.createElement("div");
    tip.setAttribute("role", "tooltip");
    tip.className = "mbf-tooltip";
    document.body.appendChild(tip);
    // Content can still grow after it was placed (fonts, lazy parts); placed again, it stays inside.
    if ("ResizeObserver" in window) new ResizeObserver(() => owner && schedule()).observe(tip);
  }
  return tip;
}

// Built with textContent only: tips carry branch names, paths and commit subjects.
function add(parent: HTMLElement, tag: string, cls: string, text = "") {
  const e = document.createElement(tag);
  e.className = cls;
  if (text) e.textContent = text;
  parent.appendChild(e);
  return e;
}

/** A path that wraps after separators only: each piece keeps its hyphens and dots together. */
function pathInto(parent: HTMLElement, p: string) {
  piecesInto(parent, homeRelative(p, currentHome()));
}

// No path normalising here: it would fold the "//" after the scheme.
function piecesInto(parent: HTMLElement, p: string) {
  for (const piece of pathPieces(p)) {
    add(parent, "span", "mbf-tooltip-piece", piece);
    parent.appendChild(document.createElement("wbr"));
  }
}

/** The same powerline segments as the BranchName component, in the small size. */
// The same segments as BranchName; any ref form, the remote joins the muted lead.
function branchInto(parent: HTMLElement, ref: string) {
  const { remote, name } = refParts(ref);
  const parts = nameParts(name);
  const segs = add(parent, "span", "mbf-segs mbf-segs-xs");
  const lead = [remote, parts.namespace].filter(Boolean).join("/");
  if (lead) add(segs, "span", "mbf-seg mbf-seg-lead", lead);
  if (parts.prefix) add(segs, "span", "mbf-seg mbf-seg-color", parts.prefix).style.setProperty("--seg", prefixColor(parts.prefix));
  // A break point after every "/", so a long name wraps at its parts, not mid-word.
  const rest = add(segs, "span", "mbf-seg mbf-seg-rest");
  parts.rest.split("/").forEach((piece, i) => {
    if (i > 0) rest.append("/", document.createElement("wbr"));
    rest.append(piece);
  });
  return parent;
}

function value(parent: HTMLElement, text: string, kind: TooltipValueKind = "text", tone?: TooltipTone) {
  const cls = `mbf-tooltip-value mbf-tooltip-${kind}${tone ? ` mbf-tone-${tone}` : ""}`;
  if (kind === "branch") return branchInto(add(parent, "span", cls.replace("mbf-tooltip-branch", "mbf-tooltip-branch mbf-tooltip-mono")), text);
  if (kind !== "path" && kind !== "url") return add(parent, "span", cls, text);
  const e = add(parent, "span", cls);
  if (kind === "url") piecesInto(e, text);
  else pathInto(e, text);
  return e;
}

function pill(parent: HTMLElement, p: TooltipPill) {
  add(parent, "span", "mbf-tooltip-pill", p.text).style.setProperty("--pill", p.color);
}

function rowsInto(parent: HTMLElement, list: (TooltipRow | [string, string])[], mono: boolean) {
  const rows = list.map((r): TooltipRow => (Array.isArray(r) ? { label: r[0], value: r[1], kind: mono ? "mono" : "text" } : r));
  // Among labelled rows a pill names its row like a label does: in the value column it would take the
  // width the value needs, and a branch name beside it broke after every other letter.
  const labelled = rows.some((r) => r.label || r.pill);
  const table = add(parent, "div", labelled ? "mbf-tooltip-rows" : "mbf-tooltip-list");
  for (const r of rows) {
    if (labelled) {
      const label = add(table, "span", "mbf-tooltip-label", r.label ?? "");
      if (r.pill && !r.label) pill(label, r.pill);
    }
    const cell = add(table, "span", "mbf-tooltip-cell");
    if (r.lead) add(cell, "span", "mbf-tooltip-current", r.lead);
    if (r.pill && r.label) pill(cell, r.pill);
    value(cell, r.value, r.kind, r.tone);
    if (r.current) add(cell, "span", "mbf-tooltip-current", r.current);
  }
}

function barsInto(parent: HTMLElement, bars: TooltipBar[]) {
  const max = Math.max(1, ...bars.map((b) => b.count));
  const box = add(parent, "div", "mbf-tooltip-bars");
  for (const b of bars) {
    add(box, "span", "mbf-tooltip-label", b.label);
    const track = add(box, "span", "mbf-tooltip-bar");
    const fill = add(track, "span", "mbf-tooltip-bar-fill");
    fill.style.width = `${Math.max(4, Math.round((b.count / max) * 100))}%`;
    fill.style.setProperty("--pill", b.color);
    add(box, "span", "mbf-tooltip-value mbf-tooltip-count", String(b.count));
  }
}

function render(c: TooltipContent) {
  const t = element();
  t.replaceChildren();
  const sections = (c.sections ?? []).filter(hasSection);
  const hasBody = !!(c.text || c.rows?.length || sections.length || c.foot);
  // Without a title the shortcut sits beside the text; a head band holding only a key looks broken.
  const keysInText = !c.title && !!c.keys && !!c.text && !c.path && !c.pills?.length;
  const hasHead = !keysInText && !!(c.title || c.keys || c.path || c.pills?.length);

  if (hasHead) {
    const head = add(t, "div", "mbf-tooltip-head");
    if (c.title || c.keys) {
      const line = add(head, "div", "mbf-tooltip-headline");
      if (c.title) add(line, "span", "mbf-tooltip-title", c.title);
      if (c.keys) add(line, "kbd", "mbf-tooltip-keys", c.keys);
    }
    if (c.path) pathInto(add(head, "div", c.title ? "mbf-tooltip-path" : "mbf-tooltip-path mbf-tooltip-plain"), c.path);
    if (c.pills?.length) {
      const box = add(head, "div", "mbf-tooltip-pills");
      for (const p of c.pills) pill(box, p);
    }
  }
  if (hasBody) {
    const body = add(t, "div", "mbf-tooltip-body");
    if (keysInText) {
      const line = add(body, "div", "mbf-tooltip-headline");
      add(line, "span", "mbf-tooltip-text mbf-tooltip-plain", c.text!);
      add(line, "kbd", "mbf-tooltip-keys", c.keys!);
    } else if (c.text) add(body, "div", hasHead ? "mbf-tooltip-text" : "mbf-tooltip-text mbf-tooltip-plain", c.text);
    if (c.rows?.length) rowsInto(body, c.rows, false);
    for (const s of sections) {
      const card = add(body, "div", "mbf-tooltip-section");
      if (s.title) add(card, "div", "mbf-tooltip-section-title", s.title);
      if (s.note) value(add(card, "div", "mbf-tooltip-note"), s.note, s.noteKind);
      if (s.text) add(card, "div", s.mono ? "mbf-tooltip-text mbf-tooltip-mono" : "mbf-tooltip-text", s.text);
      if (s.lines?.length) rowsInto(card, s.lines.map((l) => ({ ...l, label: undefined, pill: undefined })), false);
      if (s.lines?.length && s.rows?.length) add(card, "div", "mbf-tooltip-gap");
      if (s.rows?.length) rowsInto(card, s.rows, !!s.mono);
      if (s.bars?.length) barsInto(card, s.bars);
    }
    if (c.foot) add(body, "div", "mbf-tooltip-foot", c.foot);
  }
  t.toggleAttribute("data-wide", !!c.wide);
  t.toggleAttribute("data-rich", hasHead && hasBody);
  t.toggleAttribute("data-cards", sections.length > 0);
}

let beside: TooltipContent["beside"];

function position() {
  frame = 0;
  if (!tip || !owner) return;
  const size = { w: tip.offsetWidth, h: tip.offsetHeight };
  const view = { w: innerWidth, h: innerHeight };
  const box = beside ? (beside === "element" ? owner : (owner.closest<HTMLElement>(beside) ?? owner)).getBoundingClientRect() : null;
  const p = box ? placeBeside(cursor, size, view, box) : place(cursor, size, view);
  // On whole device pixels: the pointer lands between them at 125 % or 150 % scaling, and text placed
  // there is drawn soft.
  const px = (v: number) => Math.round(v * devicePixelRatio) / devicePixelRatio;
  tip.style.transform = `translate(${px(p.x)}px, ${px(p.y)}px)`;
}

function schedule() {
  if (!frame) frame = requestAnimationFrame(position);
}

function show(node: HTMLElement, c: TooltipContent, at?: { x: number; y: number }) {
  const hints = c.gestures ? gestureHints(node) : [];
  // One line each: a status ("Angemeldet als …") and gesture sentences do not run into one line.
  render(hints.length ? { ...c, foot: [c.foot, ...hints].filter(Boolean).join("\n") } : c);
  owner = node;
  beside = c.beside;
  if (at) cursor = at;
  element().dataset.open = "";
  position();
}

function hide() {
  if (tip && owner) {
    delete tip.dataset.open;
  }
  owner = null;
}

// Keyboard focus has no cursor: the tip sits below the element instead.
function anchorOf(node: HTMLElement) {
  const r = node.getBoundingClientRect();
  return { x: r.left, y: r.bottom - OFFSET.y + 6 };
}

const isCut = (node: HTMLElement) => node.scrollWidth > node.clientWidth + 1;

/** For text that may be truncated: the full text as tooltip, shown only while it is cut off. */
export function fullText(node: HTMLElement, text: string | null | undefined) {
  const wrap = (t: string | null | undefined): TooltipInput => (t ? { text: t, overflow: true } : null);
  const action = tooltip(node, wrap(text));
  return { update: (next: string | null | undefined) => action.update(wrap(next)), destroy: action.destroy };
}

export function tooltip(node: HTMLElement, input: TooltipSource) {
  watchScroll();
  let source = input;
  const lazy = () => typeof source === "function";
  // A lazy tip is built on demand; until then only "there is one" is known.
  let content = lazy() ? null : normalize(source as TooltipInput);
  // Leaving, pressing or a newer request voids an answer still loading.
  let ticket = 0;
  const current = (then: (c: TooltipContent | null) => void) => {
    const mine = ++ticket;
    if (!lazy()) return then(content);
    const done = (v: TooltipInput) => mine === ticket && then(normalize(v));
    const v = (source as (wanted: () => boolean) => TooltipInput | Promise<TooltipInput>)(() => mine === ticket);
    if (v instanceof Promise) v.then(done, () => {});
    else done(v);
  };
  // Marker for audits and tests: this element explains itself on hover.
  const mark = () => (lazy() || content ? (node.dataset.tip = content?.overflow ? "overflow" : "") : delete node.dataset.tip);
  mark();

  const enter = (e: PointerEvent) => {
    if ((!content && !lazy()) || e.pointerType === "touch") return;
    if (content?.overflow && !isCut(node)) return;
    cursor = { x: e.clientX, y: e.clientY };
    const open = () => current((c) => c && show(node, c));
    // Every tip shows at once and follows the cursor: one behaviour everywhere, no waiting game.
    open();
  };
  const move = (e: PointerEvent) => {
    cursor = { x: e.clientX, y: e.clientY };
    if (owner === node) schedule();
  };
  const cancel = () => {
    ticket++;
    if (owner === node) hide();
  };
  const focus = () => {
    if (!node.matches(":focus-visible")) return;
    current((c) => c && (!c.overflow || isCut(node)) && show(node, c, anchorOf(node)));
  };
  const key = (e: KeyboardEvent) => e.key === "Escape" && cancel();
  node.addEventListener("pointerenter", enter);
  node.addEventListener("pointermove", move);
  node.addEventListener("pointerleave", cancel);
  node.addEventListener("pointerdown", cancel);
  node.addEventListener("focusin", focus);
  node.addEventListener("focusout", cancel);
  node.addEventListener("keydown", key);
  return {
    update(next: TooltipSource) {
      source = next;
      content = lazy() ? null : normalize(next as TooltipInput);
      mark();
      if (owner !== node) return;
      current((c) => (c ? show(node, c) : hide()));
    },
    destroy() {
      cancel();
      node.removeEventListener("pointerenter", enter);
      node.removeEventListener("pointermove", move);
      node.removeEventListener("pointerleave", cancel);
      node.removeEventListener("pointerdown", cancel);
      node.removeEventListener("focusin", focus);
      node.removeEventListener("focusout", cancel);
      node.removeEventListener("keydown", key);
    },
  };
}
