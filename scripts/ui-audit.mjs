// Headless UI audit: the audit build (app on a simulated backend with demo data) in headless
// Chrome or Edge, driven over CDP. Every view runs the layout audit in both themes at three widths,
// the tooltip audit at 1280 and the jank probe on the lists. Fails on findings not in allow.json.
// The two themes run side by side, each in a browser of its own; tooltips, whose content and place do
// not depend on the theme, are checked in the light one only.
//   npx vite build --mode audit && node scripts/ui-audit.mjs [view filter] [--shots <dir>]
// CHROME_PATH picks the browser; otherwise the usual install locations are tried.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { openAudit } from "./audit/harness.mjs";

const AUDIT = "scripts/audit";
const args = process.argv.slice(2);
const opt = (name) => (args.includes(`--${name}`) ? args[args.indexOf(`--${name}`) + 1] : undefined);
const only = args.find((a, i) => !a.startsWith("--") && !args[i - 1]?.startsWith("--"));
const shots = opt("shots");
if (shots) mkdirSync(shots, { recursive: true });

const SCRIPTS = Object.fromEntries(["layout-audit.js", "tooltip-audit.js", "jank-probe.js", "naked-audit.js", "pointer-audit.js"].map((n) => [n, readFileSync(join(AUDIT, n), "utf8")]));
/** One browser page with the helpers every step needs. */
async function page() {
  const p = await openAudit();
  return {
    ...p,
    file: (name) => p.evaluate(SCRIPTS[name]),
    // Two frames and a short pause: the layout has settled, the resize observers have run.
    size: async (width, scale = 1) => {
      await p.send("Emulation.setDeviceMetricsOverride", { width, height: 860, deviceScaleFactor: scale, mobile: false });
      await p.evaluate("new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 120))))");
    },
    shot: async (path) => writeFileSync(path, Buffer.from((await p.send("Page.captureScreenshot", { format: "png" })).result.data, "base64")),
  };
}

// ---- views --------------------------------------------------------------------------------------
const wait = (ms) => `await new Promise((r) => setTimeout(r, ${ms}));`;
// Escape reaches popovers that listen on the window (the activity panel), and every list of the sidebar starts
// at its top: a view that scrolled the folders into sight left the next one without its repo groups.
const reset = `const s = window.__mbfStore; window.__mbfTest.reset("dialogs"); s.closeDelete(); document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })); window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })); document.querySelectorAll("nav *").forEach((e) => { if (e.scrollTop) e.scrollTop = 0; });`;
// The reset's Esc folds away a detail floating over the table; a view that selects a branch must see it again.
const clean = `${reset} s.setUi({ perspective: "Cleanup", tableGroup: "None", collapsedGroups: [], orphanedOnly: true, sidebarWidth: 248, detailCollapsed: false }); s.setColumns([]); s.resetFilters(); s.selectKey(null);`;
const clickText = (selector, text) => `[...document.querySelectorAll(${JSON.stringify(selector)})].find((b) => b.textContent.trim().startsWith(${JSON.stringify(text)}))?.click();`;
// A pointerdown outside closes a dropdown left open by the previous view; then the first card opens its own.
const quick = `document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); await new Promise((r) => setTimeout(r, 100)); document.querySelector('nav button[aria-haspopup=dialog]').click();`;
// A right click in the middle of the first element that matches.
const ctx = (selector) =>
  `const el = document.querySelector(${JSON.stringify(selector)}); const r = el.getBoundingClientRect(); el.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, clientX: r.left + Math.min(40, r.width / 2), clientY: r.top + r.height / 2 }));`;
const git = (tab) => `${reset} s.setUi({ perspective: "Git" }); s.gitRepo = s.repos[0].info.path; ${wait(400)} ${clickText("[role=tab]", tab)}`;
// The Changes view of the first repo with local changes, its first file open.
const gitDiff = (extra) =>
  `${reset} s.setUi({ perspective: "Git", diffSplit: false }); s.gitRepo = s.repos.find((r) => (window.__mbfGitStatus.statuses.get(r.info.path)?.entries.length ?? 0) > 0).info.path; ${wait(400)} ${clickText("[role=tab]", "Änderungen")} ${wait(200)} document.querySelector("[role=option][aria-selected]:not(nav *)")?.click(); ${wait(500)} ${extra} ${wait(400)}`;
// Opens the menu behind a labelled button and picks an entry by its text.
const menuPick = (button, entry) =>
  `document.querySelector('button[aria-label="${button}"]').click(); ${wait(200)} ${clickText("[role=menu] [role=menuitem], [role=menu] [role=menuitemcheckbox]", entry)} ${wait(300)}`;
const SETTINGS = ["appearance", "repos", "updates", "window", "rules", "online", "commands", "prompts", "env", "config", "about"];
const headMenu = (label) =>
  `const h = [...document.querySelectorAll("[role=columnheader]")].find((e) => e.textContent.includes(${JSON.stringify(label)})); const r = h.getBoundingClientRect(); h.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, clientX: r.left + 20, clientY: r.top + 10 }));`;

