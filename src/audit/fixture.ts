// Demo data for the headless audit: several roots, working copies of one repo, a linked and a
// detached worktree, and branch names in the shapes real teams use (namespaces, long rests).
import { emit } from "@tauri-apps/api/event";
import type { Handler } from "../test/backend";
import { branch, config, remote, repo, result } from "../test/backend";
import type { BranchReport } from "$lib/bindings/BranchReport";
import type { RemoteBranchReport } from "$lib/bindings/RemoteBranchReport";
import type { Verdict } from "$lib/bindings/Verdict";
import type { OnlineVerdict } from "$lib/bindings/OnlineVerdict";

// Deterministic, so a finding reproduces on every run.
let seed = 7;
/** Branches of agents' worktrees: shared prefixes, generated suffixes, as a team of agents leaves them. */
const AGENT_BRANCHES = [
  ...Array.from({ length: 10 }, (_, i) => `worktree-agent-a${(0x1280172 + i * 7919).toString(16)}f04f4e9b`),
  "rework-substitution", "rework-icons", "rework-live-backend", "rework-shell", "rework-write-guard", "rework-plan-live-ui", "rework-cards", "rework-editors",
  "ui-toolbar-a1d6", "ui-colour", "ui-catalog", "ui-schedule",
  "fix/review-store-undo-realtime", "fix/review-backend-auth-security", "fix/deploy-tooling-review",
  "frontend-4", "review-fixes", "review-integration",
];

/** Where an agent's worktree lives; the first one nests deep, so tips have to wrap a long path. */
const agentPath = (repoPath: string, i: number) =>
  i === 0
    ? `${repoPath}/.claude/worktrees/agent-a1b2c3d4e5f60718/nested/session-workspaces/agent-a1b2c3d4e5f60718-integration-review-checkout`
    : `${repoPath}/.claude/worktrees/agent-${(i * 2654435761 >>> 0).toString(16)}`;

const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
const pick = <T>(list: readonly T[]) => list[Math.floor(rand() * list.length)];

const NOW = Math.floor(Date.now() / 1000);
const DAY = 86_400;
const PEOPLE = ["me@example.com", "anna.berg@example.com", "jonas.keller@example.com", "build-bot@example.com"];
const WORDS = ["report", "grid", "sidebar", "export", "checklist", "migration", "tooltip", "scan", "filter", "layout", "print", "sync"];
const SUBJECTS = [
  "Fix null reference when the report has no pages",
  "Move column widths into the layout model",
  "Keep the first visible row in place on regroup",
  "Merge release branch back",
  "Rename fields to match the import format",
  "Add tests for the empty state",
];

// Branch names are unique per repo in git; the random words would repeat some.
const taken = new Set<string>();
function nameAt(i: number): string {
  const name = shapeAt(i);
  const unique = taken.has(name) ? `${name}-${i}` : name;
  taken.add(unique);
  return unique;
}

function shapeAt(i: number): string {
  const w = () => pick(WORDS);
  switch (i % 9) {
    case 0:
      return `release/Contoso/${1 + (i % 9)}.${1 + (i % 7)}/main`;
    case 1:
      return `wip/${w()}-${w()}-${i}`;
    case 2:
      return `bugfix/${10000 + i * 37}-${w()}-${w()}-does-not-refresh-after-save`;
    case 3:
      return `feature/${w()}-${w()}`;
    case 4:
      return `codex/${w()}-${w()}-${i}`;
    case 5:
      return `2.4/hotfix/${w()}-${i}`;
    case 6:
      return `users/anna/${w()}/${w()}-${i}`;
    case 7:
      return `${w()}-${i}`;
    default:
      return `feature/${w()}/${w()}-${w()}-${w()}-${i}`;
  }
}

const VERDICTS: Verdict[] = ["Safe", "Safe", "Review", "Unsafe", "Blocked"];
const ONLINE: OnlineVerdict[] = ["Merged", "Merged", "Inactive", "Active"];

