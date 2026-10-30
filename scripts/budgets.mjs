// Size budgets as a gate: what the start page loads, and with --release the executable and installer.
//   npm run build && node scripts/budgets.mjs [--release]
// Fails (exit 1) when a budget is exceeded, and says by how much.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const KB = 1024;
const MB = 1000 * 1000;
const BUDGETS = {
  // Entry script, its preloads, the stylesheet and the dictionary of one language.
  // Raised from 340 KB with v0.11 (diff viewer, prompt templates) and to 360 KB with v0.12 (the dictionary
  // grew with all local branches, grouping by name, commit search) and to 370 KB with v0.13 (to-do steps,
  // status chips, stashes, grouped help) and to 380 KB with v0.16 (status cache and two-stage start,
  // identities, branches across repos) and to 395 KB with v0.17 (selection with keyboard, one fold state,
  // group heads, pull requests per repo) and to 405 KB with v1.0 (worktrees grouped in the sidebar, refreshing
  // states, known parts before their status): growth is fine, unnoticed growth is not.
  startBytes: 405 * KB,
  // Raised from 4.6 / 2.0 MB with v0.16: status and pull request caches, the input fingerprint of the
  // second stage, identities, revealing files. Installer to 2.2 MB with v1.1: dashboard, activity
  // reporting, provider identity and reviewers. Exe to 5.0 MB with v1.2.5: process trees ended as a whole
  // (job objects), preflight before every destructive step, lenient config reading. Exe to 5.2 MB and
  // installer to 2.3 MB with v1.3: locks per repository and scope, the scan pipeline per repo with stop,
  // sign-in only on request, pull request caches per identity, commit lists read on demand.
  exe: 5.2 * MB,
  installer: 2.3 * MB,
};

const failures = [];
const lines = [];
function check(name, value, budget, unit) {
  const show = (v) => (unit === "KB" ? `${(v / KB).toFixed(1)} KB` : `${(v / MB).toFixed(2)} MB`);
  const ok = value <= budget;
  lines.push(`${ok ? "ok  " : "FAIL"} ${name.padEnd(12)} ${show(value).padStart(10)}  (budget ${show(budget)})`);
  if (!ok) failures.push(`${name} is ${show(value - budget)} over budget`);
}

const build = "build";
if (!existsSync(join(build, "index.html"))) {
  console.error("No build found: run `npm run build` first.");
  process.exit(2);
}
const html = readFileSync(join(build, "index.html"), "utf8");
const refs = [...html.matchAll(/<(?:script[^>]*\ssrc|link[^>]*\shref)="([^"]+)"/g)]
  .map((m) => m[1])
  .filter((r) => /\.(js|css)$/.test(r));
const size = (rel) => statSync(join(build, rel.replace(/^\//, ""))).size;
let start = refs.reduce((sum, r) => sum + size(r), 0);
// The dictionary loads before the first paint; the larger language counts.
const assets = join(build, "assets");
const dicts = readdirSync(assets).filter((f) => /^(de|en)-[\w-]+\.js$/.test(f)).map((f) => statSync(join(assets, f)).size);
start += Math.max(0, ...dicts.filter((s) => s > 20 * KB));
check("start bytes", start, BUDGETS.startBytes, "KB");

if (process.argv.includes("--release")) {
  const target = join("src-tauri", "target", "release");
  const exe = ["mcbranchface.exe", "mcbranchface"].map((f) => join(target, f)).find(existsSync);
  if (exe) check("exe", statSync(exe).size, BUDGETS.exe, "MB");
  else failures.push("no release executable found");
  const nsis = join(target, "bundle", "nsis");
  const version = JSON.parse(readFileSync("package.json", "utf8")).version;
  const setup = existsSync(nsis) ? readdirSync(nsis).find((f) => f.includes(`_${version}_`) && f.endsWith(".exe")) : null;
  if (setup) check("installer", statSync(join(nsis, setup)).size, BUDGETS.installer, "MB");
  else if (process.platform === "win32") failures.push(`no installer for ${version} found`);
}

console.log(lines.join("\n"));
if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}