const views = {
  local: { setup: `${clean} s.setScope("Local");`, jank: true },
  // The narrowest sidebar: cards with signs leave the least room for the branch name.
  "sidebar-narrow": { setup: `${clean} s.setUi({ sidebarWidth: 240 });` },
  // No status yet anywhere (first start, slow git status): placeholders in the sidebar, nothing to press.
  "sidebar-loading": {
    setup: `${clean} window.__statusDelay = 600000; window.__mbfGitStatus.statuses.clear(); window.__mbfGitStatus.statusFailed.clear();`,
    teardown: `const s = window.__mbfStore; window.__statusDelay = 0; await Promise.all([...s.repos.map((r) => r.info.path), ...s.config.repoGroups.flatMap((g) => g.paths)].map((p) => window.__mbfGitStatus.refreshStatus(p)));`,
  },
  // The commit search with hits in three repos, one of them capped and one hit in many branches.
  "find-commit": {
    setup: `${clean} s.commitSearchOpen = true; ${wait(400)} const f = document.querySelector('dialog[open] input'); f.value = "totals"; f.dispatchEvent(new Event("input", { bubbles: true })); ${wait(700)}`,
  },
  // Every local branch: also those the server still has and those never pushed, one of them selected.
  "local-all": {
    setup: `${clean} s.setScope("Local"); s.setUi({ orphanedOnly: false }); const b = s.allBranches.find((b) => b.upstreamState === "None"); s.selectKey(b.repoPath + "::" + b.name);`,
  },
  "local-name": { setup: `${clean} s.setUi({ tableGroup: "Name", orphanedOnly: false });` },
  // The same with a branch selected: in a narrow window the detail floats beside the group heads and their buttons.
  "local-name-detail": {
    setup: `${clean} s.setUi({ tableGroup: "Name", orphanedOnly: false }); const b = s.allBranches.find((b) => b.verdict === "Unsafe"); s.selectKey(b.repoPath + "::" + b.name);`,
  },
  // The actions of one branch name across its repos, with the submenu of repos it is missing in.
  "local-name-menu": {
    setup: `${clean} s.setUi({ tableGroup: "Name", orphanedOnly: false }); ${wait(300)} document.querySelector('[role=listbox]:not(nav *)').scrollTop = 0; ${wait(300)} [...document.querySelectorAll('[role=listbox]:not(nav *) button[aria-label="Aktionen für alle Repos der Gruppe"]')].find((b) => b.getBoundingClientRect().top > 200)?.click(); ${wait(400)}`,
    menu: true,
  },
  "local-folder": { setup: `${clean} s.setUi({ tableGroup: "Folder" }); s.sectionOpen.ignored = true; s.sectionOpen.locked = true;`, jank: true },
  "local-prefix": { setup: `${clean} s.setUi({ tableGroup: "Prefix" });` },
  "local-detail": { setup: `${clean} const b = s.allBranches.find((b) => b.verdict === "Unsafe"); s.selectKey(b.repoPath + "::" + b.name);` },
  // The to-do of a branch that is checked out with changes: several steps, one of them blocked.
  "local-todo": {
    setup: `${clean} s.setUi({ orphanedOnly: false }); const b = s.allBranches.find((b) => b.worktree?.files.length && b.stashes.length && !b.locked); s.selectKey(b.repoPath + "::" + b.name);`,
  },
  // A stack of messages taller than the window: it must stop below the top bar and scroll.
  // Messages dismiss themselves after seconds: gone before the tooltip audit reaches them.
  toasts: {
    tooltips: false,
    setup: `${clean} for (let i = 0; i < 9; i++) s.toast(i % 2 ? "error" : "info", "Meldung " + (i + 1), { detail: "git: fatal: something went wrong in step " + (i + 1) });`,
    teardown: `const s = window.__mbfStore; s.toasts.slice().forEach((x) => s.dismiss(x.id));`,
  },
  "grid-custom": {
    setup: `${clean} s.setColumns([{ id: "status", width: 92, visible: true }, { id: "commit", width: 104, visible: true }, { id: "branch", width: 260, visible: true }, { id: "author", width: 170, visible: true }, { id: "repo", width: 150, visible: true }, { id: "pr", width: 72, visible: false }]); s.toggleFacet("age", "month"); s.toggleFacet("repo", s.repos[1].info.path);`,
  },
  "head-menu": { setup: `${clean} ${wait(300)} ${headMenu("Repo")}`, menu: true },
  "prefix-menu": { setup: `${clean} ${wait(300)} ${clickText("button", "Präfixe")}`, menu: true },
  online: { setup: `${clean} s.setScope("Online");`, jank: true },
  "online-detail": { setup: `${clean} s.setScope("Online"); const b = s.allOnline.find((b) => b.verdict === "Merged"); s.selectKey(b.repoPath + "::online::" + b.name);` },
  "local-detail-pr": { setup: `${clean} s.setScope("Local"); const b = s.allBranches.find((b) => b.pullRequest && b.verdict === "Safe"); s.selectKey(b.repoPath + "::" + b.name);` },
  "commits-flyout": {
    // The lists are not in the scan result: read as the app reads them, from the (simulated) backend.
    setup: `${clean} s.setScope("Local"); const b = s.allBranches.find((b) => b.unpushedCommitCount);
      const l = await window.__TAURI_INTERNALS__.invoke("branch_commits", { path: b.repoPath, branch: b.name });
      s.commitsView = { title: "Commits", branch: b.name, repoPath: b.repoPath, commits: l.unpushed, total: b.unpushedCommitCount };`,
  },
  ...Object.fromEntries(SETTINGS.map((p) => [`settings-${p}`, { setup: `${clean} s.setScope("Local"); s.openSettings("${p}");` }])),
  "git-changes": { setup: git("Änderungen") },
  // The changes of all repos: a block per repo with changes, the clean ones in one line.
  "git-changes-all": {
    setup: `${git("Änderungen")} s.setUi({ gitChangesAll: true }); ${wait(400)}`,
    teardown: `window.__mbfStore.setUi({ gitChangesAll: false });`,
  },
  // Grouped by the folders the repos sit in.
  "git-changes-folders": {
    setup: `${git("Änderungen")} s.setUi({ gitChangesAll: true, gitChangesByFolder: true }); ${wait(400)}`,
    teardown: `window.__mbfStore.setUi({ gitChangesAll: false, gitChangesByFolder: false });`,
  },
  // Folders, repos, status groups and directories nested, one step in per level.
  "git-changes-tree": {
    setup: `${git("Änderungen")} s.setUi({ gitChangesAll: true, gitChangesByFolder: true, gitChangesTree: true }); ${wait(400)}`,
    teardown: `window.__mbfStore.setUi({ gitChangesAll: false, gitChangesByFolder: false, gitChangesTree: false });`,
  },
  // The same while one repo's status is still on its way: its block is a placeholder.
  "git-changes-all-loading": {
    setup: `${git("Änderungen")} window.__statusDelay = 600000; s.setUi({ gitChangesAll: true }); window.__mbfGitStatus.statuses.delete(s.repos[2].info.path); ${wait(400)}`,
    teardown: `const s = window.__mbfStore; window.__statusDelay = 0; s.setUi({ gitChangesAll: false }); await window.__mbfGitStatus.refreshStatus(s.repos[2].info.path);`,
  },
  // A pull started elsewhere (a repo group) runs in the open repo: the writing controls wait and say for what.
  "git-elsewhere": {
    setup: `${git("Änderungen")} window.__mbfGitClaims.gitStart([s.gitRepo], "Pull");`,
    teardown: `const s = window.__mbfStore; window.__mbfGitClaims.gitEnd([s.gitRepo]);`,
  },
  // The diff of a changed file side by side, with whitespace ignored (parts cannot be staged), and with a chosen line.
  "git-diff-split": { setup: gitDiff("s.setUi({ diffSplit: true });") },
  "git-diff-whitespace": { setup: gitDiff(`${menuPick("Leerraum", "Ganz ignorieren")}`) },
  "git-diff-selection": {
    setup: gitDiff(`${menuPick("Leerraum", "Beachten")} document.querySelector('button[aria-label="Zeile wählen"]')?.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })); document.body.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));`),
  },
  "git-history": { setup: `${git("Verlauf")} ${wait(400)}` },
  "git-branches": { setup: git("Branches") },
  // The repo where agents work: its branches grouped by prefix, the head and the columns aligned.
  "git-branches-grouped": {
    setup: `${reset} s.setUi({ perspective: "Git", gitBranchGroup: "Prefix" }); s.gitRepo = s.repos.find((r) => r.info.name === "Acme.Reports").info.path; ${wait(400)} ${clickText("[role=tab]", "Branches")} ${wait(500)}`,
    teardown: `window.__mbfStore.setUi({ gitBranchGroup: "None" });`,
  },
  // Many worktrees of one repo: one folded line, opened, grouped by branch prefix.
  "worktrees-many": {
    setup: `${clean} ${wait(500)} const head = [...document.querySelectorAll('nav [role=group] button[aria-expanded=false]')].find((b) => /Worktrees/.test(b.closest('[role=group]')?.getAttribute('aria-label') ?? '')); if (!head) throw new Error("no folded worktree line"); head.click(); ${wait(400)} if (head.getAttribute("aria-expanded") !== "true") throw new Error("the worktree line did not open"); document.querySelector('nav [role=group][aria-label$="Worktrees"]')?.scrollIntoView({ block: "center" }); ${wait(300)}`,
    // Folded again: the views after this one start as a new user would see them.
    teardown: `const s = window.__mbfStore; const c = { ...(s.config.ui.collapsed ?? {}) }; delete c.worktrees; s.setUi({ collapsed: c });`,
  },
  // The insert menu of the prompt editor, its groups open.
  "prompts-insert-menu": { setup: `${clean} s.openSettings("prompts"); ${wait(500)} ${clickText("dialog[open] button", "Variable einfügen")} ${wait(300)}`, menu: true },
  copies: { setup: `${clean} s.openCopies(s.repos[0].info.path, null);` },
  deleted: { setup: `${clean} s.deletedOpen = true;` },
  "row-menu": { setup: `${clean} ${wait(300)} ${ctx("[data-key][role=option]")}`, menu: true },
  "report-menu": { setup: `${clean} ${wait(300)} document.querySelector('button[aria-label^="Bericht"]').click();`, menu: true },
  "sidebar-menu": { setup: `${clean} ${wait(300)} ${ctx("nav [role=presentation]")}`, menu: true },
  "group-menu": { setup: `${clean} ${wait(300)} ${ctx("nav [data-group-head]")}`, menu: true },
  // A repo group chosen as the filter, and the actions of a group.
  "repo-groups": { setup: `${clean} ${wait(300)} document.querySelector("nav [data-rg-head] button[aria-pressed]").click();` },
  // Identities: a repo with its own sign (it replaces the folder's), a group with one, selected (one pill in the table).
  "identities": {
    setup: `${clean} await window.__mbfIdentities.setIdentity("repo:" + s.repos[0].info.identity, { short: "CORE", color: "id-9" }); await window.__mbfIdentities.setIdentity("group:g-backend", { short: "BE", color: "id-10" }); await window.__mbfIdentities.setIdentity("folder:" + s.config.roots[1], { short: "TL", color: "id-8" }); ${wait(300)} document.querySelector("nav [data-rg-head] button[aria-pressed]").click(); ${wait(300)}`,
    teardown: `const s = window.__mbfStore; await window.__mbfIdentities.setIdentity("repo:" + s.repos[0].info.identity, null); await window.__mbfIdentities.setIdentity("group:g-backend", null); await window.__mbfIdentities.setIdentity("folder:" + s.config.roots[1], null); s.filters.repos = [];`,
  },
  "identity-dialog": {
    setup: `${clean} window.__mbfIdentities.openIdentity("repo", s.repos[0].info.path, s.repos[0].info.name); ${wait(500)}`,
    teardown: `window.__mbfIdentities.identityTarget = null;`,
  },
  // Several repos selected, one of them in front: fill and bar on all, the outline on the one in front.
  "sidebar-selection": {
    setup: `${clean} s.filters.repos = [s.repos[0].info.path, s.repos[2].info.path, s.repos[3].info.path]; s.focusRepo = s.repos[2].info.path; ${wait(300)}`,
    teardown: `const s = window.__mbfStore; s.filters.repos = []; s.focusRepo = null;`,
  },
  // Single members of a group and a worktree chosen with Ctrl: each one marked where it stands.
  "sidebar-members": {
    setup: `${clean} ${wait(1200)} const rows = [...document.querySelectorAll("nav [data-rg-id] [data-sel-path]")].filter((r) => r.getAttribute("aria-busy") !== "true"); rows[0]?.click(); rows[2]?.dispatchEvent(new MouseEvent("click", { bubbles: true, ctrlKey: true })); ${wait(300)}`,
    teardown: `const s = window.__mbfStore; s.filters.repos = []; s.focusRepo = null;`,
  },
  // A sidebar dragged far wider than it used to be allowed: the cards and groups grow with it.
  "sidebar-wide": { setup: `${clean} s.setUi({ sidebarWidth: 640 }); ${wait(300)}`, teardown: `window.__mbfStore.setUi({ sidebarWidth: 248 });` },
  // The start view: next steps on top, tiles below; pull requests mine and for my review.
  dashboard: {
    setup: `${reset} s.setUi({ perspective: "Dashboard", dashboardPrs: "mine", dashboardDismissed: {} }); s.filters.repos = []; ${wait(1200)}`,
    teardown: `window.__mbfStore.setUi({ perspective: "Cleanup" });`,
  },
  "dashboard-all-prs": {
    setup: `${reset} s.setUi({ perspective: "Dashboard", dashboardPrs: "all" }); s.filters.repos = []; ${wait(1000)}`,
    teardown: `window.__mbfStore.setUi({ perspective: "Cleanup", dashboardPrs: "mine" });`,
  },
  // Everything put aside: the list says in a sentence that nothing is due.
  "dashboard-empty": {
    setup: `${reset} s.setUi({ perspective: "Dashboard" }); s.filters.repos = []; ${wait(800)} const d = window.__mbfDashboard; s.setUi({ dashboardDismissed: Object.fromEntries(d.steps.map((x) => [x.key, x.fingerprint])) }); ${wait(400)}`,
    teardown: `window.__mbfStore.setUi({ perspective: "Cleanup", dashboardDismissed: {} });`,
  },
  // Before the first scan: the shape of what comes.
  "dashboard-loading": {
    setup: `${reset} s.setUi({ perspective: "Dashboard" }); s.loaded = false; ${wait(400)}`,
    teardown: `const s = window.__mbfStore; s.loaded = true; s.setUi({ perspective: "Cleanup" });`,
  },
  // Narrowed to the repos chosen in the sidebar.
  "dashboard-narrowed": {
    setup: `${reset} s.setUi({ perspective: "Dashboard" }); s.filters.repos = [s.repos[0].info.path]; ${wait(1000)}`,
    teardown: `const s = window.__mbfStore; s.filters.repos = []; s.setUi({ perspective: "Cleanup" });`,
  },
  // A folder head chosen like a group head: its repos selected, the head pressed.
  "folder-selected": {
    setup: `${clean} ${wait(300)} document.querySelector("nav [data-folder-head] button[aria-pressed]").click(); ${wait(300)}`,
    teardown: `const s = window.__mbfStore; s.filters.repos = []; s.focusRepo = null;`,
  },
  // The folder's menu from its "…" button: the same set entries as a group, plus what a place on disk adds.
  "folder-menu": { setup: `${clean} ${wait(300)} document.querySelector('nav [data-folder-head] button[aria-haspopup=menu]').click(); ${wait(500)}`, menu: true },
  // What runs, shown: the user's own run with progress and stop in the top bar, notes on the elements.
  "activity-on": {
    setup: `${clean} ${wait(300)} const a = window.__mbfActivity; const p = s.repos.map((r) => r.info.path); s.setUi({ activityShown: true });
      a.begin("Fetch", null, { own: true, total: 5, cancel: () => {} }); a.step([...a.running.keys()].at(-1), 2, "Fetch · " + s.repos[2].info.name);
      a.begin("Status lesen", p[0]); const f = a.begin("Repo bewerten", p[1]); a.end(f, "failed", "Das Repo ist gesperrt, weil ein anderer git-Prozess läuft. Die Sperrdatei index.lock liegt noch im Ordner.");
      const o = a.begin("Pull Requests laden", p[3]); a.end(o); ${wait(300)}`,
    teardown: `document.querySelector('header button[aria-haspopup=dialog][aria-expanded=true]')?.click(); const a = window.__mbfActivity; for (const id of [...a.running.keys()]) a.end(id); a.clear(); window.__mbfStore.setUi({ activityShown: false });`,
  },
  // The list of what runs and ran, below the slot.
  "activity-panel": {
    setup: `${clean} ${wait(300)} const a = window.__mbfActivity; const p = s.repos.map((r) => r.info.path); s.setUi({ activityShown: true });
      a.begin("Fetch", null, { own: true, total: 5, cancel: () => {} }); a.step([...a.running.keys()].at(-1), 2, "Fetch · " + s.repos[2].info.name);
      a.begin("Status lesen", p[0]); const f = a.begin("Repo bewerten", p[1]); a.end(f, "failed", "Das Repo ist gesperrt, weil ein anderer git-Prozess läuft. Die Sperrdatei index.lock liegt noch im Ordner.");
      const o = a.begin("Pull Requests laden", p[3]); a.end(o); ${wait(300)} document.querySelector('header button[aria-haspopup=dialog]').click(); ${wait(500)}`,
    teardown: `const a = window.__mbfActivity; for (const id of [...a.running.keys()]) a.end(id); a.clear(); window.__mbfStore.setUi({ activityShown: false });`,
  },
  // The open pull requests of a repo, from its badge.
  "pr-dropdown": { setup: `${clean} ${wait(500)} document.querySelector('nav button[aria-haspopup=menu][aria-label*="Pull Request"]').click(); ${wait(300)}`, menu: true },
  // The edge between repo and branch at both ends of its range: nothing may collapse or overlap.
  "repo-groups-30": { setup: `${clean} s.setUi({ groupSplit: 30 }); ${wait(300)}`, teardown: `window.__mbfStore.setUi({ groupSplit: 50 });` },
  "repo-groups-70": { setup: `${clean} s.setUi({ groupSplit: 70 }); ${wait(300)}`, teardown: `window.__mbfStore.setUi({ groupSplit: 50 });` },
  // The start with the last run's statuses: branches and counters there, dimmed until fresh.
  "start-cache": {
    setup: `${clean} for (const p of window.__mbfGitStatus.statuses.keys()) window.__mbfGitStatus.staleStatus.add(p); ${wait(300)}`,
    teardown: `window.__mbfGitStatus.staleStatus.clear();`,
  },
  "repo-group-menu": { setup: `${clean} ${wait(300)} document.querySelector('nav button[aria-label="Aktionen der Gruppe"]').click(); ${wait(500)}`, menu: true },
  // The switch panel for a whole group: every branch once, with the number of repos that have it.
  // Taking a branch over: the panel opens on the branches only some repos have.
  "repo-group-adopt": {
    setup: `${clean} document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })); ${wait(300)} document.querySelector('nav button[aria-label="Aktionen der Gruppe"]').click(); ${wait(500)} ${clickText("[role=menu] [role=menuitem]", "Branch übernehmen …")} ${wait(1500)}`,
    menu: true,
  },
  // The same panel from a folder of the sidebar.
  "folder-switch": {
    setup: `${clean} document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })); ${wait(300)} ${ctx("nav [data-folder-head]")} ${wait(400)} ${clickText("[role=menu] [role=menuitem]", "Branch wechseln …")} ${wait(700)}`,
    menu: true,
  },
  "repo-group-switch": {
    // A pointerdown outside first: the menu of the previous view is still open, a click on its button would close it.
    setup: `${clean} document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })); ${wait(300)} document.querySelector('nav button[aria-label="Aktionen der Gruppe"]').click(); ${wait(500)} ${clickText("[role=menu] [role=menuitem]", "Branch wechseln …")} ${wait(700)}`,
    menu: true,
  },
  // The second step for the group: every repo with what happens there, changes handled once for all.
  "repo-group-confirm": {
    setup: `${clean} document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })); ${wait(300)} document.querySelectorAll('nav button[aria-label="Aktionen der Gruppe"]')[1].click(); ${wait(500)} ${clickText("[role=menu] [role=menuitem]", "Branch wechseln …")} ${wait(700)} [...document.querySelectorAll("[data-quick-switch] [role=option] button")].find((b) => !b.querySelector("svg.lucide-check"))?.click(); ${wait(500)}`,
    menu: true,
  },
  // A card on its way to a group: the zone for a new group, the target lit, the label at the pointer.
  "repo-group-drag": {
    tooltips: false,
    setup: `${clean} ${wait(300)} const card = document.querySelector("nav [role=presentation]"); const c = card.getBoundingClientRect();
      const at = (type, x, y) => card.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId: 7, button: 0 }));
      at("pointerdown", c.left + 40, c.top + 12); at("pointermove", c.left + 60, c.top + 30); ${wait(100)}
      const h = document.querySelectorAll("nav [data-rg-head]")[1].getBoundingClientRect(); at("pointermove", h.left + 60, h.top + h.height / 2); ${wait(200)}`,
  },
  help: { setup: `${reset} s.helpAt = { topic: null, section: null }; s.helpOpen = true;` },
  ...Object.fromEntries(
    ["verdicts", "segments", "sidebar", "worktree", "table", "topbar"].map((id) => [
      `help-legend-${id}`,
      { setup: `${reset} s.helpAt = { topic: "legend", section: "${id}" }; s.helpOpen = true; ${wait(400)}` },
    ]),
  ),
  shortcuts: { setup: `${reset} s.shortcutsOpen = true;` },
  "delete-dialog": { setup: `${reset} s.openDelete(s.allBranches.filter((b) => b.verdict === "Safe").slice(0, 12));` },
  // The branch dropdown of a sidebar card, then its second step with the other working copy marked.
  "quick-switch": { setup: `${clean} ${quick} ${wait(500)}`, menu: true },
  // The dropdown of a repo card: the card is contained (content-visibility), the panel must still show in full.
  "quick-switch-card": {
    setup: `${clean} document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })); ${wait(100)} document.querySelector("nav [data-repo] button[aria-haspopup=dialog]").click(); ${wait(500)}
      const p = document.querySelector("[data-quick-switch]"); const r = p.getBoundingClientRect();
      if (!p.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2))) throw new Error("the dropdown of a card is hidden or clipped");`,
    menu: true,
  },
  "quick-switch-mine": { setup: `${clean} ${quick} ${wait(500)} ${clickText("[role=dialog] [role=tab]", "Meine")} ${wait(200)}`, menu: true },
  "quick-confirm": {
    setup: `${clean} s.filters.repos = [s.repos.find((r) => r.info.path.includes("feature2")).info.path]; ${quick} ${wait(500)}
      [...document.querySelectorAll("[role=dialog] [role=option] button")].find((b) => b.textContent.includes("working"))?.click(); ${wait(500)}`,
    menu: true,
  },
};

