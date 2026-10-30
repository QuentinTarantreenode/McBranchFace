// Dead entries nobody else notices: dictionary keys no code reads, and style classes and colour tokens
// nothing uses. Code, exports and files are covered by TypeScript and knip; these two are not.
import { describe, expect, it } from "vitest";
import { en as enCore } from "./i18n/en";
import { enMore } from "./i18n/en.more";

const raw = (files: Record<string, string>) => Object.entries(files);
const sources = [
  ...raw(import.meta.glob<string>("/src/**/*.{ts,svelte}", { query: "?raw", import: "default", eager: true })),
  ...raw(import.meta.glob<string>("/scripts/**/*.{mjs,js}", { query: "?raw", import: "default", eager: true })),
].filter(([f]) => !f.endsWith(".test.ts"));
// Both parts of each dictionary: a key named in the other part is no reader.
const isDictionary = (f: string) => /\/(i18n|help)\/(de|en)(\.more)?\.ts$/.test(f);
const code = sources
  .filter(([f]) => !isDictionary(f))
  .map(([, text]) => text)
  .join("\n");
const css = import.meta.glob<string>("/src/app.css", { query: "?raw", import: "default", eager: true })["/src/app.css"];

/** Leaf paths of the dictionary, e.g. ["cleanup", "emptyLocal"]. */
function leaves(o: unknown, path: string[] = []): string[][] {
  if (typeof o !== "object" || o === null || Array.isArray(o)) return [path];
  return Object.entries(o).flatMap(([k, v]) => leaves(v, [...path, k]));
}

const dict = { ...enCore, ...enMore };

/** A path into the dictionary as the code reads it; `*` stands for an index (`t.verdict[v]`). */
type Access = string[];

/**
 * Every member chain of the code that starts at `t` or at a name assigned from one: `t.cleanup.key`,
 * `const k = t.check; k.key`, `{@const d = t.dashboard}`, `const { a } = t.x`, `t.verdict[v].label`.
 * A chain that stops at a node (passed on whole, spread, iterated) reads everything below it.
 */
/** The access ends at a group of texts, not at one text: a name for it is an alias, not a read. */
function isNode(access: Access): boolean {
  let at: unknown[] = [dict];
  for (const k of access) at = at.flatMap((o) => (o && typeof o === "object" ? (k === "*" ? Object.values(o) : k in o ? [(o as Record<string, unknown>)[k]] : []) : []));
  return at.some((o) => o !== null && typeof o === "object" && !Array.isArray(o));
}

function dictionaryReads(text: string): Access[] {
  const chain = /(?<![\w$.])([A-Za-z_$][\w$]*)((?:[!?]?\.[A-Za-z_$][\w$]*|[!?]?\.?\[[^[\]\n]*\])+)/g;
  // A spread (`...t.x`) starts a chain like any other expression; the dots would hide it.
  const plain = text.replaceAll("...", "   ");
  const chains = [...plain.matchAll(chain)].map((m) => ({
    at: m.index,
    root: m[1],
    segs: [...m[2].matchAll(/[!?]?\.?\[[^[\]\n]*\]|\.([A-Za-z_$][\w$]*)/g)].map((s) => s[1] ?? "*"),
    called: plain[m.index + m[0].length] === "(",
  }));
  // What the chain is assigned to, read only for chains that start at the dictionary.
  const target = (at: number) => {
    const before = text.slice(Math.max(0, at - 120), at);
    const destructured = /\{([^{}]*)\}\s*=\s*(?:\$derived\(\s*)?$/.exec(before);
    if (destructured) return { names: destructured[1].split(",").map((x) => x.split(":")[0].trim()).filter(Boolean), alias: null };
    const alias = /(?<![\w$.=!<>])([A-Za-z_$][\w$]*)\s*=\s*(?:\$derived\(\s*)?$/.exec(before);
    return { names: [], alias: alias?.[1] ?? null };
  };
  // Elsewhere `t` is some local name (a loop variable, a parameter) and its index reads nothing.
  const hasDictionary = /import\s*\{[^}]*\bt\b[^}]*\}\s*from\s*"[^"]*i18n\/index\.svelte"|\bt: Dict\b/.test(text);
  const aliases = new Map<string, Access[]>(hasDictionary ? [["t", [[]]]] : []);
  const out: Access[] = [];
  const done = new Set<number>();
  // Aliases of aliases are found in later rounds, whatever the order of the assignments.
  for (let grew = true; grew; ) {
    grew = false;
    for (const c of chains) {
      const bases = aliases.get(c.root);
      if (!bases || done.has(c.at)) continue;
      done.add(c.at);
      const { names, alias } = c.called ? { names: [], alias: null } : target(c.at);
      for (const base of bases) {
        const full = [...base, ...c.segs];
        if (names.length) out.push(...names.map((n) => [...full, n]));
        else if (alias && alias !== "t" && isNode(full)) {
          aliases.set(alias, [...(aliases.get(alias) ?? []), full]);
          grew = true;
        } else out.push(full);
      }
    }
  }
  return out;
}
const reads = [...new Map(sources.filter(([f]) => !isDictionary(f)).flatMap(([, text]) => dictionaryReads(text)).map((a) => [a.join("."), a])).values()];

