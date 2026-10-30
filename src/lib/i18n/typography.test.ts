import { describe, expect, it } from "vitest";
import { de as deCore } from "./de";
import { deMore } from "./de.more";
import { en as enCore } from "./en";
import { enMore } from "./en.more";
import { help as helpDe } from "$lib/help/de";
import { help as helpEn } from "$lib/help/en";
import { isRich, plain } from "$lib/rich";
import { PROMPT_TEXT } from "$lib/prompts";

// Both parts of each dictionary, as `t` offers them.
const de = { ...deCore, ...deMore };
const en = { ...enCore, ...enMore };

/** Every text of a dictionary, functions called with sample arguments; keyed by their path. */
function texts(node: unknown, path = ""): [string, string][] {
  if (typeof node === "string") return [[path, node]];
  if (typeof node === "function") {
    const samples = [
      [1, 2, 3],
      [2, 5, 1],
      ["x", "y", "z"],
    ];
    const out: [string, string][] = [];
    for (const args of samples) {
      try {
        const v = (node as (...a: unknown[]) => unknown)(...args);
        // Sentences with data (refs, bold parts) are checked as the text they read as.
        if (typeof v === "string") out.push([path, v]);
        else if (isRich(v)) out.push([path, plain(v)]);
      } catch {
        // A sample that does not fit the signature: another one will.
      }
    }
    return out;
  }
  if (Array.isArray(node)) return node.flatMap((v, i) => texts(v, `${path}[${i}]`));
  if (node && typeof node === "object") return Object.entries(node).flatMap(([k, v]) => texts(v, path ? `${path}.${k}` : k));
  return [];
}

// Code in texts is set in backticks or is a command line; the rules are for prose, which reads it as a word.
const prose = (s: string) => s.replace(/`[^`]*`/g, "X").replace(/\{\{\w+\}\}/g, "X");

// These name the characters themselves.
const LITERAL = new Set(["git.nameInvalid", "errors.UnsafeValue.hint"]);

function problems(s: string, lang: "de" | "en"): string[] {
  const p = prose(s);
  const out: string[] = [];
  if (p.includes('"')) out.push(lang === "de" ? "straight quote, use „…“" : "straight quote, use “…”");
  if (lang === "en" && /[„]/.test(p)) out.push("German quotes in English");
  if (lang === "de" && /“[^”„]*”/.test(p)) out.push("English quotes in German");
  if (p.includes("...")) out.push('"..." instead of "…"');
  if (/\S {2,}\S/.test(p)) out.push("double space");
  if (/\p{L} - \p{L}/u.test(p)) out.push('" - " instead of a dash');
  if (/\S·|·\S/.test(p)) out.push('"·" without spaces');
  if (/\p{L}\((?:e?n|s|e|er)\)/u.test(p.replace(/https?\(s\)/g, ""))) out.push("bracket plural");
  if (/ [,.;:!?](\s|$)/.test(p)) out.push("space before punctuation");
  if (/\s$|^\s/.test(s) && !s.startsWith("- ")) out.push("leading or trailing space");
  return out;
}

describe.each([
  ["de", { ...de, help: helpDe, prompts: PROMPT_TEXT.de }],
  ["en", { ...en, help: helpEn, prompts: PROMPT_TEXT.en }],
] as const)("typography of %s", (lang, dict) => {
  it("uses typographic quotes, ellipsis and dashes, single spaces and counted plurals", () => {
    const found = texts(dict)
      .filter(([path]) => !LITERAL.has(path))
      .flatMap(([path, s]) => problems(s, lang).map((p) => `${path}: ${p} — ${s.slice(0, 80)}`))
      .filter((v, i, all) => all.indexOf(v) === i);
    expect(found).toEqual([]);
  });

  // Names (buttons, menu entries, titles, counts) stay short and without a full stop. What explains –
  // tooltip texts, hints, notes – is written as sentences: a capital first, a full stop last, and no
  // keywords hung on with a dash ("Löschen – mit Bestätigung"). Four words and more make a sentence.
  it("writes explanations as sentences", () => {
    const EXPLAINS = /(Tip|Hint|hint|Note|Why|Text|text|Detail|intro|summary)$/;
    const found = texts(dict)
      .filter(([path]) => !LITERAL.has(path) && EXPLAINS.test(path.split(".").pop() ?? ""))
      .map(([path, s]) => [path, prose(s).trim()] as const)
      .filter(([, s]) => s.split(/\s+/).length >= 4)
      // A text may begin with a value; the samples put in for it are x, y and z.
      .filter(([, s]) => !/^([\p{Lu}\d„“"({]|[xyz]\b)/u.test(s) || !/[.!?…]$/.test(s) || / – /.test(s))
      .map(([path, s]) => `${path}: ${s.slice(0, 90)}`)
      .filter((v, i, all) => all.indexOf(v) === i);
    expect(found).toEqual([]);
  });
});

// Git's own words stay git's words: users know "fast-forward" and "gone" from the command line, a
// translation makes them look for a feature that does not exist. Checked in both languages.
const NOT_GIT = {
  de: [/verwaist/i, /vorspul/i, /Server-Stand bring/i, /\bZweig/i, /hochlad/i, /\babruf/i, /Veröffentlich/i, /Arbeitskopie/i, /noch nicht geholt/i],
  en: [/\borphan/i, /bring up to the server/i, /\bpublish\b/i, /abandoned/i],
};
// A lock file left behind is orphaned in plain words, not a branch state.
const NOT_GIT_EXCEPT = new Set(["failure.Lock.hint"]);

describe.each([
  ["de", { ...de, help: helpDe }],
  ["en", { ...en, help: helpEn }],
] as const)("wording of %s", (lang, dict) => {
  it("keeps git's terms instead of inventing translations", () => {
    const found = texts(dict)
      .filter(([path]) => !NOT_GIT_EXCEPT.has(path))
      .flatMap(([path, s]) => NOT_GIT[lang].filter((r) => r.test(s)).map((r) => `${path}: ${r} — ${s.slice(0, 80)}`))
      .filter((v, i, all) => all.indexOf(v) === i);
    expect(found).toEqual([]);
  });
});
