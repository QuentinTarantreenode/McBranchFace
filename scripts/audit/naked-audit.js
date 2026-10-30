// Signs without a surface: a count ("2", "+3", "99+") or a status icon standing alone, with no frame or
// fill of its own nor one right around it. They read as noise: the eye cannot tell a count from text
// or an icon from decoration. Returns one entry per kind of element (tag and classes), with an example.
(() => {
  const rgba = (css) => {
    const m = css.match(/[\d.]+/g);
    return m ? { a: m.length > 3 ? +m[3] : 1 } : { a: 0 };
  };
  const surface = (el) => {
    const s = getComputedStyle(el);
    const border = ["Top", "Right", "Bottom", "Left"].some((k) => parseFloat(s[`border${k}Width`]) > 0 && rgba(s[`border${k}Color`]).a > 0.1);
    // A ring is a box-shadow, and frames as well as a border.
    return border || rgba(s.backgroundColor).a > 0.05 || /inset/.test(s.boxShadow);
  };
  // The element or a small box around it (up to two levels, no larger than a chip) has a surface.
  const framed = (el) => {
    for (let e = el, i = 0; e && i < 3; e = e.parentElement, i++) {
      const r = e.getBoundingClientRect();
      if (r.height > 30 || r.width > 160) return false;
      if (surface(e)) return true;
    }
    return false;
  };
  // Words of a line outside its chips and outside the icon itself.
  const unframedText = (line, skip) => {
    let text = "";
    const walk = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
    for (let n = walk.nextNode(); n; n = walk.nextNode()) {
      let inChip = false;
      for (let e = n.parentElement; e && e !== line; e = e.parentElement) if (e === skip || surface(e)) inChip = true;
      if (!inChip) text += n.textContent.trim();
    }
    return text;
  };
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    // Icons are aria-hidden themselves; what counts is whether the part they sit in is.
    const from = el.tagName.toLowerCase() === "svg" ? el.parentElement : el;
    return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && +s.opacity > 0.05 && !from?.closest("[aria-hidden=true], .sr-only");
  };
  // Where a bare number is the content itself: table cells, text in sentences, tooltips, charts, code.
  // Line numbers and highlighted source in a diff are code, not counts.
  const exempt = (el) =>
    el.closest("[role=tooltip], pre, code, kbd, .mbf-segs, .mbf-diff-gutter, [data-naked-ok], input, textarea") || /(^|\s)syn-/.test(el.getAttribute("class") ?? "");
  // getAttribute: an SVG's className is no string.
  const key = (el) => `${el.tagName.toLowerCase()}.${(el.getAttribute("class") ?? "").split(/\s+/).filter(Boolean).slice(0, 4).join(".")}`;
  const COUNT = /^[+↑↓●•]?\s?\d{1,4}\+?$/;
  const found = new Map();
  const add = (kind, el, sample) => {
    const k = `${kind} ${key(el)}`;
    if (!found.has(k)) found.set(k, { kind, el: key(el), sample, parent: key(el.parentElement ?? el) });
  };
  for (const el of document.querySelectorAll("body *")) {
    if (!visible(el) || exempt(el)) continue;
    const own = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent.trim()).join("");
    if (own && COUNT.test(own) && !framed(el) && !el.matches("button, [role=tab], [role=radio]")) add("count", el, own);
    if (el.tagName.toLowerCase() === "svg" && el.classList.contains("lucide")) {
      const host = el.parentElement;
      // An icon beside its own words, or the picture of the control it sits in, is no sign of its own.
      // One with a tooltip of its own is: it says something, even inside a larger button.
      if (!host || host.textContent.trim()) continue;
      // Only an icon with a tooltip of its own says something; one without is decoration.
      if (!host.hasAttribute("data-tip") || host.matches("button, a, [role=button]")) continue;
      // The first thing on a line with its own words is the line's mark (a folder, a check's outcome).
      const parent = host.parentElement;
      if (!parent) continue;
      // A row of a list is a line however narrow its column: nested groups indent it below 160 px.
      const line = parent.getBoundingClientRect().width >= 160 || parent.matches("[role=option]");
      if (parent.firstElementChild === host && (line || unframedText(parent, host))) continue;
      // The picture of a field (search, tags) belongs to the field.
      if (parent.querySelector("input, textarea")) continue;
      if (framed(el)) continue;
      add("icon", el, host.getAttribute("aria-label") ?? String(el.getAttribute("class")).split(" ").find((c) => c.startsWith("lucide-")) ?? "");
    }
  }
  return [...found.values()];
})();
