// Scenarios of the cleanup view: the start on the dashboard, filters, delete and undo, rules, notes, reports,
// the grid's columns, prompts and the branch's own windows.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { MOD } from "../driver.mjs";
import { git } from "../workspace.mjs";
import { cleanup, repoPath, rowMenu, rowOf, S } from "./common.mjs";

const heads = `[...document.querySelectorAll("[role=columnheader]")].map((e) => e.textContent.trim().split(/\\s/)[0]).join(",")`;
const head = (label) => ({ role: "columnheader", nameRe: `^${label}\\b` });
const headEl = (label) => `[...document.querySelectorAll("[role=columnheader]")].find((e) => e.textContent.trim().startsWith(${JSON.stringify(label)}))`;
const savedConfig = (ctx) => JSON.parse(readFileSync(join(ctx.data, "config.json"), "utf8"));

/** Confirms the open delete dialog and waits for the end of the run. */
async function confirmDelete(t, button = "Delete") {
  await t.click(["button", button, "dialog[open]"]);
  await t.when("deletion finished", `document.querySelector("dialog[open]")?.innerText.includes("Deletion finished")`, { ms: 60_000 });
}

export const CLEANUP = [
  {
    name: "onboarding",
    title: "Without folders the app welcomes and asks for one",
    workspace: "none",
    async run(t) {
      await t.when("welcome", `document.body.innerText.includes("Welcome to McBranchFace")`);
    },
  },
  {
    name: "dashboard-lens",
    title: "The start shows the dashboard; a cleanup tile opens the table on its lens",
    async run(t) {
      // The app starts on the dashboard: what is due, here the branch with commits only this copy has.
      await t.when("dashboard", `${S}.config.ui.perspective === "Dashboard" && /Next/.test(document.querySelector("main").innerText)`);
      await t.when("a next step", `document.querySelectorAll("main [role=table][aria-label=Next] > [role=row][tabindex]").length > 0`);
      await t.click({ role: "button", nameRe: "^Safe to delete \\d+$", within: "main section" });
      await t.when("lens applied", `${S}.config.ui.perspective === "Cleanup" && ${S}.filters.verdicts.join() === "Safe" && __e2e.rows().length >= 1`);
      // The Cleanup tab shows the table without a lens.
      await t.act(`${S}.resetFilters(); ${S}.setUi({ perspective: "Dashboard" }); return true;`);
      await t.click(["tab", /^Cleanup\b/, "header"]);
      await t.when("rows", `__e2e.rows().length >= 1`);
    },
  },
  {
    name: "filter-search",
    title: "A verdict filter and the search narrow the table",
    async run(t) {
      await cleanup(t);
      await t.click({ css: "button[aria-pressed]", nameRe: "^Safe\\b" });
      await t.when("only safe", `__e2e.rows().length > 0 && ${S}.visible.every((b) => b.verdict === "Safe")`);
      await t.click({ css: "button[aria-pressed]", nameRe: "^Safe\\b" });
      await t.fill(["textbox", "Branch, commit, author, #PR"], "wip");
      await t.when("search hits", `__e2e.rows().join() === "feature/wip-dirty"`, { show: `__e2e.rows()` });
      await t.fill(["textbox", "Branch, commit, author, #PR"], "");
      await t.when("all back", `__e2e.rows().length >= 3`);
    },
  },
  {
    name: "select-delete-undo",
    title: "A selected branch shows in the detail; deleting it locally asks, runs, and undo brings it back",
    async run(t) {
      await cleanup(t);
      await t.click(await rowOf(t, "feature/old-cleanup", "feature1"));
      // Two table rows and the detail header.
      await t.when("detail", `${S}.selected?.name === "feature/old-cleanup" && __e2e.names(document.body).split("feature/old-cleanup").length > 3`);
      await t.click(["button", "Delete …", "aside"]);
      await confirmDelete(t);
      await t.click(["button", "Undo", "dialog[open]"]);
      await t.when("restored", `!document.querySelector("dialog[open]") && __e2e.rows().filter((r) => r === "feature/old-cleanup").length === 2`, { ms: 60_000 });
    },
  },
  {
    name: "lock-ignore-notes",
    title: "Lock and ignore move a branch to their sections; a tag and a note are kept with it",
    async run(t) {
      await cleanup(t);
      const repo = await repoPath(t, "feature1");
      await t.click(await rowOf(t, "feature/old-cleanup", "feature1"));
      await t.click(["button", "Lock", "aside"]);
      await t.when("locked section", `__e2e.find({ role: "button", nameRe: "^Locked\\\\b" }).length > 0`);
      await t.act(`await ${S}.setLock(${JSON.stringify(repo)}, "feature/old-cleanup", false); return true;`);
      await t.click(await rowOf(t, "feature/old-cleanup", "feature1"));
      await t.click(["button", "Ignore", "aside"]);
      await t.click(["menuitem", "30 days"]);
      await t.when("ignored section", `${S}.visibleIgnored.length === 2 && __e2e.find({ role: "button", nameRe: "^Ignored\\\\b" }).length > 0`);
      await t.click({ role: "button", nameRe: "^Ignored\\b" });
      await t.click(await rowOf(t, "feature/old-cleanup", "feature1"));
      await t.fill(["textbox", "Add tag"], "release");
      await t.key("Enter");
      await t.when("pill in row", `[...document.querySelectorAll("[role=option]")].some((r) => r.innerText.includes("release"))`);
      await t.fill(["textbox", "Note & tags"], "keep until QA signs off");
      // Leaving the field saves it.
      await t.key("Tab");
      await t.when("note saved", `Object.values(${S}.config.annotations).some((a) => a.note.includes("QA"))`);
    },
  },
  {
    name: "report",
    title: "The table copies as a Markdown report",
    async run(t) {
      await cleanup(t);
      const seq = await t.mark();
      await t.click(["button", "Report"]);
      await t.click(["menuitem", "Copy as Markdown"]);
      await t.expectEvent(seq, { kind: "toast", text: "Report copied." });
      await t.when("markdown copied", `/^\\|/m.test(window.__clip ?? "")`);
    },
  },
  {
    name: "local-delete-keeps-server",
    title: "With all local branches shown, one the server still has is Safe; it goes locally only and comes back",
    async run(t, ctx) {
      await cleanup(t);
      const row = `${S}.visible.find((b) => b.name === "feature/report-export")`;
      await t.when("orphaned only at start", `${S}.orphanedOnly && !${row}`);
      await t.click(["button", "Gone only"]);
      await t.when("live branch listed", `!${S}.orphanedOnly && ${row}?.verdict === "Safe" && ${row}?.upstreamState === "Live"`);
      await t.click(await rowOf(t, "feature/report-export"));
      await t.click(["button", "Delete …", "aside"]);
      await confirmDelete(t);
      if (!git(ctx.wc1, "ls-remote", "--heads", "origin", "feature/report-export").trim()) throw new Error("the server branch went too");
      await t.click(["button", "Undo", "dialog[open]"]);
      await t.when("restored", `!document.querySelector("dialog[open]") && !!${row}`, { ms: 60_000 });
      await t.click(["button", "Gone only"]);
      await t.when("orphaned only again", `${S}.orphanedOnly && !${row}`);
    },
  },
  {
    name: "server-delete-undo",
    title: "A server branch with local copies is deleted on the server and restored by undo",
    async run(t, ctx) {
      await cleanup(t);
      await t.click(["tab", /^Online\b/]);
      await t.when("online rows", `__e2e.rows().includes("feature/report-export")`, { ms: 60_000 });
      await t.click({ css: `[role=option][data-key$="::feature/report-export"]` });
      await t.click(["button", "Delete on the server …", "aside"]);
      await confirmDelete(t, "Delete on the server");
      if (git(ctx.wc1, "ls-remote", "--heads", "origin", "feature/report-export").trim()) throw new Error("the branch is still on the server");
      await t.click(["button", "Undo", "dialog[open]"]);
      await t.when("back on the server", `!document.querySelector("dialog[open]") && __e2e.rows().includes("feature/report-export")`, { ms: 60_000 });
      if (!git(ctx.wc1, "ls-remote", "--heads", "origin", "feature/report-export").trim()) throw new Error("undo did not bring it back to the server");
    },
  },
  {
    name: "settings-export-import",
    title: "The settings export to a file, an import previews them, and the rules tab lists an ignored branch",
    async run(t, ctx) {
      await cleanup(t);
      await t.click(await rowOf(t, "feature/old-cleanup", "feature1"));
      await t.click(["button", "Ignore", "aside"]);
      await t.click(["menuitem", "30 days"]);
      const file = join(ctx.dir, "settings.json");
      await t.act(`await window.__TAURI_INTERNALS__.invoke("export_config", { path: ${JSON.stringify(file)} }); return true;`);
      const preview = await t.act(`return (await window.__TAURI_INTERNALS__.invoke("import_config", { path: ${JSON.stringify(file)} })).config.roots;`);
      if (!existsSync(file) || JSON.stringify(preview) !== JSON.stringify([ctx.ws])) throw new Error(`import preview: ${JSON.stringify(preview)}`);
      await t.act(`${S}.openSettings("rules"); return true;`);
      await t.when("rules tab", `__e2e.names(document.querySelector("dialog[open]")).includes("feature/old-cleanup")`);
    },
  },
  {
    name: "prefix-filter",
    title: "The prefix filter narrows to one prefix; its chip removes it",
    async run(t) {
      await cleanup(t);
      await t.click(["button", /^Prefixes\b/]);
      await t.click(["menuitemcheckbox", /^feature\b/]);
      await t.when("only feature", `__e2e.rows().length > 0 && ${S}.visible.every((b) => b.name.startsWith("feature/"))`);
      await t.key("Escape");
      await t.click(["button", "Remove prefix feature"]);
      await t.when("filter gone", `${S}.filters.prefixes.length === 0`);
    },
  },
  {
    name: "grid-columns",
    title: "The grid's columns move, hide and group from their head's menu; the layout survives a reload",
    async run(t, ctx) {
      await cleanup(t);
      await t.rightClick(head("Commit"));
      await t.click(["menuitem", "Move left"]);
      await t.when("moved", `${heads} === "Status,Branch,Repo,Commit,Author,PR"`, { show: heads });
      await t.rightClick(head("PR"));
      await t.click(["menuitem", "Hide column"]);
      await t.when("hidden", `${heads} === "Status,Branch,Repo,Commit,Author"`, { show: heads });
      await t.rightClick(head("Branch"));
      await t.click(["menuitemcheckbox", "Group by this column"]);
      await t.when("prefix groups", `${S}.tableGroup === "Prefix" && !!document.querySelector("[role=listbox]:not(nav *) button[aria-expanded]")`);
      // The quiet save is work the app waits for: once idle, it is on disk.
      const saved = savedConfig(ctx);
      if (!saved.ui.tableLayout.local.some((c) => c.id === "pr" && !c.visible)) throw new Error(`layout not saved: ${JSON.stringify(saved.ui.tableLayout)}`);
      await t.reload();
      await t.idle("idle after the reload", 120_000);
      // A reload starts on the dashboard like every start; the table keeps its layout for when it is opened.
      await t.click(["tab", /^Cleanup\b/, "header"]);
      await t.when("layout back", `${heads} === "Status,Branch,Repo,Commit,Author" && ${S}.tableGroup === "Prefix"`, { show: heads });
    },
  },
  {
    name: "column-filter",
    title: "A column head's filter narrows the table to one repo; its chip removes it",
    async run(t) {
      await cleanup(t);
      await t.rightClick(head("Repo"));
      await t.click(["menuitem", "Filter"]);
      // The submenu opens beside its parent: the values are in the last menu.
      const value = await t.when(
        "values",
        `document.querySelectorAll("[role=menu]").length === 2 && __e2e.nameOf([...document.querySelectorAll("[role=menu]")].at(-1).querySelector("[role=menuitemcheckbox]"))`,
      );
      await t.click(["menuitemcheckbox", value]);
      await t.when("one repo", `${S}.filters.repos.length === 1 && ${S}.visible.every((b) => b.repoPath === ${S}.filters.repos[0])`);
      await t.key("Escape");
      await t.click(["button", /^Remove filter Repo\b/]);
      await t.when("filter gone", `${S}.filters.repos.length === 0`);
    },
  },
  {
    name: "column-drag",
    title: "A column moves by dragging its head, and gets wider by dragging its edge",
    async run(t) {
      await cleanup(t);
      await t.drag(head("Author"), head("Repo"), { at: [0.4, 0.5], toAt: [0.15, 0.5] });
      await t.when("moved", `${heads} === "Status,Branch,Author,Repo,Commit,PR"`, { show: heads });
      await t.act(`${S}.setColumns([]); return true;`);
      const width = `Math.round(${headEl("Repo")}.getBoundingClientRect().width)`;
      const before = await t.js(`return ${width}`);
      const edge = await t.center(`${headEl("Repo")}.querySelector("[role=separator]")`);
      await t.drag(edge, [edge[0] + 60 * (await t.factor()), edge[1]]);
      await t.when("wider", `${width} >= ${before + 40}`, { show: width });
    },
  },
  {
    name: "copy-prompt",
    title: "A branch copies as a prompt from its context menu",
    async run(t) {
      await cleanup(t);
      await rowMenu(t, await rowOf(t, "feature/wip-dirty"), "Copy as prompt");
      await t.click(["menuitem", "Clean up the branch"]);
      await t.when("prompt", `!!window.__clip?.includes("feature/wip-dirty") && window.__clip.includes("## Steps") && window.__clip.includes("git branch -d feature/wip-dirty")`);
    },
  },
  {
    name: "prompt-templates",
    title: "A built-in prompt template changes and resets; one of your own copies from the context menu",
    async run(t) {
      await cleanup(t);
      const text = `document.querySelector("dialog[open] textarea")`;
      await t.act(`${S}.openSettings("prompts"); return true;`);
      await t.when("editor", `!!${text}?.value.includes("{{steps.merge}}")`);
      await t.fill({ css: "dialog[open] textarea" }, "Changed merge {{branch}}");
      await t.when("changed", `document.querySelector("dialog[open]").innerText.includes("changed")`);
      await t.click(["button", "Reset to default", "dialog[open]"]);
      await t.when("reset", `${text}.value.includes("{{steps.merge}}") && !document.querySelector("dialog[open]").innerText.includes("changed")`);
      await t.click(["button", "New template", "dialog[open]"]);
      await t.fill({ css: "dialog[open] textarea" }, "Review {{branch}} in {{repo}} with the skill git-review.");
      await t.when("preview", `document.querySelector("dialog[open] pre")?.textContent.startsWith("Review ")`);
      await t.click(["button", "Save", "dialog[open]"]);
      await t.when("saved", `${S}.config.prompts.length === 1 && !${S}.settingsOpen`);
      await rowMenu(t, await rowOf(t, "feature/wip-dirty"), "Copy as prompt");
      await t.click(["menuitem", "New template"]);
      await t.when(
        "own prompt",
        `window.__clip === "Review feature/wip-dirty in " + ${S}.repoByPath.get(${S}.allBranches.find((b) => b.name === "feature/wip-dirty").repoPath).name + " with the skill git-review."`,
        { show: "window.__clip" },
      );
    },
  },
  {
    name: "show-log",
    title: "A branch's log opens in Git from its context menu",
    async run(t) {
      await cleanup(t);
      await t.rightClick(await rowOf(t, "feature/wip-dirty"));
      await t.click(["menuitem", "Show log"]);
      await t.when(
        "history of the branch",
        `${S}.config.ui.perspective === "Git" && document.body.innerText.includes("Branch feature/wip-dirty") && document.body.innerText.includes("WIP: new filter")`,
        { ms: 30_000 },
      );
    },
  },
  {
    name: "interface-size",
    title: "Ctrl + makes the interface larger, Ctrl 0 sets it back",
    async run(t) {
      await cleanup(t);
      const ratio = await t.js(`return window.devicePixelRatio`);
      await t.key("=", MOD.ctrl);
      await t.when("larger", `${S}.config.ui.scale === 130 && window.devicePixelRatio > ${ratio}`);
      await t.key("0", MOD.ctrl);
      await t.when("default", `${S}.config.ui.scale === 115 && Math.abs(window.devicePixelRatio - ${ratio}) < 0.01`);
    },
  },
  {
    name: "find-commit",
    title: "A commit is found in every repo: both working copies, with the branches that contain it",
    async run(t) {
      await cleanup(t);
      await t.key("F", MOD.ctrl | MOD.shift);
      await t.fill(["textbox", "Subject, author or SHA", "dialog[open]"], "Remove dead code");
      // The same commit in feature1 and feature2, each time on its feature/old-cleanup branch.
      await t.when("hits", `__e2e.names(document.querySelector("dialog[open]")).split("\\n").filter((n) => n === "feature/old-cleanup").length >= 2`, { ms: 30_000 });
      await t.click(["button", "Close", "dialog[open]"]);
      await t.when("closed", `!${S}.commitSearchOpen`);
    },
  },
  {
    name: "group-by-name",
    title: "Grouped by branch name, the branch both copies have is one group with actions for all of them",
    async run(t) {
      // spike/new-grid is in both working copies and still on the server: it shows with the switch off.
      await t.act(`${S}.setUi({ perspective: "Cleanup", tableGroup: "Name", orphanedOnly: false }); ${S}.setScope("Local"); return true;`);
      await t.when(
        "shared names first",
        `(() => { const g = ${S}.grouped(${S}.visible); const i = g.findIndex((x) => x.label === "spike/new-grid"); return i >= 0 && g[i].items.length === 2 && g.slice(0, i).every((x) => x.items.length >= 2); })()`,
      );
      // Every group head has this button: the one of spike/new-grid.
      const actions = await t.tag(
        `[...document.querySelectorAll('button[aria-label="Actions for every repo of the group"]')].find((b) => {
          let head = b.parentElement;
          while (head && !head.querySelector(".mbf-segs[aria-label]")) head = head.parentElement;
          return head?.querySelector(".mbf-segs[aria-label]")?.getAttribute("aria-label") === "spike/new-grid";
        })`,
      );
      await t.click(actions);
      // An entry's name carries its count and description after the label.
      await t.when("menu", `__e2e.find({ role: "menuitem", nameRe: "^Check out everywhere\\\\b" }).length === 1 && __e2e.find({ role: "menuitem", nameRe: "^Create in more repos\\\\b" }).length === 1`);
      await t.key("Escape");
    },
  },
  {
    name: "todo-push",
    title: "A branch never pushed shows a push step in the detail; pushing it removes the step",
    async run(t, ctx) {
      // A branch with a commit of its own, made in a throwaway worktree: the working copy keeps its checkout.
      const tmp = join(ctx.dir, "todo-wt");
      git(ctx.wc1, "worktree", "add", "-q", "-b", "e2e/todo-push", tmp, "main");
      writeFileSync(join(tmp, "todo.txt"), "todo\n");
      git(tmp, "add", "todo.txt");
      git(tmp, "commit", "-q", "-m", "e2e: to do");
      git(ctx.wc1, "worktree", "remove", tmp);
      const row = `${S}.allBranches.find((b) => b.name === "e2e/todo-push")`;
      const repo = await repoPath(t, "feature1");
      await t.act(`${S}.setUi({ perspective: "Cleanup", tableGroup: "None", orphanedOnly: false }); ${S}.setScope("Local"); await ${S}.rescan(${JSON.stringify(repo)}); return true;`);
      await t.when("listed", `!!${row}`, { ms: 30_000 });
      await t.click(await rowOf(t, "e2e/todo-push"));
      await t.click({ css: "aside [data-todo=push] button" });
      await t.when("pushed", `${row}?.upstreamState === "Live" && !document.querySelector("aside [data-todo=push]")`, { ms: 60_000 });
      if (!git(ctx.wc1, "ls-remote", "--heads", "origin", "e2e/todo-push").trim()) throw new Error("the branch is not on the server");
    },
  },
  {
    name: "stash-apply-drop",
    title: "A stash applies to its branch's worktree, then drops behind a backup ref",
    async run(t, ctx) {
      const row = `${S}.allBranches.find((b) => b.name === "feature/wip-dirty")`;
      await t.act(`${S}.setUi({ perspective: "Cleanup", tableGroup: "None", orphanedOnly: false }); ${S}.setScope("Local"); return true;`);
      await t.click(await rowOf(t, "feature/wip-dirty"));
      await t.when("stash listed", `${row}?.stashes.length === 1 && __e2e.find({ role: "button", name: "Apply", within: "aside" }).length === 1`, { ms: 30_000 });
      const seq = await t.mark();
      await t.click(["button", "Apply", "aside"]);
      await t.expectEvent(seq, { kind: "toast", re: "^Stash applied" });
      if (!existsSync(join(ctx.wc1, "stashed.txt"))) throw new Error("the stash did not reach the worktree");
      await t.click(["button", "Drop …", "aside"]);
      await t.click(["button", "Drop …", "dialog[open]"]);
      await t.when("dropped", `${row}?.stashes.length === 0`, { ms: 30_000 });
      if (git(ctx.wc1, "stash", "list").trim()) throw new Error("the stash is still listed");
      if (!git(ctx.wc1, "for-each-ref", "refs/mcbranchface/stash/").trim()) throw new Error("no backup ref");
    },
  },
];
