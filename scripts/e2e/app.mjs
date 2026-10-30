// The app under test: a debug build of the backend with the e2e frontend embedded (no dev server, so a change in
// the project never reloads a running test), started under an identity of its own beside the user's app, with
// a private data folder, and driven over the DevTools port of its WebView2.
import { execFileSync, spawn } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";
import { exec, ROOT, TAURI, tool } from "../run.mjs";
import { Cdp } from "./cdp.mjs";
import { HELPERS } from "./inpage.mjs";

/** Its own target folder: a dev build of the same tree (or a running dev app) and this one never overwrite each other. */
const TARGET = join(TAURI, "target-e2e");
export const EXE = join(TARGET, "debug", process.platform === "win32" ? "mcbranchface.exe" : "mcbranchface");
/** The window title of the e2e build, so the user tells its window from their own. */
const TITLE_SUFFIX = " E2E";
const BASE = JSON.parse(readFileSync(join(TAURI, "tauri.conf.json"), "utf8"));
export const WINDOW_TITLE = `${BASE.app.windows[0].title}${TITLE_SUFFIX}`;

/**
 * The frontend in mode e2e (with the test hooks, its own folder), then the backend as a debug build that embeds
 * it, under the identity of src-tauri/tauri.e2e.conf.json. The window entries come from the app's own config,
 * only titled apart: arrays are replaced whole when configs merge.
 */
export function buildApp() {
  // Built aside and moved in only when it differs: the backend build embeds the folder and compiles again for
  // every file it sees touched, so an unchanged frontend keeps its files as they were.
  const out = join(ROOT, "build-e2e");
  const next = join(TARGET, "frontend-next");
  tool("vite")("build", "--mode", "e2e", "--outDir", next, "--emptyOutDir");
  if (sameFiles(out, next)) rmSync(next, { recursive: true, force: true });
  else {
    rmSync(out, { recursive: true, force: true });
    renameSync(next, out);
  }
  const windows = { app: { windows: BASE.app.windows.map((w) => ({ ...w, title: `${w.title}${TITLE_SUFFIX}` })) } };
  const cli = join(ROOT, "node_modules", "@tauri-apps", "cli", "tauri.js");
  exec(process.execPath, [cli, "build", "--debug", "--no-bundle", "--config", join(TAURI, "tauri.e2e.conf.json"), "--config", JSON.stringify(windows)], {
    env: { CARGO_TARGET_DIR: TARGET },
  });
  if (!existsSync(EXE)) throw new Error(`no app at ${EXE} after the build`);
}

/** Whether two folders hold the same files with the same bytes. */
function sameFiles(a, b) {
  const list = (dir) => (existsSync(dir) ? readdirSync(dir, { recursive: true }).map(String).filter((f) => statSync(join(dir, f)).isFile()).sort() : []);
  const fa = list(a);
  const fb = list(b);
  return fa.length > 0 && fa.join("\n") === fb.join("\n") && fa.every((f) => readFileSync(join(a, f)).equals(readFileSync(join(b, f))));
}

/** A port nobody listens on right now. */
function freePort() {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.once("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}

/** Ends a process this run started, with every process it started (WebView2 among them), by its id. */
export function kill(pid) {
  try {
    if (process.platform === "win32") execFileSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore" });
    else process.kill(pid, "SIGKILL");
  } catch {
    /* already gone */
  }
}

export class App {
  /**
   * @param {{ data: string, log: string, path: string[], baseConfig: object }} opts
   * `path`: folders put first on PATH (the provider stand-ins).
   */
  constructor(opts) {
    this.opts = opts;
    /** The newest lines of the app's own output, for a failure report. */
    this.lines = [];
    /** @type {Cdp | null} */
    this.cdp = null;
    this.exited = null;
  }

  get pid() {
    return this.proc?.pid;
  }

  async start() {
    const { data, log, path, baseConfig } = this.opts;
    mkdirSync(data, { recursive: true });
    writeFileSync(join(data, "config.json"), JSON.stringify(baseConfig, null, 2));
    this.port = await freePort();
    this.started = Date.now();
    const sep = process.platform === "win32" ? ";" : ":";
    this.proc = spawn(EXE, [], {
      cwd: ROOT,
      env: {
        ...process.env,
        PATH: [...path, process.env.PATH].join(sep),
        MCBRANCHFACE_DATA_DIR: data,
        // Timers and frames keep their pace while the window is behind others or not focused: the run shares
        // the desktop with the user's own work.
        WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: [
          `--remote-debugging-port=${this.port}`,
          "--disable-background-timer-throttling",
          "--disable-renderer-backgrounding",
          "--disable-backgrounding-occluded-windows",
        ].join(" "),
      },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    const keep = (chunk) => {
      const text = String(chunk);
      appendFileSync(log, text);
      this.lines.push(...text.split(/\r?\n/).filter(Boolean));
      if (this.lines.length > 2000) this.lines.splice(0, this.lines.length - 2000);
    };
    this.proc.stdout.on("data", keep);
    this.proc.stderr.on("data", keep);
    this.proc.on("exit", (code) => (this.exited = code ?? "signal"));
    await this.connect();
  }

  async connect(ms = 90_000) {
    const until = Date.now() + ms;
    let target = null;
    // Nothing tells when the WebView2 opened its port: asked a few times a second until it answers.
    while (!target) {
      if (this.exited !== null) {
        throw new Error(`the app ended at its start (exit ${this.exited}); an e2e run already open keeps the second one out\n${this.tail(40)}`);
      }
      if (Date.now() > until) throw new Error(`no page on the DevTools port ${this.port} within ${ms} ms\n${this.tail(40)}`);
      target = await Cdp.target(this.port);
      if (!target) await new Promise((r) => setTimeout(r, 250));
    }
    this.cdp = await Cdp.open(target.webSocketDebuggerUrl);
    await this.cdp.send("Runtime.enable");
    await this.cdp.send("Page.enable");
    // On every document from now on; the one already loading gets them in ready().
    await this.cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: HELPERS });
    // The same size on every machine, and a page that keeps its focus while the user works in other windows:
    // menus and panels close when the window loses it.
    await this.cdp.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await this.cdp.send("Emulation.setFocusEmulationEnabled", { enabled: true });
    await this.ready();
  }

  /**
   * The helpers are on the page, the test hook is there and the start has read its config. A page that is still
   * loading its first document drops what is evaluated in it; the check then runs in the next one.
   */
  async ready(ms = 120_000) {
    const end = Date.now() + ms;
    for (;;) {
      try {
        await this.cdp.evaluate(`${HELPERS} new Promise((resolve, reject) => {
          const end = Date.now() + ${ms};
          const check = () => {
            if (window.__mbfTest && window.__mbfStore?.config) return resolve(true);
            if (Date.now() > end) return reject(new Error("the page did not start within ${ms} ms"));
            setTimeout(check, 50);
          };
          check();
        })`);
        return;
      } catch (e) {
        if (!/context was destroyed|Cannot find context|navigat/i.test(String(e?.message)) || Date.now() > end || this.exited !== null) throw e;
      }
    }
  }

  async reload() {
    const loaded = this.cdp.once("Page.loadEventFired");
    await this.cdp.send("Page.reload");
    await loaded;
    await this.ready();
  }

  tail(n = 300) {
    return this.lines.slice(-n).join("\n");
  }

  stop() {
    this.cdp?.close();
    if (this.proc && this.exited === null) kill(this.proc.pid);
  }
}
