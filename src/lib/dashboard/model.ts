// What there is to do, across every repo: the dashboard's "next" list and the numbers of its tiles.
// Pure: the inputs come from the stores, the texts from the dictionary; unit-tested.
import { LENSES, type LensId } from "$lib/alerts";
import type { BranchReport } from "$lib/bindings/BranchReport";
import type { CleanupScope } from "$lib/bindings/CleanupScope";
import type { PullRequestInfo } from "$lib/bindings/PullRequestInfo";
import type { RemoteBranchReport } from "$lib/bindings/RemoteBranchReport";
import type { RepoStatus } from "$lib/bindings/RepoStatus";
import { branchKey, onlineKey, repoOfKey } from "$lib/filter";
import type { Host } from "$lib/providerMeta";

export type { Host };

export interface DashRepo {
  path: string;
  name: string;
  host: Host | null;
  defaultBranch: string | null;
}

/** The local and server branches by name: a pull request finds its branch without walking every list. */
export interface BranchIndex {
  local: Map<string, BranchReport[]>;
  online: Map<string, RemoteBranchReport[]>;
}

export function branchIndex(local: BranchReport[], online: RemoteBranchReport[]): BranchIndex {
  const by = <B extends { name: string }>(list: B[]) => {
    const m = new Map<string, B[]>();
    for (const b of list) {
      const named = m.get(b.name);
      if (named) named.push(b);
      else m.set(b.name, [b]);
    }
    return m;
  };
  return { local: by(local), online: by(online) };
}

/** What the steps for pull requests are made of: no git state, so a status change leaves them alone. */
export interface PrInput {
  repos: DashRepo[];
  /** Pull requests by repo path. */
  prs: Record<string, PullRequestInfo[]>;
  /** Who the user is at each provider, where known. */
  me: Partial<Record<Host, string>>;
  branches: BranchIndex;
  /** Unix seconds; to the hour is enough, everything here counts days. */
  now: number;
}

/** What the steps for branches are made of: the scans' results. */
export interface BranchInput {
  local: BranchReport[];
  /** The branches each lens counts in these repos (the store's lists, narrowed). */
  lensKeys: Record<LensId, string[]>;
}

/** What the steps for working copies are made of: their git state. */
export interface StatusInput {
  repos: DashRepo[];
  /** Working copies by path, worktrees included. */
  statuses: Record<string, RepoStatus>;
  /** Linked worktrees whose branch is merged, by repo, with the branch each has checked out. */
  mergedWorktrees: { repo: string; paths: string[]; branches: string[] }[];
}

export type DashInput = PrInput & BranchInput & StatusInput;

export type TodoAction =
  | { kind: "url"; url: string }
  /** The cleanup table on exactly these branches. */
  | { kind: "focus"; keys: string[]; scope: CleanupScope }
  | { kind: "git"; path: string }
  | { kind: "changes"; path: string }
  | { kind: "history"; path: string; rev: string }
  | { kind: "pull"; path: string }
  /** The delete dialog for these branches; it still asks. */
  | { kind: "delete"; keys: string[]; scope: CleanupScope }
  | { kind: "removeWorktrees"; repo: string; paths: string[] };

export type TodoKind = "review" | "conflict" | "changes" | "approved" | "waiting" | "atRisk" | "cleanup" | "worktrees" | "behind" | "dirty";

/** What a step is about for the user: answer someone, keep work from getting lost, tidy up. In this order. */
export type DashSection = "forYou" | "secure" | "cleanup";
export const SECTIONS: DashSection[] = ["forYou", "secure", "cleanup"];
export const SECTION_OF: Record<TodoKind, DashSection> = {
  review: "forYou",
  conflict: "forYou",
  changes: "forYou",
  approved: "forYou",
  waiting: "forYou",
  atRisk: "secure",
  behind: "secure",
  dirty: "secure",
  cleanup: "cleanup",
  worktrees: "cleanup",
};

