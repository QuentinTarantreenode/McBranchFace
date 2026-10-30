// What a scan of a large workspace costs the page: the scaled audit fixture sends one result per repo,
// as the backend does, and the page reports its long animation frames. Fails over the budgets.
//   npx vite build --mode audit && node scripts/perf-scan.mjs [--repos 150] [--branches 2000]
import { openAudit } from "./audit/harness.mjs";

const args = process.argv.slice(2);
const opt = (name, fallback) => Number(args.includes(`--${name}`) ? args[args.indexOf(`--${name}`) + 1] : fallback);
const repos = opt("repos", 150);
const branches = opt("branches", 2000);
// Frames over 50 ms are "long"; the budgets are for the whole scan of the default workspace.
const BUDGET = { longSumMs: opt("budget-long", 1500), maxFrameMs: opt("budget-frame", 250), stepMs: opt("budget-step", 150), statusFrameMs: 50, slowPerSecond: 2 };

const { send, js, errors, close } = await openAudit({ query: `?repos=${repos}&branches=${branches}` });
await send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 860, deviceScaleFactor: 1, mobile: false });

const run = (group) =>
  js(`
    const s = window.__mbfStore;
    s.setUi({ perspective: "Cleanup", cleanupScope: "Local", tableGroup: ${JSON.stringify(group)} });
    // The start scan or a queued one must be over, or this scan is only queued behind it.
    const idle = async () => { while (s.scanning) await new Promise((r) => setTimeout(r, 20)); };
    await idle();
    await new Promise((r) => setTimeout(r, 300));
    const frames = [];
    const type = PerformanceObserver.supportedEntryTypes.includes("long-animation-frame") ? "long-animation-frame" : "longtask";
    const obs = new PerformanceObserver((l) => { for (const e of l.getEntries()) frames.push(e.duration); });
    obs.observe({ type });
    const t0 = performance.now();
    await s.scan(true);
    await idle();
    // Until the last result is on screen.
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    await new Promise((r) => setTimeout(r, 200));
    obs.disconnect();
    frames.sort((a, b) => a - b);
    const sum = frames.reduce((a, b) => a + b, 0);
    return { type, totalMs: Math.round(performance.now() - t0), long: frames.length, longSumMs: Math.round(sum), maxFrameMs: Math.round(frames.at(-1) ?? 0), p95Ms: Math.round(frames[Math.floor(frames.length * 0.95)] ?? 0), rows: s.visible.length };
  `);

const results = {};
for (const group of ["None", "Folder"]) results[group] = await run(group);

