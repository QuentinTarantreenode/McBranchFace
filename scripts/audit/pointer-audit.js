// A hand cursor promises a click: whatever shows it says in a tooltip what that click does. Exempt is a
// plain control that names its own action in visible words (a button or link with text, a tab, a menu
// entry). Everything else that shows the hand (rows, cells, icons, chips) needs a tip of its own; a
// full-text tip (data-tip="overflow") does not count, it only repeats a name. Checked on the outermost
// element of each pointer region, since the cursor is inherited by everything inside it, and on every
// control inside such a region: a button in a clickable row does something else than the row. One entry
// per kind of element (tag and classes), with an example and how often it occurs.
(() => {
  const SELF_NAMED = "button, a[href], label, summary, [role=tab], [role=radio], [role=menuitem], [role=menuitemcheckbox], [role=switch], [role=checkbox]";
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && +s.opacity > 0.05 && !el.closest("[aria-hidden=true], .sr-only, [inert]");
  };
  const INTERACTIVE = "button, a[href], [role=button], [role=option], [role=link], [tabindex]:not([tabindex='-1'])";
  const pointer = (el) => !!el && getComputedStyle(el).cursor === "pointer";
  const words = (el) => (el.innerText || "").trim();
  // A tip of its own, or one on the wrapper that carries it for a disabled control (IconButton, Button).
  const explained = (el) => {
    const own = (e) => e?.hasAttribute("data-tip") && e.dataset.tip !== "overflow";
    if (own(el)) return true;
    const p = el.parentElement;
    if (!own(p)) return false;
    const a = el.getBoundingClientRect();
    const b = p.getBoundingClientRect();
    return Math.abs(a.width - b.width) < 2 && Math.abs(a.height - b.height) < 2;
  };
  const key = (el) => `${el.tagName.toLowerCase()}${el.getAttribute("role") ? `[role=${el.getAttribute("role")}]` : ""}.${(el.getAttribute("class") ?? "").split(/\s+/).filter(Boolean).slice(0, 5).join(".")}`;
  const where = (el) => (el.closest("[role=tooltip]") ? "tooltip" : el.closest("dialog, [role=dialog]") ? "dialog" : el.closest("[role=menu]") ? "menu" : el.closest("nav") ? "nav" : el.closest("header") ? "header" : "main");
  const found = new Map();
  for (const el of document.querySelectorAll("body *")) {
    if (!pointer(el) || (pointer(el.parentElement) && !el.matches(INTERACTIVE)) || !visible(el)) continue;
    if (el.closest("[role=tooltip]") || el.matches(":disabled, [aria-disabled=true]")) continue;
    if (el.matches(SELF_NAMED) && words(el)) continue;
    if (explained(el)) continue;
    const k = key(el);
    const f = found.get(k);
    if (f) f.count++;
    else found.set(k, { el: k, in: where(el), sample: (words(el) || el.getAttribute("aria-label") || "").slice(0, 60), count: 1 });
  }
  return [...found.values()];
})();