/** One thing a step names: a branch, a worktree, a file, or a repo with how many it holds. */
export interface DashItem {
  repo: string;
  name: string;
  count?: number;
  /** A branch checked out in an agent's worktree, or the branch of a worktree. */
  agent?: boolean;
  branch?: string | null;
}

export interface DashStep {
  key: string;
  kind: TodoKind;
  section: DashSection;
  /** Lower comes first. */
  rank: number;
  /** The state it was in: a step put aside comes back when this changes. */
  fingerprint: string;
  /** The repos or working copies it concerns; a pull request names every copy of its repo. */
  repos: string[];
  branch?: string;
  count?: number;
  /** Several branches summed up in one step. */
  branches?: number;
  /** A pull request it is about. */
  pr?: PullRequestInfo;
  /** The pull request is the user's own. */
  mine?: boolean;
  /** For a cleanup step: its lens. */
  lens?: LensId;
  /** What a click on the line opens: the list of what it names. */
  open: TodoAction;
  /** The one thing to do right away. */
  action: TodoAction;
  /** Everything it names, most important first: the list its details show. */
  items?: DashItem[];
  /** Of the branches, those checked out in an agent's worktree. */
  agents?: number;
  /** Several repos: how many each holds, most first. */
  split?: { repo: string; count: number }[];
}

const same = (a: string | undefined, b: string | undefined) => !!a && !!b && a.toLowerCase() === b.toLowerCase();
const DAY = 86_400;
/** An own pull request open this long without an answer is worth a look. */
export const WAITING_DAYS = 7;
const lastSegment = (p: string) => p.replace(/[\\/]+$/, "").split(/[\\/]/).pop() ?? p;

/** Agents work in worktrees under .claude/worktrees: the same rule the watcher has. */
export const isAgentWorktree = (path: string | undefined) => !!path && /[\\/]\.claude[\\/]worktrees[\\/]/i.test(path);

export type PrWhy = "review" | "mine" | "other";

/** One pull request, once: several working copies of a repo report the same one. */
export interface PrRow {
  pr: PullRequestInfo;
  /** Every scanned copy that reports it, in the order of the repos. */
  repos: DashRepo[];
  why: PrWhy;
}

/** The open pull requests the tile lists: mine and those waiting for my review, or all of them. */
export function prsOf(input: Pick<PrInput, "repos" | "prs" | "me">, mode: "mine" | "all"): PrRow[] {
  const rows = new Map<string, PrRow>();
  for (const repo of input.repos) {
    const me = repo.host ? input.me[repo.host] : undefined;
    for (const pr of input.prs[repo.path] ?? []) {
      if (pr.state !== "Open") continue;
      const key = pr.url || `${repo.path}#${pr.id}`;
      const seen = rows.get(key);
      if (seen) {
        seen.repos.push(repo);
        continue;
      }
      const why: PrWhy = same(pr.author, me) ? "mine" : pr.reviewers.some((r) => same(r.id, me) && r.state === "Pending") ? "review" : "other";
      if (mode === "all" || why !== "other") rows.set(key, { pr, repos: [repo], why });
    }
  }
  const order: Record<PrWhy, number> = { review: 0, mine: 1, other: 2 };
  return [...rows.values()].sort((a, b) => order[a.why] - order[b.why] || (b.pr.createdAt ?? 0) - (a.pr.createdAt ?? 0));
}

/** Where a pull request's source branch is in the list: local in any copy, else on the server; null when neither knows it. */
export function prBranches(branches: BranchIndex, row: PrRow): { keys: string[]; scope: CleanupScope } | null {
  const name = row.pr.sourceRef.replace(/^refs\/heads\//, "");
  const paths = new Set(row.repos.map((r) => r.path));
  const local = (branches.local.get(name) ?? []).filter((b) => paths.has(b.repoPath)).map(branchKey);
  if (local.length) return { keys: local, scope: "Local" };
  const online = (branches.online.get(name) ?? []).filter((b) => paths.has(b.repoPath)).map(onlineKey);
  return online.length ? { keys: online, scope: "Online" } : null;
}

function splitByRepo(keys: string[]): { repo: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const k of keys) counts.set(repoOfKey(k), (counts.get(repoOfKey(k)) ?? 0) + 1);
  return [...counts].map(([repo, count]) => ({ repo, count })).sort((a, b) => b.count - a.count);
}

