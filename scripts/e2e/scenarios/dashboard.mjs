// Scenarios of the dashboard: its next steps and the pull requests of a provider.
import { basename } from "node:path";
import { git } from "../workspace.mjs";
import { S } from "./common.mjs";

const lines = `[...document.querySelectorAll("main [role=table][aria-label=Next] > [role=row][tabindex]")]`;

export const DASHBOARD = [
  {
    name: "dashboard-steps",
    title: "A next step opens what it names; put aside it stays away until shown again",
    async run(t) {
      await t.act(`${S}.filters.repos = []; ${S}.setUi({ perspective: "Dashboard", dashboardDismissed: {} }); return true;`);
      // A line that names branches opens the cleanup table on exactly those, with the reason as a chip.
      const named = `${lines}.find((li) => /not pushed|safe to delete|merged/i.test(li.innerText))`;
      await t.when("a step naming branches", `!!${named}`, { ms: 30_000 });
      // The line itself, beside its action buttons: on what it says.
      await t.click(await t.tag(named), { at: [0.15, 0.5] });
      await t.when("focused", `${S}.config.ui.perspective === "Cleanup" && !!${S}.filters.focus && /From the dashboard:/.test(document.querySelector("main")?.innerText ?? "")`);
      const [shown, named_] = await t.js(`return [(${S}.scope === "Online" ? ${S}.onlineVisible : ${S}.visible).length, ${S}.filters.focus.keys.length]`);
      if (shown !== named_) throw new Error(`focus shows ${shown} of ${named_} branches`);
      await t.click(["button", "Remove dashboard filter", "main"]);
      await t.when("focus removed", `!${S}.filters.focus`);
      // Uncommitted files: the line itself leads to the changes in Git.
      await t.act(`${S}.setUi({ perspective: "Dashboard" }); return true;`);
      const row = `${lines}.find((li) => /not committed/i.test(li.innerText))`;
      await t.when("uncommitted step", `!!${row}`, { ms: 30_000 });
      await t.click(await t.tag(row), { at: [0.15, 0.5] });
      await t.when("in Git", `${S}.config.ui.perspective === "Git"`);
      await t.act(`${S}.setUi({ perspective: "Dashboard" }); return true;`);
      await t.when("back", `!!${row}`);
      const before = await t.js(`return ${lines}.length`);
      await t.click(await t.tag(`${row}.querySelector('button[aria-label="Put aside"]')`));
      await t.when("put aside", `!${row} || ${lines}.length < ${before}`);
      await t.click(["button", "Show the hidden steps again", "main"]);
      await t.when("shown again", `!!${row}`);
    },
  },
  {
    name: "pull-requests",
    title: "Pull requests from the provider: mine, those waiting for my review, and a conflict",
    async run(t) {
      const path = await t.js(`return ${S}.repos.find((r) => r.result && !r.result.error).info.path`);
      const local = git(path, "config", "remote.origin.url").trim();
      const azure = `https://dev.azure.com/acme/Demo/_git/${basename(path)}`;
      // The repo reads as an Azure DevOps repo; git still fetches from the folder behind it.
      git(path, "config", "remote.origin.url", azure);
      git(path, "config", `url.${local}.insteadOf`, azure);
      await t.act(`${S}.filters.repos = []; await ${S}.scan(true); ${S}.setUi({ perspective: "Dashboard", dashboardPrs: "mine", dashboardDismissed: {} }); return true;`);
      await t.when("scanned", `!${S}.scanning && ${S}.repoByPath.get(${JSON.stringify(path)})?.provider === "Azure"`, { ms: 120_000 });
      const next = `${lines}.map((li) => li.innerText).join("\\n")`;
      await t.when("conflict and review", `(() => { const x = ${next}; return x.includes("Conflict: #77") && x.includes("Review: #78"); })()`, { ms: 60_000, show: next });
      // "Mine" lists my pull request and the one for my review; "All" adds the third.
      const tile = `[...document.querySelectorAll("main section")].find((x) => x.querySelector("h2")?.innerText === "Pull requests")`;
      // Mine says "you"; the others by the name the provider gives.
      await t.when("mine", `(() => { const x = ${tile}?.innerText ?? ""; return x.includes("#77") && x.includes("#78") && !x.includes("#79") && /\\byou\\b/.test(x) && x.includes("Anna Example"); })()`);
      await t.click(await t.tag(`[...${tile}.querySelectorAll("button")].find((b) => b.innerText.trim() === "All")`));
      await t.when("all", `(${tile}?.innerText ?? "").includes("#79")`);
    },
  },
];
