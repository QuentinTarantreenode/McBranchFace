// Tooltip audit: hovers every visible [data-tip] element and checks the tooltip it shows.
// Runs inside the page: scripts/ui-audit.mjs evaluates it over CDP in every audit view.
// Full-text tips (data-tip="overflow") count only while their text is cut off.
// Reports per tip:
//   empty · long plain text (> ~16 words without a title) · repeats the visible label · outside the viewport
//   never shown · mixed path separators · line broken inside a word (unless the word is wider than its line)
//   content clipped by the tip · content overflowing the tip or one of its boxes
//   the same text twice in one tip · a value the row shows already · typography (straight quotes, "...", double spaces, " - ", "·" without spaces)
// Also returns `catalog`: one entry per distinct tip (index into the eligible elements), so a single tip can be
// hovered again and photographed (clip the screenshot to [role=tooltip]).
// Signatures persist in window.__tipSeen: running the audit over several views catalogues each tip once.
// Needs the tooltip to mark its elements with data-tip and render into a single [role=tooltip].
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const tipEl = () => document.querySelector('[role="tooltip"]');
  const openTip = () => {
    const t = tipEl();
    return t && t.hasAttribute("data-open") ? t : null;
  };
  // A tip shows in the same task as its hover; one built on demand (lazy content) once that is ready. Taken
  // as soon as it is open, after what the hover queued (a re-render of its element) has run; null when it
  // does not open within `ms`.
  const shown = (ms) =>
    new Promise((resolve) => {
      let done = false;
      const finish = (t) => {
        if (done) return;
        done = true;
        observer.disconnect();
        clearTimeout(limit);
        resolve(t);
      };
      const check = () => {
        if (!openTip()) return;
        setTimeout(() => {
          const t = openTip();
          if (t) finish(t);
        }, 0);
      };
      const observer = new MutationObserver(check);
      observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["data-open"] });
      const limit = setTimeout(() => finish(null), ms);
      check();
    });
  const norm = (s) => (s || "").replace(/\s+/g, " ").trim().toLowerCase();
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return false;
    if (r.bottom < 0 || r.right < 0 || r.top > innerHeight || r.left > innerWidth) return false;
    const s = getComputedStyle(el);
    return s.visibility !== "hidden" && s.display !== "none" && Number(s.opacity) > 0.05;
  };
  const label = (el) => norm(el.getAttribute("aria-label") || el.innerText || "");
  const describe = (el) => {
    // Icon buttons carry their label on the inner button, not on the wrapper that holds the tip.
    const inner = el.querySelector("[aria-label]")?.getAttribute("aria-label");
    const t = (el.getAttribute("aria-label") || inner || el.innerText || el.className || el.tagName).toString().replace(/\s+/g, " ").trim();
    if (t === String(el.className).trim()) return `${t} <${el.outerHTML.slice(0, 120)}>`;
    return t.slice(0, 60);
  };
  const fire = (el, type) => {
    const r = el.getBoundingClientRect();
    el.dispatchEvent(new PointerEvent(type, { bubbles: type !== "pointerenter" && type !== "pointerleave", pointerType: "mouse", clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 }));
  };

  // Code-like parts: paths, refs, keys. Typography rules do not apply there.
  const CODE = ".mbf-tooltip-path, .mbf-tooltip-url, .mbf-tooltip-mono, .mbf-tooltip-keys, kbd, code";
  const BLOCKS = ".mbf-tooltip-title, .mbf-tooltip-path, .mbf-tooltip-text, .mbf-tooltip-value, .mbf-tooltip-note, .mbf-tooltip-foot, .mbf-tooltip-pill";

  const textNodes = (root) => {
    const out = [];
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = w.nextNode(); n; n = w.nextNode()) out.push(n);
    return out;
  };

  // The width a word may take: the nearest box that lays out lines (inline spans do not).
  const lineBox = (node) => {
    let box = node.parentElement;
    while (box && getComputedStyle(box).display === "inline") box = box.parentElement;
    if (!box) return Infinity;
    const s = getComputedStyle(box);
    return box.clientWidth - parseFloat(s.paddingLeft) - parseFloat(s.paddingRight);
  };
  const ruler = document.createElement("canvas").getContext("2d");
  const wordWidth = (node, i) => {
    const s = node.data;
    let a = i;
    let b = i;
    while (a > 0 && /[\p{L}\p{N}]/u.test(s[a - 1])) a--;
    while (b < s.length && /[\p{L}\p{N}]/u.test(s[b])) b++;
    ruler.font = getComputedStyle(node.parentElement).font;
    return ruler.measureText(s.slice(a, b)).width;
  };

  // A line that ends between two word characters was broken inside a word. A word wider than its line
  // has no other way to fit, so that break is right.
  const midWordBreaks = (el) => {
    const found = [];
    const range = document.createRange();
    let prev = null;
    for (const node of textNodes(el)) {
      // Branch segments are separate boxes: a line change between two of them is not inside a word.
      const seg = node.parentElement?.closest(".mbf-seg");
      if (prev && seg !== prev.seg) prev = null;
      const s = node.data;
      for (let i = 0; i < s.length; i++) {
        range.setStart(node, i);
        range.setEnd(node, i + 1);
        const rect = range.getClientRects()[0];
        if (!rect) continue;
        if (prev && rect.top > prev.top + 2 && /[\p{L}\p{N}]/u.test(prev.ch) && /[\p{L}\p{N}]/u.test(s[i]) && wordWidth(node, i) <= lineBox(node) + 1) {
          found.push(`${prev.ctx}|${s.slice(i, i + 6)}`);
        }
        prev = { top: rect.top, ch: s[i], seg, ctx: (prev?.ctx ?? "").concat(s[i]).slice(-6) };
      }
    }
    return found;
  };

  const typography = (tip) => {
    const issues = new Set();
    for (const node of textNodes(tip)) {
      if (node.parentElement?.closest(CODE)) continue;
      const s = node.data;
      if (/"/.test(s)) issues.add('straight double quote — use „…“ (de) or “…” (en)');
      if (/(^|\s)'|'(\s|$)/.test(s)) issues.add("straight single quote as quotation mark");
      if (/\.\.\./.test(s)) issues.add('"..." — use "…"');
      if (/\S {2,}\S/.test(s)) issues.add("double space");
      if (/\p{L} - \p{L}/u.test(s)) issues.add('" - " between words — use a dash "–"');
      if (/\S·|·\S/.test(s)) issues.add('"·" without spaces around it');
      if (/\(\p{L}+\)\p{L}|\p{L}\(\p{L}{1,2}\)/u.test(s)) issues.add("bracket plural like Datei(en) — use a counted form");
    }
    return [...issues];
  };

  // Per block: a path is split into piece spans, but two blocks must not run into each other.
  const mixedSeparators = (tip) =>
    [...tip.querySelectorAll(BLOCKS)]
      .filter((b) => !b.querySelector(BLOCKS))
      .flatMap((b) => b.textContent.match(/(?:[A-Za-z]:|~)[\\/][^\s]*/g) ?? [])
      .filter((p) => p.includes("\\") && p.includes("/"));

  const duplicates = (tip) => {
    const seen = new Map();
    const dups = new Set();
    const key = (s) => norm(s).replace(/\//g, "\\");
    // Two list rows may share a value (two copies on the same branch); a value that repeats a title,
    // path, text or pill is a repeat.
    for (const b of tip.querySelectorAll(BLOCKS)) {
      if (b.querySelector(BLOCKS)) continue;
      const k = key(b.textContent);
      if (k.length < 8) continue;
      const isValue = b.classList.contains("mbf-tooltip-value");
      const prev = seen.get(k);
      if (prev !== undefined && !(prev && isValue)) dups.add(b.textContent.trim().slice(0, 60));
      if (prev === undefined || !isValue) seen.set(k, isValue && prev !== false);
    }
    // The path of the head repeated inside a card or the foot.
    const head = tip.querySelector(".mbf-tooltip-head .mbf-tooltip-path");
    if (head) {
      const hp = key(head.textContent);
      for (const b of tip.querySelectorAll(".mbf-tooltip-body " + BLOCKS.split(", ").join(", .mbf-tooltip-body ")))
        if (hp.length >= 8 && key(b.textContent).includes(hp)) dups.add(`head path again: ${b.textContent.trim().slice(0, 60)}`);
    }
    return [...dups];
  };

  // A value the row already shows as text: a tip adds to its row, it does not read it out again.
  // Full-text tips are exempt, their whole point is the text the row cuts off.
  const repeatsRow = (el, tip) => {
    const row = el.closest("[data-row], [role=row], [role=option], li");
    if (!row || el.dataset.tip === "overflow") return [];
    const shown = norm(row.innerText);
    return [...tip.querySelectorAll(".mbf-tooltip-value")]
      .map((v) => norm(v.textContent))
      .filter((v) => v.length >= 8 && shown.includes(v))
      .slice(0, 3);
  };

  const clipped = (tip) => {
    const t = tip.getBoundingClientRect();
    const out = [];
    for (const e of tip.querySelectorAll("*")) {
      const r = e.getBoundingClientRect();
      if (r.width && (r.right > t.right + 0.5 || r.left < t.left - 0.5)) out.push((e.textContent || e.className).trim().slice(0, 40));
      else if (e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).overflowX !== "visible") out.push((e.textContent || "").trim().slice(0, 40));
    }
    return out.slice(0, 3);
  };

  // Content wider than the tip or one of its layout boxes: the tip cuts it off, or a column spills
  // into the next one. Measured on the boxes, so it holds even where nothing has a visible edge.
  const BOXES = ".mbf-tooltip-head, .mbf-tooltip-body, .mbf-tooltip-headline, .mbf-tooltip-section, .mbf-tooltip-rows, .mbf-tooltip-list, .mbf-tooltip-cell, .mbf-tooltip-path, .mbf-tooltip-bars";
  const overflowing = (tip) =>
    [tip, ...tip.querySelectorAll(BOXES)]
      .filter((b) => b.scrollWidth > b.clientWidth + 1)
      .map((b) => `${b === tip ? "tip" : b.className.split(" ")[0]} ${b.scrollWidth}>${b.clientWidth}: ${(b.textContent || "").trim().slice(0, 40)}`)
      .slice(0, 3);

  // The element itself or a part inside it (a name that truncates within a wider wrapper).
  const cut = (el) => [el, ...el.querySelectorAll("*")].some((x) => x.scrollWidth > x.clientWidth + 1 && getComputedStyle(x).overflowX !== "visible");
  // data-tip="overflow": full-text tips that only show while the text is cut off.
  // Rows repeat the same kinds of tips: four of a kind show what the fifth would, at a fraction of the time.
  const KIND_CAP = 4;
  const kinds = new Map();
  const els = [...document.querySelectorAll("[data-tip]")]
    .filter(visible)
    .filter((el) => el.dataset.tip !== "overflow" || cut(el))
    .filter((el) => {
      const kind = `${el.tagName}.${el.className}.${el.dataset.tip}`;
      kinds.set(kind, (kinds.get(kind) ?? 0) + 1);
      return kinds.get(kind) <= KIND_CAP;
    });
  const findings = [];
  const catalog = [];
  // Kept on the page across runs, so a tip seen in one view is not catalogued again in the next.
  const signatures = (window.__tipSeen ??= new Set());
  let checked = 0;
  for (const [index, el] of els.entries()) {
    let tip = null;
    // Up to a second, twice: with both themes auditing side by side the show delay can run long, and a
    // full run loads the machine far more than a single view. Only a tip that does not come either time counts.
    for (let attempt = 0; attempt < 2 && !tip; attempt++) {
      if (attempt) {
        fire(el, "pointerleave");
        await sleep(150);
      }
      fire(el, "pointerenter");
      tip = await shown(1000);
    }
    if (!tip) {
      findings.push({ el: describe(el), issue: "never shown" });
      fire(el, "pointerleave");
      continue;
    }
    checked++;
    const who = describe(el);
    const add = (issue, extra) => findings.push({ el: who, issue, ...(extra ? { text: extra } : {}) });
    // textContent: innerText stays empty until the tip counts as rendered.
    const text = norm(tip.textContent);
    const plain = tip.querySelector(".mbf-tooltip-plain");
    const hasTitle = !!tip.querySelector(".mbf-tooltip-title");
    const r = tip.getBoundingClientRect();
    if (!text) add("empty");
    else if (!hasTitle && plain && !tip.hasAttribute("data-rich") && norm(plain.textContent).split(" ").length > 16)
      add(`long (${norm(plain.textContent).split(" ").length} words) — give it a title or shorten`, text.slice(0, 120));
    if (text && label(el) && text === label(el) && !cut(el)) add("repeats the visible label", text);
    const title = tip.querySelector(".mbf-tooltip-title");
    if (title && el.innerText && norm(title.textContent) === norm(el.innerText) && !cut(el)) add("title repeats the visible text", norm(title.textContent));
    if (r.left < 0 || r.top < 0 || r.right > innerWidth || r.bottom > innerHeight) add("outside the viewport", `tip ${Math.round(r.left)},${Math.round(r.top)} ${Math.round(r.width)}x${Math.round(r.height)} in ${innerWidth}x${innerHeight}`);
    for (const p of mixedSeparators(tip)) add("mixed path separators", p);
    const breaks = [...tip.querySelectorAll(".mbf-tooltip-path, .mbf-tooltip-mono, .mbf-tooltip-value")].flatMap(midWordBreaks);
    if (breaks.length) add("line broken inside a word", breaks.slice(0, 3).join(" · "));
    for (const d of duplicates(tip)) add("same text twice", d);
    for (const v of repeatsRow(el, tip)) add("repeats what the row shows", v);
    for (const c of clipped(tip)) add("content clipped by the tip", c);
    for (const o of overflowing(tip)) add("content overflows the tip", o);
    for (const ty of typography(tip)) add(`typography: ${ty}`);
    const sig = tip.innerHTML.replace(/\d+/g, "#");
    if (!signatures.has(sig)) {
      signatures.add(sig);
      catalog.push({ index, el: who, rich: tip.hasAttribute("data-rich"), w: Math.round(r.width), h: Math.round(r.height) });
    }
    // Leaving hides the tip in the same task: the next hover starts from a closed one.
    fire(el, "pointerleave");
  }

  // Cut-off text must be readable on hover: the tip the pointer reaches first has to carry all of it.
  // A tip on the parent that says something else (what the button does) hides the full name.
  const cutKinds = new Map();
  const cutOff = [...document.querySelectorAll("body *")]
    .filter((el) => [...el.childNodes].some((n) => n.nodeType === 3 && n.data.trim()))
    .filter((el) => visible(el) && !el.closest('[role="tooltip"], .sr-only'))
    .filter((el) => {
      const s = getComputedStyle(el);
      return (s.textOverflow === "ellipsis" || s.overflowX !== "visible") && cut(el);
    })
    .filter((el) => {
      const kind = `${el.closest("[data-tip]")?.className ?? "none"}.${el.className}`;
      cutKinds.set(kind, (cutKinds.get(kind) ?? 0) + 1);
      return cutKinds.get(kind) <= KIND_CAP;
    });
  for (const el of cutOff) {
    const full = norm(el.textContent);
    const owner = el.closest("[data-tip]");
    if (!owner) {
      findings.push({ el: describe(el), issue: "cut off without a tooltip", text: full });
      continue;
    }
    fire(owner, "pointerenter");
    const tip = await shown(1000);
    if (!tip || !norm(tip.textContent).includes(full)) findings.push({ el: describe(el), issue: "cut off, and the tooltip does not show the full text", text: full });
    fire(owner, "pointerleave");
  }
  return { elements: els.length, checked, cutOff: cutOff.length, findings, catalog };
})();