const allow = JSON.parse(readFileSync(join(AUDIT, "allow.json"), "utf8"));
const allowed = (view, kind, finding) =>
  allow.some((a) => (!a.view || a.view === view) && a.kind === kind && JSON.stringify(finding).includes(a.match));

const findings = [];
const add = (theme, view, width, kind, list) => {
  for (const f of list) if (!allowed(view, kind, f)) findings.push({ theme, view, width, kind, finding: f });
};

const [light, dark] = await Promise.all([page(), page()]);

// An audit that never finds anything proves nothing: a planted overlap must be reported first.
await light.size(1280);
await light.js(`const d = document.createElement("div"); d.id = "mbf-plant"; d.style.cssText = "position: fixed; left: 40px; top: 300px; z-index: 50";
  for (const [x, y, t] of [[0, 0, "planted overlap one"], [12, 5, "planted overlap two"]]) {
    const s = document.createElement("span"); s.textContent = t; s.style.cssText = "position: absolute; white-space: nowrap; left: " + x + "px; top: " + y + "px"; d.append(s);
  }
  const pill = document.createElement("span"); pill.textContent = "planted pill"; pill.style.cssText = "position: absolute; top: 60px; border: 1px solid red; padding: 0 1px; white-space: nowrap"; d.append(pill);
  const count = document.createElement("span"); count.textContent = "7"; count.className = "planted-count"; count.style.cssText = "position: absolute; top: 90px"; d.append(count);
  const segs = document.createElement("span"); segs.className = "mbf-segs"; segs.setAttribute("aria-label", "planted segment"); segs.style.cssText = "position: absolute; top: 120px; width: 40px";
  segs.innerHTML = '<span class="mbf-seg mbf-seg-rest" style="min-width: 0; width: 6px"><span class="min-w-0 truncate">planted</span></span>'; d.append(segs);
  const card = document.createElement("div"); card.textContent = "planted card"; card.style.cssText = "position: fixed; right: 2px; bottom: 2px; width: 120px; padding: 8px; background: red"; d.append(card);
  const cut = document.createElement("span"); cut.textContent = "planted cut-off text without a tip"; cut.style.cssText = "position: absolute; top: 150px; display: block; width: 40px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap"; d.append(cut);
  const clip = document.createElement("div"); clip.style.cssText = "position: absolute; top: 210px; width: 60px; overflow: hidden"; clip.innerHTML = '<span style="white-space: nowrap">planted clipped text without an ellipsis</span>'; d.append(clip);
  const sel = document.createElement("div"); sel.setAttribute("role", "option"); sel.setAttribute("aria-selected", "true"); sel.style.cssText = "position: absolute; top: 240px; background: rgba(0,0,0,0.02)"; sel.textContent = "planted selection"; d.append(sel);
  const busyText = document.createElement("div"); busyText.setAttribute("aria-busy", "true"); busyText.style.cssText = "position: absolute; top: 270px"; busyText.innerHTML = "<span>planted known name under a busy mark</span>"; d.append(busyText);
  const busy = document.createElement("div"); busy.setAttribute("aria-busy", "true"); busy.style.cssText = "position: absolute; top: 180px"; busy.innerHTML = "<button>planted busy</button>"; d.append(busy);
  // A row that shows the hand without saying what a click does, and one beside it that says it.
  const hand = document.createElement("div"); hand.textContent = "planted clickable row"; hand.className = "planted-hand"; hand.style.cssText = "position: absolute; top: 300px; cursor: pointer"; hand.innerHTML += "<span>inside</span>"; d.append(hand);
  const told = document.createElement("div"); told.textContent = "explained clickable row"; told.className = "explained-hand"; told.dataset.tip = ""; told.style.cssText = "position: absolute; top: 330px; cursor: pointer"; d.append(told);
  // A button with a card lying over it, and one under a menu, which covers what is beneath on purpose.
  for (const [top, text, role] of [[360, "planted covered button", null], [400, "spared button under a menu", "menu"]]) {
    const b = document.createElement("button"); b.textContent = text; b.style.cssText = "position: absolute; top: " + top + "px"; d.append(b);
    const lid = document.createElement("div"); if (role) lid.setAttribute("role", role); lid.style.cssText = "position: absolute; left: 0; top: " + (top - 6) + "px; width: 240px; height: 36px; background: #888"; d.append(lid);
  }
  document.body.append(d); return 1;`);
