// The list of changes as rows of a virtual list: the tree of folders, repos, status groups and directories,
// flattened. Each row carries what it draws of the tree around it (the guide lines of the levels above it,
// its piece of the repo's identity line) and which heads stay at the top while it scrolls under them. Pure.
import type { RepoStatus } from "$lib/bindings/RepoStatus";
import { byDirectory, partlyStaged, type ChangeGroup, type ChangeRow, type GroupId } from "./changes";

export interface RepoBlock {
  path: string;
  st: RepoStatus | undefined;
  groups: ChangeGroup[];
}

export interface FolderBlocks {
  root: string;
  changed: RepoBlock[];
  pending: RepoBlock[];
}

/** Which groups are open; the lists fold the same way as before they were flattened. */
export interface Openness {
  repo: (path: string) => boolean;
  folder: (root: string) => boolean;
  status: (id: GroupId) => boolean;
  dir: (key: string) => boolean;
  clean: boolean;
}

/** Where a row sits on its repo's identity line: the line starts below the head's top and ends above the last row's bottom. */
export type IdPiece = "first" | "mid" | "last" | "only";

export type ChangesItem = {
  key: string;
  /** Guide lines outside the repo's identity line (the folder's), and inside it (repo, status, directory). */
  outer: number;
  inner: number;
  /** The repo whose identity line the row carries, and its piece of it; null outside a repo. */
  repo: string | null;
  id: IdPiece | null;
  /** The row's own height and, below it, the gap to the next block at the top level; in rem, as the CSS has them. */
  height: number;
  gap: number;
  /** The folder head and the repo head the row belongs to (-1: none): they stay at the top while it scrolls. */
  folderAt: number;
  repoAt: number;
} & (
  | { kind: "pad" }
  | { kind: "folder"; folder: FolderBlocks }
  | { kind: "repo"; block: RepoBlock }
  | { kind: "status"; group: ChangeGroup }
  | { kind: "dir"; group: ChangeGroup; dir: string; count: number; dirs: string[] }
  | { kind: "file"; row: ChangeRow; showDir: boolean; partly: Set<string> }
  | { kind: "pending"; block: RepoBlock }
  | { kind: "skeleton" }
  | { kind: "cleanHead"; count: number }
  | { kind: "clean"; path: string }
);

/**
 * The heights of the rows in rem, as the heads and rows draw them: GroupHead h-8, h-7, h-6, a file h-7, the
 * placeholder py-1 with two lines, the clean group's head pt-1 above h-6, the list's padding p-1.
 */
export const ROW_REM = { pad: 0.25, folder: 2, repo: 1.75, status: 1.5, dir: 1.5, file: 1.75, pending: 1.75, skeleton: 2.5, cleanHead: 1.75, clean: 1.75 } as const;
/** Between blocks at the top level, as the list's gap-0.5 had it. */
const GAP = 0.125;

export const dirKey = (repo: string, g: ChangeGroup, dir: string) => `${repo}|${g.id}|${dir}`;
export const fileKey = (repo: string, r: Pick<ChangeRow, "source" | "path">) => `${repo}|${r.source}|${r.path}`;

type Frame = Pick<ChangesItem, "outer" | "repo" | "folderAt" | "repoAt">;
type Body = ChangesItem extends infer I ? (I extends ChangesItem ? Omit<I, keyof Frame | "height" | "gap" | "id" | "inner"> : never) : never;

class Rows {
  readonly items: ChangesItem[] = [];

  add(frame: Frame, inner: number, body: Body): number {
    const item = { ...frame, inner, id: frame.repo ? "mid" : null, height: ROW_REM[body.kind], gap: 0, ...body } as ChangesItem;
    return this.items.push(item) - 1;
  }

  /** The rows from `from` on carry one repo's identity line: it starts at the first and ends at the last. */
  closeRepo(from: number) {
    const last = this.items.length - 1;
    if (last < from) return;
    this.items[from].id = from === last ? "only" : "first";
    if (last > from) this.items[last].id = "last";
  }

  /** A block at the top level ends here: the next one starts after the gap. */
  closeBlock() {
    const last = this.items.at(-1);
    if (last) last.gap = GAP;
  }

  pad(key: string) {
    this.items.push({ key, kind: "pad", outer: 0, inner: 0, repo: null, id: null, height: ROW_REM.pad, gap: 0, folderAt: -1, repoAt: -1 });
  }
}

