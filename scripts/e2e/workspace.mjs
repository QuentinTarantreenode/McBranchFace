// The demo workspace every scenario starts from: built once per run by scripts/demo.mjs as a template, then
// copied fresh for each scenario, its remotes pointed at the copy's own server repositories.
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { ROOT } from "../run.mjs";

/** Runs git in a folder with a fixed identity and returns its output. */
export function git(cwd, ...args) {
  return execFileSync("git", ["-c", "user.email=e2e@example.com", "-c", "user.name=e2e", "-c", "commit.gpgsign=false", "-c", "core.autocrlf=false", ...args], {
    cwd,
    stdio: ["ignore", "pipe", "pipe"],
  }).toString();
}

/** The template: the demo workspace (scripts/demo.mjs) below `dir`; returns its folder. */
export function makeTemplate(dir) {
  execFileSync(process.execPath, [join(ROOT, "scripts", "demo.mjs"), dir], { stdio: ["ignore", "pipe", "inherit"] });
  return dir;
}

/** Every git working copy below a folder (a .git folder, not a linked worktree's .git file), up to a few levels. */
export function repos(dir, depth = 4) {
  if (!existsSync(dir)) return [];
  if (existsSync(join(dir, ".git"))) return [dir];
  if (depth === 0) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith("."))
    .flatMap((d) => repos(join(dir, d.name), depth - 1));
}

/**
 * A fresh copy of the template at `dest`. The clones name their server by its absolute path, so each remote is
 * pointed at the copy's own server: a scenario that pushes or deletes on the server never reaches the template.
 */
export function freshCopy(template, dest) {
  cpSync(template, dest, { recursive: true });
  for (const repo of repos(dest)) {
    const remotes = git(repo, "remote").split("\n").filter(Boolean);
    for (const r of remotes) {
      const url = git(repo, "config", "--get", `remote.${r}.url`).trim();
      const rel = relative(template, url);
      if (!rel.startsWith("..")) git(repo, "config", `remote.${r}.url`, join(dest, rel));
    }
  }
  return {
    root: dest,
    ws: join(dest, "ws"),
    wc1: join(dest, "ws", "feature1", "Acme.Core"),
    wc2: join(dest, "ws", "feature2", "Acme.Core"),
    tools: join(dest, "ws", "Tools"),
    server: join(dest, "server"),
  };
}

/**
 * Stand-ins for the provider CLIs on PATH: `az` answers with a signed-in account and three pull requests, so the
 * provider paths run without a network.
 */
export function providerTools(dir) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "az.cmd"), `@node "%~dp0az.mjs" %*\r\n`);
  writeFileSync(
    join(dir, "az.mjs"),
    `const a = process.argv.slice(2).join(" ");
const day = 86400000;
const iso = (d) => new Date(Date.now() - d * day).toISOString();
const pr = (id, title, author, extra) => ({ pullRequestId: id, title, status: "active", sourceRefName: "refs/heads/f" + id, targetRefName: "refs/heads/main",
  createdBy: { uniqueName: author, displayName: author.split("@")[0].replace(/^./, (c) => c.toUpperCase()) + " Example" }, creationDate: iso(2), reviewers: [], isDraft: false, ...extra });
let out = "[]";
if (a.startsWith("version")) out = JSON.stringify({ "azure-cli": "2.70.0", extensions: { "azure-devops": "1.0.1" } });
else if (a.startsWith("account show") && a.includes("tsv")) out = "dev@example.com";
else if (a.startsWith("account show")) out = JSON.stringify({ user: { name: "dev@example.com" } });
else if (a.startsWith("repos pr list")) out = JSON.stringify([
  pr(77, "Export keeps the order", "dev@example.com", { mergeStatus: "conflicts", reviewers: [{ uniqueName: "anna@example.com", vote: 0, isRequired: true }] }),
  pr(78, "Faster scan", "anna@example.com", { reviewers: [{ uniqueName: "dev@example.com", vote: 0, isRequired: true }] }),
  pr(79, "Docs only", "sam@example.com"),
]);
process.stdout.write(out);
`,
  );
  return dir;
}