const calibration = await light.file("layout-audit.js");
const nakedCalibration = await light.file("naked-audit.js");
const pointerCalibration = await light.file("pointer-audit.js");
const tipCalibration = (await light.file("tooltip-audit.js")).findings;
await light.js(`document.getElementById("mbf-plant").remove(); return 1;`);
const planted = (list) => list.some((o) => JSON.stringify(o).includes("planted"));
// The rule must also stay quiet where the tip is there, and not report the text inside the row on its own.
if (pointerCalibration.some((o) => /explained|inside/.test(JSON.stringify(o)) && !/planted/.test(o.el))) {
  console.error(`Calibration failed: the pointer audit reported an element that explains itself: ${JSON.stringify(pointerCalibration)}`);
  process.exit(2);
}
if (calibration.covered.some((o) => /spared/.test(o.el))) {
  console.error(`Calibration failed: the layout audit reported a button that a menu covers on purpose: ${JSON.stringify(calibration.covered)}`);
  process.exit(2);
}
for (const [rule, list] of [["overlap", calibration.overlaps], ["cramped", calibration.cramped], ["edge", calibration.edge], ["segment", calibration.segments], ["naked", nakedCalibration], ["pointer", pointerCalibration], ["cut-off", tipCalibration], ["busy", calibration.busyInteractive], ["clipped", calibration.clipped], ["selection", calibration.selection], ["busy-content", calibration.busyContent], ["covered", calibration.covered]]) {
  if (planted(list)) continue;
  console.error(`Calibration failed: the layout audit did not report a planted ${rule}.`);
  process.exit(2);
}

