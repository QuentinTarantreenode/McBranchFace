// What a set of repos offers, wherever the set comes from: a folder of the sidebar or a repo group.
// A group is a folder without a place on disk, so both menus share these entries and differ only in what
// a place on disk adds (open, terminal, copy path) or what a group adds (rename, remove).
import { ArrowDownToLine, ArrowRightLeft, ArrowUpFromLine, CloudDownload, CopyPlus, GitBranchPlus, RefreshCw } from "@lucide/svelte";
import { api } from "$lib/api";
import type { RepoStatus } from "$lib/bindings/RepoStatus";
import { fetchIn, pullIn, pushIn, type Skip } from "$lib/services/groupActions";
import { t } from "$lib/i18n/index.svelte";
import { pooled } from "$lib/pool";
import { remoteTargets } from "$lib/repoGroups";
import { folderKey } from "$lib/roots";
import { gitClaims } from "$lib/stores/gitClaims.svelte";
import { gitStatus } from "$lib/stores/gitStatus.svelte";
import type { MenuEntry } from "$lib/ui/menu.svelte";
import { commandsItem } from "./commandMenu";
import { prItemsOf } from "./prMenu";
import type { SwitchMode } from "./repoGroupDrop.svelte";
import { selectEntries } from "./selectMenu";
import { settings } from "$lib/stores/settings.svelte";
import { scanResults } from "$lib/stores/scanResults.svelte";
import { scanner } from "$lib/services/scanner.svelte";

/** A repo of the scan or a worktree one of them lists; anything else is no longer there. */
export function reachable(path: string) {
  if (scanResults.repoByPath.has(path)) return scanResults.resultOf(path)?.errorKind !== "RepoMissing";
  return gitStatus.ownerOf(path) !== path;
}

/** Each repo once: a worktree stands for its repo where the action works on the repository, not the copy. */
export const owners = (paths: string[]) => {
  const seen = new Set<string>();
  return paths.map((p) => gitStatus.ownerOf(p)).filter((p) => !seen.has(folderKey(p)) && seen.add(folderKey(p)));
};

/**
 * The menu opens with what is known; a status git still has to work out (seconds on a large tree)
 * is asked for once now, so the next opening has it, and the action itself waits for the fresh one.
 */
const asked = new Set<string>();
export function knownStatuses(paths: string[]): Record<string, RepoStatus | undefined> {
  for (const p of paths) {
    if (gitStatus.statuses.get(p) || asked.has(p)) continue;
    asked.add(p);
    void gitStatus.refreshStatus(p).finally(() => asked.delete(p));
  }
  return Object.fromEntries(paths.map((p) => [p, gitStatus.statuses.get(p)]));
}

async function fresh(paths: string[]): Promise<Record<string, RepoStatus | undefined>> {
  const read = new Map<string, RepoStatus>();
  const missing = paths.filter((p) => !gitStatus.statuses.get(p));
  await pooled(missing, settings.config?.concurrency ?? 4, (p) => api.repoStatus(p).then((st) => read.set(p, st)));
  return Object.fromEntries(paths.map((p) => [p, gitStatus.statuses.get(p) ?? read.get(p)]));
}

/** Pull and push of the given working copies, decided on their current status when they run. */
export async function pull(paths: string[], missing: Skip[]) {
  const to = remoteTargets(paths, await fresh(paths));
  const left = paths.filter((p) => !to.pull.some((x) => x.path === p) && !to.skipped.some((x) => x.path === p));
  return pullIn(to.pull.map((x) => x.path), [...missing, ...to.skipped, ...left.map((path) => ({ path, why: "noUpstream" as const }))]);
}

export async function push(paths: string[], missing: Skip[]) {
  const to = remoteTargets(paths, await fresh(paths));
  const left = paths.filter((p) => !to.push.some((x) => x.path === p) && !to.skipped.some((x) => x.path === p));
  return pushIn(to.push, [...missing, ...to.skipped, ...left.map((path) => ({ path, why: "upToDate" as const }))]);
}

export interface RepoSet {
  name: string;
  /** Every member, reachable or not. */
  paths: string[];
  /** The branch panel for the reachable members. */
  openSwitch: (mode: SwitchMode, live: string[]) => void;
}

/** Fetch, pull and push as tiles; branches, commands, pull requests, rescan and selection. */
export function setEntries(set: RepoSet): MenuEntry[] {
  const live = set.paths.filter(reachable);
  const missing: Skip[] = set.paths.filter((p) => !live.includes(p)).map((path) => ({ path, why: "missing" }));
  // Fetch works on the repository: a repo and its worktree share one, so it is fetched once.
  const fetches = owners(live);
  // Counts from the statuses at hand; one that is still unknown counts as possible, the run decides.
  const statuses = knownStatuses(live);
  const unknown = live.filter((p) => !statuses[p]).length;
  const to = remoteTargets(live.filter((p) => statuses[p]), statuses);
  const pulls = to.pull.length + unknown;
  const pushes = to.push.length + unknown;
  const busy = live.some((p) => gitClaims.gitRepos.has(p));
  const none = (n: number) => (n && !busy ? undefined : t.repoGroups.nothing);
  return [
    { group: t.repoGroups.git },
    {
      tiles: [
        { label: t.git.op.Fetch.label, icon: CloudDownload, count: fetches.length, disabled: busy || !fetches.length, run: () => fetchIn(fetches, missing) },
        { label: t.git.op.Pull.label, icon: ArrowDownToLine, count: pulls, hint: t.repoGroups.pullHint, disabled: busy || !pulls, run: () => pull(live, missing) },
        { label: t.git.op.Push.label, icon: ArrowUpFromLine, count: pushes, hint: t.repoGroups.pushHint, disabled: busy || !pushes, run: () => push(live, missing) },
      ],
    },
    { group: t.repoGroups.branches },
    { label: t.repoGroups.switchBranch, icon: ArrowRightLeft, hint: t.repoGroups.switchHint, disabled: none(live.length), run: () => set.openSwitch("switch", live) },
    { label: t.repoGroups.createBranch, icon: GitBranchPlus, hint: t.repoGroups.createHint, disabled: none(live.length), run: () => set.openSwitch("create", live) },
    { label: t.repoGroups.adoptBranch, icon: CopyPlus, hint: t.repoGroups.adoptHint, disabled: none(live.length > 1 ? live.length : 0), run: () => set.openSwitch("adopt", live) },
    { group: t.repoGroups.repos },
    // Allowed during a scan: each repo has its own ticket, the latest answer lands, nothing is disturbed.
    { label: t.sidebar.rescanGroup, icon: RefreshCw, count: fetches.length || undefined, disabled: fetches.length ? undefined : t.repoGroups.nothing, run: () => scanner.rescanAll(fetches) },
    ...(live.length ? [commandsItem(live)] : []),
    ...[prItemsOf(live)].filter((x) => x !== null),
    ...selectEntries(live),
  ];
}
