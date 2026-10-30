// End-to-end run of the main paths against the real app: a debug build with the frontend embedded, under an
// identity of its own (so it runs beside the user's McBranchFace), a private data folder and a demo workspace.
// Each scenario starts from a fresh copy of the demo workspace and a fresh page; a failed one runs once more and
// leaves a report in failures/. Nothing outside the work folder is touched.
//
//   node scripts/e2e.mjs [<work folder>] [--list] [--only <name>[,<name>]] [--from <name>] [--no-build]
//
//   <work folder>   default: <tmp>/mcbranchface-e2e-<time>-<pid>; the last few of those are kept
//   --list          the scenarios, in run order
//   --only, --from  run some of them, or the rest from one on
//   --no-build      reuse the last e2e build (src-tauri/target-e2e) instead of building
//
// Exit status 0 only when every scenario passed at its first try: FLAKY (green only on the rerun) fails the run too.
import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { App, buildApp } from "./e2e/app.mjs";
import { Driver } from "./e2e/driver.mjs";
import { dump } from "./e2e/dump.mjs";
import { SCENARIOS } from "./e2e/scenarios.mjs";
import { freshCopy, makeTemplate, providerTools } from "./e2e/workspace.mjs";

/** Earlier runs kept besides this one; older ones are removed at the start. */
const KEEP_RUNS = 3;
const RUN_NAME = /^mcbranchface-e2e-\d{8}-\d{6}-\d+$/;

// English UI, so the checks read the same on every machine. No background schedule: the server check and the
// automatic fetch run only where a scenario calls them, never in the middle of another one's step, and a refs
// change is reassessed at once instead of at the end of a gap (a step would wait for it). The activity display
// on, so the backend reports its calls (idle waits for them) and a failure report lists them. No system
// notifications on the user's desktop.
const BASE_CONFIG = {
  language: "En",
  theme: "Light",
  myEmails: ["dev@example.com"],
  serverCheckMinutes: 0,
  autoFetchMinutes: 0,
  diagnostics: true,
  alerts: { notify: false },
  ui: { activityShown: true, refsGapSeconds: 0 },
};

// ---- arguments ------------------------------------------------------------------------------------

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const runnable = SCENARIOS.filter((s) => !s.windowsOnly || process.platform === "win32");

if (flag("--list")) {
  for (const [i, s] of runnable.entries()) console.log(`${String(i + 1).padStart(2)} ${s.name.padEnd(28)} ${s.title}`);
  process.exit(0);
}

const only = option("--only")?.split(",").map((s) => s.trim());
const from = option("--from");
const unknown = [...(only ?? []), ...(from ? [from] : [])].filter((n) => !runnable.some((s) => s.name === n));
if (unknown.length || (flag("--only") && !only?.length) || (flag("--from") && !from)) {
  console.error(`unknown scenario ${unknown.join(", ") || "(none given)"}; see --list`);
  process.exit(2);
}
let chosen = runnable;
if (from) chosen = chosen.slice(chosen.findIndex((s) => s.name === from));
if (only) chosen = chosen.filter((s) => only.includes(s.name));

const positional = args.filter((a, i) => !a.startsWith("--") && !["--only", "--from"].includes(args[i - 1]));
const stamp = new Date().toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
const work = positional[0] ?? join(tmpdir(), `mcbranchface-e2e-${stamp}-${process.pid}`);

// ---- work folder ----------------------------------------------------------------------------------

function pruneOldRuns() {
  const old = readdirSync(tmpdir())
    .filter((n) => RUN_NAME.test(n) && join(tmpdir(), n) !== work)
    .sort()
    .reverse()
    .slice(KEEP_RUNS);
  for (const n of old) rmSync(join(tmpdir(), n), { recursive: true, force: true, maxRetries: 3 });
}

if (!positional[0]) pruneOldRuns();
const shots = join(work, "shots");
const failures = join(work, "failures");
for (const dir of [shots, failures, join(work, "s")]) rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
mkdirSync(shots, { recursive: true });

// ---- the run --------------------------------------------------------------------------------------

const seconds = (ms) => `${(ms / 1000).toFixed(1)} s`;
const results = [];
const timing = {};
let app = null;
let appNo = 0;
let driver = null;
/** The config the app had at its start: each scenario starts from it again. */
let pristine = null;

async function startApp() {
  app?.stop();
  appNo++;
  const t0 = Date.now();
  app = new App({ data: join(work, `data-${appNo}`), log: join(work, `app-${appNo}.log`), path: [tools], baseConfig: BASE_CONFIG });
  await app.start();
  driver = new Driver(app);
  pristine = await driver.js(`return await window.__TAURI_INTERNALS__.invoke("get_config")`);
  console.log(`app ${appNo} started in ${seconds(Date.now() - t0)} (pid ${app.pid}, data ${app.opts.data})`);
}