await light.js(`window.__tipSeen = new Set(); return 1;`);
let checks = 0;
// What ran, by kind: the layout and state checks make up `checks`; the hovers and probes inside a view are counted apart.
const counted = { layout: 0, popover: 0, stability: 0, detail: 0, copy: 0, latency: 0, pressed: 0, tooltips: 0, "cut-off": 0, naked: 0, pointer: 0, jank: 0 };
const count = (kind, n = 1) => {
  counted[kind] += n;
  if (!["tooltips", "cut-off", "naked", "pointer", "jank"].includes(kind)) checks += n;
};
// Every dropdown closes on a click beside it, on Esc (wherever the focus is), when the window loses the
// focus, and on a second click on what opened it.
async function popoverChecks({ js }) {
  const open = (sel) => `!!document.querySelector(${JSON.stringify(sel)})`;
  const cases = [
    { name: "quick-switch", sel: "[data-quick-switch]", open: quick, trigger: "nav button[aria-haspopup=dialog]" },
    { name: "row-menu", sel: "[role=menu]", open: ctx("[data-key][role=option]") },
    { name: "bell", sel: "[role=menu]", open: `document.querySelector('header button[aria-haspopup=menu]').click();`, trigger: "header button[aria-haspopup=menu]" },
  ];
  const ways = {
    outside: `document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));`,
    escape: `document.activeElement?.blur(); window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));`,
    blur: `window.dispatchEvent(new Event("blur"));`,
  };
  for (const c of cases) {
    const all = c.trigger ? { ...ways, toggle: `const t = document.querySelector(${JSON.stringify(c.trigger)}); t.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })); t.click();` } : ways;
    for (const [way, close] of Object.entries(all)) {
      const state = await js(`${clean} ${wait(300)} ${c.open} ${wait(400)} const before = ${open(c.sel)}; ${close} ${wait(300)} return { before, after: ${open(c.sel)} };`);
      count("popover");
      if (!state.before || state.after) findings.push({ theme: "-", view: `popover-${c.name}`, width: 1280, kind: "popover", finding: { way, ...state } });
    }
  }
}