type Todo = Omit<DashStep, "section">;

/** Everything there is to do, in the order the list shows it. */
export function nextSteps(input: DashInput): DashStep[] {
  return sortSteps([...prSteps(input), ...branchSteps(input), ...statusSteps(input)]);
}

/** Pull requests: those waiting for me first, then mine that need something. */
export function prSteps(input: PrInput): Todo[] {
  const todos: Todo[] = [];
  for (const row of prsOf(input, "mine")) {
    const { pr, why } = row;
    if (pr.isDraft && why === "review") continue;
    const at = prBranches(input.branches, row);
    const base = {
      repos: row.repos.map((r) => r.path),
      pr,
      mine: why === "mine",
      open: (at ? { kind: "focus", ...at } : { kind: "url", url: pr.url }) as TodoAction,
      action: { kind: "url", url: pr.url } as TodoAction,
    };
    const id = pr.url || `${row.repos[0].path}#${pr.id}`;
    if (why === "review") {
      todos.push({ ...base, key: `review:${id}`, kind: "review", rank: 10, fingerprint: "pending" });
      continue;
    }
    const changes = pr.reviewers.some((r) => r.state === "Changes");
    const required = pr.reviewers.filter((r) => r.required);
    const approved = pr.reviewers.length > 0 && (required.length ? required : pr.reviewers).every((r) => r.state === "Approved");
    const age = pr.createdAt ? Math.floor((input.now - pr.createdAt) / DAY) : 0;
    if (pr.hasConflicts) todos.push({ ...base, key: `conflict:${id}`, kind: "conflict", rank: 15, fingerprint: "conflict" });
    else if (changes) todos.push({ ...base, key: `changes:${id}`, kind: "changes", rank: 20, fingerprint: pr.reviewers.map((r) => `${r.id}=${r.state}`).join(",") });
    else if (approved && !pr.isDraft) todos.push({ ...base, key: `approved:${id}`, kind: "approved", rank: 25, fingerprint: "approved" });
    else if (age >= WAITING_DAYS && !pr.isDraft) todos.push({ ...base, key: `waiting:${id}`, kind: "waiting", rank: 40, count: age, fingerprint: String(Math.floor(age / WAITING_DAYS)) });
  }
  return todos;
}

/** Work only this machine has, and the cleanup the lenses count. */
export function branchSteps(input: BranchInput): Todo[] {
  const todos: Todo[] = [];
  // Work that exists only here: commits no server has, on branches without upstream or whose upstream is gone.
  const atRisk = input.local.filter((b) => !b.locked && !b.ignored && b.unpushedCommitCount > 0 && (b.upstreamState === "Gone" || b.upstreamState === "None"));
  // One step per repo: a repo where agents work has many such branches, one line each would bury the rest.
  const byRepo = new Map<string, BranchReport[]>();
  for (const b of atRisk) {
    const list = byRepo.get(b.repoPath);
    if (list) list.push(b);
    else byRepo.set(b.repoPath, [b]);
  }
  for (const [repo, list] of byRepo) {
    const most = [...list].sort((a, b) => b.unpushedCommitCount - a.unpushedCommitCount);
    todos.push({
      key: `atRisk:${repo}`,
      kind: "atRisk",
      rank: 30,
      fingerprint: list.map((b) => `${b.name}=${b.unpushedCommitCount}`).join(","),
      repos: [repo],
      branch: list.length === 1 ? list[0].name : undefined,
      count: list.reduce((n, b) => n + b.unpushedCommitCount, 0),
      branches: list.length,
      items: most.map((b) => ({ repo, name: b.name, count: b.unpushedCommitCount, agent: isAgentWorktree(b.worktree?.path) })),
      agents: list.filter((b) => isAgentWorktree(b.worktree?.path)).length,
      open: { kind: "focus", keys: list.map(branchKey), scope: "Local" },
      action: { kind: "git", path: repo },
    });
  }

  // Cleaning up: one step per lens; the line shows exactly the branches it counted.
  for (const lens of LENSES.filter((l) => l.id === "localSafe" || l.id === "onlineMerged")) {
    const keys = input.lensKeys[lens.id];
    if (!keys.length) continue;
    const split = splitByRepo(keys);
    todos.push({
      key: `cleanup:${lens.id}`,
      kind: "cleanup",
      rank: lens.id === "localSafe" ? 50 : 55,
      fingerprint: String(keys.length),
      repos: split.map((s) => s.repo),
      count: keys.length,
      lens: lens.id,
      split,
      open: { kind: "focus", keys, scope: lens.scope },
      action: { kind: "delete", keys, scope: lens.scope },
    });
  }
  return todos;
}

