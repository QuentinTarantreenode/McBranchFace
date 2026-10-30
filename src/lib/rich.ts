// Sentences that carry data: plain text with refs (shown as branch segments), key facts in bold,
// SHAs in monospace and folders by name. The dictionaries build them; RichText renders them.

export type RichPart = string | { ref: string } | { strong: string } | { mono: string } | { path: string };
export type Rich = RichPart[];

export const ref = (r: string): RichPart => ({ ref: r });
export const strong = (v: string | number): RichPart => ({ strong: String(v) });
export const mono = (v: string): RichPart => ({ mono: v });
/** A folder: its name in the sentence, the whole path in the tooltip. */
export const path = (p: string): RichPart => ({ path: p });

/** `rich\`Merged into ${ref(x)}\``: the literal parts and the values in order, empty strings dropped. */
export function rich(strings: TemplateStringsArray, ...values: (RichPart | number)[]): Rich {
  const out: Rich = [];
  strings.forEach((s, i) => {
    if (s) out.push(s);
    if (i < values.length) out.push(typeof values[i] === "number" ? String(values[i]) : (values[i] as RichPart));
  });
  return out;
}

const partText = (p: RichPart) => (typeof p === "string" ? p : "ref" in p ? p.ref : "strong" in p ? p.strong : "mono" in p ? p.mono : p.path);

/** The sentence as plain text: for the clipboard, search and tests. */
export const plain = (r: Rich | string): string => (typeof r === "string" ? r : r.map(partText).join(""));

export const isRich = (v: unknown): v is Rich =>
  Array.isArray(v) && v.every((p) => typeof p === "string" || (typeof p === "object" && p !== null && ("ref" in p || "strong" in p || "mono" in p || "path" in p)));
