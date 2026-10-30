// Demo workspace for UI checks and the E2E run: two working copies of one repository, gone
// branches locally, merged / inactive / active branches on the server, a colleague's branch and a
// second, unrelated repository. Everything lives below the given folder.
//
// With --large, the second working copy gets well over a hundred more branches in the name shapes teams use
// (release folders, wip/…, versioned namespaces such as 2.4/…), many of them gone, and the server keeps a long list: enough
// rows to scroll, group and filter.
//
//   node scripts/demo.mjs <folder> [--large]
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync, appendFileSync } from "node:fs";
import { join } from "node:path";

const root = process.argv[2];
if (!root) throw new Error("usage: node scripts/demo.mjs <folder> [--large]");
const large = process.argv.includes("--large");

const ME = { GIT_AUTHOR_NAME: "Dev", GIT_AUTHOR_EMAIL: "dev@example.com", GIT_COMMITTER_NAME: "Dev", GIT_COMMITTER_EMAIL: "dev@example.com" };
const OLD = { GIT_AUTHOR_DATE: "2026-01-05T10:00:00", GIT_COMMITTER_DATE: "2026-01-05T10:00:00" };

function g(cwd, args, env = {}) {
  return execFileSync("git", ["-c", "commit.gpgsign=false", "-c", "core.autocrlf=false", ...args], {
    cwd,
    env: { ...process.env, ...ME, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  }).toString();
}
function commit(cwd, file, content, msg, env = {}) {
  writeFileSync(join(cwd, file), content + "\n");
  g(cwd, ["add", file]);
  g(cwd, ["commit", "-q", "-m", msg], env);
}

rmSync(root, { recursive: true, force: true });
mkdirSync(root, { recursive: true });
const origin = join(root, "origin", "Acme.Core.git");
mkdirSync(origin, { recursive: true });
g(origin, ["init", "-q", "--bare", "-b", "main"]);
const server = join(root, "server");
g(root, ["clone", "-q", origin, server]);
commit(server, "readme.md", "Acme core", "Initial import");
commit(server, "app.cs", "v1", "Add application shell");
g(server, ["push", "-q", "-u", "origin", "main"]);

// Merged by fast-forward, then kept on the server.
g(server, ["switch", "-q", "-c", "feature/report-export", "main"]);
commit(server, "export.cs", "export", "Report export: CSV and XLSX");
g(server, ["push", "-q", "-u", "origin", "feature/report-export"]);
g(server, ["switch", "-q", "main"]);
g(server, ["merge", "-q", "--ff-only", "feature/report-export"]);
g(server, ["push", "-q", "origin", "main"]);

// Squash merged, branch still on the server.
g(server, ["switch", "-q", "-c", "bugfix/null-date", "main"]);
commit(server, "date.cs", "fix 1", "Null date in order list");
commit(server, "date.cs", "fix 2", "Null date: also in the detail view");
g(server, ["push", "-q", "-u", "origin", "bugfix/null-date"]);
g(server, ["switch", "-q", "main"]);
g(server, ["merge", "-q", "--squash", "bugfix/null-date"]);
g(server, ["commit", "-q", "-m", "Merged PR 311: Null date"]);
g(server, ["push", "-q", "origin", "main"]);

// A colleague: merged, but the branch was left on the server.
g(server, ["switch", "-q", "-c", "feature/colleague-fix", "main"]);
commit(server, "colleague.cs", "c", "Colleague: fix rounding", { GIT_AUTHOR_NAME: "Colleague", GIT_AUTHOR_EMAIL: "colleague@example.com" });
g(server, ["push", "-q", "-u", "origin", "feature/colleague-fix"]);
g(server, ["switch", "-q", "main"]);
g(server, ["merge", "-q", "--ff-only", "feature/colleague-fix"]);
g(server, ["push", "-q", "origin", "main"]);

// Old and unmerged: inactive. Fresh and unmerged: active.
g(server, ["switch", "-q", "-c", "spike/new-grid", "main"]);
commit(server, "grid.cs", "grid", "Spike: virtual grid", OLD);
g(server, ["push", "-q", "-u", "origin", "spike/new-grid"]);
g(server, ["switch", "-q", "-c", "feature/checklist-ui", "main"]);
commit(server, "checklist.cs", "ui", "Checklist UI: first draft");
g(server, ["push", "-q", "-u", "origin", "feature/checklist-ui"]);
g(server, ["switch", "-q", "main"]);

// Two working copies of the same repository.
const wc1 = join(root, "ws", "feature1", "Acme.Core");
const wc2 = join(root, "ws", "feature2", "Acme.Core");
for (const wc of [wc1, wc2]) {
  mkdirSync(join(wc, ".."), { recursive: true });
  g(root, ["clone", "-q", origin, wc]);
  g(wc, ["config", "user.email", ME.GIT_AUTHOR_EMAIL]);
  g(wc, ["config", "user.name", ME.GIT_AUTHOR_NAME]);
}

// Working copy 1: tracks the merged branch, plus local work that becomes gone.
g(wc1, ["switch", "-q", "-c", "feature/report-export", "origin/feature/report-export"]);
g(wc1, ["switch", "-q", "-c", "feature/old-cleanup", "main"]);
commit(wc1, "cleanup.cs", "c", "Remove dead code");
g(wc1, ["push", "-q", "-u", "origin", "feature/old-cleanup"]);
g(wc1, ["switch", "-q", "-c", "spike/new-grid", "origin/spike/new-grid"]);
g(wc1, ["switch", "-q", "-c", "feature/wip-dirty", "main"]);
commit(wc1, "wip.cs", "w", "WIP: new filter");
g(wc1, ["push", "-q", "-u", "origin", "feature/wip-dirty"]);
// A stash on it, to apply and drop from the detail.
writeFileSync(join(wc1, "stashed.txt"), "stashed\n");
g(wc1, ["stash", "push", "-q", "--include-untracked", "-m", "WIP: stashed idea"]);
// Stays checked out with an unsaved change: Unsafe in the cleanup view.
appendFileSync(join(wc1, "wip.cs"), "unsaved\n");

// Working copy 2: tracks the active branch, the inactive spike and the cleanup branch.
g(wc2, ["fetch", "-q"]);
g(wc2, ["switch", "-q", "-c", "feature/checklist-ui", "origin/feature/checklist-ui"]);
g(wc2, ["switch", "-q", "-c", "spike/new-grid", "origin/spike/new-grid"]);
g(wc2, ["switch", "-q", "-c", "feature/old-cleanup", "origin/feature/old-cleanup"]);
g(wc2, ["switch", "-q", "main"]);

// The server deletes two merged branches: they become gone locally.
g(server, ["fetch", "-q"]);
g(server, ["merge", "-q", "--ff-only", "origin/feature/old-cleanup"]);
g(server, ["push", "-q", "origin", "main"]);
g(server, ["push", "-q", "origin", "--delete", "feature/old-cleanup"]);
g(server, ["push", "-q", "origin", "--delete", "feature/wip-dirty"]);

if (large) {
  // Common name shapes: release folders, versioned namespaces, personal work branches.
  const shapes = [
    (i) => `release/Contoso/${(i % 9) + 1}.${(i % 27) + 1}/main`,
    (i) => `wip/dev-${(i % 9) + 1}-${(i % 27) + 1}-contoso-sync-${i}`,
    (i) => `bugfix/settings-menu-js-runtime-${i}`,
    (i) => `feature/report-export-action-${i}`,
    (i) => `codex/tab-order-for-forms-${i}`,
    (i) => `2.4/hotfix-${i}`,
    (i) => `2.4/feature/sync-${(i % 9) + 1}-${i}`,
    (i) => `stresstest/load-${i}`,
  ];
  const names = Array.from({ length: 128 }, (_, i) => shapes[i % shapes.length](i));
  // Most point at main (merged, Safe once gone); every fifth gets a commit of its own.
  for (const [i, n] of names.entries()) {
    if (i % 5 === 0) {
      g(wc2, ["switch", "-q", "-c", n, "main"]);
      commit(wc2, `large-${i}.txt`, n, `Work on ${n}`, i % 2 ? OLD : {});
    } else {
      g(wc2, ["branch", n, "main"]);
    }
  }
  g(wc2, ["switch", "-q", "main"]);
  g(wc2, ["push", "-q", "-u", "origin", ...names]);
  // Two thirds leave the server: gone locally. The rest stay as server branches.
  const gone = names.filter((_, i) => i % 3 !== 0);
  g(wc2, ["push", "-q", "origin", "--delete", ...gone]);
  g(wc2, ["fetch", "-q", "--prune"]);
}

// A second, unrelated repository.
const toolsOrigin = join(root, "origin", "Tools.git");
mkdirSync(toolsOrigin, { recursive: true });
g(toolsOrigin, ["init", "-q", "--bare", "-b", "main"]);
const tools = join(root, "ws", "Tools");
g(root, ["clone", "-q", toolsOrigin, tools]);
commit(tools, "tool.ps1", "t", "Build helper");
g(tools, ["push", "-q", "-u", "origin", "main"]);

console.log(join(root, "ws"));
