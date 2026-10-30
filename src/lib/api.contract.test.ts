// The contract between backend and frontend, read from both sources: a renamed command, a parameter
// Tauri cannot map, a return type that differs, or an event nobody listens to fails here instead of
// at run time. Tauri passes arguments by their camelCase names and ignores keys it does not know.
import { describe, expect, it } from "vitest";

const read = (files: Record<string, string>) => Object.entries(files);
const rust = read(import.meta.glob<string>("/src-tauri/src/**/*.rs", { query: "?raw", import: "default", eager: true }));
const frontend = read(import.meta.glob<string>("/src/**/*.{ts,svelte}", { query: "?raw", import: "default", eager: true })).filter(
  ([f]) => !f.endsWith(".test.ts") && !f.startsWith("/src/test/"),
);
const source = (name: string) => rust.find(([f]) => f.endsWith(`/src-tauri/src/${name}`))?.[1] ?? "";
/** Every command module: the commands live in `src-tauri/src/commands/`, one file per area. */
const commandSources = rust.filter(([f]) => /\/src-tauri\/src\/commands\/[^/]+\.rs$/.test(f)).map(([, text]) => text);

/** The text from `open` to its matching close, both excluded; `at` points just past `open`. */
function balanced(text: string, at: number, open: string, close: string): string {
  let depth = 1;
  for (let i = at; i < text.length; i++) {
    if (text[i] === open) depth++;
    else if (text[i] === close && --depth === 0) return text.slice(at, i);
  }
  throw new Error(`unbalanced ${open}${close} at ${at}`);
}

