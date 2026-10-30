// Scenarios of the Git perspective and of git operations started elsewhere: staging, committing, partial staging
// in the diff, the changes of all repos, branches and upstreams, the quick switch, custom commands.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { git } from "../workspace.mjs";
import { repoPath, rowOf, S } from "./common.mjs";

const toGit = (t, path) => t.act(`${S}.gitRepo = ${JSON.stringify(path)}; ${S}.setUi({ perspective: "Git" }); return true;`);
const fileRows = (name) => `[...document.querySelectorAll("[role=option]")].filter((o) => o.textContent.includes(${JSON.stringify(name)}))`;
const buttonsNamed = (text) => `[...document.querySelectorAll("button")].filter((b) => b.textContent.trim() === ${JSON.stringify(text)})`;

export const GIT = [
  {
    name: "git-stage-commit",
    title: "A change is staged and committed in Git; the new commit opens in the commit window, with search",
    async run(t) {
      await toGit(t, await repoPath(t, "feature1"));
      await t.when("changes", `document.body.innerText.includes("wip.cs")`, { ms: 30_000 });
      await t.click(["button", "Stage"]);
      // The group of its own, not the word: "Not staged" holds it too.
      await t.when("staged", `!!document.querySelector('[role=group][aria-label="Staged"]')`);
      await t.fill({ css: 'textarea[placeholder^="Commit message"]' }, "E2E: keep the filter");
      const seq = await t.mark();
      await t.click({ role: "button", nameRe: "^Commit( \\(\\d+\\))?$" });
      await t.expectEvent(seq, { kind: "toast", re: "^Committed" });
      // The commit after the last push opens in the commit window from the count flag in the row.
      await t.act(`${S}.setUi({ perspective: "Cleanup", tableGroup: "None" }); ${S}.setScope("Local"); return true;`);
      await t.click(await rowOf(t, "feature/wip-dirty"));
      await t.click(await t.tag(`[...document.querySelector('[role=option][data-key$="::feature/wip-dirty"]').querySelectorAll("button")].find((b) => /^\\d+$/.test(b.innerText.trim()))`));
      await t.when("window", `document.querySelector("dialog[open]")?.innerText.includes("E2E: keep the filter")`);
      await t.fill(["textbox", "Subject, author or SHA", "dialog[open]"], "nothing like this");
      await t.when("filtered", `!document.querySelector("dialog[open]").innerText.includes("E2E: keep the filter")`);
      await t.key("Escape");
      await t.when("closed", `!document.querySelector("dialog[open]")`);
    },
  },
  {
    name: "diff-partial-staging",
    title: "In the diff one hunk is staged, then a single line of the other; side by side and ignored whitespace block it",
    async run(t, ctx) {
      const body = Array.from({ length: 12 }, (_, i) => `line ${i + 1}`).join("\n") + "\n";
      writeFileSync(join(ctx.wc1, "list.txt"), body);
      git(ctx.wc1, "add", "list.txt");
      git(ctx.wc1, "commit", "-q", "-m", "E2E: twelve lines");
      writeFileSync(join(ctx.wc1, "list.txt"), body.replace("line 2\n", "line two\n").replace("line 11\n", "line eleven\nline 11b\n"));
      const index = () => git(ctx.wc1, "show", ":list.txt");
      await toGit(t, await repoPath(t, "feature1"));
      await t.when("file listed", `${fileRows("list.txt")}.length > 0`, { ms: 30_000 });
      await t.click(await t.tag(`${fileRows("list.txt")}[0]`));
      await t.when("two hunks", `${buttonsNamed("Stage hunk")}.length === 2`, { ms: 15_000 });
      await t.click(await t.tag(`${buttonsNamed("Stage hunk")}[0]`));
      if (!index().includes("line two")) throw new Error("the first hunk was not staged");
      if (index().includes("line eleven")) throw new Error("the second hunk was staged too");
      // The rest is still unstaged: open it and stage only the added line "line 11b".
      await t.when("unstaged rest", `${fileRows("list.txt")}.length === 2`, { ms: 15_000 });
      await t.click(await t.tag(`${fileRows("list.txt")}.at(-1)`));
      // The list refreshes before the diff below it: choosing in the old two-hunk diff would be refused as changed.
      await t.when("choosable", `${buttonsNamed("Stage hunk")}.length === 1 && document.querySelectorAll('button[aria-label="Choose line"]').length === 3`, { ms: 15_000 });
      await t.click(await t.tag(`[...document.querySelectorAll('button[aria-label="Choose line"]')].at(-1)`));
      await t.when("chosen", `document.body.innerText.includes("1 line chosen")`);
      await t.click(await t.tag(`${buttonsNamed("Stage")}[0]`));
      if (!index().includes("line 11\nline 11b")) throw new Error("the chosen line was not staged");
      if (index().includes("line eleven")) throw new Error("the unchosen replacement was staged");
      // Side by side, and with whitespace ignored the lines can no longer be chosen.
      await t.click(["button", "Side by side"]);
      await t.when("split", `${S}.config.ui.diffSplit === true && document.querySelectorAll("[role=listbox][aria-label=Diff] .grid").length > 0`);
      await t.click(["button", "Whitespace"]);
      await t.click({ css: "[role=menuitemcheckbox], [role=menuitem]", nameRe: "^Ignore all\\b" });
      await t.when("no handles", `document.querySelectorAll('button[aria-label="Choose line"]').length === 0`, { ms: 15_000 });
      await t.click(["button", "Whitespace"]);
      await t.click({ css: "[role=menuitemcheckbox], [role=menuitem]", nameRe: "^Keep\\b" });
      await t.act(`${S}.setUi({ diffSplit: false }); return true;`);
      await t.when("handles back", `document.querySelectorAll('button[aria-label="Choose line"]').length > 0`, { ms: 15_000 });
    },
  },
  {
    name: "changes-all-repos",
    title: "The changes of all repos list both working copies; a file opens its repo, staging acts there",
    async run(t) {
      const [pa, pb] = await t.js(`return ${S}.repos.slice(0, 2).map((r) => r.info.path)`);
      writeFileSync(join(pa, "e2e-all-a.txt"), "a\n");
      writeFileSync(join(pb, "e2e-all-b.txt"), "b\n");
      await t.act(
        `${S}.filters.repos = []; ${S}.gitRepo = ${JSON.stringify(pa)}; ${S}.setUi({ perspective: "Git", gitChangesAll: true }); await window.__mbfGitStatus.refreshStatus(${JSON.stringify(pa)}); await window.__mbfGitStatus.refreshStatus(${JSON.stringify(pb)}); return true;`,
      );
      await t.click(["tab", /^Changes\b/]);
      const list = `document.querySelector('[role=listbox][aria-label="Changed files"]')`;
      const fileB = `[...${list}.querySelectorAll("[role=option]")].find((o) => o.textContent.includes("e2e-all-b.txt"))`;
      await t.when("both files", `${list}?.textContent.includes("e2e-all-a.txt") && ${list}.textContent.includes("e2e-all-b.txt")`, { ms: 15_000 });
      // A file of the second copy opens that copy.
      await t.click(await t.tag(fileB));
      await t.when("opened", `${S}.gitRepo === ${JSON.stringify(pb)}`);
      // Back to the first; staging the second copy's file from its row acts in the second copy.
      await t.act(`${S}.gitRepo = ${JSON.stringify(pa)}; return true;`);
      await t.click(await t.tag(`${fileB}.querySelector('button[aria-label="Stage"]')`));
      await t.when("staged there", `window.__mbfGitStatus.statuses.get(${JSON.stringify(pb)})?.entries.some((e) => e.path === "e2e-all-b.txt" && e.staged)`, { ms: 15_000 });
      if (git(pa, "diff", "--cached", "--name-only").includes("e2e-all")) throw new Error("staged in the wrong repo");
      if (!git(pb, "diff", "--cached", "--name-only").includes("e2e-all-b.txt")) throw new Error("not staged in the second copy");
    },
  },
  {
    name: "upstream-in-git",
    title: "Git's branch list shows the upstream ref where it exists and a cloud where the server deleted it",
    async run(t) {
      await toGit(t, await repoPath(t, "feature1"));
      await t.click(["tab", /^Branches\b/]);
      await t.when("gone as cloud", `!!document.querySelector('[role=img][aria-label="Deleted on the server"]')`, { ms: 20_000 });
      await t.when("present as ref", `[...document.querySelectorAll("[role=listbox]:not(nav *) [role=option] [aria-label]")].some((e) => /^origin\\//.test(e.getAttribute("aria-label")))`);
    },
  },
  {
    name: "quick-switch-new-branch",
    title: "The sidebar's quick switch creates a branch and switches to it, then back to main in this repo only",
    async run(t) {
      const tools = `${S}.repos.find((r) => r.info.name === "Tools").info.path`;
      const headOf = `window.__mbfGitStatus.statuses.get(${tools})?.head.branch`;
      await t.act(`${S}.setUi({ perspective: "Cleanup" }); ${S}.filters.repos = []; return true;`);
      await t.click(["button", "Branch of Tools", "nav"]);
      await t.fill({ css: `[role=dialog] input[placeholder="Search a branch or type a new name"]` }, "e2e/quick");
      await t.click(["button", "New branch “e2e/quick”", "[role=dialog] [role=option]"]);
      await t.click(["button", "Create and switch", "[role=dialog]"]);
      await t.when("on the new branch", `${headOf} === "e2e/quick"`, { ms: 30_000 });
      // Back to main: other repos have main too and are offered, but only this one switches.
      await t.click(["button", "Branch of Tools", "nav"]);
      await t.click(await t.tag(`document.querySelector('[role=dialog] [role=option] button [aria-label="main"]')?.closest("button")`));
      await t.click(["button", "Switch", "[role=dialog]"]);
      await t.when("back on main", `${headOf} === "main"`, { ms: 30_000 });
    },
  },
  {
    name: "quick-switch-filters",
    title: "The quick switch's list filters to server and own branches",
    async run(t) {
      const tab = (name) => `[...document.querySelectorAll("[role=dialog] [role=tab]")].find((b) => b.textContent.trim().startsWith(${JSON.stringify(name)}))`;
      const count = (name) => `Number(${tab(name)}.querySelector("span:last-child").textContent)`;
      const options = `document.querySelectorAll("[role=dialog] [role=option]").length`;
      await t.act(`${S}.setUi({ perspective: "Cleanup" }); ${S}.filters.repos = []; return true;`);
      await t.click(["button", "Branch of Tools", "nav"]);
      await t.click(["tab", /^Server\b/, "[role=dialog]"]);
      await t.when(
        "server only",
        `${options} === ${count("Server")} && [...document.querySelectorAll("[role=dialog] [role=option] [aria-label]")].every((o) => o.getAttribute("aria-label").startsWith("origin/"))`,
      );
      await t.click(["tab", /^Mine\b/, "[role=dialog]"]);
      await t.when("own only", `${options} === ${count("Mine")}`);
      await t.click(["tab", /^All\b/, "[role=dialog]"]);
      await t.key("Escape");
      await t.when("closed", `!document.querySelector("[role=dialog] [role=tab]")`);
    },
  },
  {
    name: "one-repo-selection",
    title: "One repo selection serves cleanup and Git",
    async run(t) {
      const tools = `${S}.repos.find((r) => r.info.name === "Tools").info.path`;
      await t.act(`${S}.setUi({ perspective: "Cleanup" }); ${S}.filters.repos = []; return true;`);
      await t.click(await t.tag(`document.querySelector('nav button[aria-label="Branch of Tools"]').closest("[role=presentation]").querySelector("button")`), { at: [0.3, 0.5] });
      await t.when("filtered", `${S}.filters.repos.join() === ${tools}`);
      await t.act(`${S}.setUi({ perspective: "Git" }); return true;`);
      await t.when("git shows it", `${S}.gitRepo === ${tools}`);
      await t.act(`${S}.setUi({ perspective: "Cleanup" }); return true;`);
      await t.when("still filtered", `${S}.filters.repos.join() === ${tools}`);
    },
  },
  {
    name: "custom-command",
    title: "A custom command is created in the settings and runs from a repo's context menu, with its output",
    async run(t) {
      await t.act(`${S}.openSettings("commands"); return true;`);
      await t.click(["button", "New command", "dialog[open]"]);
      await t.when("editor", `!!document.querySelector("dialog[open] textarea")`);
      await t.click(["button", "Save", "dialog[open]"]);
      await t.when("saved", `${S}.config.commands.length === 1 && !${S}.settingsOpen`);
      await t.rightClick(await t.tag(`[...document.querySelectorAll("nav button")].find((b) => b.innerText.includes("feature1"))`), { at: [0.3, 0.5] });
      await t.click(["menuitem", /^Commands\b/]);
      await t.click(["menuitem", /^New command\b/]);
      await t.when("run finished", `window.__mbfCommandRuns.runs[0]?.status === "ok" && window.__mbfCommandRuns.runs[0].lines.length > 0`, { ms: 60_000 });
      await t.click({ role: "button", nameRe: "^New command\\b", within: "section[aria-label]" });
      await t.when("output", `!!document.querySelector("section[aria-label='New command'] [role=listbox]")?.innerText.includes("On branch")`);
    },
  },
  {
    name: "branch-takeover",
    title: "A folder takes a branch over: suggested where only some repos have it, created in the rest without switching",
    async run(t) {
      const paths = await t.js(`return ${S}.repos.filter((r) => r.result && !r.result.error).map((r) => r.info.path)`);
      const [first, ...rest] = paths;
      git(first, "branch", "e2e/adopt");
      const heads = rest.map((p) => git(p, "rev-parse", "--abbrev-ref", "HEAD").trim());
      await t.act(`${S}.setUi({ perspective: "Cleanup" }); ${S}.filters.repos = []; await ${S}.rescan(${JSON.stringify(first)}); return true;`);
      await t.rightClick({ css: "nav [data-folder-head]" }, { at: [0.3, 0.5] });
      await t.click(["menuitem", /^Take a branch over …/]);
      await t.fill({ css: "[data-quick-switch] input" }, "e2e/adopt");
      const suggestion = `[...document.querySelectorAll("[data-quick-switch] [role=option] button")].find((b) => b.textContent.includes("adopt") && b.textContent.includes("in 1/"))`;
      await t.when("suggested", `!!${suggestion}`);
      await t.click(await t.tag(suggestion));
      const seq = await t.mark();
      await t.click(["button", `Only create in ${rest.length} repos`, "[data-quick-switch]"]);
      await t.expectEvent(seq, { kind: "op", ok: true, re: "create" });
      for (const [i, p] of rest.entries()) {
        git(p, "rev-parse", "--verify", "-q", "e2e/adopt");
        const head = git(p, "rev-parse", "--abbrev-ref", "HEAD").trim();
        if (head !== heads[i]) throw new Error(`${p} switched to ${head}`);
      }
    },
  },
];
