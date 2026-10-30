// The import graph of the app, read from its sources: no module reaches itself through its imports, static
// or dynamic, and the layers depend only downward (functional core, stores, services, app). A cycle or an
// import against the direction fails here instead of in a start order that happens to work.
import { describe, expect, it } from "vitest";

const sources = import.meta.glob<string>("/src/**/*.{ts,svelte}", { query: "?raw", import: "default", eager: true });
const app = Object.fromEntries(
  Object.entries(sources).filter(([f]) => !f.endsWith(".test.ts") && !f.endsWith(".d.ts") && !f.startsWith("/src/test/") && !f.startsWith("/src/lib/bindings/")),
);

interface Edge {
  to: string;
  dynamic: boolean;
  /** Only types: gone at run time, so no part of a cycle; still a dependency between layers. */
  typeOnly: boolean;
}

function normalize(path: string): string {
  const out: string[] = [];
  for (const part of path.split("/")) {
    if (part === "..") out.pop();
    else if (part !== ".") out.push(part);
  }
  return out.join("/");
}

/** The source file an import names, or null for a package or an asset. */
function resolve(from: string, spec: string): string | null {
  let base: string;
  if (spec === "$lib" || spec.startsWith("$lib/")) base = `/src/lib${spec.slice(4)}`;
  else if (spec.startsWith(".")) base = normalize(`${from.slice(0, from.lastIndexOf("/"))}/${spec}`);
  else return null;
  return [base, `${base}.ts`, `${base}.svelte`, `${base}.svelte.ts`, `${base}/index.ts`].find((c) => c in app) ?? null;
}

// Comments name imports in prose; a line comment starts at the line or after a blank, unlike `https://`.
const withoutComments = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/.*$/gm, "$1");

function edgesOf(file: string, text: string): Edge[] {
  const code = withoutComments(text);
  const edges: Edge[] = [];
  const add = (spec: string, dynamic: boolean, typeOnly: boolean) => {
    const to = resolve(file, spec);
    if (to) edges.push({ to, dynamic, typeOnly });
  };
  for (const m of code.matchAll(/\b(?:import|export)\s+(type\s+)?([^;=()]*?)\s*from\s*["']([^"']+)["']/g)) {
    const names = /^\{([^}]*)\}$/.exec(m[2].trim())?.[1].split(",").map((s) => s.trim()).filter(Boolean);
    add(m[3], false, !!m[1] || (!!names?.length && names.every((n) => n.startsWith("type "))));
  }
  for (const m of code.matchAll(/\bimport\s*["']([^"']+)["']/g)) add(m[1], false, false);
  for (const m of code.matchAll(/\bimport\(\s*["']([^"']+)["']\s*\)/g)) add(m[1], true, false);
  return edges;
}

const graph = new Map(Object.entries(app).map(([f, text]) => [f, edgesOf(f, text)]));

/** Groups of modules that reach each other (Tarjan); only groups of more than one, or a module importing itself. */
function cycles(): string[][] {
  let index = 0;
  const stack: string[] = [];
  const on = new Set<string>();
  const at = new Map<string, number>();
  const low = new Map<string, number>();
  const found: string[][] = [];
  const runtime = (f: string) => (graph.get(f) ?? []).filter((e) => !e.typeOnly).map((e) => e.to);
  const visit = (v: string) => {
    at.set(v, index);
    low.set(v, index++);
    stack.push(v);
    on.add(v);
    for (const w of runtime(v)) {
      if (!at.has(w)) {
        visit(w);
        low.set(v, Math.min(low.get(v)!, low.get(w)!));
      } else if (on.has(w)) low.set(v, Math.min(low.get(v)!, at.get(w)!));
    }
    if (low.get(v) !== at.get(v)) return;
    const group: string[] = [];
    let w: string;
    do {
      w = stack.pop()!;
      on.delete(w);
      group.push(w);
    } while (w !== v);
    if (group.length > 1 || runtime(v).includes(v)) found.push(group.sort());
  };
  for (const v of graph.keys()) if (!at.has(v)) visit(v);
  return found;
}

/** Plain functions the stores build on; they know no store, service or component. */
const CORE = ["scanMerge", "tableGrouping", "selectionPolicy", "configEdits", "notify", "onlineReclassifier", "latest", "timers"].map((n) => `/src/lib/${n}.ts`);
/** State and what derives from it; the view stores of Git and the dashboard live beside their views. */
const isStore = (f: string) => f.startsWith("/src/lib/stores/") || f === "/src/lib/git/gitStore.svelte.ts" || f === "/src/lib/dashboard/dashboard.svelte.ts";
/** What acts and then reassesses: scans, git operations, deleting, navigation, and the app's start. */
const isService = (f: string) => f.startsWith("/src/lib/services/") || f.startsWith("/src/lib/app/");
const isComponent = (f: string) => f.endsWith(".svelte") || f.startsWith("/src/lib/components/");
const FACADE = "/src/lib/store.svelte.ts";

/** Every import from a module of one kind to a module of another, as "from → to". */
const imports = (from: (f: string) => boolean, to: (f: string) => boolean) =>
  [...graph].flatMap(([f, edges]) => (from(f) ? edges.filter((e) => to(e.to)).map((e) => `${f} → ${e.to}`) : []));

describe("import graph", () => {
  it("reads the whole app", () => {
    expect(graph.size).toBeGreaterThan(200);
    expect(graph.get("/src/lib/app/bootstrap.svelte.ts")?.some((e) => e.to === "/src/lib/services/scanner.svelte.ts")).toBe(true);
    expect(graph.get("/src/lib/app/bootstrap.svelte.ts")?.some((e) => e.to === "/src/lib/stores/activityProcess.ts" && e.dynamic)).toBe(true);
    for (const f of CORE) expect(graph.has(f), f).toBe(true);
  });

  it("has no cycle, through static or dynamic imports", () => {
    expect(cycles()).toEqual([]);
  });

  it("a store never imports a service", () => {
    expect(imports(isStore, isService)).toEqual([]);
  });

  it("a store never imports a component", () => {
    expect(imports(isStore, isComponent)).toEqual([]);
  });

  it("the functional core imports no store, service or component", () => {
    expect(imports((f) => CORE.includes(f), (f) => isStore(f) || isService(f) || isComponent(f))).toEqual([]);
  });

  it("only the dev hook reaches the facade of tests and scripts", () => {
    expect(imports((f) => f !== "/src/lib/app/testHook.svelte.ts", (f) => f === FACADE)).toEqual([]);
  });
});
