// What the start costs in time until the user sees data: 40 repos with realistic delays (status 40 ms,
// assessment 30 ms, fetch 800 ms per repo, six at a time), measured from the store's start marks.
//   npx vite build --mode audit && node scripts/perf-start.mjs [--repos 40] [--no-cache]
// --no-cache starts without the last run's statuses: the cache check must fail then, which shows the
// measurement sees what it claims to.
import { openAudit } from "./audit/harness.mjs";

const args = process.argv.slice(2);
const opt = (name, fallback) => Number(args.includes(`--${name}`) ? args[args.indexOf(`--${name}`) + 1] : fallback);
const repos = opt("repos", 40);
const cache = !args.includes("--no-cache");
// Counted from the first paint: the window is there, what follows is the user's wait. The time up to
// the paint is the page loading, which the headless browser measures differently from the WebView.
const BUDGET = { firstStatusMs: 300, gitReadyMs: 300, localMs: 1500 };

const { js, errors, close } = await openAudit({ query: `?repos=${repos}&branches=${repos * 10}&timing=1${cache ? "" : "&cache=0"}` });
const m = await js(`
  const at = (n) => performance.getEntriesByName("mbf:" + n)[0];
  const t0 = performance.now();
  while (!at("fetched") && performance.now() - t0 < 30000) await new Promise((r) => setTimeout(r, 50));
  const init = at("init").startTime;
  const paint = at("first-paint").startTime;
  const since = (n) => (at(n) ? Math.round(at(n).startTime - (n === "first-paint" ? init : paint)) : null);
  return { atPaint: at("first-paint")?.detail ?? 0, paint: since("first-paint"), firstStatus: since("first-status"), gitReady: since("git-ready"), local: since("local-assessed"), fetched: since("fetched") };
`);
close();

const checks = [
  ["statuses at the first paint", m.atPaint >= repos, `${m.atPaint} of ${repos}`],
  ["first fresh status", m.firstStatus !== null && m.firstStatus <= BUDGET.firstStatusMs, `${m.firstStatus} ms (budget ${BUDGET.firstStatusMs})`],
  ["Git perspective with a fresh status", m.gitReady !== null && m.gitReady <= BUDGET.gitReadyMs, `${m.gitReady} ms (budget ${BUDGET.gitReadyMs})`],
  ["stage one: assessed locally", m.local !== null && m.local <= BUDGET.localMs, `${m.local} ms (budget ${BUDGET.localMs})`],
  ["stage two: fetched and assessed", m.fetched !== null, `${m.fetched} ms`],
];
let failed = false;
for (const [name, ok, value] of checks) {
  failed ||= !ok;
  console.log(`${ok ? "ok  " : "FAIL"} ${name.padEnd(36)} ${value}`);
}
for (const e of errors) console.log(`exception: ${e.slice(0, 300)}`);
console.log(`${repos} repos · first paint ${m.paint} ms after the start, the times above from there · ${cache ? "with" : "without"} the last run's statuses`);
if (failed) process.exitCode = 1;
