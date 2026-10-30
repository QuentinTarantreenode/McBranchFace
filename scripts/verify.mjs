// Every gate in one run, fastest failures first. Each step is a program started without a shell, its
// exit status checked; the first failure ends the run with a non-zero exit. A table at the end says
// what ran, what failed, what was skipped and how long each took.
//   node scripts/verify.mjs              all gates (before a release)
//   node scripts/verify.mjs --quick      without builds and audits (pre-push hook)
//   node scripts/verify.mjs --only rust-tests,bindings
//   node scripts/verify.mjs --list
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cargo, childEnv, exec, Fail, npmCli, ROOT, TAURI, tool } from "./run.mjs";
import { VERSION_FILES, versionMismatches } from "./versions.mjs";

const BINDINGS = join(ROOT, "src", "lib", "bindings");

// Test hooks the dev and audit builds put on window; the release bundle must not carry them.
const TEST_HOOKS = ["__mbf", "__e2e"];

/** A step that could not run here; the run goes on and the table says why. */
class Skip extends Error {}

function scratch(name) {
  return mkdtempSync(join(tmpdir(), `mbf-verify-${name}-`));
}

/** The backend embeds the frontend build; without one it does not compile. */
function ensureFrontendBuild() {
  if (!existsSync(join(ROOT, "build", "index.html"))) tool("vite")("build");
}

/** Files below a folder, as relative paths with forward slashes. */
function files(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { recursive: true })
    .map(String)
    .filter((f) => statSync(join(dir, f)).isFile())
    .map((f) => f.replaceAll("\\", "/"))
    .sort();
}

const STEPS = [
  {
    id: "versions",
    title: "One version in every file",
    run() {
      const text = Object.fromEntries(VERSION_FILES.map((f) => [f, readFileSync(join(ROOT, f), "utf8")]));
      const problems = versionMismatches(text);
      if (problems.length) throw new Fail(problems.join("\n"));
    },
  },
  { id: "types", title: "svelte-check", run: () => tool("svelte-check")("--tsconfig", "./tsconfig.json", "--threshold", "warning") },
  { id: "lint", title: "ESLint", run: () => tool("eslint")(".") },
  { id: "knip", title: "Unused files, exports, dependencies", run: () => tool("knip")("--no-progress") },
  { id: "vitest", title: "Frontend tests", run: () => tool("vitest")("run") },
  {
    id: "clippy",
    title: "Clippy -D warnings",
    run() {
      ensureFrontendBuild();
      cargo(["clippy", "--all-targets", "--", "-D", "warnings"]);
    },
  },
  {
    id: "rust-tests",
    title: "Rust tests",
    run() {
      ensureFrontendBuild();
      // The tests export the TypeScript bindings as a side effect; here they go to a folder of their
      // own, so a run never changes the work tree (the bindings step compares).
      const out = scratch("ts");
      try {
        cargo(["test"], { TS_RS_EXPORT_DIR: out });
      } finally {
        rmSync(out, { recursive: true, force: true });
      }
    },
  },
  {
    id: "bindings",
    title: "Bindings match the Rust types",
    run() {
      ensureFrontendBuild();
      const out = scratch("bindings");
      try {
        cargo(["test", "--lib", "export_bindings", "--", "--quiet"], { TS_RS_EXPORT_DIR: out });
        const fresh = files(out);
        const kept = files(BINDINGS);
        const missing = fresh.filter((f) => !kept.includes(f));
        const extra = kept.filter((f) => !fresh.includes(f));
        const changed = fresh.filter((f) => kept.includes(f) && !readFileSync(join(out, f)).equals(readFileSync(join(BINDINGS, f))));
        if (!fresh.length) throw new Fail("no bindings generated: did TS_RS_EXPORT_DIR reach the tests?");
        const report = [["changed", changed], ["missing in src/lib/bindings", missing], ["no Rust type any more", extra]].filter(([, l]) => l.length);
        if (report.length) {
          throw new Fail(`${report.map(([what, l]) => `${what}: ${l.join(", ")}`).join("\n")}\nRun \`cargo test\` in src-tauri and commit src/lib/bindings (delete the files of removed types).`);
        }
        console.log(`${fresh.length} bindings, all current`);
      } finally {
        rmSync(out, { recursive: true, force: true });
      }
    },
  },
  {
    id: "build",
    title: "Production build + start-bytes budget",
    full: true,
    run() {
      tool("vite")("build");
      exec(process.execPath, [join(ROOT, "scripts", "budgets.mjs")]);
    },
  },
  {
    id: "bundle-hooks",
    title: "No test hooks in the release bundle",
    full: true,
    run() {
      const build = join(ROOT, "build");
      if (!existsSync(join(build, "index.html"))) throw new Fail("no production build: run the build step first");
      const hits = files(build).flatMap((f) => {
        const text = readFileSync(join(build, f), "latin1");
        return TEST_HOOKS.filter((h) => text.includes(h)).map((h) => `${f}: ${h}`);
      });
      if (hits.length) throw new Fail(`test hooks in the production build:\n${hits.join("\n")}`);
      console.log(`${files(build).length} files, none with ${TEST_HOOKS.join(" or ")}`);
    },
  },
  {
    id: "ui-audit",
    title: "Headless UI audit, 0 findings",
    full: true,
    run() {
      tool("vite")("build", "--mode", "audit");
      exec(process.execPath, [join(ROOT, "scripts", "ui-audit.mjs")]);
    },
  },
  {
    id: "audit",
    title: "Dependency advisories (cargo audit, npm audit)",
    full: true,
    run() {
      const notes = [];
      const probe = spawnSync("cargo", ["audit", "--version"], { cwd: TAURI, env: childEnv, encoding: "utf8" });
      if (probe.status === 0) cargo(["audit"]);
      else notes.push("cargo audit left out: cargo-audit is not installed (cargo install cargo-audit)");
      const npm = npmCli();
      if (npm) exec(process.execPath, [npm, "audit", "--omit=dev"]);
      else notes.push("npm audit left out: npm's command-line script not found");
      if (notes.length === 2) throw new Skip(notes.join("; "));
      return notes.join("; ");
    },
  },
];

