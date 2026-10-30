// Jank probe for virtual lists: scrolls the largest list frame by frame and reports frames where the
// rendered rows do not cover the viewport (a blank band) or the row at the top jumps backwards. It
// also regroups and changes data while scrolled, and checks that the row at the top stays in place.
// Runs inside the page: scripts/ui-audit.mjs evaluates it over CDP.
// Needs a [role=listbox] viewport whose row slots carry data-row (group and section headers too, else
// they read as holes); rows as [role=option][data-key] still work as a fallback. Regrouping and data
// changes go through window.__mbfStore (dev builds and the audit build only).
(async () => {
  const frame = () => new Promise((r) => requestAnimationFrame(() => r()));
  const lists = [...document.querySelectorAll("[role=listbox]")].filter((v) => v.scrollHeight > v.clientHeight + 40);
  const vp = lists.sort((a, b) => b.scrollHeight - a.scrollHeight)[0];
  if (!vp) return { skipped: "no scrollable virtual list" };
  const findings = [];
  const rows = () => {
    const slots = [...vp.querySelectorAll("[data-row]")];
    return slots.length ? slots : [...vp.querySelectorAll("[role=option][data-key]")];
  };
  const box = () => vp.getBoundingClientRect();

  // By position, not DOM order: rows may place themselves absolutely.
  const placed = () => rows().map((e) => ({ e, r: e.getBoundingClientRect() })).sort((a, b) => a.r.top - b.r.top);

  // Where the top row sits: its key and its distance from the viewport's top edge.
  const top = () => {
    const b = box();
    const hit = placed().find((x) => x.r.bottom > b.top + 1);
    return hit ? { key: hit.e.dataset.row ?? hit.e.dataset.key, y: Math.round(hit.r.top - b.top) } : null;
  };
  // Rows must cover the viewport without holes; two rows in one slot is an overlap.
  const covered = () => {
    const b = box();
    const list = placed().filter((x) => x.r.bottom > b.top && x.r.top < b.bottom);
    if (!list.length) return "no rows rendered";
    const atEnd = vp.scrollTop + vp.clientHeight >= vp.scrollHeight - 1;
    if (list[0].r.top > b.top + 1 && vp.scrollTop > 0) return `blank band above: ${Math.round(list[0].r.top - b.top)} px`;
    for (let i = 1; i < list.length; i++) {
      const gap = list[i].r.top - list[i - 1].r.bottom;
      if (gap > 1) return `hole of ${Math.round(gap)} px between rows`;
      if (gap < -1) return `rows overlap by ${Math.round(-gap)} px`;
    }
    const last = list.at(-1).r;
    if (last.bottom < b.bottom - 1 && !atEnd) return `blank band below: ${Math.round(b.bottom - last.bottom)} px`;
    return null;
  };

  // 1 · Scrolling down and up in wheel-sized steps: every frame covered, the top row never jumps back.
  vp.scrollTop = 0;
  await frame();
  let prevKey = null;
  let prevPos = -1;
  for (const dir of [1, -1]) {
    for (let step = 0; step < 60; step++) {
      vp.scrollTop += dir * 53;
      await frame();
      const gap = covered();
      if (gap) findings.push({ phase: dir > 0 ? "scroll down" : "scroll up", frame: step, issue: gap });
      const t = top();
      if (t) {
        const pos = vp.scrollTop;
        if (prevKey !== null && dir > 0 && pos < prevPos - 1) findings.push({ phase: "scroll down", frame: step, issue: `scrollTop went back ${Math.round(prevPos - pos)} px` });
        prevKey = t.key;
        prevPos = pos;
      }
    }
    prevKey = null;
  }

  const s = window.__mbfStore;
  if (s) {
    // 2 · Regrouping mid-list: the row at the top stays where it was.
    vp.scrollTop = Math.floor(vp.scrollHeight / 3);
    await frame();
    await frame();
    const groupings = ["Folder", "Repo", "None"];
    for (const g of groupings) {
      const before = top();
      s.setUi({ tableGroup: g });
      await frame();
      await frame();
      const after = top();
      const gap = covered();
      if (gap) findings.push({ phase: `group ${g}`, issue: gap });
      const moved = before && after && rows().find((e) => (e.dataset.row ?? e.dataset.key) === before.key);
      if (before && moved) {
        const y = Math.round(moved.getBoundingClientRect().top - box().top);
        if (Math.abs(y - before.y) > 2) findings.push({ phase: `group ${g}`, issue: `top row moved ${y - before.y} px`, key: before.key });
      }
    }
    // 3 · Data changes while scrolled (clock tick, a rescan result): nothing moves.
    const before = top();
    s.now += 30;
    s.repos = [...s.repos];
    await frame();
    await frame();
    const after = top();
    if (before && after && (before.key !== after.key || Math.abs(before.y - after.y) > 2)) {
      findings.push({ phase: "data change", issue: `top row changed from ${before.key}@${before.y} to ${after.key}@${after.y}` });
    }
  }
  vp.scrollTop = 0;
  return { rows: vp.querySelectorAll("[role=option][data-key]").length, findings };
})();
