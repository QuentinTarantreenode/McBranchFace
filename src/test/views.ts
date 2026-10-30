// The app as the view tests start it: the real stores on the simulated backend, one module instance for
// the whole file (a component, its icons and Testing Library must share a single Svelte runtime, so the
// stores are reset instead of loaded again). `start` opens the workspace below: two working copies of
// one repo, one with a branch that has everything a detail can show, a linked worktree, a lock, an
// ignore, a note and the tools.
import { expect } from "vitest";
import { configure } from "@testing-library/svelte";
import { testApi } from "$lib/app/testHook.svelte";
import { probe } from "$lib/probe";
import { store } from "$lib/store.svelte";
import { menu } from "$lib/ui/menu.svelte";
import {
  branch,
  branchRow,
  commit,
  config,
  entry,
  fileDiff,
  installBackend,
  logEntry,
  pullRequest,
  remote,
  repo,
  repoStatus,
  result,
  statusEntry,
  tool,
  worktree,
  type Backend,
  type Handler,
} from "./backend";
import { WAIT_MS, waitFor } from "./wait";

// findBy* waits as long as waitFor.
configure({ asyncUtilTimeout: WAIT_MS });

// Every start loads the second part of the dictionary: loaded with the file, not inside its first test.
await import("$lib/i18n/en.more");

export const A = repo("C:/ws/a", { provider: "GitHub", links: { home: "https://x/a", pullRequests: "https://x/a/pulls", branch: "https://x/a/tree/{branch}" } });
export const A2 = repo("C:/ws/copy/a", { identity: A.identity });

export const TOOLS = [
  tool("Git", { required: true, version: "2.54.0", minVersion: "2.30", downloadUrl: "https://git-scm.com" }),
  tool("AzureCli", { state: "NotLoggedIn", version: "2.60.0", downloadUrl: "https://az", commands: [{ action: "Login", command: "az login" }] }),
  tool("GitHubCli", { version: "2.83.0", account: "octocat", downloadUrl: "https://gh" }),
  tool("GitHubDesktop", { state: "Missing", downloadUrl: "https://desktop", commands: [{ action: "Install", command: "winget install GitHub.GitHubDesktop" }] }),
];

export const STATUS = repoStatus(A.path, {
  head: { branch: "feature/x", oid: "abc", upstream: "origin/feature/x", ahead: 1, behind: 2 },
  entries: [
    statusEntry("src/a.ts", { staged: "Modified", unstaged: null }),
    statusEntry("b.txt"),
    statusEntry("new.txt", { unstaged: null, untracked: true }),
    statusEntry("c.txt", { unstaged: null, conflicted: true }),
  ],
  worktrees: [worktree(A.path, { branch: "feature/x", head: "abc", isMain: true }), worktree("C:/wt", { branch: "hotfix", head: "def" })],
});

export const DIFF = fileDiff("b.txt", {
  added: 1,
  removed: 1,
  hunks: [
    {
      header: "@@ -1,2 +1,2 @@",
      section: "",
      oldStart: 1,
      oldLines: 2,
      newStart: 1,
      newLines: 2,
      lines: [
        { kind: "Del", oldNo: 1, newNo: null, text: "old", changed: [], eol: false },
        { kind: "Add", oldNo: null, newNo: 1, text: "new", changed: [], eol: false },
        { kind: "Context", oldNo: 2, newNo: 2, text: "same", changed: [], eol: false },
      ],
    },
  ],
});