// Controls keep their place when their state changes: a label that counts, a badge that comes and goes
// or a bolder active tab moves everything beside it. Each state is set, the top bar's groups measured,
// and every state must give the same boxes as the first.
async function stabilityChecks({ js, size }) {
  await size(1280);
  const measure = `return [...document.querySelectorAll("header [role=tablist], header [role=group]")].map((e) => { const r = e.getBoundingClientRect(); return (e.getAttribute("aria-label") ?? e.getAttribute("role")) + " " + Math.round(r.left) + "+" + Math.round(r.width); });`;
  const states = {
    cleanup: `s.setUi({ perspective: "Cleanup" });`,
    git: `s.setUi({ perspective: "Git" });`,
    "git, clean repo": `s.setUi({ perspective: "Git" }); s.gitRepo = s.repos.find((r) => !(window.__mbfGitStatus.statuses.get(r.info.path)?.entries.length)).info.path;`,
    scanning: `s.setUi({ perspective: "Cleanup" }); Object.assign(s, { scanning: true, scanKind: "fetch", doneRepos: 3 });`,
    online: `Object.assign(s, { scanning: true, scanKind: "fetch", onlinePending: true });`,
  };
  const base = await js(`${clean} ${wait(300)} ${measure}`);
  for (const [name, set] of Object.entries(states)) {
    const now = await js(`const s = window.__mbfStore; ${set} ${wait(300)} ${measure}`);
    count("stability");
    const moved = now.filter((b, i) => b !== base[i]);
    if (moved.length || now.length !== base.length) findings.push({ theme: "-", view: `stable-${name}`, width: 1280, kind: "jump", finding: { moved, was: base } });
  }
  await js(`Object.assign(window.__mbfStore, { scanning: false, scanKind: null, onlinePending: false }); return 1;`);
}

// The detail pane floats over the table in a narrow window and sits beside it in a wide one: a change of
// the window's width must not take away a pane that is on screen, nor bring back one that was closed.
async function detailModeChecks({ js, size, file }) {
  const shown = `!!document.querySelector("main > aside:last-of-type [role=toolbar]")`;
  const pick = `const b = s.allBranches.find((b) => b.verdict === "Unsafe"); s.selectKey(b.repoPath + "::" + b.name);`;
  const cases = [
    { name: "open over the table, window grows", from: 1000, to: 1800, setup: `s.setUi({ detailCollapsed: false }); ${pick}`, want: true },
    // Hidden on purpose stays hidden, also when a row is chosen over the table.
    { name: "hidden over the table, a row chosen", from: 1000, to: 1000, setup: `s.setUi({ detailCollapsed: true }); ${pick}`, want: false },
    { name: "beside the table, window shrinks", from: 1800, to: 1000, setup: `s.setUi({ detailCollapsed: false }); ${pick}`, want: true },
    { name: "closed beside the table, window shrinks", from: 1800, to: 1000, setup: `s.setUi({ detailCollapsed: true }); ${pick}`, want: false },
  ];
  for (const c of cases) {
    await size(c.from);
    await js(`${clean} ${wait(300)} ${c.setup} ${wait(500)} return 1;`);
    await size(c.to);
    const on = await js(`${wait(400)} return ${shown};`);
    count("detail");
    if (on !== c.want) findings.push({ theme: "-", view: "detail-mode", width: c.to, kind: "layout", finding: { case: c.name, shown: on } });
  }
  // Floating over the table, the detail starts at the list: search, filters and the delete button above
  // it stay free, also where the bars wrap at a narrow width (a small screen caps the smallest window).
  // Beside it the list ends, so no head, group head or row keeps a control under the pane.
  for (const w of [1000, 880]) {
    await size(w);
    const r = await js(`${clean} ${wait(300)} s.setUi({ detailCollapsed: false }); ${pick} ${wait(700)}
      const aside = document.querySelector("main > aside:last-of-type");
      const list = document.querySelector("[data-table-list]");
      if (!aside || !list) return { error: "no detail or list" };
      const a = aside.getBoundingClientRect();
      const covered = [...list.parentElement.children].filter((e) => e !== list).flatMap((bar) => [...bar.querySelectorAll("button, input")])
        .filter((e) => { const b = e.getBoundingClientRect(); return b.width && b.right > a.left && b.bottom > a.top + 1 && b.top < a.bottom; })
        .map((e) => e.getAttribute("aria-label") || e.getAttribute("placeholder") || e.textContent.trim().slice(0, 30));
      return { top: Math.round(a.top), list: Math.round(list.getBoundingClientRect().top), covered };`);
    count("detail");
    if (r.error || r.covered.length || r.top < r.list - 1) findings.push({ theme: "-", view: "detail-overlay", width: w, kind: "layout", finding: r });
    for (const group of ["None", "Name"]) {
      await js(`window.__mbfStore.setUi({ tableGroup: "${group}", orphanedOnly: false }); ${wait(500)} return 1;`);
      count("detail");
      add("-", `detail-overlay-${group}`, w, "covered", (await file("layout-audit.js")).covered);
    }
  }
  await size(1280);
}