function localBranches(path: string, count: number, from: number): BranchReport[] {
  return Array.from({ length: count }, (_, k) => {
    const i = from + k;
    const author = pick(PEOPLE);
    const verdict = pick(VERDICTS);
    const name = nameAt(i);
    // Mostly orphaned, as the list starts; some still on the server, a few never pushed. Not drawn from
    // the random stream, so every other value stays as it was.
    const upstreamState = i % 11 === 7 ? "None" : i % 5 === 3 ? "Live" : "Gone";
    return branch(path, name, {
      upstreamState,
      behind: upstreamState === "Live" && i % 2 === 0 ? 3 : 0,
      upstream: upstreamState === "None" ? "" : `refs/remotes/origin/${name}`,
      sha: ((i + 1) * 2654435761).toString(16).padStart(12, "0").slice(0, 12),
      lastCommitAt: NOW - Math.floor(rand() * 200) * DAY,
      lastCommitSubject: pick(SUBJECTS),
      lastCommitAuthor: author,
      authors: [author],
      isMine: author === PEOPLE[0],
      verdict,
      // As the backend has it: a pull request as evidence names its number, the others the branch they are in.
      mergeEvidence: verdict !== "Safe" ? null : i % 4 === 0 ? { kind: "PullRequest", target: `#${3000 + i}` } : { kind: pick(["Ancestor", "Squash"] as const), target: "refs/remotes/origin/main" },
      unpushedCommits: verdict === "Unsafe" ? [1, 2].map((k) => ({ sha: `${k}a2b3c4d5e6f${i}`, subject: pick(SUBJECTS), authorEmail: author, authoredAt: NOW - k * DAY })) : [],
      pullRequest:
        i % 4 === 0
          ? { id: 3000 + i, title: pick(SUBJECTS), state: pick(["Open", "Merged", "Closed"] as const), url: "https://example.invalid/pr", author, authorName: null, sourceRef: `refs/heads/${name}`, targetRef: "refs/heads/main", sourceSha: null, createdAt: NOW - 40 * DAY, closedAt: NOW - 30 * DAY, targetSha: null , reviewers: [], isDraft: false, hasConflicts: false}
          : null,
      locked: i % 23 === 0,
      ignored: i % 19 === 0,
      // The checks behind the verdict, so the detail lists its steps; some unsafe ones are still checked
      // out with changes and stashes. Fixed by the index, not drawn: the random stream stays as it was.
      checks:
        verdict === "Unsafe"
          ? [{ kind: "Pushed", outcome: "Fail", code: upstreamState === "None" ? { code: "NeverPushed", p: { count: 2, merged: false } } : { code: "CommitsAfterPush", p: { count: 2, upstream: `refs/remotes/origin/${name}`, merged: false } } }]
          : verdict === "Review"
            ? [{ kind: "Merged", outcome: "Warn", code: { code: "NoMergeEvidence", p: { own: 3, base: "refs/remotes/origin/main" } } }]
            : [],
      ...(verdict === "Unsafe" && i % 3 === 0
        ? {
            worktree: { path: `${path}-wt-${i}`, isMain: false, files: [{ path: "src/app.ts", kind: "Unstaged" as const }, { path: "README.md", kind: "Staged" as const }] },
            stashes: [{ selector: "stash@{0}", sha: `5a${i}`, message: `WIP on ${name}` }],
          }
        : {}),
    });
  });
}

function onlineBranches(path: string, count: number, from: number): RemoteBranchReport[] {
  return Array.from({ length: count }, (_, k) => {
    const i = from + k;
    const author = pick(PEOPLE);
    const verdict = pick(ONLINE);
    return remote(path, nameAt(i + 3), {
      sha: ((i + 7) * 2246822519).toString(16).padStart(12, "0").slice(0, 12),
      lastCommitAt: NOW - Math.floor(rand() * 300) * DAY,
      lastCommitSubject: pick(SUBJECTS),
      lastCommitAuthor: author,
      isMine: author === PEOPLE[0],
      verdict,
      merged: verdict === "Merged",
      // As in the backend: merged exactly when there is evidence.
      mergeEvidence: verdict === "Merged" ? { kind: "Ancestor", target: "refs/remotes/origin/main" } : null,
      openPr: verdict === "Active" && i % 2 === 0,
    });
  });
}