/** Read when an access reaches the leaf or stops at one of its ancestors (`*` matching any key). */
const reaches = (path: string[]) => reads.some((a) => a.slice(0, path.length).every((s, i) => s === "*" || s === path[i]));

/**
 * Reached by a key computed at run time from data that never names the text: a backend code, an enum
 * value, an operation id. A missing text there is a compile error (`satisfies Record<…>`); which of
 * them are still reachable is the backend's matter, not something a search of the frontend can tell.
 */
const DYNAMIC: Record<string, string> = {
  errors: "one text per backend ErrorCode, picked by the code of the failure",
  failure: "one text per FailureKind of a delete or git step",
  "settings.importFailure": "one text per reason a config import is refused",
  "git.op": "one label per git operation, picked by the operation id",
  check: "one text per check code the backend reports",
  todo: "one text per kind of step on the to-do list",
  repoWarning: "one text per RepoWarning code",
  activityOps: "one label per kind of background activity",
};
const isDynamic = (path: string[]) => Object.keys(DYNAMIC).some((d) => `${path.join(".")}.`.startsWith(`${d}.`));

/** Unread, but owned by work in progress elsewhere; each entry goes once that work removes the text. */
const PENDING = new Set<string>([]);

const isRead = (path: string[]) => isDynamic(path) || reaches(path) || PENDING.has(path.join("."));

// Built from a stem, like `mbf-segs-{size}` or `mbf-tone-${tone}`: the stem followed by an expression.
const stemOf = (name: string) => name.slice(0, name.lastIndexOf("-") + 1);
const built = (stem: string) => code.includes(`${stem}{`) || code.includes(`${stem}\${`);

describe("nothing dead", () => {
  it("every dictionary entry is read somewhere", () => {
    const unread = leaves(dict)
      .filter((p) => p.length > 1 && !isRead(p))
      .map((p) => p.join("."));
    expect(unread).toEqual([]);
    const all = new Set(leaves(dict).map((p) => p.join(".")));
    expect([...PENDING].filter((k) => !all.has(k) || reaches(k.split(".")))).toEqual([]);
  });

  it("every style class and colour token of app.css is used", () => {
    const all = `${code}\n${css}`;
    const classes = [...new Set([...css.matchAll(/\.(mbf-[\w-]+)/g)].map((m) => m[1]))];
    const unusedClasses = classes.filter((c) => !new RegExp(`\\b${c}\\b`).test(code) && !built(stemOf(c)));
    // A token is used through var(--x), as a Tailwind colour (--color-x → bg-x, text-x …), through a
    // built name (var(--id-${n})), or, in a Tailwind namespace (--shadow-x, --text-x), as the class x.
    const tokens = [...new Set([...css.matchAll(/^\s*--([\w-]+):/gm)].map((m) => m[1]))].filter((x) => !x.startsWith("color-") && !x.startsWith("font-"));
    const namespaced = (x: string) => /^(shadow|text|radius|leading|tracking)-/.test(x) && new RegExp(`\\b${x.split("--")[0]}\\b`).test(code);
    const used = (x: string) =>
      new RegExp(`var\\(--${x}\\b`).test(all) ||
      new RegExp(`\\b(bg|text|border|ring|from|to|fill|stroke|outline|shadow|divide|accent|caret|decoration)-${x}\\b`).test(code) ||
      built(`--${stemOf(x)}`) ||
      namespaced(x);
    const unusedTokens = tokens.filter((x) => !used(x));
    expect({ unusedClasses, unusedTokens }).toEqual({ unusedClasses: [], unusedTokens: [] });
  });
});
