// Scenarios of the app as a whole: scans and their stop, the background ticks, the start, the window and the
// tray, settings, help and the activity display.
import { execFileSync, spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";
import { ROOT } from "../../run.mjs";
import { EXE, kill, WINDOW_TITLE } from "../app.mjs";
import { git } from "../workspace.mjs";
import { cleanup, S } from "./common.mjs";

/** The run's own window, found by its process and title: a close like its X button, a press on its frame, its state. */
const win = (ctx, what) =>
  execFileSync("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", join(ROOT, "scripts", "window.ps1"), "-Do", what, "-Id", String(ctx.app.pid), "-Title", WINDOW_TITLE])
    .toString()
    .trim();

/** For what the app cannot report, the operating system's windows and processes: asked a few times a second. */
async function settle(label, check, ms = 20_000) {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error(`timeout: ${label}`);
    await new Promise((r) => setTimeout(r, 250));
  }
}

const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

/** A server that takes the connection and never answers: a fetch from it hangs until stopped. */
async function silentServer() {
  const server = createServer((socket) => socket.on("error", () => {}));
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return server;
}

export const APP = [
  {
    name: "scan-stop",
    title: "A running scan stops from the other half of the refresh button",
    async run(t, ctx) {
      const silent = await silentServer();
      git(ctx.tools, "remote", "add", "silent", `http://127.0.0.1:${silent.address().port}/x.git`);
      try {
        const seq = await t.mark();
        await t.click(["button", "Refresh", "header"], { idle: false });
        // Not idle while it runs: the stop shows on the half that reassesses without the server.
        await t.when("scan running", `${S}.scanning && ${S}.scanKind === "fetch"`);
        await t.press(await t.point(["button", "Stop scan", "header"]));
        await t.expectEvent(seq, { kind: "op", text: "cancel_scan", ok: true });
        await t.expectEvent(seq, { kind: "toast", re: "^Scan stopped\\." });
        await t.idle();
        await t.when("refresh offered again", `!${S}.scanning && __e2e.find({ role: "button", name: "Reassess without the server", within: "header" }).length === 1`);
      } finally {
        silent.close();
      }
    },
  },
  {
    name: "refresh-busy",
    title: "The refresh button spins while its scan runs, and its other half stops it; afterwards both are back",
    async run(t) {
      const probe = `[[...document.querySelectorAll("header button")].find((b) => b.textContent.trim() === "Refresh")?.getAttribute("aria-busy") ?? null, !!document.querySelector('header button[aria-label="Stop scan"]')]`;
      const state = await t.act(`const run = ${S}.scan(true); await __e2e.frame(); const during = ${probe}; await run; await __e2e.frame(); return [during, ${probe}];`);
      if (JSON.stringify(state) !== JSON.stringify([["true", true], [null, false]])) throw new Error(`[aria-busy, stop shown] during and after: ${JSON.stringify(state)}`);
    },
  },
  {
    name: "background-ticks",
    title: "The server check and the automatic fetch, called as their intervals would, bring in branches pushed elsewhere",
    // Intervals long enough that their own timers never come due during the scenario; the ticks are called here.
    config: { serverCheckMinutes: 60, autoFetchMinutes: 60 },
    async run(t, ctx) {
      const later = "Date.now() + 61 * 60_000";
      const push = (name) => {
        git(ctx.server, "switch", "-q", "-c", name, "main");
        git(ctx.server, "commit", "-q", "--allow-empty", "-m", `E2E: ${name}`);
        git(ctx.server, "push", "-q", "-u", "origin", name);
        git(ctx.server, "switch", "-q", "main");
      };
      await t.act(`${S}.setUi({ perspective: "Cleanup", tableGroup: "None" }); ${S}.setScope("Online"); return true;`);
      push("feature/from-elsewhere");
      await t.when("not known yet", `__e2e.rows().length > 0 && !__e2e.rows().includes("feature/from-elsewhere")`);
      // The light check asks the server, finds it moved and fetches only there.
      await t.act(`await __mbfTest.tick("serverCheck", ${later}); return true;`);
      await t.when("the check fetched it", `__e2e.rows().includes("feature/from-elsewhere")`, { show: "__e2e.rows()" });
      await t.when("as a server check", `__mbfTest.report().triggers.some((x) => x.kind === "serverCheck" && x.effect === "fetch")`);
      // The automatic fetch runs as a background scan: no message, the new branch simply arrives.
      push("feature/fetched-later");
      const seq = await t.mark();
      await t.act(`__mbfTest.tick("autoFetch", ${later}); return true;`);
      await t.when("the fetch brought it", `__e2e.rows().includes("feature/fetched-later")`, { show: "__e2e.rows()" });
      await t.when("as an automatic fetch", `__mbfTest.report().triggers.some((x) => x.kind === "autoFetch")`);
      const told = await t.js(`return __mbfTest.events.filter((e) => e.seq > ${seq} && e.kind === "toast").map((e) => e.text)`);
      if (told.length) throw new Error(`a background fetch spoke up: ${told.join(" | ")}`);
    },
  },
  {
    name: "start-stages",
    title: "A start shows the last git state at the first paint, then a local stage, then a fetch stage",
    async run(t, ctx) {
      // Written by the backend a moment after the statuses were read, outside of what the page waits for.
      const cacheFile = join(ctx.data, "cache", "status-v1.json");
      await settle("status cache written", () => existsSync(cacheFile), 10_000);
      const repos = await t.js(`return ${S}.repos.length`);
      await t.reload();
      await t.when("both stages", `!!performance.getEntriesByName("mbf:fetched")[0]`, { ms: 120_000 });
      const m = await t.js(
        `const at = (n) => performance.getEntriesByName("mbf:" + n)[0]; return { painted: at("first-paint").detail, local: at("local-assessed").startTime, fetched: at("fetched").startTime }`,
      );
      if (m.painted < repos) throw new Error(`only ${m.painted} of ${repos} statuses at the first paint`);
      if (!(m.local < m.fetched)) throw new Error("the local stage did not come first");
    },
  },
  {
    name: "tray",
    title: "Closing hides the window to the tray; a second start hands over and brings it back",
    windowsOnly: true,
    async run(t, ctx) {
      const shown = () => win(ctx, "state").startsWith("visible=True");
      await settle("window shown", shown);
      win(ctx, "close");
      // A hidden window is no main window of its process any more.
      await settle("window hidden", () => !shown());
      if (!alive(ctx.app.pid)) throw new Error("closing ended the app instead of hiding it");
      // A second start of the same build hands over to the running instance, which shows its window again.
      const second = spawn(EXE, [], { env: { ...process.env, MCBRANCHFACE_DATA_DIR: ctx.data }, stdio: "ignore", windowsHide: true });
      try {
        await settle("window back", shown);
        await settle("the second start ended", () => second.exitCode !== null, 10_000);
      } finally {
        if (second.exitCode === null) kill(second.pid);
      }
    },
  },
  {
    name: "frame-press-closes-menu",
    title: "A press on the window's frame closes an open menu",
    windowsOnly: true,
    async run(t, ctx) {
      await t.rightClick({ css: "nav [data-folder-head]" }, { at: [0.3, 0.5] });
      await t.when("menu open", `!!document.querySelector("[role=menu]")`);
      win(ctx, "press-frame");
      await t.when("menu closed", `!document.querySelector("[role=menu]")`, { ms: 5000 });
    },
  },
  {
    name: "settings-dialog-size",
    title: "The settings dialog moves and resizes; its size survives a reload, its place does not",
    async run(t, ctx) {
      const dlg = `document.querySelector("dialog[open]")`;
      await t.act(`${S}.openSettings(); return true;`);
      await t.when("settings", `!!${dlg}?.querySelector("[role=separator]")`);
      const before = await t.js(`const r = ${dlg}.getBoundingClientRect(); return [r.left, r.top, r.width, r.height];`);
      const f = await t.factor();
      const head = await t.center(`${dlg}.querySelector("header")`, 0.3);
      await t.drag(head, [head[0] + 80 * f, head[1] + 40 * f]);
      await t.when("moved", `(() => { const r = ${dlg}.getBoundingClientRect(); return r.left > ${before[0] + 40} && r.top > ${before[1] + 20}; })()`);
      const grip = await t.center(`${dlg}.querySelector("[role=separator]")`);
      await t.drag(grip, [grip[0] - 160 * f, grip[1] - 80 * f]);
      await t.when("smaller", `${dlg}.getBoundingClientRect().width < ${before[2] - 80}`);
      const width = Math.round(await t.js(`return ${dlg}.getBoundingClientRect().width`));
      if (!JSON.parse(readFileSync(join(ctx.data, "config.json"), "utf8")).ui.dialogSizes?.settings) throw new Error("dialog size not saved");
      await t.act(`${S}.settingsOpen = false; return true;`);
      await t.reload();
      await t.idle("idle after the reload", 120_000);
      await t.act(`${S}.openSettings(); return true;`);
      await t.when("same size", `Math.abs((${dlg}?.getBoundingClientRect().width ?? 0) - ${width}) < 3`);
      // Opens where dialogs open, not where it was left.
      await t.when("back on top", `Math.abs(${dlg}.getBoundingClientRect().top - ${before[1]}) < 3`);
    },
  },
  {
    name: "context-submenu",
    title: "A context menu's submenu opens on hover; Esc closes the submenu, then the menu",
    async run(t) {
      await cleanup(t);
      await t.rightClick(await t.tag(`document.querySelector("[role=option][data-key]")`), { at: [0.3, 0.5] });
      await t.hover(await t.tag(`document.querySelector("[role=menu] [role=menuitem][aria-haspopup=menu]")`));
      await t.when("submenu", `document.querySelectorAll("[role=menu]").length === 2`, { ms: 5000 });
      // Real key presses reach the focused menu, which a submenu opened by hovering leaves on the parent:
      // Esc closes the submenu only, the next one the menu.
      await t.key("Escape");
      await t.when("submenu closed", `document.querySelectorAll("[role=menu]").length === 1`);
      await t.key("Escape");
      await t.when("menu closed", `!document.querySelector("[role=menu]")`);
    },
  },
  {
    name: "help-legend",
    title: "The help's legend shows the real elements",
    async run(t) {
      await t.act(`const s = ${S}; s.helpAt = { topic: "legend", section: "sidebar" }; s.helpOpen = true; return true;`);
      await t.when("legend", `document.querySelectorAll("[data-legend=sidebar] dt svg, [data-legend=sidebar] dt span").length >= 8`);
    },
  },
  {
    name: "help-topic",
    title: "F1 opens the help on the topic of the current view",
    async run(t) {
      await t.act(`${S}.setUi({ perspective: "Cleanup" }); ${S}.setScope("Online"); return true;`);
      await t.key("F1");
      // Opens on the topic of the current view: the server branches.
      await t.when("help open", `!!document.querySelector("aside[aria-label=Help]")?.innerText.includes("Branches on the server")`);
    },
  },
  {
    name: "activity",
    title: "Every external call names its source and operation, on screen and in the log; the triggers list the refresh",
    async run(t, ctx) {
      await t.act(`${S}.setUi({ perspective: "Cleanup" }); window.__mbfActivity.clear(); return true;`);
      await t.click(["button", "Reassess without the server", "header"]);
      // The backend reports the git calls of the scan; each one says it is local and what it reads.
      await t.when("named calls", `window.__mbfActivity.recent.some((a) => /^Local · /.test(a.text) && a.path)`);
      // The list of what ran opens from the status slot, on the calls; its triggers name the refresh.
      await t.click({ css: "header button[aria-haspopup=dialog]" });
      await t.click(["tab", /^Triggers\b/, "[role=dialog][aria-label=Activity]"]);
      await t.when("triggers", `/Refresh/.test(document.querySelector("[role=dialog][aria-label=Activity]")?.innerText ?? "")`);
      await t.click({ css: "[role=dialog][aria-label=Activity] [role=radio], [role=dialog][aria-label=Activity] [role=tab], [role=dialog][aria-label=Activity] button", nameRe: "^Activity\\b" });
      await t.when("recent", `/Recent/i.test(document.querySelector("[role=dialog][aria-label=Activity]")?.innerText ?? "")`);
      await t.key("Escape");
      await t.when("closed", `!document.querySelector("[role=dialog][aria-label=Activity]")`);
      // The log has the calls of the backend and the activities of the app, one timeline; once idle it is written.
      const log = readFileSync(join(ctx.data, "diagnostics.log"), "utf8");
      if (!/ git /.test(log) || !/activity /.test(log)) throw new Error(`log without git calls or activities: ${log.slice(-400)}`);
    },
  },
];
