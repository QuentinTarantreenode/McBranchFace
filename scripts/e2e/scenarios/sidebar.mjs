// Scenarios of the sidebar: folders and their menus, working copies and worktrees, repo groups, the selection,
// and fetches started there.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";
import { MOD } from "../driver.mjs";
import { git } from "../workspace.mjs";
import { repoPath, S } from "./common.mjs";

const savedConfig = (ctx) => JSON.parse(readFileSync(join(ctx.data, "config.json"), "utf8"));
const groupHead = (name) => `[...document.querySelectorAll("nav [data-group-head]")].find((h) => h.textContent.includes(${JSON.stringify(name)}))`;
/** The native drop arrives as a webview event with the paths; the same event is emitted here. */
const drop = (t, paths) =>
  t.act(`await window.__TAURI_INTERNALS__.invoke("plugin:event|emit", { event: "tauri://drag-drop", payload: { paths: ${JSON.stringify(paths)}, position: { x: 10, y: 10 } } }); return true;`);

async function removeFolder(t, head) {
  await t.click(await t.tag(`${head}.querySelector("button[aria-haspopup=menu]")`));
  await t.click(["menuitem", /^Remove folder from list\b/]);
  await t.click(["button", "Remove from list", "dialog[open]"]);
}

export const SIDEBAR = [
  {
    name: "folder-groups",
    title: "A folder head folds and selects its repos; the table groups by repo and folds a group",
    async run(t) {
      await t.act(`${S}.setUi({ perspective: "Cleanup" }); ${S}.setScope("Local"); return true;`);
      // The chevron of a folder head folds it; the name selects its repos, like a repo group's head.
      const chevron = { css: "nav [data-folder-head] button[aria-expanded]", nameRe: "^demo/" };
      await t.click(chevron);
      await t.when("folded", `${S}.config.ui.collapsedRoots.length === 1 && !document.querySelector("nav").innerText.includes("Tools")`);
      await t.click(chevron);
      await t.when("unfolded", `document.querySelector("nav").innerText.includes("Tools")`);
      await t.click({ css: "nav [data-folder-head] button[aria-pressed]" });
      await t.when("folder selected", `${S}.filters.repos.length > 0 && !!document.querySelector("nav [data-folder-head] button[aria-pressed=true]")`);
      await t.click({ css: "nav [data-folder-head] button[aria-pressed]" });
      await t.when("selection cleared", `${S}.filters.repos.length === 0`);
      await t.click(["button", "Group"]);
      await t.click(["menuitemcheckbox", /^Repo\b/]);
      await t.when("group header", `!!document.querySelector("[role=listbox]:not(nav *) button[aria-expanded]")`);
      await t.click(await t.tag(`document.querySelector("[role=listbox]:not(nav *) button[aria-expanded=true]")`));
      await t.when("group folded", `__e2e.rows().length === 0`);
    },
  },
  {
    name: "worktree-create-remove",
    title: "A worktree is created from the copies dialog, shows in the sidebar, and is removed from its menu",
    async run(t) {
      await t.act(`${S}.openCopies(${S}.repos.find((r) => r.info.path.includes("feature1")).info.path); return true;`);
      await t.when("dialog", `!!document.querySelector("dialog[open] input[aria-label='Folder name 1']")`);
      await t.click(["button", "Create", "dialog[open]"]);
      await t.when("created", `document.querySelector("dialog[open]")?.innerText.includes("Working copy created")`, { ms: 60_000 });
      await t.click(["button", "Close", "dialog[open] footer"]);
      // Worktree rows are groups named after their folder; the name itself is in the tooltip.
      const row = `nav [role=option][aria-label="Acme.Core-agent-1"]`;
      await t.when("sub-row", `!!document.querySelector(${JSON.stringify(row)})`, { ms: 20_000 });
      await t.rightClick({ css: row }, { at: [0.2, 0.5] });
      await t.click(["menuitem", /^Remove worktree …/]);
      const seq = await t.mark();
      await t.click(["button", "Remove", "dialog[open]"]);
      await t.when("removed", `!document.querySelector(${JSON.stringify(row)})`, { ms: 20_000 });
      // Asked once, done once: the app is idle before the click, so no git call of its own may refuse it.
      const refused = await t.js(`return __mbfTest.events.filter((e) => e.seq > ${seq} && e.text.startsWith("A git operation is running")).map((e) => e.text)`);
      if (refused.length) throw new Error(`the removal was refused: ${refused.join(" | ")}`);
    },
  },
  {
    name: "clone-copy",
    title: "An own clone is created from the copies dialog and shows up as a working copy",
    async run(t) {
      await t.act(`${S}.openCopies(${S}.repos.find((r) => r.info.path.includes("feature2")).info.path); return true;`);
      await t.click(["tab", "Own clone", "dialog[open]"]);
      await t.when("folder field", `!!document.querySelector("dialog[open] input[aria-label='Folder name 1']")`);
      await t.click(["button", "Create", "dialog[open]"]);
      await t.when("created", `document.querySelector("dialog[open]")?.innerText.includes("Working copy created")`, { ms: 60_000 });
      await t.click(["button", "Close", "dialog[open] footer"]);
      await t.when("new working copy", `${S}.repos.some((r) => r.info.path.includes("Acme.Core-agent-1")) && !${S}.scanning`, { ms: 60_000 });
    },
  },
  {
    name: "folders-drop-reorder-remove",
    title: "A dropped folder is added, a nested one changes nothing; folders reorder by drag and leave after asking",
    async run(t, ctx) {
      const extra = join(ctx.root, "..", "extra");
      mkdirSync(join(extra, "Extra.Repo"), { recursive: true });
      git(join(extra, "Extra.Repo"), "init", "-q", "-b", "main");
      git(join(extra, "Extra.Repo"), "commit", "-q", "--allow-empty", "-m", "init");
      const seq = await t.mark();
      await drop(t, [extra, join(ctx.ws, "feature1")]);
      await t.expectEvent(seq, { kind: "toast", re: "^This folder is inside" });
      await t.when("extra repo listed", `${S}.repos.some((r) => r.info.name === "Extra.Repo") && !${S}.scanning`, { ms: 60_000 });
      await t.idle();
      if (savedConfig(ctx).roots.length !== 2) throw new Error("roots: " + JSON.stringify(savedConfig(ctx).roots));
      await t.drag(await t.tag(groupHead("extra")), await t.tag(groupHead("ws")), { at: [0.4, 0.5], toAt: [0.4, 0.5], shift: [0, -8] });
      await t.when("reordered", `${S}.config.roots[0].endsWith("extra")`);
      await removeFolder(t, groupHead("extra"));
      await t.when("removed", `${S}.config.roots.length === 1 && !${S}.repos.some((r) => r.info.name === "Extra.Repo")`, { ms: 60_000 });
      if (!existsSync(join(extra, "Extra.Repo", ".git"))) throw new Error("the folder must stay on disk");
    },
  },
  {
    name: "lent-worktrees",
    title: "A folder of linked worktrees shows them with the right count while their repo stays under its own folder",
    async run(t, ctx) {
      const lent = join(ctx.root, "..", "lent");
      mkdirSync(lent, { recursive: true });
      const repo = await repoPath(t, "feature1");
      git(ctx.wc1, "worktree", "add", "-q", "-b", "e2e/lent", join(lent, "Core-lent"), "main");
      await drop(t, [lent]);
      const head = groupHead("lent");
      await t.when("folder listed", `!!${head} && !${S}.scanning`, { ms: 60_000 });
      await t.act(`await window.__mbfGitStatus.refreshStatus(${JSON.stringify(repo)}); return true;`);
      await t.when("worktree shown there", `${head}.querySelector(".mbf-count")?.textContent.trim() === "1" && !!document.querySelector('nav [role=option][aria-label="Core-lent"]')`, {
        ms: 30_000,
      });
      if (await t.js(`return ${S}.repos.some((r) => r.info.name === "Core-lent")`)) throw new Error("the worktree became a repo of its own");
      await removeFolder(t, head);
      await t.when("folder removed", `!${head}`, { ms: 60_000 });
    },
  },
  {
    name: "double-click-card",
    title: "A double click on a repo card opens its folder once and keeps the selection",
    async run(t) {
      // Observed where the sidebar hands the call over (store.safely), so no file manager opens; the IPC object
      // itself is read-only.
      await t.act(`const s = ${S}; window.__opened = []; s.safely = (fn) => (window.__opened.push(String(fn)), Promise.resolve()); s.filters.repos = []; return true;`);
      await t.doubleClick(await t.tag(`document.querySelector("nav [role=presentation] > div > button")`), { at: [0.3, 0.5] });
      await t.when("opened once", `window.__opened.length === 1 && window.__opened[0].includes("openFolder") && ${S}.filters.repos.length === 1`, { show: "window.__opened" });
    },
  },
  {
    name: "repo-groups",
    title: "Repos drag into groups, one into two; a group filters, creates a branch in all with changes, fetches and pulls",
    async run(t, ctx) {
      await t.act(`${S}.setUi({ perspective: "Cleanup", tableGroup: "None" }); ${S}.filters.repos = []; return true;`);
      await t.when("block", `!!document.querySelector("nav [data-drop=new]")`);
      // The two top cards: both in view together with the groups above them.
      const [pa, pb] = await t.js(`return [...document.querySelectorAll("nav [data-drop=out] [data-repo]")].slice(0, 2).map((c) => c.dataset.repo)`);
      const card = (path) => `[...document.querySelectorAll("nav [data-drop=out] [data-repo]")].find((c) => c.dataset.repo === ${JSON.stringify(path)})`;
      // Grabbed by the name line: the branch line below is a dropdown and starts no drag.
      const grip = (path) => t.tag(`${card(path)}.querySelector("button")`);
      const zone = { css: "nav [data-drop=new]" };
      const head = (name) => `[...document.querySelectorAll("nav [data-rg-head]")].find((h) => h.textContent.includes(${JSON.stringify(name)}))`;

      // A card onto the zone makes a group and asks for its name.
      await t.drag(await grip(pa), zone, { at: [0.3, 0.5] });
      await t.when("created", `${S}.config.repoGroups.length === 1`);
      await t.when("name field", `!!document.activeElement?.matches('nav input[aria-label="Group name"]')`);
      await t.fill(["textbox", "Group name", "nav"], "E2E");
      await t.key("Enter");
      await t.when("named", `${S}.config.repoGroups[0].name === "E2E"`);
      // The second card onto the group's head joins it.
      await t.drag(await grip(pb), await t.tag(head("E2E")), { at: [0.3, 0.5] });
      await t.when("joined", `${S}.config.repoGroups[0].paths.length === 2`);
      // The zone below the groups makes a second group; the first repo is in both.
      await t.drag(await grip(pa), zone, { at: [0.3, 0.5] });
      await t.when("second group", `${S}.config.repoGroups.length === 2 && ${S}.config.repoGroups[1].paths.length === 1`);
      await t.key("Escape");
      // Its row dragged onto the folders leaves the group again.
      await t.drag(await t.tag(`document.querySelectorAll("nav [data-rg-id]")[1].querySelector("[role=option]")`), await t.tag(card(pb)), { at: [0.3, 0.5] });
      await t.when("taken out", `${S}.config.repoGroups[1].paths.length === 0`);
      if (savedConfig(ctx).repoGroups[0].paths.length !== 2) throw new Error("groups not saved: " + JSON.stringify(savedConfig(ctx).repoGroups));

      // A right click opens the menu of the group and of an entry at once, with real mouse input.
      for (const target of [head("E2E"), `${head("E2E")}.closest("[data-rg-id]").querySelector("[role=option]")`]) {
        await t.rightClick(await t.tag(target), { at: [0.4, 0.5] });
        await t.when("menu", `!!document.querySelector("[role=menu]")`, { ms: 1500 });
        await t.key("Escape");
        await t.when("menu closed", `!document.querySelector("[role=menu]")`);
      }

      // The edge between repo and branch moves for every group, is saved, and a double click resets it.
      const edge = `${head("E2E")}.closest("[data-rg-id]").querySelector("[role=option] [role=separator]")`;
      const from = await t.center(edge);
      await t.drag(from, [from[0] + 40 * (await t.factor()), from[1]]);
      await t.when("split saved", `${S}.config.ui.groupSplit > 55`);
      if (!(savedConfig(ctx).ui.groupSplit > 55)) throw new Error("the column split was not saved");
      await t.doubleClick(await t.tag(edge));
      await t.when("split reset", `${S}.config.ui.groupSplit === 50`);

      // A click on the head filters the table to the group.
      await t.click(await t.tag(`${head("E2E")}.querySelector("button[aria-pressed]")`));
      await t.when("filtered", `${S}.filters.repos.length === 2`);

      // A change in the first repo comes along to the new branch: stash, switch, stash pop.
      const file = git(pa, "ls-files").split("\n")[0];
      writeFileSync(join(pa, file), readFileSync(join(pa, file), "utf8") + "\ne2e change\n");
      await t.act(`await window.__mbfGitStatus.refreshStatus(${JSON.stringify(pa)}); return true;`);
      const branchOf = (p) => `window.__mbfGitStatus.statuses.get(${JSON.stringify(p)})?.head.branch`;
      const before = await t.js(`return [${branchOf(pa)}, ${branchOf(pb)}]`);
      const groupActions = () => t.tag(`${head("E2E")}.querySelector('button[aria-label="Group actions"]')`);
      await t.click(await groupActions());
      await t.click(["menuitem", /^Create branch …/]);
      await t.fill({ css: `[data-quick-switch] input[placeholder="Name of the new branch"]` }, "e2e/group");
      await t.click(["button", "New branch “e2e/group”", "[role=dialog] [role=option]"]);
      await t.click(["button", "Create and switch in 2 repos", "[role=dialog]"]);
      await t.when("both on it", `${branchOf(pa)} === "e2e/group" && ${branchOf(pb)} === "e2e/group"`, { ms: 60_000 });
      if (!readFileSync(join(pa, file), "utf8").includes("e2e change")) throw new Error("the change did not come along");
      if (git(pa, "stash", "list").trim()) throw new Error("a stash was left behind");
      // Back, as the message offers, with the change.
      await t.click(["button", "Back", "[role=status]"]);
      await t.when("back", `${branchOf(pa)} === ${JSON.stringify(before[0])} && ${branchOf(pb)} === ${JSON.stringify(before[1])}`, { ms: 60_000 });
      git(pa, "checkout", "--", file);

      // Fetch and pull on the whole group, from the tiles at the top of its menu, with one message each.
      for (const [entry, re] of [["Fetch", "^Fetch: 2 repos"], ["Pull", "^Pull: "]]) {
        const seq = await t.mark();
        await t.click(await groupActions());
        // A tile names how many repos it acts on.
        await t.click(["menuitem", new RegExp(`^${entry} \\d+$`), "[role=menu]"]);
        await t.expectEvent(seq, { kind: "toast", re }, { ms: 60_000 });
      }
    },
  },
  {
    name: "sidebar-selection",
    title: "Sidebar selection: Shift spans, Ctrl adds, Esc clears, Ctrl+A takes all, arrows move",
    async run(t) {
      await t.act(`${S}.setUi({ perspective: "Cleanup" }); ${S}.filters.repos = []; return true;`);
      const cards = `[...document.querySelectorAll("nav [data-drop=out] [role=option][data-sel-path]")]`;
      const count = await t.when("cards", `${cards}.length >= 3 && ${cards}.length`);
      if (count < 3) throw new Error("too few cards");
      const card = async (i) => t.tag(`${cards}[${i}].querySelector("button")`);
      await t.click(await card(0), { at: [0.2, 0.5] });
      await t.when("one", `${S}.filters.repos.length === 1`);
      // Shift spans to the third card, Ctrl takes the second out again.
      await t.click(await card(2), { at: [0.2, 0.5], modifiers: MOD.shift });
      await t.when("range", `${cards}.slice(0, 3).every((c) => c.getAttribute("aria-selected") === "true")`);
      await t.click(await card(1), { at: [0.2, 0.5], modifiers: MOD.ctrl });
      await t.when("one out", `${cards}[1].getAttribute("aria-selected") === "false" && ${cards}[2].getAttribute("aria-selected") === "true"`);
      await t.act(`${cards}[2].focus(); return true;`);
      await t.key("Escape");
      await t.when("none", `${S}.filters.repos.length === 0`);
      await t.key("a", MOD.ctrl);
      await t.when("all", `${cards}.every((c) => c.getAttribute("aria-selected") === "true")`);
      await t.key("ArrowDown");
      await t.when("arrow selects one", `${S}.filters.repos.length === 1`);
    },
  },
  {
    name: "folder-fetch-group",
    title: "A folder fetches from its menu, counting a repo once, and makes a repo group of its repos",
    async run(t) {
      await t.act(`${S}.setUi({ perspective: "Cleanup" }); return true;`);
      const menu = () => t.tag(`document.querySelector("nav [data-folder-head] button[aria-haspopup=menu]")`);
      const seq = await t.mark();
      await t.click(await menu());
      // The tile counts the repositories it fetches: a repo and its worktree are one.
      await t.click(["menuitem", /^Fetch \d+$/, "[role=menu]"]);
      await t.expectEvent(seq, { kind: "toast", re: "^Fetch: \\d+ repos?$" }, { ms: 60_000 });
      const groups = await t.js(`return (${S}.config.repoGroups ?? []).length`);
      await t.click(await menu());
      await t.click(["menuitem", /^Create a repo group from it\b/]);
      await t.when("group", `(${S}.config.repoGroups ?? []).length === ${groups} + 1`);
    },
  },
  {
    name: "fetch-stop",
    title: "A fetch across repos stops when asked; the one that hangs is cancelled",
    async run(t, ctx) {
      // A server that takes the connection and never answers: the fetch from it hangs until stopped. The cancelled
      // git resets the socket, which is expected here.
      const silent = createServer((socket) => socket.on("error", () => {}));
      await new Promise((r) => silent.listen(0, "127.0.0.1", r));
      git(ctx.wc1, "remote", "add", "silent", `http://127.0.0.1:${silent.address().port}/x.git`);
      try {
        await t.act(`${S}.setUi({ perspective: "Cleanup" }); return true;`);
        const seq = await t.mark();
        await t.click(await t.tag(`document.querySelector("nav [data-folder-head] button[aria-haspopup=menu]")`));
        await t.click(["menuitem", /^Fetch \d+$/, "[role=menu]"], { idle: false });
        await t.when("running with stop", `!!document.querySelector('header button[aria-label="Stop"]') && /Fetch/.test(document.querySelector("header")?.innerText ?? "")`, { ms: 30_000 });
        await t.press(await t.point(["button", "Stop", "header"]));
        await t.expectEvent(seq, { kind: "toast", re: "^Fetch stopped after \\d+ of \\d+ repos$" });
        await t.idle();
        await t.when("free again", `!window.__mbfGitClaims.gitBusy`);
      } finally {
        silent.close();
      }
    },
  },
];