/** What the working copies say: merged worktrees, the default branch behind, files not committed. */
export function statusSteps(input: StatusInput): Todo[] {
  const todos: Todo[] = [];
  for (const w of input.mergedWorktrees.filter((x) => x.paths.length)) {
    todos.push({
      key: `worktrees:${w.repo}`,
      kind: "worktrees",
      rank: 52,
      fingerprint: String(w.paths.length),
      repos: [w.repo],
      count: w.paths.length,
      items: w.paths.map((p, i) => ({ repo: w.repo, name: lastSegment(p), branch: w.branches[i] ?? null })),
      open: { kind: "focus", keys: w.branches.map((name) => branchKey({ repoPath: w.repo, name })), scope: "Local" },
      action: { kind: "removeWorktrees", repo: w.repo, paths: w.paths },
    });
  }

  // The default branch behind its server, and changes not committed.
  for (const repo of input.repos) {
    const st = input.statuses[repo.path];
    if (st?.head.branch && st.head.branch === repo.defaultBranch && st.head.behind > 0) {
      todos.push({
        key: `behind:${repo.path}`,
        kind: "behind",
        rank: 60,
        fingerprint: String(st.head.behind),
        repos: [repo.path],
        branch: st.head.branch,
        count: st.head.behind,
        // The history of what the server has: the commits waiting to be pulled are on top.
        open: { kind: "history", path: repo.path, rev: st.head.upstream ?? st.head.branch },
        action: { kind: "pull", path: repo.path },
      });
    }
  }
  for (const [path, st] of Object.entries(input.statuses)) {
    if (!st.entries.length) continue;
    todos.push({
      key: `dirty:${path}`,
      kind: "dirty",
      rank: 70,
      fingerprint: String(st.entries.length),
      repos: [path],
      branch: st.head.branch ?? undefined,
      count: st.entries.length,
      items: st.entries.map((e) => ({ repo: path, name: e.path })),
      open: { kind: "changes", path },
      // The line and the button lead to the same place: the button says it in words.
      action: { kind: "changes", path },
    });
  }
  return todos;
}

/** By section, then by rank: answers for others first, then work to keep, then tidying up. */
export function sortSteps(todos: Todo[]): DashStep[] {
  const order = (s: DashSection) => SECTIONS.indexOf(s);
  return todos
    .map((s) => ({ ...s, section: SECTION_OF[s.kind] }))
    .sort((a, b) => order(a.section) - order(b.section) || a.rank - b.rank || a.key.localeCompare(b.key));
}

/** The steps not put aside in the state they are in now. */
export const shownSteps = (todos: DashStep[], dismissed: Record<string, string>) => todos.filter((x) => dismissed[x.key] !== x.fingerprint);
