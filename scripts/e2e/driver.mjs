// What a scenario uses to drive the app: waits that end on the app's own signals instead of sleeps, clicks with
// real mouse input on a control named by role and exact name once it can take them, and the app's event log
// as the signal that something succeeded. Every action waits until the app is idle before and after.
import { writeFileSync } from "node:fs";

/** A condition that did not hold in time; carries what the failure report shows. */
export class WaitError extends Error {
  constructor(label, info) {
    super(`timeout: ${label} (${info.error ?? "not met"})`);
    this.wait = { label, ...info };
  }
}

/** A control that never became clickable, or a click that reached something else. */
export class ClickError extends Error {
  constructor(message, info) {
    super(message);
    this.click = info;
  }
}

/** A condition is an expression, or a function body that returns (it starts with return, const, let or if). */
const fnOf = (src) => (/^\s*(return|const|let|if|for)\b/.test(src) ? `() => { ${src} }` : `() => (${src})`);

/** ["button", "Save"], ["button", "Save", "dialog[open]"], { role, name, within } or { css, within }. */
function specOf(target) {
  if (Array.isArray(target)) {
    const [role, name, within] = target;
    return { role, ...(name instanceof RegExp ? { nameRe: name.source } : { name }), ...(within ? { within } : {}) };
  }
  return target;
}

const KEYS = {
  Escape: [27, "Escape"], Enter: [13, "Enter"], Tab: [9, "Tab"], Delete: [46, "Delete"], Backspace: [8, "Backspace"],
  ArrowDown: [40, "ArrowDown"], ArrowUp: [38, "ArrowUp"], ArrowLeft: [37, "ArrowLeft"], ArrowRight: [39, "ArrowRight"],
  F1: [112, "F1"], F5: [116, "F5"], "=": [187, "Equal"], "0": [48, "Digit0"],
};
/** A wait longer than this is listed with the scenario's result. */
const SLOW_MS = 2000;

/** CDP's modifier bits. */
export const MOD = { alt: 1, ctrl: 2, meta: 4, shift: 8 };

export class Driver {
  /** @param {import("./app.mjs").App} app */
  constructor(app) {
    this.app = app;
    /** The waits of the running scenario that took long, label and time: where its time went. */
    this.slow = [];
    this.tags = 0;
  }

  get cdp() {
    return this.app.cdp;
  }

  /** Runs a function body in the page (it may await) and returns what it returns. */
  js(body) {
    return this.cdp.evaluate(`(async () => { ${body} })()`);
  }

  /**
   * Waits until the condition (page code, see fnOf) is truthy and returns its value. Event-driven inside the
   * page; on a timeout the error carries the condition, the history of its value and what kept the app busy.
   * `show` is an expression recorded beside it, for conditions whose own value says little.
   */
  async when(label, cond, { ms = 20_000, show } = {}) {
    const src = fnOf(cond);
    const t0 = Date.now();
    const res = await this.cdp.evaluate(`__e2e.wait(${src}, ${ms}${show ? `, ${fnOf(show)}` : ""})`, ms + 15_000);
    if (Date.now() - t0 > SLOW_MS) this.slow.push({ label, ms: Date.now() - t0, history: res?.history });
    if (res?.ok) return res.value;
    throw new WaitError(label, { cond, ms, ...res });
  }

  /** No command, scan, git operation, delete, timer or external call running. */
  idle(label = "idle", ms = 60_000) {
    return this.when(label, "__mbfTest.idle()", { ms, show: "__mbfTest.busy()" });
  }

  /** An action written as page code: waits for idle before and after. */
  async act(body, label = "act") {
    await this.idle(`idle before ${label}`);
    const v = await this.js(body);
    await this.idle(`idle after ${label}`);
    return v;
  }

  /** The newest event's number: what an expectEvent after an action counts from. */
  mark() {
    return this.js(`return __mbfTest.events.at(-1)?.seq ?? 0`);
  }

