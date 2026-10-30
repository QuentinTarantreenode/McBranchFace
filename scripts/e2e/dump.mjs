// What a failed scenario leaves behind, one folder per failure: enough to tell a timing problem (the app was
// busy when the wait ended) from a logic one (idle, and the value never came), without running it again.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { repos } from "./workspace.mjs";

/** The app's state as a scenario sees it, each part on its own so one broken part does not hide the rest. */
const STATE = `
  const s = window.__mbfStore;
  const part = (f) => { try { return f(); } catch (e) { return "unreadable: " + e.message; } };
  return {
    url: location.href,
    loaded: part(() => s.loaded),
    perspective: part(() => s.config?.ui.perspective),
    scope: part(() => s.scope),
    scanning: part(() => s.scanning),
    stage: part(() => s.stage),
    filters: part(() => JSON.parse(JSON.stringify(s.filters))),
    selectedKey: part(() => s.selectedKey),
    rows: part(() => __e2e.rows()),
    repos: part(() => s.repos.map((r) => ({ path: r.info.path, name: r.info.name, error: r.result?.error ?? null }))),
    dialogs: part(() => ({ settings: s.settingsOpen, deleted: s.deletedOpen, help: s.helpOpen, commitSearch: s.commitSearchOpen, copies: s.copiesFor, ask: !!s.ask })),
    deleteJob: part(() => (s.deleteJob ? { phase: s.deleteJob.phase } : null)),
    gitRepo: part(() => s.gitRepo),
    heads: part(() => Object.fromEntries([...window.__mbfGitStatus.statuses].map(([p, st]) => [p, st.head?.branch ?? null]))),
    toasts: part(() => s.toasts.map((t) => t.text)),
    config: part(() => JSON.parse(JSON.stringify(s.config))),
  };`;

function safe(fn) {
  try {
    return fn();
  } catch (e) {
    return `unavailable: ${e.message}`;
  }
}

async function safely(promise) {
  try {
    return await promise;
  } catch (e) {
    return `unavailable: ${e.message}`;
  }
}

const tailOf = (file, lines) => (existsSync(file) ? readFileSync(file, "utf8").split(/\r?\n/).slice(-lines).join("\n") : "(none)");

/** The refs, worktrees and stashes of every repository the scenario worked in. */
function gitReport(root) {
  const out = [];
  for (const repo of repos(root)) {
    out.push(`==== ${repo}`);
    for (const args of [["status", "-sb"], ["for-each-ref", "refs/heads", "refs/mcbranchface"], ["worktree", "list"], ["stash", "list"]]) {
      out.push(`$ git ${args.join(" ")}`);
      out.push(safe(() => execFileSync("git", args, { cwd: repo, stdio: ["ignore", "pipe", "pipe"] }).toString().trimEnd()));
    }
    out.push("");
  }
  return out.join("\n");
}

/**
 * Writes the report of a failure to `dir`: summary.txt (what failed, the wait's condition and value history, what
 * was busy), state.json, events.json, ipc.json, activity.json, triggers.json, targets.txt, dom.html, git.txt,
 * app.log, diagnostics.log and screenshot.png.
 */
export async function dump(dir, { driver, app, scenario, attempt, error, workspace, data }) {
  mkdirSync(dir, { recursive: true });
  const cdp = app?.cdp && !app.cdp.closed ? app.cdp : null;
  const page = async (body) => (cdp ? safely(cdp.evaluate(`(async () => { ${body} })()`)) : "no page");
  const wait = error?.wait ?? null;
  const click = error?.click ?? null;
  const report = await page("return __mbfTest.report()");
  const busyNow = await page("return { idle: __mbfTest.idle(), busy: __mbfTest.busy() }");

  const summary = [
    `scenario: ${scenario.name} (attempt ${attempt})`,
    `what it checks: ${scenario.title}`,
    `error: ${error?.message ?? error}`,
    "",
    ...(wait
      ? [
          `wait: ${wait.label}`,
          `condition: ${wait.cond}`,
          `timeout: ${wait.ms} ms`,
          `idle when it ended: ${wait.idle}`,
          `busy when it ended: ${JSON.stringify(wait.busy)}`,
          // Busy at the end points to timing, idle to logic: the value never came although nothing ran.
          `reading: ${wait.idle ? "the app was idle: the condition is not what the app does (logic)" : "the app was still working: timing, or work that never ends"}`,
          "values over time (ms since the wait began):",
          ...(wait.history ?? []).map((h) => `  +${String(h.ms).padStart(6)}  ${h.value}`),
          "",
        ]
      : []),
    ...(click ? [`click: ${JSON.stringify(click, null, 2)}`, ""] : []),
    `now: ${JSON.stringify(busyNow)}`,
    "",
    "stack:",
    error?.stack ?? "",
    "",
    "page errors (newest last):",
    ...(app?.cdp?.pageErrors ?? []).slice(-20).map((p) => `  ${p.at} ${p.text}`),
  ].join("\n");
  writeFileSync(join(dir, "summary.txt"), summary);
  writeFileSync(join(dir, "state.json"), JSON.stringify(await page(STATE), null, 2));
  writeFileSync(join(dir, "events.json"), JSON.stringify(await page("return __mbfTest.events"), null, 2));
  const r = typeof report === "object" ? report : {};
  writeFileSync(join(dir, "ipc.json"), JSON.stringify({ running: r.running, last: r.invokes }, null, 2));
  writeFileSync(join(dir, "activity.json"), JSON.stringify(r.activities ?? report, null, 2));
  writeFileSync(join(dir, "triggers.json"), JSON.stringify(r.triggers ?? report, null, 2));
  const targets = await page("return __e2e.targets()");
  writeFileSync(join(dir, "targets.txt"), Array.isArray(targets) ? targets.join("\n") : String(targets));
  writeFileSync(join(dir, "dom.html"), String(await page("return __e2e.dom()")));
  writeFileSync(join(dir, "git.txt"), workspace ? gitReport(workspace) : "(no workspace)");
  writeFileSync(join(dir, "app.log"), app ? app.tail(1000) : "(no app)");
  writeFileSync(join(dir, "diagnostics.log"), data ? tailOf(join(data, "diagnostics.log"), 500) : "(no data folder)");
  if (cdp) {
    try {
      await driver.screenshot(join(dir, "screenshot.png"));
    } catch {
      /* the page is gone; the rest still tells */
    }
  }
}
