// One menu for one working copy, wherever it is clicked: its card, its line below the card, its row in a
// repo group. The place adds only what belongs to it (take it out of the group, remove the worktree); the
// rest is the same, so a repo offers the same things everywhere.
import {
  ArrowDownToLine, ArrowRightLeft, ArrowUpFromLine, Boxes, CloudDownload, Copy, CopyPlus, ExternalLink, FolderOpen, GitFork, GitGraph, Globe, GlobeLock, Lock, LockOpen,
  Palette, Plus, RefreshCw, SquareTerminal, Tags, Trash2, X,
} from "@lucide/svelte";
import { api } from "$lib/api";
import type { RepoGroup } from "$lib/bindings/RepoGroup";
import { copyBranchEntries } from "$lib/branchCopy";
import { repoName } from "$lib/filter";
import { fetchIn } from "$lib/services/groupActions";
import { t } from "$lib/i18n/index.svelte";
import { newTo, remoteTargets, withRemoved } from "$lib/repoGroups";
import { gitClaims } from "$lib/stores/gitClaims.svelte";
import { gitStatus } from "$lib/stores/gitStatus.svelte";
import { identities } from "$lib/stores/identities.svelte";
import { sidebarUi } from "$lib/stores/sidebarUi.svelte";
import type { MenuEntry } from "$lib/ui/menu.svelte";
import { commandsItem } from "./commandMenu";
import { prItem } from "./prMenu";
import { dropRepos, groupTarget } from "./repoGroupDrop.svelte";
import { openInGit } from "./openInGit";
import { knownStatuses, pull, push } from "./setMenu";
import { toasts } from "$lib/stores/toasts.svelte";
import { settings } from "$lib/stores/settings.svelte";
import { dialogs } from "$lib/stores/dialogs.svelte";
import { scanResults } from "$lib/stores/scanResults.svelte";
import { rules } from "$lib/stores/rules.svelte";
import { repoSelection } from "$lib/stores/repoSelection.svelte";
import { scanner } from "$lib/services/scanner.svelte";
import { repoActions } from "$lib/services/repoActions.svelte";

export { openInGit };

/** The keyboard way to what dragging a card onto a group does; marked repos come along. */
function addToGroupItem(path: string): MenuEntry {
  const marked = repoSelection.repos;
  const paths = marked.length > 1 && marked.includes(path) ? marked : [path];
  const groups = settings.config?.repoGroups ?? [];
  return {
    label: t.repoGroups.addToMenu,
    icon: Boxes,
    hint: paths.length > 1 ? t.repoGroups.dragging(paths.length) : undefined,
    submenu: [
      ...groups.map((g) => ({
        label: g.name,
        disabled: newTo(g, paths).length ? undefined : t.repoGroups.alreadyIn(g.name),
        run: () => dropRepos({ paths, from: null }, groupTarget(g.id), false),
      })),
      ...(groups.length ? ["sep" as const] : []),
      { label: t.repoGroups.addToNew, icon: Plus, run: () => dropRepos({ paths, from: null }, "new", false) },
    ],
    run: () => {},
  };
}

export interface CopyPlace {
  /** Listed in this repo group: the menu can take it out again. */
  group?: RepoGroup;
  /** Shown on its own line (a worktree): the line offers to switch its branch there. */
  switchBranch?: () => void;
}