  /**
   * The first event after `after` that matches: `{ kind: "toast" | "op", text, re, ok, level }`. A toast is found
   * however briefly it showed; one from an earlier step never counts.
   */
  async expectEvent(after, match, { ms = 30_000 } = {}) {
    const parts = [`e.seq > ${after}`];
    if (match.kind) parts.push(`e.kind === ${JSON.stringify(match.kind)}`);
    if (match.text !== undefined) parts.push(`e.text === ${JSON.stringify(match.text)}`);
    if (match.re) parts.push(`new RegExp(${JSON.stringify(match.re)}).test(e.text)`);
    if (match.ok !== undefined) parts.push(`e.ok === ${match.ok}`);
    if (match.level) parts.push(`e.level === ${JSON.stringify(match.level)}`);
    return this.when(`event ${JSON.stringify(match)}`, `__mbfTest.events.find((e) => ${parts.join(" && ")}) ?? null`, {
      ms,
      show: `__mbfTest.events.filter((e) => e.seq > ${after}).slice(-6).map((e) => e.kind + ":" + e.text + (e.ok === false ? " (failed)" : ""))`,
    });
  }

  // ---- input ----------------------------------------------------------------------------------

  /**
   * Input points per page pixel. Whether CDP's input points follow the interface zoom differs between WebView2
   * setups, so one move to the middle of the window measures it, again whenever the zoom changes.
   */
  async factor() {
    const [dpr, w, h] = await this.cdp.evaluate("[window.devicePixelRatio, innerWidth, innerHeight]");
    if (this.measuredAt !== dpr) {
      const [x, y] = [Math.round(w / 2), Math.round(h / 2)];
      await this.mouse("mouseMoved", x, y);
      const at = await this.cdp.evaluate("__e2e.moved()");
      this.scale = at && at[0] > 0 ? x / at[0] : 1;
      this.measuredAt = dpr;
    }
    return this.scale;
  }

  mouse(type, x, y, extra = {}) {
    return this.cdp.send("Input.dispatchMouseEvent", { type, x, y, button: "none", ...extra });
  }

  /** Where a control can be clicked, once it can: in input coordinates. */
  async point(target, { ms = 15_000, at = [0.5, 0.5] } = {}) {
    const spec = specOf(target);
    // Measured first: its mouse move may hover something, and the checks below must see the page after it.
    const f = await this.factor();
    const res = await this.cdp.evaluate(`__e2e.actionable(${JSON.stringify(spec)}, ${ms}, ${at[0]}, ${at[1]})`, ms + 15_000);
    if (!res?.ok) {
      const why = `${res?.state ?? "no answer"}${res?.detail ? `: ${JSON.stringify(res.detail)}` : ""}`;
      throw new ClickError(`not clickable: ${res?.target ?? JSON.stringify(spec)} (${why})`, res);
    }
    return { x: res.x * f, y: res.y * f, what: res.what };
  }

  async press(p, { button = "left", count = 1, modifiers = 0 } = {}) {
    const buttons = button === "right" ? 2 : 1;
    await this.mouse("mouseMoved", p.x, p.y, { modifiers });
    for (let c = 1; c <= count; c++) {
      await this.mouse("mousePressed", p.x, p.y, { button, buttons, clickCount: c, modifiers });
      await this.mouse("mouseReleased", p.x, p.y, { button, buttons: 0, clickCount: c, modifiers });
    }
    const missed = await this.cdp.evaluate("__e2e.landed()");
    if (missed) throw new ClickError(`the click on ${p.what} reached ${missed}`, { target: p.what, reached: missed });
  }

  /**
   * A real click on the one control the target names, once it is enabled, uncovered and still. `idle: false`
   * for a click that starts work which runs on, such as a fetch a later step stops.
   */
  async click(target, opts = {}) {
    await this.idle("idle before a click");
    await this.press(await this.point(target, opts), opts);
    if (opts.idle !== false) await this.idle(`idle after the click on ${JSON.stringify(specOf(target))}`);
  }

  rightClick(target, opts = {}) {
    return this.click(target, { ...opts, button: "right" });
  }

  doubleClick(target, opts = {}) {
    return this.click(target, { ...opts, count: 2 });
  }

  /** The mouse over a control, e.g. for a submenu that opens on hover. */
  async hover(target, opts = {}) {
    const p = await this.point(target, opts);
    await this.mouse("mouseMoved", p.x, p.y);
    await this.idle("idle after hover");
  }