// Typing in the search, re-sorting, regrouping: each step until the next frame is painted.
const interaction = await js(`
  const s = window.__mbfStore;
  const frame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  const time = async (f) => { const t0 = performance.now(); f(); await frame(); return performance.now() - t0; };
  // After a scan the status refresh of every repo still runs; steps measured on top of it would time
  // that work, not the step. Wait for a second without long frames (at most ten).
  let lastLong = performance.now();
  const quiet = new PerformanceObserver(() => (lastLong = performance.now()));
  quiet.observe({ type: "long-animation-frame" });
  const t0 = performance.now();
  while (performance.now() - lastLong < 1000 && performance.now() - t0 < 10000) await new Promise((r) => setTimeout(r, 100));
  quiet.disconnect();
  // One run is noisy; the median of three says what a step costs.
  const runs = [];
  for (let run = 0; run < 3; run++) {
    const steps = [];
    for (const q of ["f", "fe", "fea", "feat", ""]) steps.push(["search " + JSON.stringify(q), await time(() => (s.filters.search = q))]);
    for (const key of ["name", "repo", "lastCommitAt", "verdict"]) steps.push(["sort " + key, await time(() => (s.sort = { key, dir: 1 }))]);
    for (const g of ["Prefix", "Repo", "Name", "None", "Folder"]) steps.push(["group " + g, await time(() => s.setUi({ tableGroup: g }))]);
    runs.push(steps);
  }
  const median = (xs) => [...xs].sort((a, b) => a - b)[1];
  return runs[0].map(([n], i) => [n, Math.round(median(runs.map((r) => r[i][1])))]);
`);
// Beyond the table: a status event with the dashboard open, arrow keys held down in the sidebar, Ctrl+A
// over the changes of a working copy with thousands of files. Each step until the next frame is painted.
const views = await js(`
  const s = window.__mbfStore;
  const gs = window.__mbfGitStatus;
  const frame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const time = async (f) => { const t0 = performance.now(); f(); await frame(); return performance.now() - t0; };
  const path = s.repos[0].info.path;
  const file = (p) => ({ path: p, origPath: null, staged: null, unstaged: "Modified", conflicted: false, untracked: false });
  const runs = [];
  for (let run = 0; run < 3; run++) {
    const steps = [];
    s.setUi({ perspective: "Dashboard" });
    await wait(400);
    const st = gs.statuses.get(path);
    steps.push(["status event", await time(() => gs.statuses.set(path, { ...st, entries: [...st.entries, file("perf.txt")] }))]);
    steps.push(["status event back", await time(() => gs.statuses.set(path, st))]);
    // The key repeats every 33 ms; the slowest of ten steps counts.
    s.setUi({ perspective: "Cleanup" });
    s.filters.repos = [];
    await wait(400);
    document.querySelector("nav [data-sel-path]")?.focus();
    let slowest = 0;
    for (let i = 0; i < 10; i++) {
      const row = document.activeElement;
      slowest = Math.max(slowest, await time(() => row.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }))));
      await wait(33);
    }
    steps.push(["sidebar arrow", slowest]);
    await wait(400);
    s.filters.repos = [];
    s.setUi({ perspective: "Git", gitChangesAll: false });
    s.gitRepo = path;
    await wait(800);
    [...document.querySelectorAll("[role=tab]")].find((b) => b.textContent.trim().startsWith("Änderungen"))?.click();
    const before = gs.statuses.get(path);
    gs.statuses.set(path, { ...before, entries: Array.from({ length: 5000 }, (_, i) => file("big/f" + i + ".ts")) });
    await wait(800);
    const list = [...document.querySelectorAll("[role=listbox]")].find((l) => !l.closest("nav") && l.querySelector("[role=option]"));
    steps.push(["changes Ctrl+A 5000", list ? await time(() => list.dispatchEvent(new KeyboardEvent("keydown", { key: "a", ctrlKey: true, bubbles: true }))) : -1]);
    gs.statuses.set(path, before);
    s.setUi({ perspective: "Cleanup" });
    await wait(400);
    runs.push(steps);
  }
  const median = (xs) => [...xs].sort((a, b) => a - b)[1];
  return runs[0].map(([n], i) => [n, Math.round(median(runs.map((r) => r[i][1])))]);
`);
// The start: every repo's status arrives on its own, a few at a time, while the sidebar shows
// placeholders. The frames must keep coming: no long one, hardly a dropped one.
const statuses = await js(`
  const s = window.__mbfStore;
  const paths = s.repos.map((r) => r.info.path);
  window.__mbfGitStatus.statuses.clear();
  await new Promise((r) => setTimeout(r, 500));
  // The same frames with nothing arriving: what the headless browser drops on its own.
  const idleDeltas = [];
  await new Promise((done) => { let l = performance.now(); const t0 = performance.now(); const f = (t) => { idleDeltas.push(t - l); l = t; if (t - t0 < 2000) requestAnimationFrame(f); else done(); }; requestAnimationFrame(f); });
  const idlePerSecond = idleDeltas.slice(1).filter((d) => d > 25).length / 2;
  window.__statusDelay = 40;
  const deltas = [];
  let last = performance.now();
  let on = true;
  const loop = (t) => { deltas.push(t - last); last = t; if (on) requestAnimationFrame(loop); };
  requestAnimationFrame(loop);
  const long = [];
  const obs = new PerformanceObserver((l) => { for (const e of l.getEntries()) long.push(e.duration); });
  obs.observe({ type: "long-animation-frame" });
  const t0 = performance.now();
  const queue = [...paths];
  await Promise.all(Array.from({ length: 6 }, async () => { while (queue.length) await window.__mbfGitStatus.refreshStatus(queue.shift()); }));
  await new Promise((r) => setTimeout(r, 200));
  on = false;
  obs.disconnect();
  window.__statusDelay = 0;
  const secs = (performance.now() - t0) / 1000;
  const slow = deltas.slice(1).filter((d) => d > 25).length;
  return { totalMs: Math.round(secs * 1000), frames: deltas.length, slow, perSecond: +(slow / secs).toFixed(2), idlePerSecond, longMaxMs: Math.round(Math.max(0, ...long)) };
`);
close();

let failed = false;
{
  // Counted above what the idle page drops: the headless browser has no GPU and misses frames of its own.
  const over = statuses.longMaxMs > BUDGET.statusFrameMs || statuses.perSecond - statuses.idlePerSecond > BUDGET.slowPerSecond;
  failed ||= over;
  console.log(`${over ? "FAIL" : "ok  "} statuses: ${repos} in ${statuses.totalMs} ms · ${statuses.frames} frames · ${statuses.slow} over 25 ms (${statuses.perSecond}/s, idle ${statuses.idlePerSecond}/s, budget +${BUDGET.slowPerSecond}/s) · longest long frame ${statuses.longMaxMs} ms (budget ${BUDGET.statusFrameMs})`);
}
for (const [group, r] of Object.entries(results)) {
  const over = r.longSumMs > BUDGET.longSumMs || r.maxFrameMs > BUDGET.maxFrameMs;
  failed ||= over;
  console.log(`${over ? "FAIL" : "ok  "} group ${group.padEnd(6)} total ${r.totalMs} ms · ${r.long} long frames (${r.type}) · sum ${r.longSumMs} ms · max ${r.maxFrameMs} ms · p95 ${r.p95Ms} ms · ${r.rows} rows`);
}
const slowest = Math.max(...interaction.map(([, ms]) => ms));
failed ||= slowest > BUDGET.stepMs;
console.log(`${slowest > BUDGET.stepMs ? "FAIL" : "ok  "} interaction: ${interaction.map(([n, ms]) => `${n} ${ms}`).join(" · ")} ms`);
const slowestView = Math.max(...views.map(([, ms]) => (ms < 0 ? Infinity : ms)));
failed ||= slowestView > BUDGET.stepMs;
console.log(`${slowestView > BUDGET.stepMs ? "FAIL" : "ok  "} views: ${views.map(([n, ms]) => `${n} ${ms < 0 ? "not found" : ms}`).join(" · ")} ms`);
for (const e of errors) console.log(`exception: ${e.slice(0, 300)}`);
console.log(`${repos} repos, ${branches} branches · budget: long frames ≤ ${BUDGET.longSumMs} ms in sum, ≤ ${BUDGET.maxFrameMs} ms each`);
process.exit(failed || errors.length ? 1 : 0);
