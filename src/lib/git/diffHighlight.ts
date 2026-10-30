// Syntax colours for diff lines, loaded with the first diff that shows. Each side of a hunk is
// highlighted as one text, so a comment or string that spans lines is coloured right, and then cut
// back into lines. The result is pieces with a class, never HTML: the viewer renders text only.
import hljs from "highlight.js/lib/core";
import type { LanguageFn } from "highlight.js";
import type { FileDiff } from "$lib/bindings/FileDiff";

export interface Piece {
  text: string;
  cls: string;
}

/** Above this the colours would cost more than they help. */
const MAX_LINES = 2000;

type Loader = () => Promise<{ default: LanguageFn }>;
const LANGUAGES: Record<string, Loader> = {
  typescript: () => import("highlight.js/lib/languages/typescript"),
  javascript: () => import("highlight.js/lib/languages/javascript"),
  xml: () => import("highlight.js/lib/languages/xml"),
  rust: () => import("highlight.js/lib/languages/rust"),
  csharp: () => import("highlight.js/lib/languages/csharp"),
  json: () => import("highlight.js/lib/languages/json"),
  css: () => import("highlight.js/lib/languages/css"),
  markdown: () => import("highlight.js/lib/languages/markdown"),
  sql: () => import("highlight.js/lib/languages/sql"),
  powershell: () => import("highlight.js/lib/languages/powershell"),
  yaml: () => import("highlight.js/lib/languages/yaml"),
  ini: () => import("highlight.js/lib/languages/ini"),
  bash: () => import("highlight.js/lib/languages/bash"),
};

const BY_EXTENSION: Record<string, keyof typeof LANGUAGES> = {
  ts: "typescript",
  tsx: "typescript",
  mts: "typescript",
  cts: "typescript",
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  svelte: "xml",
  vue: "xml",
  html: "xml",
  htm: "xml",
  xml: "xml",
  xaml: "xml",
  csproj: "xml",
  props: "xml",
  targets: "xml",
  resx: "xml",
  config: "xml",
  rs: "rust",
  cs: "csharp",
  json: "json",
  css: "css",
  md: "markdown",
  sql: "sql",
  ps1: "powershell",
  psm1: "powershell",
  yml: "yaml",
  yaml: "yaml",
  toml: "ini",
  ini: "ini",
  sh: "bash",
  bash: "bash",
};

/** highlight.js scopes → the few colours the theme defines; unknown scopes keep their parent's. */
const CLASS: Record<string, string> = {
  keyword: "syn-kw",
  built_in: "syn-type",
  type: "syn-type",
  string: "syn-str",
  regexp: "syn-str",
  number: "syn-num",
  literal: "syn-num",
  symbol: "syn-num",
  comment: "syn-com",
  quote: "syn-com",
  title: "syn-fn",
  attr: "syn-attr",
  attribute: "syn-attr",
  property: "syn-attr",
  meta: "syn-meta",
  tag: "syn-tag",
  name: "syn-tag",
  "selector-tag": "syn-tag",
  "selector-class": "syn-attr",
  variable: "syn-var",
  params: "syn-var",
  "template-variable": "syn-var",
};

export function languageOf(path: string): keyof typeof LANGUAGES | null {
  const ext = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
  return BY_EXTENSION[ext] ?? null;
}

async function ready(lang: keyof typeof LANGUAGES) {
  if (!hljs.getLanguage(lang)) hljs.registerLanguage(lang, (await LANGUAGES[lang]()).default);
}

/** highlight.js HTML → one list of pieces per line, the classes of open spans carried across lines. */
export function toLines(html: string): Piece[][] {
  const root = new DOMParser().parseFromString(`<div>${html}</div>`, "text/html").body.firstElementChild!;
  const lines: Piece[][] = [[]];
  const walk = (node: Node, cls: string) => {
    if (node.nodeType === Node.TEXT_NODE) {
      (node.textContent ?? "").split("\n").forEach((part, i) => {
        if (i > 0) lines.push([]);
        if (part) lines[lines.length - 1].push({ text: part, cls });
      });
      return;
    }
    const scope = (node as Element).className?.toString().split(" ")[0]?.replace(/^hljs-/, "") ?? "";
    const own = CLASS[scope] ?? cls;
    node.childNodes.forEach((c) => walk(c, own));
  };
  walk(root, "");
  return lines;
}

/** The pieces of every line, by `hunk:index`; null when the language is unknown or the diff too long. */
export async function highlightDiff(diff: FileDiff): Promise<Map<string, Piece[]> | null> {
  const lang = languageOf(diff.path);
  if (!lang || diff.binary || diff.conflict) return null;
  if (diff.hunks.reduce((n, h) => n + h.lines.length, 0) > MAX_LINES) return null;
  await ready(lang);
  const out = new Map<string, Piece[]>();
  diff.hunks.forEach((h, hunk) => {
    // Old side first; the new side's colours win for the context lines both share.
    for (const own of ["Del", "Add"] as const) {
      const idx = h.lines.flatMap((l, i) => (l.kind === "Context" || l.kind === own ? [i] : []));
      const html = hljs.highlight(idx.map((i) => h.lines[i].text).join("\n"), { language: lang, ignoreIllegals: true }).value;
      const lines = toLines(html);
      idx.forEach((i, k) => out.set(`${hunk}:${i}`, lines[k] ?? []));
    }
  });
  return out;
}
