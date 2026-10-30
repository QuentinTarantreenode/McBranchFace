/** Display helpers for file system paths. The backend hands out paths with mixed separators on Windows. */

let home: string | null = null;

/** Paths below this folder show as `~`; set once at start. */
export function setHome(folder: string | null) {
  home = folder;
}

export const currentHome = () => home;

const isWindows = (p: string) => /^[A-Za-z]:/.test(p) || p.startsWith("\\\\") || p.includes("\\");

/** One separator style per path, no doubled or trailing separators. */
export function normalizePath(p: string): string {
  if (!p) return p;
  if (isWindows(p)) {
    const unc = /^[\\/]{2}/.test(p);
    let s = p.replace(/\//g, "\\").replace(/\\{2,}/g, "\\");
    if (unc) s = "\\" + s;
    return /^[A-Za-z]:\\$/.test(s) ? s : s.replace(/\\$/, "");
  }
  const s = p.replace(/\/{2,}/g, "/");
  return s.length > 1 ? s.replace(/\/$/, "") : s;
}

/**
 * Identity of a path for comparing and keying: one separator, no trailing one, and case only where
 * the file system ignores it. Backend paths are absolute, so their shape tells the platform.
 * Same rule as the backend; both test against `src-tauri/tests/fixtures/path-keys.json`.
 */
export const pathKey = (p: string, windows = isWindows(p)) => {
  const s = p.replace(/\\/g, "/").replace(/\/+$/, "");
  return windows ? s.toLowerCase() : s;
};

const sepOf = (p: string) => (isWindows(p) ? "\\" : "/");
const same = (a: string, b: string, win: boolean) => pathKey(a, win) === pathKey(b, win);

function parts(p: string): string[] {
  return normalizePath(p).split(sepOf(p));
}

/** The home folder as `~`, which is how people read and type it. */
export function homeRelative(p: string, home: string | null | undefined): string {
  const path = normalizePath(p);
  if (!home) return path;
  const h = normalizePath(home);
  const win = isWindows(path);
  const sep = sepOf(path);
  if (same(path, h, win)) return "~";
  if (path.length > h.length && same(path.slice(0, h.length), h, win) && path[h.length] === sep) return "~" + path.slice(h.length);
  return path;
}

/** Deepest folder that contains all paths; empty when they share nothing but the drive. */
export function commonParent(paths: string[]): string {
  if (!paths.length) return "";
  const win = isWindows(paths[0]);
  const lists = paths.map(parts);
  // Folders only: the last piece of a path is never part of the common parent.
  const limit = Math.min(...lists.map((l) => l.length - 1));
  let n = 0;
  while (n < limit && lists.every((l) => same(l[n], lists[0][n], win))) n++;
  // Only the drive or the file system root in common says nothing.
  return n <= 1 ? "" : lists[0].slice(0, n).join(sepOf(paths[0]));
}

/** The path below `base`, or the path unchanged when it is not below. */
export function relativeTo(base: string, p: string): string {
  const path = normalizePath(p);
  if (!base) return path;
  const b = normalizePath(base);
  const win = isWindows(path);
  const sep = sepOf(path);
  const prefix = b.endsWith(sep) ? b : b + sep;
  return path.length > prefix.length && same(path.slice(0, prefix.length), prefix, win) ? path.slice(prefix.length) : path;
}

/** Pieces that each end with their separator, so a line may break after a separator and nowhere else. */
export function pathPieces(p: string): string[] {
  const out: string[] = [];
  const re = /[^\\/]*[\\/]+|[^\\/]+$/g;
  for (const m of p.matchAll(re)) if (m[0]) out.push(m[0]);
  return out;
}

/** One line of path for the UI: one separator style, the home folder as `~`. */
export const displayPath = (p: string) => homeRelative(p, home);
