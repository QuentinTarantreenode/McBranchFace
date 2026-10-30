// Where a clone goes: the folder name suggested by the address, and the target path from folder and name.

/** The repository's name as the last part of its address: link, scp-style address or path. */
export function repoNameFromUrl(url: string): string {
  const trimmed = url.trim().replace(/[\\/]+$/, "");
  // A bare host ("https://example.com") ends in the host, which names no repository.
  if (/^[a-z][a-z0-9+.-]*:\/\/[^/]*$/i.test(trimmed)) return "";
  const last = trimmed.split(/[\\/:]/).pop() ?? "";
  return last.replace(/\.git$/i, "");
}

const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;

/** Why `name` cannot be a folder name on any system the app runs on; null when it can. */
export function folderNameProblem(name: string): "empty" | "invalid" | null {
  if (!name.trim()) return "empty";
  if (name === "." || name === ".." || /[<>:"/\\|?*]/.test(name) || [...name].some((c) => c.charCodeAt(0) < 32) || /^\s|[\s.]$/.test(name) || RESERVED.test(name)) return "invalid";
  return null;
}

/** `parent` and `name` as one path, in the parent's separator style; empty while either is missing. */
export function cloneTarget(parent: string, name: string): string {
  const dir = parent.trim().replace(/[\\/]+$/, "");
  if (!dir || !name.trim()) return "";
  return `${dir}${dir.includes("/") && !dir.includes("\\") ? "/" : "\\"}${name.trim()}`;
}