// ---- run ----------------------------------------------------------------------------------------

const args = process.argv.slice(2);
if (args.includes("--list")) {
  for (const s of STEPS) console.log(`${s.id.padEnd(14)} ${s.title}${s.full ? "  (not with --quick)" : ""}`);
  process.exit(0);
}
const quick = args.includes("--quick");
const onlyArg = args.includes("--only") ? args[args.indexOf("--only") + 1] : undefined;
const only = onlyArg?.split(",").map((s) => s.trim());
const unknown = only?.filter((id) => !STEPS.some((s) => s.id === id)) ?? [];
if (args.includes("--only") && (!onlyArg || unknown.length)) {
  console.error(`unknown step ${unknown.join(", ") || "(none given)"}; steps: ${STEPS.map((s) => s.id).join(", ")}`);
  process.exit(2);
}

const chosen = STEPS.filter((s) => (only ? only.includes(s.id) : !(quick && s.full)));
/** @type {{ id: string, title: string, result: string, ms: number | null, note?: string }[]} */
const rows = STEPS.map((s) => ({ id: s.id, title: s.title, result: chosen.includes(s) ? "not run" : "left out", ms: null }));
let failed = null;

for (const step of chosen) {
  const row = rows.find((r) => r.id === step.id);
  console.log(`\n=== ${step.id}: ${step.title}`);
  const started = Date.now();
  try {
    const note = step.run();
    row.result = "ok";
    if (note) row.note = note;
  } catch (e) {
    row.result = e instanceof Skip ? "skipped" : "FAILED";
    row.note = e instanceof Error ? e.message : String(e);
    if (!(e instanceof Skip) && !(e instanceof Fail)) console.error(e);
  }
  row.ms = Date.now() - started;
  if (row.result === "FAILED") {
    failed = row;
    break;
  }
}

const seconds = (ms) => (ms === null ? "" : `${(ms / 1000).toFixed(1)} s`);
console.log("\n" + ["step".padEnd(14), "result".padEnd(9), "time".padStart(9), "  what"].join(" "));
for (const r of rows) console.log([r.id.padEnd(14), r.result.padEnd(9), seconds(r.ms).padStart(9), `  ${r.title}`].join(" "));
const total = rows.reduce((sum, r) => sum + (r.ms ?? 0), 0);
console.log(`${"".padEnd(25)}${seconds(total).padStart(9)}  total`);
for (const r of rows.filter((r) => r.note)) console.log(`\n${r.id} ${r.result}: ${r.note}`);
if (failed) {
  console.error(`\nverify FAILED at ${failed.id}`);
  process.exit(1);
}
console.log(`\nverify ok${quick ? " (quick: builds and audits left out)" : ""}`);