/** One try of a scenario: a fresh copy of the workspace, its config, a fresh page, then its steps. */
async function attempt(s, index, tryNo) {
  const nn = String(index + 1).padStart(2, "0");
  const dir = join(work, "s", `${nn}${tryNo > 1 ? "-rerun" : ""}`);
  const ctx = { dir, work, data: app.opts.data, app };
  driver.slow = [];
  try {
    mkdirSync(dir, { recursive: true });
    const ws = s.workspace === "none" ? null : freshCopy(template, join(dir, "demo"));
    Object.assign(ctx, ws);
    const config = { ...pristine, ...s.config, ui: { ...pristine.ui, ...s.config?.ui }, roots: ws ? [ws.ws] : [] };
    await driver.idle("the previous scenario settled");
    await driver.js(`await window.__TAURI_INTERNALS__.invoke("save_config", { config: ${JSON.stringify(config)} }); return true;`);
    await driver.reload();
    await driver.when("the start finished", "__mbfStore.loaded && __mbfTest.idle()", { ms: 120_000, show: "__mbfTest.busy()" });
    await s.run(driver, ctx);
    await driver.idle("idle at the end");
    await driver.screenshot(join(shots, `${nn}-${s.name}.png`));
    return { ok: true, ctx };
  } catch (error) {
    return { ok: false, error, ctx };
  }
}

let template;
let tools;
const started = Date.now();
process.on("SIGINT", () => {
  app?.stop();
  process.exit(130);
});

try {
  console.log(`e2e: ${chosen.length} of ${runnable.length} scenarios · work folder ${work}`);
  if (!flag("--no-build")) {
    const t0 = Date.now();
    buildApp();
    timing.build = Date.now() - t0;
  }
  const t1 = Date.now();
  template = makeTemplate(join(work, "template"));
  tools = providerTools(join(work, "tools"));
  timing.template = Date.now() - t1;
  const t2 = Date.now();
  await startApp();
  timing.start = Date.now() - t2;

  const t3 = Date.now();
  for (const s of chosen) {
    const index = runnable.indexOf(s);
    const nn = String(index + 1).padStart(2, "0");
    const t0 = Date.now();
    let res = await attempt(s, index, 1);
    let result = "PASS";
    const errors = [];
    if (!res.ok) {
      errors.push(String(res.error?.message ?? res.error).split("\n")[0]);
      console.log(`FAIL ${nn} ${s.name}: ${errors[0]} · rerun`);
      await dump(join(failures, `${nn}-${s.name}`), { driver, app, scenario: s, attempt: 1, error: res.error, workspace: res.ctx.root, data: app.opts.data });
      // What the failed try left behind is unknown: the rerun gets a new app with a new data folder.
      await startApp();
      res = await attempt(s, index, 2);
      result = res.ok ? "FLAKY" : "FAIL";
      if (!res.ok) {
        errors.push(String(res.error?.message ?? res.error).split("\n")[0]);
        await dump(join(failures, `${nn}-${s.name}-rerun`), { driver, app, scenario: s, attempt: 2, error: res.error, workspace: res.ctx.root, data: app.opts.data });
        await startApp();
      }
    }
    const ms = Date.now() - t0;
    results.push({ scenario: s.name, result, ms, errors, slow: driver.slow });
    console.log(`${result.padEnd(5)} ${nn} ${s.name} (${seconds(ms)})`);
    for (const w of driver.slow) console.log(`      slow: ${w.label} ${seconds(w.ms)}`);
  }
  timing.scenarios = Date.now() - t3;
} catch (e) {
  // Before or between scenarios: the build, the template, the app's start.
  console.error(e?.stack ?? String(e));
  results.push({ scenario: "(run)", result: "FAIL", ms: 0, errors: [String(e?.message ?? e).split("\n")[0]] });
} finally {
  app?.stop();
  timing.total = Date.now() - started;
  writeFileSync(join(work, "e2e-result.json"), JSON.stringify({ timing, results }, null, 2));
  const count = (r) => results.filter((x) => x.result === r).length;
  console.log("\nscenario                       result   time");
  for (const r of results) console.log(`${r.scenario.padEnd(30)} ${r.result.padEnd(6)} ${seconds(r.ms).padStart(7)}${r.errors.length ? `  ${r.errors.at(-1)}` : ""}`);
  console.log(
    `\n${count("PASS")} passed, ${count("FLAKY")} flaky, ${count("FAIL")} failed · ` +
      Object.entries(timing).map(([k, v]) => `${k} ${seconds(v)}`).join(", ") +
      `\nscreenshots in ${shots}${count("FLAKY") + count("FAIL") ? ` · failure reports in ${failures}` : ""}`,
  );
  process.exitCode = results.some((r) => r.result !== "PASS") ? 1 : 0;
}
