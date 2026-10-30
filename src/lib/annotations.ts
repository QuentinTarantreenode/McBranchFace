import type { Annotation } from "./bindings/Annotation";

/** Same keys as the backend (config::annotation_key): identity for a repo, identity::branch for a branch. */
export const annotationKey = (identity: string, branch?: string | null) => (branch ? `${identity}::${branch}` : identity);

export const emptyAnnotation = (): Annotation => ({ note: "", tags: [] });

/** Input as the user types it: trimmed, without "#", unique ignoring case; the backend applies the same on save. */
export function addTag(tags: string[], input: string): string[] {
  const t = input.trim().replace(/^#+/, "").trim().slice(0, 40);
  if (!t || tags.some((x) => x.toLowerCase() === t.toLowerCase())) return tags;
  return [...tags, t];
}

const PALETTE = 8;

/** A tag keeps its colour everywhere and in every session: derived from its text, not its position. */
export function tagColor(tag: string): string {
  let h = 0;
  for (const c of tag.toLowerCase()) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return `var(--id-${h % PALETTE})`;
}

/** Every tag in use, sorted, for suggestions and the tag filter. */
export function allTags(annotations: Record<string, Annotation>): string[] {
  const m = new Map<string, string>();
  for (const a of Object.values(annotations)) for (const t of a.tags) if (!m.has(t.toLowerCase())) m.set(t.toLowerCase(), t);
  return [...m.values()].sort((a, b) => a.localeCompare(b));
}
