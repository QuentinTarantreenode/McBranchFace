// The audit build in headless Chrome or Edge over CDP: static server, browser, one page, loaded app.
// Shared by the UI audit and the performance run. CHROME_PATH picks the browser.
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { extname, join, normalize } from "node:path";

const ROOT = "build-audit";
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".svg": "image/svg+xml", ".woff2": "font/woff2" };
const CANDIDATES = [
  process.env.CHROME_PATH,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
].filter(Boolean);

/** `query`: appended to the page URL, e.g. "?repos=150" for the scaled fixture. */
export async function openAudit({ query = "" } = {}) {
  if (!existsSync(join(ROOT, "audit.html"))) {
    console.error("No audit build found: run `npx vite build --mode audit` first.");
    process.exit(2);
  }
  const server = createServer((req, res) => {
    const path = decodeURIComponent(new URL(req.url, "http://x").pathname);
    const file = normalize(join(ROOT, path === "/" ? "audit.html" : path));
    if (!file.startsWith(normalize(ROOT)) || !existsSync(file)) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" }).end(readFileSync(file));
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${server.address().port}/`;

  const exe = CANDIDATES.find((p) => existsSync(p));
  if (!exe) {
    console.error("No Chrome or Edge found; set CHROME_PATH.");
    process.exit(2);
  }
  const profile = mkdtempSync(join(tmpdir(), "mbf-audit-"));
  const browser = spawn(exe, [
    "--headless=new", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "--no-first-run", "--no-default-browser-check",
    "--disable-gpu", "--hide-scrollbars=false", "--window-size=1280,860", "--lang=de-DE", url + query,
  ]);
  const port = await new Promise((resolve, reject) => {
    let err = "";
    browser.stderr.on("data", (d) => {
      err += d;
      const m = err.match(/DevTools listening on ws:\/\/[^:]+:(\d+)\//);
      if (m) resolve(m[1]);
    });
    browser.on("exit", (code) => reject(new Error(`browser exited (${code}): ${err.slice(0, 500)}`)));
  });

  let page;
  for (let i = 0; i < 50 && !page; i++) {
    page = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((t) => t.type === "page" && t.url.startsWith(url));
    if (!page) await new Promise((r) => setTimeout(r, 100));
  }
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r, j) => {
    ws.addEventListener("open", r);
    ws.addEventListener("error", j);
  });
  let seq = 0;
  const pending = new Map();
  const errors = [];
  ws.addEventListener("message", (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    } else if (msg.method === "Runtime.exceptionThrown") errors.push(msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text);
    // A view that fails renders its error boundary, which logs the error instead of throwing it.
    else if (msg.method === "Runtime.consoleAPICalled" && msg.params.type === "error") errors.push(msg.params.args.map((a) => a.description ?? a.value).join(" "));
  });
  const send = (method, params = {}) =>
    new Promise((r) => {
      const i = ++seq;
      pending.set(i, r);
      ws.send(JSON.stringify({ id: i, method, params }));
    });
  // A step that never settles would stall the whole audit silently: it fails instead, and the audit goes on.
  async function evaluate(expression, ms = 90_000) {
    let timer;
    const late = new Promise((_, reject) => (timer = setTimeout(() => reject(new Error(`step did not finish within ${ms / 1000} s`)), ms)));
    const res = await Promise.race([send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }), late]).finally(() => clearTimeout(timer));
    if (res.result?.exceptionDetails) throw new Error(JSON.stringify(res.result.exceptionDetails).slice(0, 500));
    return res.result?.result?.value;
  }
  const js = (body) => evaluate(`(async () => { ${body} })()`);

  await send("Runtime.enable");
  await send("Page.enable");
  // Load again with the runtime listening, so errors during start are reported too.
  await send("Page.reload");
  let loaded = false;
  for (let i = 0; i < 100 && !loaded; i++) {
    await new Promise((r) => setTimeout(r, 100));
    loaded = await evaluate(`!!window.__mbfStore?.loaded`).catch(() => false);
  }
  if (!loaded) {
    console.error("The app did not load.", errors.join("\n"));
    process.exit(2);
  }

  const close = () => {
    ws.close();
    browser.kill();
    server.close();
    try {
      rmSync(profile, { recursive: true, force: true });
    } catch {
      // The browser may still hold its profile for a moment; the temp folder is cleaned by the OS.
    }
  };
  return { send, evaluate, js, errors, close };
}