// Every branch name copies itself on right click. Inside a row the row's menu opens instead and carries
// the entry; over a modal dialog the menu must be on top and take the click, not sit inert behind it.
async function branchCopyChecks({ js }) {
  const cases = [
    { name: "detail", setup: `const b = s.allBranches.find((b) => b.verdict === "Unsafe"); s.selectKey(b.repoPath + "::" + b.name);`, sel: "main > aside:last-of-type .mbf-segs" },
    { name: "table row", setup: "", sel: "[data-key][role=option] .mbf-segs" },
    { name: "modal dialog", setup: `s.deletedOpen = true;`, sel: "dialog[open] .mbf-segs" },
  ];
  for (const c of cases) {
    const r = await js(`${clean} ${wait(300)} ${c.setup} ${wait(600)}
      window.__copied = null;
      navigator.clipboard.writeText = async (x) => { window.__copied = x; };
      const name = document.querySelector(${JSON.stringify(c.sel)});
      if (!name) return { error: "no branch name" };
      const want = name.getAttribute("aria-label");
      const box = name.getBoundingClientRect();
      name.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: box.left + 4, clientY: box.top + 4 }));
      ${wait(300)}
      const m = document.querySelector("[role=menu]");
      if (!m) return { error: "no menu", want };
      const item = [...m.querySelectorAll("[role=menuitem]")].find((b) => /^(Branch-Namen kopieren|Copy branch name|Name)$/.test(b.textContent.trim()));
      if (!item) return { error: "no copy entry", want, entries: m.textContent.slice(0, 200) };
      const ib = item.getBoundingClientRect();
      const hit = document.elementFromPoint(ib.left + ib.width / 2, ib.top + ib.height / 2);
      if (!item.contains(hit)) return { error: "entry covered", want, hit: hit?.outerHTML.slice(0, 120) };
      item.click();
      ${wait(200)}
      return { want, copied: window.__copied };`);
    count("copy");
    if (r.error || !r.want?.endsWith(r.copied ?? "\u0000")) findings.push({ theme: "-", view: `copy-${c.name}`, width: 1280, kind: "copy", finding: r });
  }
  await js(`${clean} return 1;`);
}

// A toggle shows at a glance whether it is on: switching it must change its frame (fill or border) by a
// visible colour distance, not only a hover grey. Each toggle is flipped through the store and measured in
// both states; a planted toggle with the old hover-grey look calibrates the rule.
const PRESSED_MIN = 20;
const lookOf = `const lab = (css) => {
    const c = document.createElement("canvas").getContext("2d"); c.fillStyle = "#000"; c.fillStyle = css; c.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = c.getImageData(0, 0, 1, 1).data; return [r, g, b, a / 255];
  };
  const behind = (el) => { for (let e = el.parentElement; e; e = e.parentElement) { const c = lab(getComputedStyle(e).backgroundColor); if (c[3] > 0.9) return c; } return lab(getComputedStyle(document.body).backgroundColor); };
  const over = (t, b) => [0, 1, 2].map((i) => t[i] * t[3] + b[i] * (1 - t[3]));
  const toLab = ([r, g, b]) => {
    const f = (c) => ((c /= 255) <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
    const [R, G, B] = [f(r), f(g), f(b)];
    const xyz = [(R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047, R * 0.2126 + G * 0.7152 + B * 0.0722, (R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883];
    const h = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
    const [x, y, z] = xyz.map(h);
    return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
  };
  const look = (el) => { const s = getComputedStyle(el); const base = behind(el); return { fill: toLab(over(lab(s.backgroundColor), base)), border: toLab(over(lab(s.borderTopColor), base)) }; };
  const dE = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);`;
async function pressedChecks({ js }, theme) {
  await js(`await window.__mbfStore.setTheme("${theme}"); return 1;`);
  const cases = {
    "only mine": `s.filters.onlyMine = !s.filters.onlyMine;`,
    "only gone": `s.setUi({ orphanedOnly: !s.orphanedOnly });`,
    help: `s.toggleHelp();`,
  };
  // Segments of a segmented filter are judged as one control with a raised thumb, not as lone toggles.
  const measure = `${lookOf} return Object.fromEntries([...[...document.querySelectorAll("button[aria-pressed]")].filter((b) => b.getBoundingClientRect().width > 0 && !b.parentElement.matches("[role=group]")).map((b) => [b.getAttribute("aria-label"), { pressed: b.getAttribute("aria-pressed"), ...look(b) }]), ...[...document.querySelectorAll("input[role=switch]")].map((i) => i.closest("label")).filter((l) => l && l.getBoundingClientRect().width > 0).map((l) => [l.textContent.trim(), { pressed: String(l.querySelector("input").checked), ...look(l.querySelector("input").nextElementSibling ?? l) }])]);`;
  const dE = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  for (const [name, flip] of Object.entries(cases)) {
    const before = await js(`${clean} ${wait(300)} ${measure}`);
    const after = await js(`const s = window.__mbfStore; ${flip} ${wait(300)} ${measure}`);
    const changed = Object.keys(before).filter((k) => after[k] && after[k].pressed !== before[k].pressed);
    count("pressed");
    if (!changed.length) findings.push({ theme, view: `pressed-${name}`, width: 1280, kind: "pressed", finding: "no toggle changed its aria-pressed" });
    for (const k of changed) {
      const d = Math.max(dE(before[k].fill, after[k].fill), dE(before[k].border, after[k].border));
      if (d < PRESSED_MIN) findings.push({ theme, view: `pressed-${name}`, width: 1280, kind: "pressed", finding: { el: k, distance: +d.toFixed(1) } });
    }
  }
  await js(`${clean} if (window.__mbfStore.helpOpen) window.__mbfStore.toggleHelp(); return 1;`);
}
// Calibration: the look that could not be told apart (hover grey on the panel) must be reported.
{
  const d = await light.js(`${lookOf}
    const mk = (cls) => { const b = document.createElement("button"); b.className = cls; b.style.cssText = "position: fixed; top: 0; left: 0; width: 28px; height: 28px; border-width: 1px; border-style: solid"; document.querySelector("header").append(b); return b; };
    const off = mk("border-line-strong"); const on = mk("border-line-strong bg-hover");
    const r = Math.max(dE(look(off).fill, look(on).fill), dE(look(off).border, look(on).border)); off.remove(); on.remove(); return r;`);
  if (d >= PRESSED_MIN) {
    console.error(`Calibration failed: the pressed rule did not report a hover-grey toggle (distance ${d.toFixed(1)}).`);
    process.exit(2);
  }
}

// First, on a fresh page: a dialog left open by a view would rightly keep Esc for itself.
await popoverChecks(light);
await stabilityChecks(light);
await detailModeChecks(light);
await branchCopyChecks(light);

