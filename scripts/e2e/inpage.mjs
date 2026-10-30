// What the run puts on the page as window.__e2e: finding a control the way a user names it (role and exact
// accessible name), waiting until it can take a click, waiting for a condition with the history of its value,
// and the state a failure report shows. Runs inside the page, so it uses nothing from this module's scope; the
// page's content security policy forbids eval, so conditions arrive as functions written into the expression.

function helpers() {
  if (window.__e2e) return;

  const IMPLICIT = {
    BUTTON: () => "button",
    A: (e) => (e.hasAttribute("href") ? "link" : null),
    TEXTAREA: () => "textbox",
    SELECT: (e) => (e.multiple || e.size > 1 ? "listbox" : "combobox"),
    DIALOG: () => "dialog",
    IMG: () => "img",
    NAV: () => "navigation",
    MAIN: () => "main",
    ASIDE: () => "complementary",
    H1: () => "heading", H2: () => "heading", H3: () => "heading", H4: () => "heading", H5: () => "heading", H6: () => "heading",
    INPUT: (e) =>
      ({ checkbox: "checkbox", radio: "radio", button: "button", submit: "button", reset: "button", range: "slider", number: "spinbutton", search: "searchbox", hidden: null })[e.type] ??
      "textbox",
  };
  // Roles whose name comes from what they contain when nothing labels them.
  const FROM_CONTENT = new Set([
    "button", "link", "tab", "menuitem", "menuitemcheckbox", "menuitemradio", "option", "checkbox", "radio", "switch", "cell", "gridcell", "columnheader",
    "rowheader", "heading", "treeitem", "row", "tooltip",
  ]);
  const norm = (s) => String(s ?? "").replace(/\s+/g, " ").trim();

  function roleOf(e) {
    const explicit = e.getAttribute("role");
    if (explicit) return explicit.trim().split(/\s+/)[0];
    return IMPLICIT[e.tagName]?.(e) ?? null;
  }

  function shown(e) {
    if (e.getAttribute("aria-hidden") === "true" || e.hidden) return false;
    const cs = getComputedStyle(e);
    return cs.display !== "none" && cs.visibility !== "hidden";
  }

  function textOf(node) {
    let out = "";
    for (const c of node.childNodes) {
      if (c.nodeType === Node.TEXT_NODE) out += c.data;
      else if (c.nodeType === Node.ELEMENT_NODE) {
        if (!shown(c)) continue;
        const label = c.getAttribute("aria-label");
        const block = !getComputedStyle(c).display.startsWith("inline");
        out += block ? ` ${label ?? textOf(c)} ` : label ? ` ${label} ` : textOf(c);
      }
    }
    return out;
  }

  /** The accessible name, as far as this app needs it: labelledby, label, the field's label, the content. */
  function nameOf(e) {
    const by = e.getAttribute("aria-labelledby");
    if (by) {
      const text = norm(by.split(/\s+/).map((id) => document.getElementById(id)).filter(Boolean).map((x) => textOf(x)).join(" "));
      if (text) return text;
    }
    const label = norm(e.getAttribute("aria-label"));
    if (label) return label;
    if (e.matches("input[type=button], input[type=submit], input[type=reset]")) return norm(e.value);
    if (e.matches("input, textarea, select")) {
      const own = e.labels?.[0];
      if (own) return norm(textOf(own));
      return norm(e.getAttribute("placeholder") || e.getAttribute("title"));
    }
    if (FROM_CONTENT.has(roleOf(e))) return norm(textOf(e));
    return norm(e.getAttribute("title"));
  }

  function visible(e) {
    if (!e.isConnected || !e.getClientRects().length) return false;
    if (e.checkVisibility && !e.checkVisibility({ visibilityProperty: true })) return false;
    for (let a = e; a; a = a.parentElement) if (a.getAttribute("aria-hidden") === "true" || a.inert) return false;
    return true;
  }

  /** Where a user can act: inside the open modal dialogs (menus are such dialogs too) and popovers, or anywhere. */
  function scopes(within) {
    if (within) return [...document.querySelectorAll(within)].filter(visible);
    const modal = [...document.querySelectorAll("dialog")].filter((d) => d.matches(":modal") && visible(d));
    if (!modal.length) return [document.documentElement];
    return [...modal, ...document.querySelectorAll(":popover-open")];
  }

  function describe(e) {
    if (!e) return "nothing";
    if (e === document.documentElement || e === document.body) return e.tagName.toLowerCase();
    const role = roleOf(e);
    const name = nameOf(e);
    const cls = typeof e.className === "string" ? e.className.split(/\s+/).filter(Boolean).slice(0, 3).join(".") : "";
    return `<${e.tagName.toLowerCase()}${e.id ? "#" + e.id : ""}${cls ? "." + cls : ""}>${role ? ` role=${role}` : ""}${name ? ` "${name.slice(0, 80)}"` : ""}`;
  }

  function label(spec) {
    const name = spec.name !== undefined ? ` "${spec.name}"` : spec.nameRe ? ` /${spec.nameRe}/` : "";
    return `${spec.role ?? spec.css}${name}${spec.css && spec.role ? ` (${spec.css})` : ""}${spec.within ? ` in ${spec.within}` : ""}`;
  }

  /** Every visible element the spec names: by role and exact name, or by a CSS selector for structure. */
  function find(spec) {
    const found = new Set();
    const re = spec.nameRe ? new RegExp(spec.nameRe) : null;
    for (const root of scopes(spec.within)) {
      const pool = spec.css ? root.querySelectorAll(spec.css) : root.querySelectorAll("*");
      for (const e of pool) {
        if (found.has(e)) continue;
        if (spec.role && roleOf(e) !== spec.role) continue;
        if (!visible(e)) continue;
        if (spec.name !== undefined && nameOf(e) !== spec.name) continue;
        if (re && !re.test(nameOf(e))) continue;
        found.add(e);
      }
    }
    return [...found];
  }

  function disabled(e) {
    for (let a = e; a; a = a.parentElement) {
      if (a.getAttribute("aria-disabled") === "true") return true;
      if (a === e && a.disabled) return true;
      if (a.tagName === "FIELDSET" && a.disabled) return true;
    }
    return false;
  }

  /** The box a click aims at: a hidden checkbox or switch is clicked through its label, as a user does. */
  function aim(e) {
    const r = e.getBoundingClientRect();
    if (e.labels?.length && (r.width < 4 || r.height < 4)) return { at: e.labels[0], rect: e.labels[0].getBoundingClientRect() };
    return { at: e, rect: r };
  }

  /** Whether the point lies outside a box around the element that cuts off what overflows it. */
  function clipped(e, x, y) {
    for (let n = e; n.parentElement && n.parentElement !== document.body; n = n.parentElement) {
      // A fixed layer is not cut by the boxes it sits in.
      if (getComputedStyle(n).position === "fixed") return false;
      const s = getComputedStyle(n.parentElement);
      if (s.overflowX === "visible" && s.overflowY === "visible") continue;
      const c = n.parentElement.getBoundingClientRect();
      if (x < c.left || x > c.right || y < c.top || y > c.bottom) return true;
    }
    return false;
  }

  /** One check of whether the control can take a click now, and if not, why. */
  function inspect(spec, fx = 0.5, fy = 0.5) {
    const all = find(spec);
    if (!all.length) return { state: "missing" };
    if (all.length > 1) return { state: "ambiguous", detail: all.slice(0, 6).map(describe) };
    const e = all[0];
    if (disabled(e)) return { state: "disabled", el: e };
    const { at, rect } = aim(e);
    const x = rect.left + rect.width * fx;
    const y = rect.top + rect.height * fy;
    if (x < 0 || y < 0 || x > innerWidth || y > innerHeight) {
      at.scrollIntoView({ block: "nearest", inline: "nearest" });
      return { state: "outside the window", el: e };
    }
    // A column of a table wider than its room: scrolled to, as a user does.
    if (clipped(at, x, y)) {
      at.scrollIntoView({ block: "nearest", inline: "nearest" });
      return { state: "scrolled out of its box", el: e };
    }
    const hit = document.elementFromPoint(x, y);
    if (!hit || !(at === hit || at.contains(hit) || e.contains(hit))) return { state: "covered", detail: describe(hit), el: e };
    return { state: "ok", el: e, at, x, y, rect: [rect.left, rect.top, rect.width, rect.height] };
  }

  // Frames may stop in a window nobody sees; a short timer stands in, so a wait never hangs on that.
  const frame = () => new Promise((r) => {
    const t = setTimeout(r, 100);
    requestAnimationFrame(() => (clearTimeout(t), r()));
  });

  /** Resolves on the next change of the page or after `ms`, whichever comes first. */
  function change(ms) {
    return new Promise((resolve) => {
      const observer = new MutationObserver(() => done());
      const timer = setTimeout(() => done(), ms);
      const done = () => (observer.disconnect(), clearTimeout(timer), resolve());
      observer.observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true });
    });
  }

  // The user's clipboard stays theirs: what the app copies is kept here for the checks.
  if (navigator.clipboard) navigator.clipboard.writeText = async (text) => void (window.__clip = text);

  let lastDown = null;
  addEventListener("pointerdown", (ev) => (lastDown = ev.target), true);
  let lastMove = null;
  addEventListener("mousemove", (ev) => (lastMove = [ev.clientX, ev.clientY]), true);
  let aimed = null;

  window.__e2e = {
    roleOf,
    nameOf,
    describe,
    find,
    frame,

    /**
     * Waits until exactly one control matches, it is enabled, a click at its point reaches it and its box held
     * still for two frames; resolves with that point, or with the last reason after `ms`.
     */
    async actionable(spec, ms, fx = 0.5, fy = 0.5) {
      const end = performance.now() + ms;
      let last = { state: "missing" };
      for (;;) {
        last = inspect(spec, fx, fy);
        if (last.state === "ok") {
          await frame();
          await frame();
          const again = inspect(spec, fx, fy);
          if (again.state === "ok" && again.el === last.el && again.rect.every((v, i) => Math.abs(v - last.rect[i]) < 0.5)) {
            aimed = again.at;
            lastDown = null;
            return { ok: true, x: again.x, y: again.y, what: describe(again.el) };
          }
          last = again.state === "ok" ? { state: "moving", el: again.el } : again;
        }
        if (performance.now() > end) {
          return { ok: false, target: label(spec), state: last.state, detail: last.detail, what: last.el ? describe(last.el) : undefined, count: find(spec).length };
        }
        await change(50);
      }
    },

    /** Where the last mouse move arrived, in page pixels. */
    moved() {
      return lastMove;
    },

    /** After a press: null when it reached the control aimed at, else what it reached instead. */
    landed() {
      if (!aimed) return null;
      const ok = lastDown && (aimed === lastDown || aimed.contains(lastDown));
      return ok ? null : describe(lastDown);
    },

    /** Sets a field's value the way typing ends: the value, then the input event the bindings listen to. */
    fill(spec, value) {
      const all = find(spec);
      if (all.length !== 1) throw new Error(`fill ${label(spec)}: ${all.length} matches`);
      const e = all[0];
      e.focus();
      const proto = e instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, "value").set.call(e, value);
      e.dispatchEvent(new Event("input", { bubbles: true }));
      return true;
    },

    /**
     * Waits until `cond()` is truthy, through the app's own wait (store changes, work ending, page changes),
     * and keeps every distinct value it had with the time, for the report when it never comes.
     */
    async wait(cond, ms, show) {
      const t0 = performance.now();
      const history = [];
      let lastKey;
      const read = () => {
        let v;
        try {
          v = show ? { cond: cond(), shown: show() } : cond();
        } catch (e) {
          v = { threw: String(e?.message ?? e) };
        }
        let key;
        try {
          key = JSON.stringify(v);
        } catch {
          key = String(v);
        }
        if (key !== lastKey) {
          lastKey = key;
          history.push({ ms: Math.round(performance.now() - t0), value: key === undefined ? "undefined" : key.length > 600 ? key.slice(0, 600) + "…" : key });
          // The first and the last values tell most; the middle of a long history gives way.
          if (history.length > 80) history.splice(30, 1);
        }
        return show ? v.cond : v;
      };
      try {
        await window.__mbfTest.when(() => !!read(), ms);
        const value = read();
        return { ok: true, value, ...(performance.now() - t0 > 2000 ? { history } : {}) };
      } catch (e) {
        read();
        return { ok: false, error: String(e?.message ?? e), history, idle: window.__mbfTest.idle(), busy: window.__mbfTest.busy() };
      }
    },

    // ---- what the old checks read ----
    rows() {
      return [...document.querySelectorAll("[role=option][data-key]")].map((e) => e.dataset.key.split("::").pop());
    },
    row(name) {
      return [...document.querySelectorAll("[role=option][data-key]")].find((e) => e.dataset.key.endsWith("::" + name)) ?? null;
    },
    // Branch names show as segments; each carries its real name as aria-label.
    names(el) {
      return [...(el?.querySelectorAll(".mbf-segs[aria-label]") ?? [])].map((e) => e.getAttribute("aria-label")).join("\n");
    },

    // ---- for the failure report ----
    /** Every control a user could name right now, with its role: what a click could have meant. */
    targets() {
      const out = [];
      for (const root of scopes()) {
        for (const e of root.querySelectorAll("*")) {
          const role = roleOf(e);
          if (!role || !FROM_CONTENT.has(role) && !["textbox", "searchbox", "combobox", "dialog", "menu", "listbox", "switch", "slider"].includes(role)) continue;
          if (!visible(e)) continue;
          out.push(`${role.padEnd(16)} ${JSON.stringify(nameOf(e).slice(0, 120))}${disabled(e) ? "  (disabled)" : ""}`);
        }
      }
      return out;
    },
    /** The open dialogs, menus and panels, then the whole page. */
    dom() {
      const open = [...document.querySelectorAll("dialog[open], [role=menu], [role=dialog], aside, [role=status]")];
      return [
        `<!-- ${open.length} open dialogs, menus, panels and the status region -->`,
        ...open.map((e) => `<!-- ${describe(e)} -->\n${e.outerHTML}`),
        "<!-- the whole page -->",
        document.documentElement.outerHTML,
      ].join("\n\n");
    },
  };
}

/** The source the page evaluates on every load. */
export const HELPERS = `(${helpers.toString()})();`;