export function copyMenu(path: string, place: CopyPlace = {}): MenuEntry[] {
  const owner = gitStatus.ownerOf(path);
  const repo = scanResults.repos.find((r) => r.info.path === path);
  const missing = repo ? repo.result?.errorKind === "RepoMissing" : owner === path && !gitStatus.statuses.get(path);
  const takeOut: MenuEntry[] = place.group
    ? [
        "sep",
        {
          label: t.repoGroups.takeOut,
          icon: X,
          run: () => repoActions.setRepoGroups(withRemoved(settings.config?.repoGroups ?? [], place.group!.id, [path]), t.repoGroups.takenOut(1, place.group!.name)),
        },
      ]
    : [];
  if (missing) return [{ heading: repoName(path) }, ...takeOut];

  const isWorktree = !repo && owner !== path;
  const ownerEntry = scanResults.repos.find((r) => r.info.path === owner);
  const links = (repo ?? ownerEntry)?.info.links;
  const status = knownStatuses([path])[path];
  const branch = status?.head.branch ?? gitStatus.statuses.get(owner)?.worktrees.find((w) => w.path === path)?.branch ?? null;
  const to = status ? remoteTargets([path], { [path]: status }) : null;
  const busy = gitClaims.gitRepos.has(path);
  // Without a status yet, pull and push are offered: the run checks and says why it left the copy out.
  const canPull = !to || to.pull.length > 0;
  const canPush = !to || to.push.length > 0;
  const locked = rules.isRepoLocked(owner);
  const foreign = repo ? (gitStatus.statuses.get(path)?.worktrees ?? []).filter((w) => !w.isMain && w.foreign) : [];

  return [
    { heading: repoName(path) },
    {
      tiles: [
        { label: t.common.openFolder, icon: FolderOpen, run: () => toasts.safely(() => api.openFolder(path)) },
        { label: t.common.openTerminal, icon: SquareTerminal, run: () => toasts.safely(() => api.openTerminal(path)) },
        { label: t.menu.git, icon: GitGraph, run: () => openInGit(path) },
        ...(links ? [{ label: t.menu.online, icon: ExternalLink, run: () => toasts.safely(() => api.openUrl(links.home)) }] : []),
        { label: t.menu.copyPath, icon: Copy, run: () => toasts.copy(path) },
      ],
    },
    ...(branch ? copyBranchEntries(branch) : []),
    { group: t.repoGroups.git },
    {
      tiles: [
        { label: t.git.op.Fetch.label, icon: CloudDownload, disabled: busy, run: () => fetchIn([owner], []) },
        { label: t.git.op.Pull.label, icon: ArrowDownToLine, hint: canPull ? undefined : t.repoGroups.why.noUpstream, disabled: busy || !canPull, run: () => pull([path], []) },
        { label: t.git.op.Push.label, icon: ArrowUpFromLine, hint: canPush ? undefined : t.repoGroups.why.upToDate, disabled: busy || !canPush, run: () => push([path], []) },
      ],
    },
    ...(place.switchBranch ? [{ label: t.sidebar.switchWorktreeBranch, icon: ArrowRightLeft, hint: t.sidebar.worktreeBranchTip, run: place.switchBranch }] : []),
    { group: isWorktree ? t.menu.worktree : t.menu.repo },
    { label: t.sidebar.rescan, icon: RefreshCw, run: () => scanner.rescan(owner) },
    ...(repo
      ? [
          { label: t.detail.repoAnnotation, icon: Tags, run: () => (sidebarUi.annotating = repo) },
          { label: t.identity.menu, icon: Palette, hint: t.identity.repoHint, run: () => identities.openIdentity("repo", path, repo.info.name) },
        ]
      : []),
    addToGroupItem(path),
    ...(repo ? [{ label: t.copies.menu, icon: CopyPlus, run: () => dialogs.openCopies(path) }] : []),
    commandsItem([path]),
    ...[prItem(owner)].filter((x) => x !== null),
    ...(repo
      ? [
          { group: t.menu.protect },
          locked
            ? { label: t.sidebar.unlockRepo, icon: LockOpen, run: () => rules.setLock(path, null, false) }
            : { label: t.sidebar.lockRepo, icon: Lock, run: () => rules.setLock(path, null, true) },
          settings.config?.onlineExcluded.includes(repo.info.identity)
            ? { label: t.sidebar.onlineOn, icon: Globe, run: () => repoActions.setOnlineExcluded(path, false) }
            : { label: t.sidebar.onlineOff, icon: GlobeLock, run: () => repoActions.setOnlineExcluded(path, true) },
          ...foreign.map((w) => ({ label: t.quick.foreignMenu, hint: repoName(w.path), icon: GitFork, run: () => import("$lib/services/quickSwitch").then((m) => m.forgetForeignWorktree(path, w.path)) })),
        ]
      : []),
    ...takeOut,
    ...(isWorktree ? ["sep" as const, { label: t.copies.removeWorktree, icon: Trash2, danger: true, hint: t.copies.removeWorktreeTip, run: () => repoActions.removeWorktree(owner, path) }] : []),
  ];
}