// A right click opens its menu at once, also while git is slow to answer: on a large working tree a
// git status takes seconds, and a menu that waits for it looks dead. Real mouse input, slow status.
async function menuLatencyChecks({ js, send }) {
  // The group head opens at once even while no member has a status. An entry that has one opens at
  // once while a fresh one is slow; an entry still loading opens its menu too: name and actions are known before the status.
  const cases = {
    "repo group entry": { target: `document.querySelector("nav [data-rg-id] [role=option]")`, clear: false, opens: true },
    "repo group": { target: `[...document.querySelectorAll("nav [data-rg-head]")].at(-1)`, clear: true, opens: true },
    "loading repo group entry": { target: `document.querySelector("nav [data-rg-id] [role=option]")`, clear: true, opens: true },
  };
  for (const [name, { target, clear: wipe, opens }] of Object.entries(cases)) {
    // The menu of the case before is closed first: it may lie right over the next target.
    const at = await js(`document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })); ${clean} ${wait(300)}
      ${opens ? "" : wait(2500) /* answers asked for by the cases before land first, or the entry is no longer loading */}
      ${wipe ? "for (const g of s.config.repoGroups) for (const p of g.paths) window.__mbfGitStatus.statuses.delete(p);" : ""}
      window.__statusDelay = ${opens ? 2000 : 600000}; ${wait(100)}
      const r = (${target}).getBoundingClientRect(); return [r.left + 40, r.top + r.height / 2];`);
    await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: at[0], y: at[1] });
    const started = Date.now();
    await send("Input.dispatchMouseEvent", { type: "mousePressed", x: at[0], y: at[1], button: "right", buttons: 2, clickCount: 1 });
    await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: at[0], y: at[1], button: "right", buttons: 0, clickCount: 1 });
    const ms = await js(`const t0 = performance.now(); while (!document.querySelector("[role=menu]") && performance.now() - t0 < ${opens ? 3000 : 600}) await new Promise((r) => setTimeout(r, 10)); return document.querySelector("[role=menu]") ? Math.round(performance.now() - t0) : null;`);
    const total = Date.now() - started;
    count("latency");
    if (!opens) {
      if (ms !== null) findings.push({ theme: "-", view: `menu-latency-${name}`, width: 1280, kind: "busy", finding: { issue: "a menu opened on an entry that is still loading", menu: await js(`return document.querySelector("[role=menu]")?.textContent.slice(0, 80) ?? null`) } });
      await js(`document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); return 1;`);
    } else if (ms === null || total > 400) findings.push({ theme: "-", view: `menu-latency-${name}`, width: 1280, kind: "latency", finding: { opened: ms !== null, ms: total } });
  }
  // The pointer leaves the sidebar: left there, it would open a card's tip in every later view.
  await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 1279, y: 859 });
  // The statuses come back for the views after this, as on any start.
  await js(`window.__statusDelay = 0; document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })); ${clean} await Promise.all(s.config.repoGroups.flatMap((g) => g.paths).map((p) => window.__mbfGitStatus.refreshStatus(p))); return 1;`);
}
await menuLatencyChecks(light);
await Promise.all([pressedChecks(light, "Light"), pressedChecks(dark, "Dark")]);

async function runTheme(p, theme) {
  await p.js(`await window.__mbfStore.setTheme("${theme}"); return 1;`);
  for (const [name, view] of Object.entries(views)) {
    if (only && !only.split(",").some((o) => name.includes(o))) continue;
    // The report comes at the end; stderr shows where a long run stands.
    console.error(`${new Date().toLocaleTimeString()} ${theme} ${name}`);
    if (view.menu) await p.size(1280);
    try {
      await p.js(`${view.setup} ${wait(700)} return 1;`);
      // A menu view whose menu did not open would check the page behind it and pass for nothing.
      if (view.menu && !(await p.js(`return !!document.querySelector("[role=menu], [data-quick-switch]")`))) throw new Error("the menu of this view did not open");
    } catch (e) {
      findings.push({ theme, view: name, width: 0, kind: "setup", finding: String(e).slice(0, 300) });
      continue;
    }
    try {
      await checkView(p, theme, name, view);
    } catch (e) {
      findings.push({ theme, view: name, width: 0, kind: "stalled", finding: String(e).slice(0, 300) });
    }
    if (view.teardown) await p.js(`${view.teardown} return 1;`);
  }
}
await Promise.all([runTheme(light, "Light"), runTheme(dark, "Dark")]);

async function checkView({ file, size, shot }, theme, name, view) {
  const widths = view.menu ? [1280] : [1100, 1280, 1600];
  for (const width of widths) {
    if (!view.menu) await size(width);
    const l = await file("layout-audit.js");
    count("layout");
    if (l.horizontalScroll) add(theme, name, width, "hscroll", [{ viewport: l.viewport }]);
    add(theme, name, width, "collapsed", l.collapsed);
    add(theme, name, width, "overlap", l.overlaps);
    add(theme, name, width, "placeholder", l.placeholderTruncated);
    add(theme, name, width, "truncated", l.truncatedWithoutTitle);
    add(theme, name, width, "contrast", l.lowContrast);
    add(theme, name, width, "faint", l.faintSurfaces);
    add(theme, name, width, "tight", l.tightSegments);
    add(theme, name, width, "cramped", l.cramped);
    add(theme, name, width, "edge", l.edge);
    add(theme, name, width, "segment", l.segments);
    add(theme, name, width, "busy", l.busyInteractive);
    add(theme, name, width, "clipped", l.clipped);
    add(theme, name, width, "selection", l.selection);
    add(theme, name, width, "busy-content", l.busyContent);
    add(theme, name, width, "covered", l.covered);
    if (width !== 1280) continue;
    // Bare counts and signs do not depend on the width: once per view.
    add(theme, name, width, "naked", await file("naked-audit.js"));
    count("naked");
    // The cursor does not depend on the theme: once, in the light one.
    if (theme === "Light") {
      add(theme, name, width, "pointer", await file("pointer-audit.js"));
      count("pointer");
    }
    if (shots) {
      // A menu would close on the switch to the sharper scale: it is photographed as it is.
      if (!view.menu) await size(1280, 1.5);
      await shot(join(shots, `${theme}-${name}.png`));
      if (!view.menu) await size(1280);
    }
    // Menus close on the pointer events of the tooltip audit, so it runs after the layout checks.
    if (!view.menu && view.tooltips !== false && theme === "Light") {
      const tips = await file("tooltip-audit.js");
      add(theme, name, width, "tooltip", tips.findings);
      count("tooltips", tips.checked);
      count("cut-off", tips.cutOff);
    }
    if (view.jank && theme === "Light") {
      const j = await file("jank-probe.js");
      add(theme, name, width, "jank", j.skipped ? [{ skipped: j.skipped }] : j.findings);
      count("jank");
    }
  }
}
for (const e of [...light.errors, ...dark.errors]) findings.push({ theme: "-", view: "-", width: 0, kind: "exception", finding: e.slice(0, 300) });

light.close();
dark.close();

for (const f of findings) console.log(`${f.theme} ${f.view} ${f.width} ${f.kind}: ${JSON.stringify(f.finding)}`);
console.log(`${checks} layout checks, ${findings.length} findings`);
console.log(`checks by kind: ${Object.entries(counted).map(([k, n]) => `${k} ${n}`).join(", ")}`);
process.exit(findings.length ? 1 : 0);