// The third root has a long folder name under a long parent: group heads must drop the parent, not squeeze it.
const ROOTS = ["C:/ws/Acme26", "C:/ws/Tools", "C:/ws/Projects/Acme_Platform_Contoso_Integration"];
const CORE_1 = "C:/ws/Acme26/feature1/Acme.Core";
const CORE_2 = "C:/ws/Acme26/feature2/Acme.Core";
const REPOS = [
  { info: repo(CORE_1, { root: ROOTS[0], identity: "id:acme-core" }), local: 40, online: 60 },
  { info: repo(CORE_2, { root: ROOTS[0], identity: "id:acme-core" }), local: 90, online: 60 },
  {
    info: repo("C:/ws/Acme26/Acme.Reports", {
      root: ROOTS[0],
      provider: "Azure",
      remoteUrl: "https://acme@dev.azure.com/acme/Platform-Development/_git/Acme.Reports.Integration-Workspace",
      links: { home: "https://dev.azure.com/o/p/_git/reports", pullRequests: "https://dev.azure.com/o/p/_git/reports/pullrequests?_a=active", branch: "https://dev.azure.com/o/p/_git/reports?version=GB{branch}" },
    }),
    local: 12,
    online: 30,
  },
  { info: repo("C:/ws/Tools/McBranchFace", { root: ROOTS[1] }), local: 6, online: 8 },
  { info: repo("C:/ws/Tools/Scripts", { root: ROOTS[1] }), local: 3, online: 0 },
  { info: repo("C:/ws/Projects/Acme_Platform_Contoso_Integration/Contoso", { root: ROOTS[2] }), local: 4, online: 4 },
];

// A renamed C# file: word marks at several places, a line ending change, a long line, two hunks.
const line = (kind: string, oldNo: number | null, newNo: number | null, text: string, changed: [number, number][] = [], eol = false) => ({ kind, oldNo, newNo, text, changed, eol });
const diff = (path: string) => ({
  path,
  oldPath: path.replace(/(\.\w+)$/, ".Old$1"),
  similarity: 91,
  oldMode: null,
  newMode: null,
  binary: false,
  truncated: false,
  added: 4,
  removed: 3,
  conflict: false,
  hunks: [
    {
      header: "@@ -10,4 +10,5 @@ public sealed class ReportExport",
      section: "public sealed class ReportExport",
      oldStart: 10,
      oldLines: 4,
      newStart: 10,
      newLines: 5,
      lines: [
        line("Context", 10, 10, "    public void Export(Report report)"),
        line("Del", 11, null, "        var pages = report.Pages.ToList();"),
        line("Add", null, 11, "        var pages = report.Pages?.ToList() ?? [];", [[32, 33], [42, 48]]),
        line("Add", null, 12, "        if (pages.Count == 0) { RenderEmptyState(); return; } // an empty report still gets its cover page, a summary and the footer with the page count"),
        line("Context", 12, 13, "        foreach (var page in pages)"),
      ],
    },
    {
      header: "@@ -40,3 +41,3 @@ private static string Title(Report report)",
      section: "private static string Title(Report report)",
      oldStart: 40,
      oldLines: 3,
      newStart: 41,
      newLines: 3,
      lines: [
        line("Context", 40, 41, "    {"),
        line("Del", 41, null, "        return report.Name;", [], true),
        line("Del", 42, null, "        // TODO: localise"),
        line("Add", null, 42, "        return report.Name;", [], true),
        line("Add", null, 43, "        // The name comes localised from the template."),
      ],
    },
  ],
});

/**
 * `?repos=150&branches=2000`: a workspace of that size instead of the hand-made one, and a scan that
 * sends its results one by one, as the backend does. For measuring what 150 results cost the page.
 */