/** The status groups of one repo, each with its directories and files as far as they are open. */
function fileGroups(rows: Rows, frame: Frame, inner: number, repo: string, groups: ChangeGroup[], partly: Set<string>, tree: boolean, open: Openness) {
  for (const g of groups) {
    rows.add(frame, inner, { key: `status:${repo}|${g.id}`, kind: "status", group: g });
    if (!open.status(g.id)) continue;
    if (!tree) {
      for (const r of g.rows) rows.add(frame, inner + 1, { key: `file:${fileKey(repo, r)}`, kind: "file", row: r, showDir: true, partly });
      continue;
    }
    const dirs = byDirectory(g.rows);
    const named = dirs.filter((d) => d.dir).map((d) => d.dir);
    for (const d of dirs) {
      if (!d.dir) {
        for (const r of d.rows) rows.add(frame, inner + 1, { key: `file:${fileKey(repo, r)}`, kind: "file", row: r, showDir: false, partly });
        continue;
      }
      const key = dirKey(repo, g, d.dir);
      rows.add(frame, inner + 1, { key: `dir:${key}`, kind: "dir", group: g, dir: d.dir, count: d.rows.length, dirs: named });
      if (!open.dir(key)) continue;
      for (const r of d.rows) rows.add(frame, inner + 2, { key: `file:${fileKey(repo, r)}`, kind: "file", row: r, showDir: false, partly });
    }
  }
}

/** The changes of the repo open in Git: its status groups along its identity line. */
export function oneRepoRows(repo: string, groups: ChangeGroup[], entries: RepoStatus["entries"], tree: boolean, open: Openness): ChangesItem[] {
  const rows = new Rows();
  rows.pad("pad:top");
  const from = rows.items.length;
  fileGroups(rows, { outer: 0, repo, folderAt: -1, repoAt: -1 }, 0, repo, groups, partlyStaged(entries), tree, open);
  rows.closeRepo(from);
  rows.pad("pad:end");
  return rows.items;
}

function repoBlock(rows: Rows, b: RepoBlock, outer: number, folderAt: number, tree: boolean, open: Openness) {
  const from = rows.items.length;
  const head = rows.add({ outer, repo: b.path, folderAt, repoAt: -1 }, 0, { key: `repo:${b.path}`, kind: "repo", block: b });
  if (open.repo(b.path)) fileGroups(rows, { outer, repo: b.path, folderAt, repoAt: head }, 1, b.path, b.groups, partlyStaged(b.st?.entries ?? []), tree, open);
  rows.closeRepo(from);
}

function pendingBlock(rows: Rows, b: RepoBlock, outer: number, folderAt: number) {
  const from = rows.items.length;
  rows.add({ outer, repo: b.path, folderAt, repoAt: -1 }, 0, { key: `pending:${b.path}`, kind: "pending", block: b });
  rows.add({ outer, repo: b.path, folderAt, repoAt: -1 }, 1, { key: `skeleton:${b.path}`, kind: "skeleton" });
  rows.closeRepo(from);
}

/**
 * The changes of several repos: by folder when asked, each repo as a block with its identity line, those
 * still loading as a block of placeholders, the clean ones folded together at the end.
 */
export function allReposRows(list: { folders: FolderBlocks[] | null; changed: RepoBlock[]; pending: RepoBlock[]; clean: RepoBlock[] }, tree: boolean, open: Openness): ChangesItem[] {
  const rows = new Rows();
  rows.pad("pad:top");
  if (list.folders) {
    for (const f of list.folders) {
      const at = rows.add({ outer: 0, repo: null, folderAt: -1, repoAt: -1 }, 0, { key: `folder:${f.root}`, kind: "folder", folder: f });
      if (open.folder(f.root)) {
        for (const b of f.changed) repoBlock(rows, b, 1, at, tree, open);
        for (const b of f.pending) pendingBlock(rows, b, 1, at);
      }
      rows.closeBlock();
    }
  } else {
    for (const b of list.changed) {
      repoBlock(rows, b, 0, -1, tree, open);
      rows.closeBlock();
    }
    for (const b of list.pending) {
      pendingBlock(rows, b, 0, -1);
      rows.closeBlock();
    }
  }
  if (list.clean.length) {
    rows.add({ outer: 0, repo: null, folderAt: -1, repoAt: -1 }, 0, { key: "clean", kind: "cleanHead", count: list.clean.length });
    if (open.clean) for (const b of list.clean) rows.add({ outer: 0, repo: null, folderAt: -1, repoAt: -1 }, 1, { key: `clean:${b.path}`, kind: "clean", path: b.path });
  } else {
    // The last block ends the list: no gap after it.
    const last = rows.items.at(-1);
    if (last) last.gap = 0;
  }
  rows.pad("pad:end");
  return rows.items;
}