const WORKSPACE: Record<string, Handler> = {
  get_config: () =>
    config({
      language: "En",
      locks: [{ identity: A.identity, branch: null }],
      ignores: [{ identity: A.identity, branch: "x", scope: "Local", until: null }],
      annotations: { [A.identity]: { note: "core repo", tags: ["core"] } },
    }),
  cached_results: () => [
    result(A, [
      branch(A.path, "x", {
        verdict: "Unsafe",
        unpushedCommits: [commit("u1", { subject: "local only" })],
        stashes: [{ selector: "stash@{0}", sha: "st", message: "wip" }],
        worktree: { path: "C:/wt", isMain: false, files: [{ path: "f.txt", kind: "Unstaged" }] },
        ownCommits: [commit("o1", { subject: "own" })],
        ownCommitCount: 3,
        pullRequest: pullRequest(5, { title: "PR five", sourceRef: "refs/heads/x" }),
        checks: [
          { kind: "Merged", outcome: "Fail", code: { code: "NoMergeEvidence", p: { own: 3, base: "refs/remotes/origin/main" } } },
          { kind: "Pushed", outcome: "Pass", code: { code: "AllPushed", p: { upstream: "refs/remotes/origin/x", sha: "s", source: "Snapshot" } } },
        ],
      }),
      branch(A.path, "blocked", { verdict: "Blocked", worktree: { path: A.path, isMain: true, files: [] }, mergeEvidence: { kind: "Ancestor", target: "refs/remotes/origin/main" } }),
    ], [remote(A.path, "x"), remote(A.path, "old", { merged: false, lastCommitAt: 1 })], { warnings: [{ code: "PrListCapped", p: { limit: 1000 } }], fetchErrorKind: "Network" }),
    result(A2, [branch(A2.path, "x")]),
  ],
  environment_status: () => TOOLS,
  deleted_entries: () => [entry({ repoPath: A.path, name: "gone" }), entry({ repoPath: A.path, name: "back" }, { id: "e2", restoredAt: 5, remote: "origin", forced: true })],
  repo_status: () => STATUS,
  working_diff: () => DIFF,
  git_log: () => [logEntry("c1", { parents: ["p"], subject: "first", refs: ["HEAD -> feature/x", "origin/feature/x", "tag: v1"] })],
  commit_detail: () => ({ entry: logEntry("c1", { parents: ["p", "q"], subject: "first" }), body: "body", files: [{ path: "src/a.ts", origPath: null, change: "Modified" }] }),
  commit_diff: () => DIFF,
  branch_list: () => ({ local: [branchRow("feature/x", { isHead: true, ahead: 1 }), branchRow("old", { gone: true })], remote: [branchRow("origin/main")] }),
  app_info: () => ({ version: "0.5.0", builtAt: 1, appDir: "C:/app", crashLogs: ["C:/app/crash-1.log"], diagnosticsLog: "C:/app/diagnostics.log" }),
  github_desktop_available: () => true,
};

/** The backend of the running test; a live binding, set by `start` and `startApp`. */
export let backend: Backend;

/** Until nothing runs or waits any more: no command in flight, no scan, no timer some work waits for. */
export const settled = () => testApi.when(testApi.idle, WAIT_MS);

/** The app with an empty config in English and `handlers`, started and settled. */
export async function startApp(handlers: Record<string, Handler> = {}) {
  // The stores are shared by the tests of a file: a command an earlier test left unanswered would keep this
  // start from ever being quiet. Such a test answers what it holds back once it is over (onTestFinished).
  await waitFor(() => expect(probe.invokes, "commands an earlier test left unanswered").toBe(0));
  backend = installBackend({ get_config: () => config({ language: "En" }), ...handlers });
  store.resetForTests();
  // The menu is no store of the app; one a test left open would answer the next test's wait for a menu.
  menu.close(false);
  await store.init();
  await settled();
  return backend;
}

/** The app on the workspace, started and settled; `handlers` replace or add commands. */
export const start = (handlers: Record<string, Handler> = {}) => startApp({ ...WORKSPACE, ...handlers });

/** A custom command for every repo, offered on branches too. */
export const CMD = { id: "c1", name: "Status", script: "git status {{path}}", shell: "Default", mode: "Background", repos: [], branches: true, confirm: false };

/** The entries of the open menu once it has one (an item or a tile) with this label: a menu loads its code on its first opening. */
export async function menuWith(label: string) {
  const labels = () => (menu.current?.entries ?? []).flatMap((e) => (typeof e !== "object" ? [] : "tiles" in e ? e.tiles.map((x) => x.label) : "label" in e ? [e.label] : []));
  await waitFor(() => expect(labels()).toContain(label));
  return menu.current!.entries;
}

/** The rows of the open branch switcher; sidebar rows are options too. */
export const switchOptions = () => [...document.querySelectorAll<HTMLElement>("[data-quick-switch] [role=option]")];
