// One DevTools connection to the app's page: commands with their answers, the events the run listens to,
// and what the page threw or logged as an error.

/** A command the page could not answer, or a connection that ended while it waited. */
export class CdpError extends Error {}

/** Longer than any wait a scenario sets: past it the page itself is stuck. */
const ANSWER_MS = 200_000;

export class Cdp {
  /** @param {WebSocket} socket */
  constructor(socket) {
    this.socket = socket;
    this.next = 0;
    /** @type {Map<number, { resolve: (v: any) => void, reject: (e: Error) => void, method: string }>} */
    this.pending = new Map();
    /** @type {Map<string, Set<(params: any) => void>>} */
    this.handlers = new Map();
    /** What the page threw or logged as an error, newest last. */
    this.pageErrors = [];
    this.closed = false;
    socket.addEventListener("message", (m) => this.receive(JSON.parse(String(m.data))));
    socket.addEventListener("close", () => this.end("the connection to the page closed"));
    this.on("Runtime.exceptionThrown", (p) => this.pageError(p.exceptionDetails.exception?.description ?? p.exceptionDetails.text));
    this.on("Runtime.consoleAPICalled", (p) => {
      if (p.type === "error") this.pageError(p.args.map((a) => a.description ?? a.value).join(" "));
    });
  }

  /** The first page target on the port, or null while the app is still starting. */
  static async target(port) {
    try {
      const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
      return targets.find((t) => t.type === "page") ?? null;
    } catch {
      return null;
    }
  }

  static async open(url) {
    const socket = new WebSocket(url);
    await new Promise((resolve, reject) => {
      socket.addEventListener("open", resolve, { once: true });
      socket.addEventListener("error", () => reject(new CdpError(`no connection to ${url}`)), { once: true });
    });
    return new Cdp(socket);
  }

  pageError(text) {
    this.pageErrors.push({ at: new Date().toISOString(), text: String(text).slice(0, 2000) });
    if (this.pageErrors.length > 200) this.pageErrors.shift();
  }

  receive(msg) {
    if (msg.id !== undefined) {
      const p = this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      if (msg.error) p.reject(new CdpError(`${p.method}: ${msg.error.message}`));
      else p.resolve(msg.result);
      return;
    }
    for (const h of this.handlers.get(msg.method) ?? []) h(msg.params);
  }

  end(reason) {
    if (this.closed) return;
    this.closed = true;
    for (const p of this.pending.values()) p.reject(new CdpError(`${p.method}: ${reason}`));
    this.pending.clear();
  }

  on(method, handler) {
    if (!this.handlers.has(method)) this.handlers.set(method, new Set());
    this.handlers.get(method).add(handler);
    return () => this.handlers.get(method)?.delete(handler);
  }

  /** The next event of this kind, e.g. the page's load after a reload. */
  once(method, ms = 60_000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => (off(), reject(new CdpError(`no ${method} within ${ms} ms`))), ms);
      const off = this.on(method, (p) => (clearTimeout(timer), off(), resolve(p)));
    });
  }

  /** A command and its answer; a page that stops answering (hung, gone) fails it after `ms`. */
  send(method, params = {}, ms = ANSWER_MS) {
    if (this.closed) return Promise.reject(new CdpError(`${method}: the connection to the page is closed`));
    return new Promise((resolve, reject) => {
      const id = ++this.next;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new CdpError(`${method}: no answer within ${ms} ms`));
      }, ms);
      const settle = (fn) => (v) => (clearTimeout(timer), fn(v));
      this.pending.set(id, { resolve: settle(resolve), reject: settle(reject), method });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  /**
   * Evaluates an expression in the page and returns its value; a promise is awaited, at most `ms`. What the page
   * throws comes back as an error with the page's own message.
   */
  async evaluate(expression, ms = ANSWER_MS) {
    const res = await this.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }, ms);
    if (res.exceptionDetails) {
      const d = res.exceptionDetails;
      throw new CdpError(d.exception?.description ?? d.exception?.value ?? d.text ?? JSON.stringify(d));
    }
    return res.result?.value;
  }

  close() {
    this.end("closed by the run");
    try {
      this.socket.close();
    } catch {
      /* already closed */
    }
  }
}