/** Splits at commas outside of brackets: `a: Vec<(u8, u8)>, b: X` is two parts. */
function splitTop(text: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if ("<([{".includes(c)) depth++;
    else if (">)]}".includes(c)) depth--;
    else if (c === "," && depth === 0) {
      parts.push(text.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(text.slice(start));
  return parts.map((p) => p.trim()).filter(Boolean);
}

const camel = (s: string) => s.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());

interface Param {
  name: string;
  optional: boolean;
}
interface Command {
  params: Param[];
  returns: string;
}

/** Arguments Tauri supplies itself; the frontend never passes them. */
const INJECTED = /^(tauri::)?(AppHandle|State|Window|WebviewWindow|Webview)\b/;

const ALIASES = new Map(commandSources.flatMap((text) => [...text.matchAll(/^type (\w+)\s*=\s*([^;]+);/gm)]).map((m) => [m[1], m[2].trim()]));

/** The TypeScript type a Rust return type arrives as, in the spelling api.ts uses. */
function tsType(rustType: string): string {
  const t = rustType.trim();
  if (t === "" || t === "()") return "void";
  const generic = /^([\w:]+)\s*<(.*)>$/s.exec(t);
  if (generic) {
    const [, outer, inner] = generic;
    const args = splitTop(inner);
    const name = outer.split("::").pop()!;
    if (name === "CmdResult" || name === "Result") return tsType(args[0]);
    if (name === "Vec") return `${tsType(args[0])}[]`;
    if (name === "Option") return `${tsType(args[0])} | null`;
    throw new Error(`no mapping for ${t}`);
  }
  const name = t.split("::").pop()!;
  const alias = ALIASES.get(name);
  if (alias) return tsType(alias);
  if (name === "String" || name === "str") return "string";
  if (name === "bool") return "boolean";
  if (/^[iu](8|16|32|64|size)$|^f(32|64)$/.test(name)) return "number";
  return name;
}

function rustCommands(): Map<string, Command> {
  const out = new Map<string, Command>();
  for (const text of commandSources) commandsOf(text, out);
  return out;
}

function commandsOf(text: string, out: Map<string, Command>) {
  for (const m of text.matchAll(/#\[tauri::command\]\s*(?:(?:\/\/[^\n]*|#\[[^\n]*\])\s*)*pub (?:async )?fn (\w+)\s*(?:<[^>]*>)?\(/g)) {
    const at = m.index + m[0].length;
    const list = balanced(text, at, "(", ")");
    const rest = text.slice(at + list.length + 1, text.indexOf("{", at + list.length));
    const params = splitTop(list)
      .map((p) => {
        const [name, type] = p.split(/:(.*)/s).map((s) => s.trim());
        return { name, type };
      })
      .filter((p) => !INJECTED.test(p.type))
      .map((p) => ({ name: camel(p.name), optional: /^Option\s*</.test(p.type) }));
    out.set(m[1], { params, returns: tsType(rest.replace(/^\s*->/, "")) });
  }
  return out;
}

function registered(): string[] {
  const lib = source("lib.rs");
  const at = lib.indexOf("generate_handler![") + "generate_handler![".length;
  // Registered by their module path (`commands::scan::scan`); the command name is the last segment.
  return splitTop(balanced(lib, at, "[", "]")).map((s) => s.split("::").pop()!);
}

interface Call {
  file: string;
  name: string;
  type: string | null;
  keys: string[];
}

function invokes(): Call[] {
  const calls: Call[] = [];
  for (const [file, text] of frontend) {
    for (const m of text.matchAll(/\binvoke\s*(<)?/g)) {
      let at = m.index + m[0].length;
      let type: string | null = null;
      if (m[1]) {
        type = balanced(text, at, "<", ">");
        at += type.length + 1;
      }
      const head = /^\s*\(\s*"([^"]+)"\s*(,\s*\{)?/.exec(text.slice(at));
      if (!head) continue;
      const keys = head[2] ? splitTop(balanced(text, at + head[0].length, "{", "}")).map((k) => k.split(":")[0].trim()) : [];
      calls.push({ file, name: head[1], type: type?.replace(/\s+/g, " ").trim() ?? null, keys });
    }
  }
  // The window plugin's own commands are Tauri's contract, not ours.
  return calls.filter((c) => !c.name.startsWith("plugin:"));
}

/** Event names the backend emits: literals, and constants of the same file. */
function emitted(): Set<string> {
  const names = new Set<string>();
  for (const [, text] of rust) {
    const consts = new Map([...text.matchAll(/const (\w+): &str = "([^"]+)";/g)].map((m) => [m[1], m[2]]));
    for (const m of text.matchAll(/\b(?:emit|emit_or_log)\s*\(\s*(?:[\w&.]+\s*,\s*)?("([^"]+)"|[A-Z][A-Z0-9_]*)\s*,/g)) {
      const name = m[2] ?? consts.get(m[1]);
      if (!name) throw new Error(`emit of an unknown constant ${m[1]}`);
      names.add(name);
    }
    for (const m of text.matchAll(/\bemit_to\s*\([^,]+,\s*"([^"]+)"/g)) names.add(m[1]);
  }
  return names;
}

function listened(): Set<string> {
  const names = new Set<string>();
  for (const [, text] of frontend) for (const m of text.matchAll(/\b(?:listen|once)\s*(?:<[^>]*>)?\s*\(\s*"([^"]+)"/g)) names.add(m[1]);
  return new Set([...names].filter((n) => !n.startsWith("tauri://")));
}

describe("backend contract", () => {
  const commands = rustCommands();
  const calls = invokes();

  it("reads the backend at all", () => {
    expect(commands.size).toBeGreaterThan(50);
    expect(commands.get("git_commit")?.params).toEqual([
      { name: "path", optional: false },
      { name: "message", optional: false },
      { name: "amend", optional: false },
      { name: "allowPushed", optional: false },
    ]);
    expect(commands.get("git_switch")?.returns).toBe("OpResult");
    expect(tsType("CmdResult<Vec<gitops::copies::CopyOutcome>>")).toBe("CopyOutcome[]");
    expect(tsType("Option<String>")).toBe("string | null");
  });

  it("registers every command function and nothing else", () => {
    expect([...registered()].sort()).toEqual([...commands.keys()].sort());
  });

  it("calls every registered command, and only those", () => {
    const called = new Set(calls.map((c) => c.name));
    expect(registered().filter((n) => !called.has(n))).toEqual([]);
    expect(calls.filter((c) => !commands.has(c.name)).map((c) => `${c.file}: ${c.name}`)).toEqual([]);
  });

  it.each(calls.map((c) => [c.name, c] as const))("%s: argument names as Tauri maps them", (name, call) => {
    const params = commands.get(name)?.params ?? [];
    const known = params.map((p) => p.name);
    expect(call.keys.filter((k) => !known.includes(k)), "keys the backend would ignore").toEqual([]);
    expect(params.filter((p) => !p.optional && !call.keys.includes(p.name)).map((p) => p.name), "required arguments missing").toEqual([]);
  });

  it.each(calls.map((c) => [c.name, c] as const))("%s: the type it resolves to", (name, call) => {
    expect(call.type, "invoke without a type argument").not.toBeNull();
    expect(call.type).toBe(commands.get(name)?.returns);
  });

  it("listens to every event the backend emits, and only to those", () => {
    const out = emitted();
    const heard = listened();
    expect(out.size).toBeGreaterThan(5);
    expect([...out].filter((n) => !heard.has(n)), "emitted, never heard").toEqual([]);
    expect([...heard].filter((n) => !out.has(n)), "heard, never emitted").toEqual([]);
  });
});