  /**
   * Presses at one point and releases at another, moving in steps as a hand does. Each end is a target or a
   * point in input coordinates; `to` may be shifted by `[dx, dy]` page pixels.
   */
  async drag(from, to, { at = [0.5, 0.5], toAt = [0.5, 0.5], shift = [0, 0], steps = 8 } = {}) {
    await this.idle("idle before a drag");
    const a = Array.isArray(from) && typeof from[0] === "number" ? { x: from[0], y: from[1] } : await this.point(from, { at });
    let b;
    if (Array.isArray(to) && typeof to[0] === "number") b = { x: to[0], y: to[1] };
    else {
      const spec = specOf(to);
      const r = await this.js(`const e = __e2e.find(${JSON.stringify(spec)})[0]; if (!e) return null; const r = e.getBoundingClientRect(); return [r.left + r.width * ${toAt[0]}, r.top + r.height * ${toAt[1]}];`);
      if (!r) throw new ClickError(`drop target not found: ${JSON.stringify(spec)}`, spec);
      const f = await this.factor();
      b = { x: r[0] * f, y: r[1] * f };
    }
    const f = await this.factor();
    b = { x: b.x + shift[0] * f, y: b.y + shift[1] * f };
    await this.mouse("mouseMoved", a.x, a.y);
    await this.mouse("mousePressed", a.x, a.y, { button: "left", buttons: 1, clickCount: 1 });
    for (let i = 1; i <= steps; i++) await this.mouse("mouseMoved", a.x + ((b.x - a.x) * i) / steps, a.y + ((b.y - a.y) * i) / steps, { button: "left", buttons: 1 });
    await this.mouse("mouseReleased", b.x, b.y, { button: "left", buttons: 0, clickCount: 1 });
    await this.idle("idle after a drag");
  }

  /**
   * A target for an element only page code can find (the button inside one particular group): the element the
   * expression returns is marked, and the mark is the target.
   */
  async tag(expr, ms = 15_000) {
    const id = `t${++this.tags}`;
    await this.when(`an element for ${expr}`, `(() => { const e = (${expr}); if (!e) return false; e.setAttribute("data-e2e", ${JSON.stringify(id)}); return true; })()`, { ms });
    return { css: `[data-e2e="${id}"]` };
  }

  /** The point of an element a page expression returns, at a fraction of its box, in input coordinates. */
  async center(expr, fx = 0.5, fy = 0.5) {
    const r = await this.js(`const e = (${expr}); if (!e) return null; const r = e.getBoundingClientRect(); return [r.left + r.width * ${fx}, r.top + r.height * ${fy}];`);
    if (!r) throw new ClickError(`no element for ${expr}`, { expr });
    const f = await this.factor();
    return [r[0] * f, r[1] * f];
  }

  /** Types into a field the way a finished entry looks to the app: the value, then its input event. */
  async fill(target, value) {
    await this.point(target);
    await this.js(`return __e2e.fill(${JSON.stringify(specOf(target))}, ${JSON.stringify(value)})`);
    await this.idle("idle after typing");
  }

  /** A real key press on the focused element; `mods` uses the bits in MOD. */
  async key(name, mods = 0) {
    const [code, keyCode] = KEYS[name] ?? [name.toUpperCase().charCodeAt(0), `Key${name.toUpperCase()}`];
    const text = name.length === 1 && !(mods & (MOD.ctrl | MOD.alt | MOD.meta)) ? name : undefined;
    const base = { key: name, code: keyCode, windowsVirtualKeyCode: code, nativeVirtualKeyCode: code, modifiers: mods };
    await this.cdp.send("Input.dispatchKeyEvent", { type: text ? "keyDown" : "rawKeyDown", ...base, ...(text ? { text } : {}) });
    await this.cdp.send("Input.dispatchKeyEvent", { type: "keyUp", ...base });
    await this.idle(`idle after the key ${name}`);
  }

  async screenshot(file) {
    const shot = await this.cdp.send("Page.captureScreenshot", { format: "png" });
    writeFileSync(file, Buffer.from(shot.data, "base64"));
  }

  /** Loads the page again, as a start of the frontend does, and waits until the app is ready and idle. */
  async reload() {
    await this.app.reload();
  }
}