function scaled(): typeof REPOS | null {
  const q = new URLSearchParams(globalThis.location?.search ?? "");
  const repos = Number(q.get("repos") ?? 0);
  if (!repos) return null;
  const per = Math.max(1, Math.round(Number(q.get("branches") ?? repos * 10) / repos));
  return Array.from({ length: repos }, (_, i) => {
    const root = ROOTS[i % ROOTS.length];
    return { info: repo(`${root}/repo-${String(i).padStart(3, "0")}`, { root, identity: `id:repo-${i % Math.ceil(repos * 0.8)}` }), local: per, online: Math.round(per / 2) };
  });
}

/**
 * `?timing=1`: what a start costs in time. A status takes 40 ms, a local assessment 30 ms and a fetch
 * 800 ms per repo, six repos at once; the last run's statuses are in the cache unless `&cache=0`.
 */
const timing = () => {
  const q = new URLSearchParams(globalThis.location?.search ?? "");
  return { on: q.get("timing") === "1", cache: q.get("cache") !== "0" };
};

export function fixture(): Record<string, Handler> {
  let n = 0;
  const time = timing();
  const workspace = scaled() ?? REPOS;
  const results = workspace.map((r) => {
    const local = localBranches(r.info.path, r.local, n);
    const online = r.online ? onlineBranches(r.info.path, r.online, n) : null;
    n += r.local;
    const res = result(r.info, local, online, { onlineAt: online ? NOW - 600 : null });
    // As the branches say: a gone upstream is gone here too, a branch without one has no tracking entry.
    res.tracking = local
      .filter((b) => b.upstreamState !== "None")
      .map((b, i) => ({ branch: b.name, remote: "origin", remoteBranch: b.name, gone: b.upstreamState === "Gone", ahead: i % 5 === 1 ? 2 : 0, behind: i % 7 === 2 ? 3 : 0, checkedOut: i === 1 }));
    return res;
  });
  // One feature worked on in several repos: a few names of the first repo exist in two others as well,
  // so grouping by name has real groups and not only the "one repo only" one.
  const [first, ...others] = results;
  for (const other of others.filter((r) => r.repo.identity !== first?.repo.identity).slice(0, 2)) {
    for (const b of first.branches.slice(0, 3)) other.branches.push({ ...b, repoPath: other.repo.path, verdict: other === others[0] ? b.verdict : "Unsafe" });
  }
  return {
    // No auto-fetch: a full audit runs longer than its interval, and a scan in the middle would change
    // the state under whichever view is being measured.
    get_config: () =>
      config({
        roots: ROOTS,
        language: "De",
        theme: "Light",
        autoFetchMinutes: 0,
        // One repo in both groups, and a working copy the last scan no longer found.
        repoGroups: [
          { id: "g-backend", name: "Backend", paths: [CORE_1, "C:/ws/Tools/McBranchFace"] },
          { id: "g-release", name: "Release group with a rather long name", paths: [CORE_1, "C:/ws/Acme26/Acme.Reports", "C:/ws/Gone/OldRepo"] },
        ],
      }),
    cached_results: () => results,
    cached_status: () =>
      time.on && time.cache
        ? {
            statuses: workspace.map((r) => ({ path: r.info.path, head: { branch: "main", oid: "0123456789ab", upstream: "origin/main", ahead: 0, behind: 0, unreferenced: 0 }, entries: [], worktrees: [], stashes: 0 })),
            scannedAt: Math.floor(Date.now() / 1000) - 3600,
          }
        : { statuses: [], scannedAt: null },
    scan: async (a) => {
      if (workspace === REPOS) return { durationMs: 10, repoCount: REPOS.length };
      const started = Date.now();
      await emit("scan-started", { repos: workspace.map((r) => r.info) });
      if (time.on) {
        // Six repos at a time, each its assessment and, with a fetch, the network first.
        for (let i = 0; i < results.length; i += 6) {
          await new Promise((ok) => setTimeout(ok, 30 + (a.fetch ? 800 : 0)));
          for (const r of results.slice(i, i + 6)) await emit("scan-repo", r);
        }
        return { durationMs: Date.now() - started, repoCount: workspace.length };
      }
      // Results arrive a few milliseconds apart, like parallel git runs finishing.
      for (const r of results) {
        await new Promise((ok) => setTimeout(ok, 4));
        await emit("scan-repo", r);
      }
      return { durationMs: Date.now() - started, repoCount: workspace.length };
    },
    server_heads: () => [],
    provider_identity: () => "dev@example.com",
    // The About page shows what the app knows about itself; without it the page was empty in the audit.
    app_info: () => ({
      version: "1.2.3",
      builtAt: NOW - 2 * DAY,
      appDir: "C:\\Users\\dev\\AppData\\Local\\McBranchFace",
      crashLogs: [],
      diagnosticsLog: "C:\\Users\\dev\\AppData\\Local\\McBranchFace\\diagnostics.log",
    }),
    git_switch: () => ({ sha: "s", backupDir: null, stashed: false, warning: null, summary: null }),
    git_switch_new: () => ({ sha: "s", backupDir: null, stashed: false, warning: null, summary: null }),
    environment_status: () => [
      { id: "Git", required: true, state: "Ready", version: "2.54.0", minVersion: "2.30", account: null, detail: null, downloadUrl: "https://git-scm.com", commands: [] },
      { id: "AzureCli", required: false, state: "Ready", version: "2.70.0", minVersion: "2.50", account: "dev@example.com", detail: null, downloadUrl: "https://aka.ms/azcli", commands: [] },
      { id: "GitHubCli", required: false, state: "Missing", version: null, minVersion: "2.40", account: null, detail: null, downloadUrl: "https://cli.github.com", commands: [] },
      { id: "GitHubDesktop", required: false, state: "Missing", version: null, minVersion: null, account: null, detail: null, downloadUrl: "https://desktop.github.com", commands: [] },
    ],
    open_pull_requests: (a) =>
      String(a.path).endsWith("Acme.Reports")
        ? [
            { id: 4127, title: "Report designer: page breaks keep their group header together", state: "Open", url: "https://dev.azure.com/o/p/_git/reports/pullrequest/4127", author: "dana@example.com", authorName: "Dana Weber", sourceRef: "refs/heads/feature/page-breaks", targetRef: "refs/heads/main", sourceSha: null, createdAt: Math.floor(Date.now() / 1000) - 3 * 3600, closedAt: null, targetSha: null , reviewers: [{ id: "dev@example.com", state: "Pending", required: true }, { id: "dana@example.com", state: "Approved", required: false }], isDraft: false, hasConflicts: false},
            { id: 4119, title: "Draft: export to PDF/A-3 with embedded XML", state: "Open", url: "https://dev.azure.com/o/p/_git/reports/pullrequest/4119", author: "sam@example.com", authorName: "Sam Krüger", sourceRef: "refs/heads/feature/pdfa3", targetRef: "refs/heads/release/2.5", sourceSha: null, createdAt: Math.floor(Date.now() / 1000) - 5 * 86400, closedAt: null, targetSha: null , reviewers: [], isDraft: true, hasConflicts: false},
            { id: 4133, title: "Grid export keeps the column order of the layout", state: "Open", url: "https://dev.azure.com/o/p/_git/reports/pullrequest/4133", author: "dev@example.com", authorName: "Dev Example", sourceRef: "refs/heads/feature/grid-export", targetRef: "refs/heads/main", sourceSha: null, createdAt: Math.floor(Date.now() / 1000) - 2 * 86400, closedAt: null, targetSha: null, reviewers: [{ id: "sam@example.com", state: "Changes", required: true }], isDraft: false, hasConflicts: false },
          ]
        : [],
    // `window.__statusDelay` (ms): git status of a large working tree takes that long.
    repo_status: async (a) => {
      const delay = (globalThis as { __statusDelay?: number }).__statusDelay ?? (time.on ? 40 : 0);
      if (delay) await new Promise((ok) => setTimeout(ok, delay));
      const path = a.path as string;
      // A folder that is gone answers as git does: with an error, not with a status.
      if (path.includes("/Gone/")) throw { code: "RepoMissing", p: { path } };
      // The copy with changes stands on a long feature branch: its card has the least room for the name.
      const head = { branch: path === CORE_2 ? "feature/wip-dirty-checklist-export" : "main", oid: "0123456789ab", upstream: "origin/main", ahead: 0, behind: 0, unreferenced: 0 };
      const wt = (p: string, branch: string | null, sha: string, over = {}) => ({ path: p, branch, head: sha, isMain: false, detached: !branch, foreign: false, unreferenced: 0, ...over });
      const main = { path, branch: "main", head: head.oid, isMain: true, detached: false, foreign: false, unreferenced: 0 };
      // The second working copy was made by copying the folder: the first one's registrations came along.
      const worktrees =
        path === CORE_1
          ? [
              main,
              wt(`${path}-agent-1`, "wip/grid-columns-and-filter-in-header", "abcdef012345"),
              wt(`${path}-practical-blackwell-7f3a`, null, "7f3a0c1d2e3f", { unreferenced: 2 }),
              // Below another root: that folder shows it, as it holds no repo of its own for it.
              wt(`${ROOTS[2]}/Acme.Core-integration`, "release/Contoso/2.4/main", "fedcba987654"),
            ]
          : path === CORE_2
            ? [main, wt(`${CORE_1}-practical-blackwell-7f3a`, null, "7f3a0c1d2e3f", { foreign: true })]
            : path.endsWith("Acme.Reports")
              ? [main, ...AGENT_BRANCHES.map((b, i) => wt(agentPath(path, i), b, "ab12cd34ef56"))]
              : [];
      const entries = path === CORE_2 ? [{ path: "src/a.cs", origPath: null, staged: null, unstaged: "Modified", conflicted: false, untracked: false }] : [];
      // Stashes in the copy with changes, so the card shows every sign it has.
      return { path, head, entries, worktrees, stashes: path === CORE_2 ? 2 : 0 };
    },
    // History with merges, refs and long subjects; one commit has files for the detail pane.
    // A fix and its cherry-picks: on a feature branch in one repo, on main and a release line in others.
    find_commit: (a) =>
      (a.paths as string[]).slice(0, 3).map((repoPath, r) => ({
        repoPath,
        capped: r === 0,
        error: null,
        hits: Array.from({ length: r === 0 ? 4 : 1 }, (_, k) => ({
          commit: { sha: ((r * 7 + k + 1) * 2654435761 >>> 0).toString(16).padStart(8, "0").repeat(5), parents: ["p"], author: PEOPLE[k % PEOPLE.length].split("@")[0], email: PEOPLE[k % PEOPLE.length], time: NOW - (k + r) * DAY, subject: `${SUBJECTS[k % SUBJECTS.length]} (${a.query})`, refs: [] },
          local: k === 0 ? ["feature/export-report", "main", "release/Contoso/2.1/main", "hotfix/totals"] : ["main"],
          remote: k === 0 ? ["origin/main", "origin/feature/export-report"] : [],
        })),
      })),
    git_log: (a) => {
      const skip = Number(a.skip ?? 0);
      if (skip >= 120) return [];
      return Array.from({ length: 60 }, (_, i) => {
        const k = skip + i;
        return {
          sha: (((k + 1) * 2654435761) >>> 0).toString(16).padStart(8, "0").repeat(5),
          parents: k % 9 === 4 ? ["p1", "p2"] : ["p1"],
          author: PEOPLE[k % PEOPLE.length].split("@")[0],
          email: PEOPLE[k % PEOPLE.length],
          time: NOW - k * 5400,
          subject: SUBJECTS[k % SUBJECTS.length],
          refs: k === 0 ? ["HEAD -> main", "origin/main", "tag: v2.4.3"] : k === 7 ? ["origin/wip/grid-columns-and-filter-in-header"] : [],
        };
      });
    },
    commit_detail: (a) => ({
      entry: { sha: String(a.sha), parents: ["p1"], author: "anna.berg", email: "anna.berg@example.com", time: NOW - 5400, subject: SUBJECTS[0], refs: [] },
      body: "Pages without content no longer crash the export.\n\nThe empty state renders a placeholder instead.",
      files: [
        { path: "src/Reports/ReportExport.cs", origPath: null, change: "Modified" },
        { path: "src/Reports/EmptyState.cs", origPath: null, change: "Added" },
        { path: "src/Reports/Old/LegacyExport.cs", origPath: "src/Reports/LegacyExport.cs", change: "Renamed" },
      ],
    }),
    // The copies dialog: free folders next to the repo, every target fine.
    free_copy_folders: (a) => Array.from({ length: Number(a.count ?? 1) }, (_, i) => `${a.path}-${a.label}-${i + 1}`),
    check_copy_targets: (a) => (a.targets as unknown[]).map(() => ({ pathTaken: false, nameInvalid: false, branchExists: false, checkedOutAt: null })),
    working_diff: (a) => diff(String(a.file)),
    commit_diff: (a) => diff(String(a.file)),
    deleted_entries: () => {
      const entry = (i: number, over = {}) => {
        const b = results[0].branches[i];
        return {
          id: `d-${i}`,
          repoPath: b.repoPath,
          branch: b.name,
          sha: b.sha,
          upstreamRemote: "origin",
          upstreamMerge: `refs/heads/${b.name}`,
          backupRef: `refs/mcbranchface/backup/${i}/${b.name}`,
          deletedAt: NOW - i * 3 * DAY,
          forced: i === 2,
          verdict: i === 2 ? "Unsafe" : "Safe",
          droppedStashes: [],
          removedWorktree: null,
          restoredAt: i === 4 ? NOW - DAY : null,
          remote: i === 3 ? "origin" : null,
          filesBackup: null,
          worktreeBackup: null,
          worktreeBranch: null,
          branchConfig: [],
          ...over,
        };
      };
      const repo = results[0].branches[0].repoPath;
      return [
        ...[0, 1, 2, 3, 4, 5].map((i) => entry(i)),
        // A worktree removed on its own: no branch went, its folder sits in the backups.
        entry(6, {
          branch: "",
          backupRef: "",
          deletedAt: NOW - 2 * DAY,
          removedWorktree: agentPath(repo, 1),
          worktreeBackup: `C:/Users/dev/AppData/Roaming/McBranchFace/backups/${NOW}-1a2b3c4d/worktree`,
          worktreeBranch: AGENT_BRANCHES[1],
        }),
        // Older than the 90 days the dialog offers to clean up.
        entry(7, { deletedAt: NOW - 120 * DAY }),
      ];
    },
    backups_size: () => 734_003_200,
    // Local branches as the scan saw them, main checked out, the online ones as server branches.
    branch_list: (a) => {
      const res = results.find((r) => r.repo.path === a.path) ?? results[0];
      const row = (name: string, over = {}) => ({ name, fullRef: `refs/heads/${name}`, sha: "s", upstream: null, ahead: 0, behind: 0, gone: false, isHead: false, worktreePath: null, committedAt: NOW, subject: "", author: "", isMine: false, ...over });
      const agents = String(a.path).endsWith("Acme.Reports")
        ? AGENT_BRANCHES.map((b, i) => row(b, { worktreePath: agentPath(String(a.path), i), subject: SUBJECTS[i % SUBJECTS.length], author: "agent", committedAt: NOW - i * 3600 }))
        : [];
      return {
        // Working copies of one repository share their branches; the second copy knows the first one's too.
        local: [
          row("main", { isHead: true }),
          ...agents,
          ...[...(a.path === CORE_2 ? results[0].branches.slice(0, 12) : []), ...res.branches.slice(0, 30)].map((b) => row(b.name, { isMine: b.isMine })),
        ],
        remote: (res.online ?? []).slice(0, 30).map((b) => row(`origin/${b.name}`, { isMine: b.isMine })),
      };
    },
  };
}
