// Layout audit: run inside the page (CDP Runtime.evaluate, Playwright page.evaluate, browser JS tool).
// Returns JSON with measured findings; it does not judge design, it finds what is objectively broken.
(() => {
  const MIN_TEXT_WIDTH = 24;
  const out = {
    viewport: `${innerWidth}x${innerHeight}`,
    horizontalScroll: document.documentElement.scrollWidth > innerWidth + 1,
    collapsed: [],
    overlaps: [],
    truncatedWithoutTitle: [],
    placeholderTruncated: [],
    lowContrast: [],
    // Surfaces with their own background that barely differ from what lies beneath: they cost a
    // colour token but do not read as a surface (e.g. zebra rows or cards on the wrong base).
    faintSurfaces: [],
    // Branch segments inside a bordered control (a chip, a button) with no room to its border.
    tightSegments: [],
    fontSizes: {},
    spacingValues: {},
  };

  // Width is deliberately not required: a text element squeezed to 0 px is exactly the bug to find.
  const rendered = (el) => {
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return r.height > 0 && s.visibility !== "hidden" && s.display !== "none" && +s.opacity > 0.05 && !el.closest("[hidden],[aria-hidden=true]");
  };
  const visible = (el) => rendered(el) && el.getBoundingClientRect().width > 0;
  const label = (el) => {
    const cls = typeof el.className === "string" ? el.className.split(/\s+/).slice(0, 3).join(".") : "";
    const text = (el.textContent || el.getAttribute("placeholder") || el.getAttribute("aria-label") || "").trim().slice(0, 40);
    return `${el.tagName.toLowerCase()}${cls ? "." + cls : ""} "${text}"`;
  };
  const hasOwnText = (el) => [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
  // A native title, an aria-label or a custom tooltip marker (data-tip, data-tooltip) all explain the element.
  const titled = (el) => {
    for (let e = el, i = 0; e && i < 3; e = e.parentElement, i++)
      if (e.title || e.hasAttribute("data-tip") || e.hasAttribute("data-tooltip") || e.getAttribute("aria-label")) return true;
    return false;
  };
  // Part of the element that is actually painted: clipped by every ancestor that does not overflow visibly.
  const paintedRect = (el) => {
    const r = el.getBoundingClientRect();
    let { left, top, right, bottom } = r;
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      const s = getComputedStyle(p);
      if (s.overflowX === "visible" && s.overflowY === "visible") continue;
      const c = p.getBoundingClientRect();
      left = Math.max(left, c.left);
      top = Math.max(top, c.top);
      right = Math.min(right, c.right);
      bottom = Math.min(bottom, c.bottom);
    }
    return { left, top, right, bottom };
  };

  const ctx = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
  const rgba = (css) => {
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillStyle = "#000";
    ctx.fillStyle = css;
    ctx.fillRect(0, 0, 1, 1);
    const d = ctx.getImageData(0, 0, 1, 1).data;
    return [d[0], d[1], d[2], d[3] / 255];
  };
  const lum = ([r, g, b]) => {
    const f = (c) => ((c /= 255) <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  // `top` painted over `below`, both [r, g, b, a]; the result is opaque when `below` is.
  const over = (top, below) => [0, 1, 2].map((i) => top[i] * top[3] + below[i] * (1 - top[3])).concat(below[3]);
  // What is really behind the text: every tinted layer up to the first opaque one, painted in order.
  // A tint alone (bg-accent/8 on a panel) is not the colour the reader sees.
  const background = (el) => {
    const layers = [];
    let base = null;
    for (let e = el; e; e = e.parentElement) {
      const c = rgba(getComputedStyle(e).backgroundColor);
      if (c[3] > 0.9) {
        base = c;
        break;
      }
      if (c[3] > 0) layers.push(c);
    }
    base ??= rgba(getComputedStyle(document.body).backgroundColor);
    return layers.reduceRight((acc, layer) => over(layer, acc), base);
  };

  const allText = [...document.querySelectorAll("body *")].filter((el) => rendered(el) && hasOwnText(el));
  for (const el of allText) {
    const w = el.getBoundingClientRect().width;
    // Short words are narrow by nature; collapsed means the text no longer fits its box.
    if (w < MIN_TEXT_WIDTH && el.textContent.trim().length > 3 && el.scrollWidth > w + 1 && !el.closest(".sr-only")) out.collapsed.push({ el: label(el), width: Math.round(w) });
  }

  // Screen-reader-only text is clipped to 1 px on purpose.
  const textEls = allText.filter(visible).filter((el) => !el.closest(".sr-only"));
  for (const el of textEls) {
    const s = getComputedStyle(el);
    out.fontSizes[s.fontSize] = (out.fontSizes[s.fontSize] || 0) + 1;

    const clips = s.overflow !== "visible" || s.textOverflow === "ellipsis";
    if (clips && el.scrollWidth > el.clientWidth + 1 && !titled(el)) out.truncatedWithoutTitle.push(label(el));

    const fg = rgba(s.color);
    const bg = background(el);
    // Translucent text is seen mixed with what is behind it.
    const [l1, l2] = [lum(over(fg, bg)), lum(bg)].sort((a, b) => b - a);
    const ratio = (l1 + 0.05) / (l2 + 0.05);
    const large = parseFloat(s.fontSize) >= 18 || (parseFloat(s.fontSize) >= 14 && +s.fontWeight >= 700);
    if (ratio < (large ? 3 : 4.5) && fg[3] > 0.5) out.lowContrast.push({ el: label(el), ratio: +ratio.toFixed(2), fontSize: s.fontSize });
  }

  const opaque = (el) => {
    const m = getComputedStyle(el).backgroundColor.match(/[\d.]+/g);
    return !!m && (m.length < 4 || +m[3] > 0.9);
  };
  const occluded = (a, b, x, y) => {
    const stack = document.elementsFromPoint(x, y);
    const at = (el) => stack.findIndex((s) => el.contains(s) || s === el);
    const [ia, ib] = [at(a), at(b)];
    // Not hit at that point: covered there, e.g. by a modal dialog, whose inert page is not hit-tested.
    if (ia < 0 || ib < 0) return true;
    const [upper, lower, from, to] = ia < ib ? [a, b, ia, ib] : [b, a, ib, ia];
    return stack.slice(from, to).some((s) => !s.contains(lower) && !upper.contains(s) && opaque(s));
  };

  // Overlap between text elements that are neither ancestor nor descendant of each other.
  const painted = textEls.map(paintedRect);
  // A wrapped inline element's box spans both lines and covers its neighbours on them; its line
  // boxes are what is painted.
  const lines = textEls.map((el, i) => {
    const rects = getComputedStyle(el).display === "inline" ? [...el.getClientRects()] : [];
    return rects.length > 1 ? rects : [painted[i]];
  });
  const firstHit = (la, lb) => {
    for (const x of la)
      for (const y of lb) {
        const w = Math.min(x.right, y.right) - Math.max(x.left, y.left);
        const h = Math.min(x.bottom, y.bottom) - Math.max(x.top, y.top);
        if (w > 2 && h > 2) return { w, h, x, y };
      }
    return null;
  };
  // Sweep from top to bottom: only elements that start above the current one's bottom can meet it.
  const byTop = textEls.map((_, i) => i).sort((x, y) => painted[x].top - painted[y].top);
  for (let n = 0; n < byTop.length; n++) {
    const i = byTop[n];
    const a = textEls[i];
    const ra = painted[i];
    if (ra.right - ra.left <= 0 || ra.bottom - ra.top <= 0) continue;
    for (let m = n + 1; m < byTop.length && painted[byTop[m]].top < ra.bottom; m++) {
      const j = byTop[m];
      const b = textEls[j];
      if (a.contains(b) || b.contains(a)) continue;
      const rb = painted[j];
      // Inline siblings on one line that never wraps sit side by side by layout; where the line is cut
      // with an ellipsis, Chrome splits the box at the cut into rects that seem to overlap.
      if (a.parentElement === b.parentElement && /^(pre|nowrap)$/.test(getComputedStyle(a.parentElement).whiteSpace)) continue;
      if (lines[i].length > 1 || lines[j].length > 1) {
        const hit = firstHit(lines[i], lines[j]);
        if (hit && !occluded(a, b, Math.max(hit.x.left, hit.y.left) + hit.w / 2, Math.max(hit.x.top, hit.y.top) + hit.h / 2))
          out.overlaps.push({ a: label(a), b: label(b), area: Math.round(hit.w * hit.h) });
        continue;
      }
      const w = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left);
      const h = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top);
      if (w > 2 && h > 2) {
        // Elements in different stacking layers (dialog or overlay over page) are not an overlap bug:
        // at the centre of the overlap, an opaque surface between the two hides the lower one.
        if (!occluded(a, b, Math.max(ra.left, rb.left) + w / 2, Math.max(ra.top, rb.top) + h / 2))
          out.overlaps.push({ a: label(a), b: label(b), area: Math.round(w * h) });
      }
    }
  }

  for (const input of document.querySelectorAll("input[placeholder], textarea[placeholder]")) {
    if (!visible(input)) continue;
    const s = getComputedStyle(input);
    ctx.font = `${s.fontWeight} ${s.fontSize} ${s.fontFamily}`;
    const need = ctx.measureText(input.placeholder).width;
    const have = input.clientWidth - parseFloat(s.paddingLeft) - parseFloat(s.paddingRight);
    if (need > have + 1) out.placeholderTruncated.push({ el: label(input), need: Math.round(need), have: Math.round(have) });
  }

  for (const el of document.querySelectorAll("body *")) {
    if (!visible(el)) continue;
    const s = getComputedStyle(el);
    for (const v of [s.paddingTop, s.paddingLeft, s.gap, s.marginTop]) if (v && v !== "0px" && v !== "normal") out.spacingValues[v] = (out.spacingValues[v] || 0) + 1;
  }

  // Blends every translucent background from the page down to the element, as the eye sees it.
  const effective = (el) => {
    const chain = [];
    for (let e = el; e && e !== document.documentElement; e = e.parentElement) chain.unshift(e);
    let acc = rgba(getComputedStyle(document.body).backgroundColor);
    for (const e of chain) {
      const c = rgba(getComputedStyle(e).backgroundColor);
      if (c[3] > 0) acc = [0, 1, 2].map((i) => c[i] * c[3] + acc[i] * (1 - c[3])).concat(1);
    }
    return acc;
  };
  const seenSurface = new Set();
  for (const el of document.querySelectorAll("body *")) {
    if (!visible(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 24 || r.height < 16 || rgba(getComputedStyle(el).backgroundColor)[3] < 0.02 || !el.parentElement) continue;
    const [a, b] = [effective(el), effective(el.parentElement)];
    if (a.slice(0, 3).join() === b.slice(0, 3).join()) continue;
    const [l1, l2] = [lum(a), lum(b)].sort((x, y) => y - x);
    const ratio = (l1 + 0.05) / (l2 + 0.05);
    const key = label(el).replace(/ ".*$/, "");
    if (ratio < 1.025 && !seenSurface.has(key)) {
      seenSurface.add(key);
      out.faintSurfaces.push({ el: label(el), ratio: +ratio.toFixed(3) });
    }
  }

  // The arrows of the segments run to their full height: under 2 px to a border they touch it.
  const MIN_ROOM = 2;
  for (const segs of document.querySelectorAll(".mbf-segs")) {
    if (!visible(segs)) continue;
    // Only a control around the segments counts; a scrolling list or a panel further out does not.
    let box = null;
    for (let e = segs.parentElement, i = 0; e && e !== document.body && i < 4; e = e.parentElement, i++) {
      const s = getComputedStyle(e);
      if (parseFloat(s.borderTopWidth) > 0 && parseFloat(s.borderBottomWidth) > 0) {
        box = e;
        break;
      }
      if (/auto|scroll/.test(s.overflowY)) break;
    }
    if (!box) continue;
    const s = getComputedStyle(box);
    const b = box.getBoundingClientRect();
    const r = segs.getBoundingClientRect();
    if (b.height > r.height * 2.5) continue;
    const top = r.top - (b.top + parseFloat(s.borderTopWidth));
    const bottom = b.bottom - parseFloat(s.borderBottomWidth) - r.bottom;
    if (Math.min(top, bottom) < MIN_ROOM - 0.5) out.tightSegments.push({ el: label(box), room: +Math.min(top, bottom).toFixed(1) });
  }

  // A surface is what the eye reads as a box: its own border or a background of its own.
  const surfaceOf = (el) => {
    const s = getComputedStyle(el);
    const border = ["Top", "Right", "Bottom", "Left"].some((k) => parseFloat(s[`border${k}Width`]) > 0 && rgba(s[`border${k}Color`])[3] > 0.1);
    return border || rgba(s.backgroundColor)[3] > 0.05;
  };
  // Text that touches the edge of its chip, pill, badge or button. Only small controls count: a panel
  // or a row keeps its text away by layout, and the segments of a branch name have their own rule.
  const MIN_X = 4;
  const MIN_Y = 2;
  const cramped = [];
  for (const el of document.querySelectorAll("body *")) {
    if (!visible(el) || el.closest(".mbf-segs, .mbf-diff-word, .sr-only, input, textarea, select") || !surfaceOf(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.height > 44 || r.width > 480 || r.width < 8) continue;
    if (el.scrollWidth > el.clientWidth + 1) continue;
    // The text this surface frames itself; text inside a nested surface is that one's business.
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let box = null;
    let font = 0;
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (!n.textContent.trim()) continue;
      let owner = n.parentElement;
      while (owner && owner !== el && !surfaceOf(owner)) owner = owner.parentElement;
      if (owner !== el) continue;
      const range = document.createRange();
      range.selectNodeContents(n);
      const t = range.getBoundingClientRect();
      if (t.width === 0) continue;
      font = Math.max(font, parseFloat(getComputedStyle(n.parentElement).fontSize));
      box = box ? { left: Math.min(box.left, t.left), top: Math.min(box.top, t.top), right: Math.max(box.right, t.right), bottom: Math.max(box.bottom, t.bottom) } : t;
    }
    if (!box) continue;
    const s = getComputedStyle(el);
    const inner = {
      left: r.left + parseFloat(s.borderLeftWidth),
      right: r.right - parseFloat(s.borderRightWidth),
      top: r.top + parseFloat(s.borderTopWidth),
      bottom: r.bottom - parseFloat(s.borderBottomWidth),
    };
    const x = Math.min(box.left - inner.left, inner.right - box.right);
    // Text running past the box is clipped or wraps away: the truncation rule covers that.
    if (x < -0.5) continue;
    // The range of a text is as tall as the font's line, leading included; the letters themselves
    // are about the font size, centred in it.
    const y = (inner.bottom - inner.top - font) / 2;
    if (x < MIN_X - 0.5 || y < MIN_Y - 0.5) cramped.push({ el: label(el), x: +x.toFixed(1), y: +y.toFixed(1) });
  }
  out.cramped = cramped;

  // Floating cards (runs, toasts, popovers) keep a margin to the window: flush with its edge they look cut off.
  // Popovers keep 8 px; cards that stay (messages, runs) sit clearly above the 12 px margin of the app's own
  // cards, or they look stuck to the frame.
  const MIN_EDGE = 8;
  const MIN_CARD_EDGE = 20;
  out.edge = [];
  // A fixed stack without a surface of its own (the messages) is judged by the cards in it.
  const floating = [];
  for (const el of document.querySelectorAll("body *")) {
    if (!visible(el) || getComputedStyle(el).position !== "fixed" || el.closest("[role=tooltip], dialog")) continue;
    if (surfaceOf(el)) floating.push(el);
    else for (const c of el.children) if (visible(c) && surfaceOf(c)) floating.push(c);
  }
  for (const el of floating) {
    const r = el.getBoundingClientRect();
    // Full-width bars and backdrops are meant to reach the edge.
    if (r.width >= innerWidth - 1 || r.height >= innerHeight - 1) continue;
    const room = Math.min(r.left, r.top, innerWidth - r.right, innerHeight - r.bottom);
    const card = !!el.closest("[role=status], [aria-live]") || el.matches("section");
    if (room < (card ? MIN_CARD_EDGE : MIN_EDGE) - 0.5) out.edge.push({ el: label(el), room: +room.toFixed(1) });
  }

  // A control whose centre lies under another element takes no click there: a pane or card of the layout
  // floating over it hides it for good. Layers that open on demand and close again (dialogs, menus,
  // popovers, tips, messages, the help marked data-overlay) cover the page on purpose; content scrolled
  // under a part of its own scroll box (a stuck head) comes back by scrolling; a field drawn by its label
  // (a switch) takes the click through the label.
  out.covered = [];
  const TRANSIENT = "dialog, [role=dialog], [role=alertdialog], [role=menu], [role=tooltip], [role=status], [aria-live], .mbf-popover, [data-overlay]";
  const modal = document.querySelector("dialog:modal");
  const scroller = (el) => {
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      const s = getComputedStyle(p);
      if (/auto|scroll/.test(s.overflowX + s.overflowY)) return p;
    }
    return null;
  };
  const controls = 'button:not([disabled]), [role=button], [role=columnheader], [role=tab], a[href], input:not([disabled]):not([type=hidden]), select:not([disabled])';
  for (const el of document.querySelectorAll(controls)) {
    if ((modal && !modal.contains(el)) || el.closest('[inert], [aria-hidden="true"]')) continue;
    const s = getComputedStyle(el);
    if (s.visibility === "hidden" || s.pointerEvents === "none") continue;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) continue;
    const x = r.left + r.width / 2;
    const y = r.top + r.height / 2;
    // Scrolled out of its box or out of the window: not on screen, nothing to click.
    const p = paintedRect(el);
    if (x <= Math.max(p.left, 0) || x >= Math.min(p.right, innerWidth) || y <= Math.max(p.top, 0) || y >= Math.min(p.bottom, innerHeight)) continue;
    const hit = document.elementFromPoint(x, y);
    if (!hit || el.contains(hit) || hit.contains(el) || [...(el.labels ?? [])].some((l) => l.contains(hit))) continue;
    const layer = hit.closest(TRANSIENT);
    if (layer && !layer.contains(el)) continue;
    const box = scroller(el);
    if (box && box.contains(hit)) continue;
    out.covered.push({ el: label(el), under: label(hit).slice(0, 80) });
  }

  // A branch name squeezed until its last segment shows no letter: an empty arrow where the name was.
  // What is still loading has nothing to act on: no enabled control inside a busy element.
  out.busyContent = [...document.querySelectorAll('[aria-busy="true"]:not(button)')]
    .filter((b) => b.getBoundingClientRect().width > 0)
    .flatMap((b) => textEls.filter((el) => b.contains(el) && !el.closest(".skeleton")).slice(0, 1).map((el) => label(el)));

  out.busyInteractive = [...document.querySelectorAll('[aria-busy="true"]')]
    .flatMap((b) => [...b.querySelectorAll('button:not([disabled]), a[href], input:not([disabled]), [tabindex]:not([tabindex="-1"])')])
    .filter((el) => el.getBoundingClientRect().width > 0)
    .map((el) => label(el));

  // What is selected shows by colour and by shape: a fill that stands off the surface around it, and a
  // frame (a border, or a ring drawn as an inset shadow). A tint alone vanishes beside a repo's own colour,
  // which owns the left edge.
  out.selection = [...document.querySelectorAll('[role="option"][aria-selected="true"], [aria-current="true"]')]
    .filter((el) => el.getBoundingClientRect().width > 0 && !el.closest('[aria-hidden="true"]'))
    .flatMap((el) => {
      const own = lum(background(el));
      const around = lum(background(el.parentElement ?? document.body));
      const ratio = (Math.max(own, around) + 0.05) / (Math.min(own, around) + 0.05);
      const cs = getComputedStyle(el);
      const frame = cs.boxShadow.includes("inset") || parseFloat(cs.borderTopWidth) >= 1;
      return ratio < 1.12 || !frame ? [{ el: label(el), ratio: Math.round(ratio * 100) / 100, frame }] : [];
    });

  // Text cut off at the side by a box that hides what overflows, without an ellipsis: the reader sees
  // half a word and no sign that more follows. Areas that scroll sideways and ellipsized text (their own
  // rule) are left out; the segments of a branch name have theirs.
  out.clipped = [];
  const textRange = document.createRange();
  // The box that cuts with an ellipsis: the element or one of its close ancestors (a syntax token inside a
  // code line that ends in "…").
  const ellipsisBox = (el) => {
    for (let e = el, i = 0; e && i < 3; e = e.parentElement, i++) if (getComputedStyle(e).textOverflow === "ellipsis") return e;
    return null;
  };
  const sideways = (el) => {
    if (el.closest("[data-hscroll]")) return true;
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      const x = getComputedStyle(p).overflowX;
      if (x === "auto" || x === "scroll") return true;
    }
    return false;
  };
  for (const el of textEls) {
    // An ellipsis counts only where it shows: the element itself cuts its text. Cut by a box further out,
    // the ellipsis never appears ("Nicht überal" in a segment of a panel too narrow for it).
    const cutter = ellipsisBox(el);
    const showsEllipsis = !!cutter && getComputedStyle(cutter).overflowX !== "visible" && cutter.scrollWidth > cutter.clientWidth + 1;
    if (el.closest('[aria-hidden="true"], [role="tooltip"]') || showsEllipsis || sideways(el)) continue;
    const own = getComputedStyle(el);
    // The room the boxes around it leave, not the element's own painted part: an element pushed out
    // entirely has no painted part at all and would pass for absent.
    const box = { left: 0, top: 0, right: innerWidth, bottom: innerHeight };
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      const ps = getComputedStyle(p);
      if (ps.overflowX === "visible" && ps.overflowY === "visible") continue;
      const c = p.getBoundingClientRect();
      box.left = Math.max(box.left, c.left);
      box.top = Math.max(box.top, c.top);
      box.right = Math.min(box.right, c.right);
      box.bottom = Math.min(box.bottom, c.bottom);
    }
    if (own.overflowX !== "visible") {
      const r = el.getBoundingClientRect();
      box.left = Math.max(box.left, r.left);
      box.right = Math.min(box.right, r.right);
    }
    for (const node of el.childNodes) {
      if (node.nodeType !== 3 || !node.data.trim()) continue;
      textRange.selectNodeContents(node);
      const t = textRange.getBoundingClientRect();
      // On the box's lines, and cut at the side or pushed out of it entirely: a counter beside a label
      // that no longer fits is as lost as the label's last letters.
      const onLines = t.bottom > box.top && t.top < box.bottom && box.right > box.left;
      const cut = Math.max(t.right - box.right, box.left - t.left);
      if (onLines && cut > 2) {
        out.clipped.push({ el: label(el), cut: Math.round(cut) });
        break;
      }
    }
  }

  out.segments = [];
  for (const rest of document.querySelectorAll(".mbf-seg-rest")) {
    if (!visible(rest)) continue;
    const text = rest.firstElementChild ?? rest;
    const shown = paintedRect(text);
    if (shown.right - shown.left < 12) out.segments.push({ el: label(rest.closest(".mbf-segs") ?? rest), width: Math.round(shown.right - shown.left), in: label(rest.closest("[role=tooltip], dialog, [role=dialog], [role=menu], nav, main, aside") ?? document.body).slice(0, 60) });
  }

  out.summary = {
    problems: out.collapsed.length + out.overlaps.length + out.placeholderTruncated.length + (out.horizontalScroll ? 1 : 0),
    truncatedWithoutTitle: out.truncatedWithoutTitle.length,
    lowContrast: out.lowContrast.length,
    faintSurfaces: out.faintSurfaces.length,
    distinctFontSizes: Object.keys(out.fontSizes).length,
    distinctSpacings: Object.keys(out.spacingValues).length,
  };
  return out;
})();
