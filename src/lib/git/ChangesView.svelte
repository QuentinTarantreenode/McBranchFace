<script lang="ts">
  import { untrack } from "svelte";
  import { gitClaims } from "$lib/stores/gitClaims.svelte";
  import { gitStatus } from "$lib/stores/gitStatus.svelte";
  import { identities } from "$lib/stores/identities.svelte";
  import { Check, FoldVertical, UnfoldVertical, CircleCheck, Copy, Ellipsis, ExternalLink, FolderOpen, FolderTree, Layers, Layers2, ListTree, Minus, Plus, Search, SquareDashed, SquareTerminal, Undo2 } from "@lucide/svelte";
  import { fold } from "$lib/stores/fold.svelte";
  import GroupHead from "$lib/ui/GroupHead.svelte";
  import PrBadge from "$lib/components/PrBadge.svelte";
  import ProviderMark from "$lib/components/ProviderMark.svelte";
  import { prItem } from "$lib/components/prMenu";
  import { api } from "$lib/api";
  import { t } from "$lib/i18n/index.svelte";
  import { pooled } from "$lib/pool";
  import RepoName from "$lib/components/RepoName.svelte";
  import { repoName } from "$lib/filter";
  import GroupMark from "$lib/components/GroupMark.svelte";
  import BranchName from "$lib/ui/BranchName.svelte";
  import EmptyState from "$lib/ui/EmptyState.svelte";
  import FolderName from "$lib/ui/FolderName.svelte";
  import RootBadge from "$lib/ui/RootBadge.svelte";
  import IconButton from "$lib/ui/IconButton.svelte";
  import Input from "$lib/ui/Input.svelte";
  import Resizer from "$lib/ui/Resizer.svelte";
  import Segmented from "$lib/ui/Segmented.svelte";
  import Skeleton from "$lib/ui/Skeleton.svelte";
  import { delayed } from "$lib/ui/delay.svelte";
  import { contextmenu, openBelow, type MenuEntry } from "$lib/ui/menu.svelte";
  import { fullText, tooltip } from "$lib/ui/tooltip";
  import { CHANGE_META, groupChanges, splitPath, type ChangeGroup, type ChangeRow, type GroupId } from "./changes";
  import { allReposRows, dirKey, fileKey, oneRepoRows, ROW_REM, type ChangesItem, type IdPiece, type Openness } from "./changesList";
  import VirtualList from "$lib/ui/VirtualList.svelte";
  import { rowAt, rowTops } from "$lib/ui/virtual";
  import CommitBox from "./CommitBox.svelte";
  import DiffView from "./DiffView.svelte";
  import GitError from "./GitError.svelte";
  import { gitStore } from "./gitStore.svelte";
  import { emptySelection, nextSelection, type Selection } from "$lib/selection";
  import { toasts } from "$lib/stores/toasts.svelte";
  import { settings } from "$lib/stores/settings.svelte";
  import { scanResults } from "$lib/stores/scanResults.svelte";
  import { repoSelection } from "$lib/stores/repoSelection.svelte";

  let listWidth = $state(360);
  let paneWidth = $state(1000);
  let filter = $state("");
  const all = $derived(settings.config?.ui.gitChangesAll ?? false);
  const status = $derived(gitStore.repo ? gitStatus.statuses.get(gitStore.repo) : undefined);
  // A clean tree has no file to pick: the list takes the whole width, no blank pane beside "no changes".
  const noDiff = $derived(!!status && !status.entries.length);
  const groups = $derived(groupChanges(status?.entries ?? [], filter));
  const flat = $derived(groups.flatMap((g) => g.rows));
  const stagedCount = $derived(status?.entries.filter((e) => e.staged).length ?? 0);
  const isSelected = (r: ChangeRow, repo = gitStore.repo) => repo === gitStore.repo && gitStore.selectedFile?.path === r.path && gitStore.selectedFile.source === r.source;
  const showSkeleton = delayed(() => !status);

  // ---- all repos ------------------------------------------------------------------------------
  // The sidebar's selection or repo group decides which repos, else all of them; their linked worktrees
  // come along, each with a block of its own.
  const scope = $derived.by(() => {
    const base = repoSelection.repos.length ? repoSelection.repos : scanResults.repos.map((r) => r.info.path);
    return base.flatMap((p) => [p, ...(gitStatus.statuses.get(p)?.worktrees ?? []).filter((w) => !w.isMain && !w.foreign).map((w) => w.path)]);
  });
  const blocks = $derived(scope.map((path) => ({ path, st: gitStatus.statuses.get(path), groups: groupChanges(gitStatus.statuses.get(path)?.entries ?? [], filter) })));
  type Block = (typeof blocks)[number];
  const pending = $derived(blocks.filter((b) => !b.st && !gitStatus.statusFailed.has(b.path)));
  const changed = $derived(blocks.filter((b) => b.st && b.groups.length));
  const clean = $derived(filter ? [] : blocks.filter((b) => b.st && !b.st.entries.length));
  // Under the folder they sit in, in the order of the sidebar: which part of the workspace the changes are in.
  const byFolder = $derived(settings.config?.ui.gitChangesByFolder ?? false);
  const folderOf = (path: string) => identities.rootBadgeOf(gitStatus.ownerOf(path))?.root ?? "";
  const folders = $derived.by(() => {
    const order = settings.config?.roots ?? [];
    const keys = [...new Set([...changed, ...pending].map((b) => folderOf(b.path)))];
    keys.sort((a, b) => order.indexOf(a) - order.indexOf(b));
    return keys.map((root) => ({ root, badge: identities.rootBadgeOf(gitStatus.ownerOf([...changed, ...pending].find((b) => folderOf(b.path) === root)!.path))?.badge, changed: changed.filter((b) => folderOf(b.path) === root), pending: pending.filter((b) => folderOf(b.path) === root) }));
  });
  type Folder = (typeof folders)[number];
  const tree = $derived(settings.config?.ui.gitChangesTree ?? false);
  const STATUSES: GroupId[] = ["conflicts", "staged", "unstaged", "untracked"];
  const repoOpen = (path: string) => fold.isOpen("changesRepos", path);
  const folderOpen = (root: string) => fold.isOpen("changesFolders", root);
  const statusOpen = (id: GroupId) => fold.isOpen("changesStatus", id);
  const dirOpen = (key: string) => fold.isOpen("changesDirs", key);
  // The clean repos start folded: the list is about changes. Stored the other way round, as "opened".
  const cleanOpen = $derived(fold.foldedSet("changesClean").has("open"));
  const toggleClean = () => fold.set("changesClean", "open", cleanOpen);

  // ---- the rows: one virtual list for the tree of folders, repos, status groups and directories ----
  const items = $derived.by((): ChangesItem[] => {
    const open: Openness = { repo: repoOpen, folder: folderOpen, status: statusOpen, dir: dirOpen, clean: cleanOpen };
    if (all) return allReposRows({ folders: byFolder ? folders : null, changed, pending, clean }, tree, open);
    return gitStore.repo && status ? oneRepoRows(gitStore.repo, groups, status.entries, tree, open) : [];
  });
  /** The files as shown, folded ones left out: what the keyboard and the selection walk through. */
  const shown = $derived(items.flatMap((i) => (i.kind === "file" ? [{ repo: i.repo!, r: i.row }] : [])));
  const activeKey = $derived(gitStore.repo && gitStore.selectedFile ? `file:${fileKey(gitStore.repo, gitStore.selectedFile)}` : null);

  // The rows are as high as the CSS draws them, in rem: the list places them in pixels.
  const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
  const heightOf = (i: ChangesItem) => (i.height + i.gap) * rem;

  // The heads the rows at the top belong to stay there: the folder of the row at the top, below it the repo.
  let listTop = $state(0);
  const tops = $derived(rowTops(items.map(heightOf)));
  const stuckFolder = $derived.by(() => {
    if (!items.length) return -1;
    const i = rowAt(tops, listTop);
    return items[i].kind === "folder" ? i : items[i].folderAt;
  });
  const stuckRepo = $derived.by(() => {
    if (!items.length) return -1;
    const i = rowAt(tops, listTop + (stuckFolder >= 0 ? ROW_REM.folder * rem : 0));
    return items[i].kind === "repo" ? i : items[i].repoAt;
  });

  /** Everything folded or unfolded: the repos over all repos, the status groups for one. */
  function foldEverything(open: boolean) {
    if (all) {
      fold.setAll("changesRepos", changed.map((b) => b.path), open);
      if (byFolder) fold.setAll("changesFolders", folders.map((f) => f.root), open);
    } else fold.setAll("changesStatus", STATUSES, open);
    if (open) fold.setAll("changesDirs", fold.folded("changesDirs"), true);
  }
  const anyOpen = $derived(all ? changed.some((b) => repoOpen(b.path)) : groups.some((g) => statusOpen(g.id)));
  const statusFoldAll = $derived({ anyOpen: STATUSES.some(statusOpen), run: (open: boolean) => fold.setAll("changesStatus", STATUSES, open) });
  const repoFoldAll = $derived({ anyOpen: changed.some((b) => repoOpen(b.path)), run: (open: boolean) => fold.setAll("changesRepos", changed.map((b) => b.path), open) });
  const folderFoldAll = $derived({ anyOpen: folders.some((f) => folderOpen(f.root)), run: (open: boolean) => fold.setAll("changesFolders", folders.map((f) => f.root), open) });

  // Worktrees have no status until asked: the overview asks for them, a few at a time. Paths on their
  // way count as asked, else every status that arrives would request the rest once more.
  const requested = new Set<string>();
  $effect(() => {
    if (!all) return;
    const paths = scope;
    const missing = untrack(() => paths.filter((p) => !requested.has(p) && !gitStatus.statuses.has(p) && !gitStatus.statusFailed.has(p)));
    if (!missing.length) return;
    for (const p of missing) requested.add(p);
    void pooled(missing, 4, (p) => gitStatus.refreshStatus(p).finally(() => requested.delete(p)));
  });

  /** A file or an action of another repo opens that repo first: the diff, the commit box and the git commands follow it. */
  function openIn(repo: string, sel?: { path: string; source: ChangeRow["source"] }) {
    if (repo !== gitStore.repo) {
      repoSelection.gitRepo = repo;
      gitStore.setRepo(repo);
    }
    if (sel) gitStore.selectFile(sel);
  }
  const busyIn = (repo: string) => (repo === gitStore.repo ? gitStore.locked : !!gitClaims.gitRunning(repo));

  // The first file is shown right away, so the diff pane is never empty while there are changes; over
  // all repos that may be a file of another repo when the open one has none.
  $effect(() => {
    if (!(all && !flat.length && shown.length && status)) return;
    const first = shown[0];
    untrack(() => openIn(first.repo, { path: first.r.path, source: first.r.source }));
  });
  // Follows the rows only: the selection it writes must not run it again.
  $effect(() => {
    const rows = flat;
    void gitStore.repo;
    untrack(() => {
      if (!gitStore.selectedFile && rows.length) gitStore.selectFile({ path: rows[0].path, source: rows[0].source });
      if (gitStore.selectedFile && !rows.some((r) => isSelected(r))) gitStore.selectFile(rows[0] ? { path: rows[0].path, source: rows[0].source } : null);
    });
  });

  function absolute(repo: string, path: string) {
    return `${repo}/${path}`;
  }

  function stage(repo: string, paths: string[]) {
    openIn(repo);
    gitStore.stage(paths);
  }
  function unstage(repo: string, paths: string[]) {
    openIn(repo);
    gitStore.unstage(paths);
  }

  function toggleStage(r: ChangeRow, repo: string) {
    if (r.source === "Staged") unstage(repo, [r.path]);
    else if (r.change !== "Conflict") stage(repo, [r.path]);
  }

  function discard(rows: ChangeRow[], repo: string) {
    const tracked = rows.filter((r) => r.source === "Unstaged" && r.change !== "Conflict").map((r) => r.path);
    const untracked = rows.filter((r) => r.source === "Untracked").map((r) => r.path);
    if (!tracked.length && !untracked.length) return;
    openIn(repo);
    gitStore.requestDiscard(tracked, untracked);
  }

  function groupAction(g: ChangeGroup, repo: string) {
    if (g.id === "staged") unstage(repo, g.rows.map((r) => r.path));
    else if (g.id !== "conflicts") stage(repo, g.rows.map((r) => r.path));
  }

  // Everything that is not staged yet, in one go: the head of a repo block offers it.
  const unstagedOf = (b: Block) => b.groups.filter((g) => g.id === "unstaged" || g.id === "untracked").flatMap((g) => g.rows.map((r) => r.path));

  // ---- several files at once: Ctrl and Shift as in a file manager; the diff shows the one in front ----
  // Sets for the lookups: every row asks whether it is chosen, and thousands of files select at once.
  const keyOf = fileKey;
  const order = $derived(shown.map((x) => keyOf(x.repo, x.r)));
  const inOrder = $derived(new Set(order));
  let picked = $state<Selection>(emptySelection);
  // What is no longer shown (staged away, folded) leaves the selection.
  const chosen = $derived(picked.items.filter((k) => inOrder.has(k)));
  const chosenSet = $derived(new Set(chosen));
  const isChosen = (r: ChangeRow, repo: string) => chosen.length > 1 && chosenSet.has(keyOf(repo, r));
  const chosenRows = () => shown.filter((x) => chosenSet.has(keyOf(x.repo, x.r)));

  function show(k: string | null) {
    const x = k ? shown.find((y) => keyOf(y.repo, y.r) === k) : undefined;
    if (x) openIn(x.repo, { path: x.r.path, source: x.r.source });
  }

  function pick(r: ChangeRow, repo: string, e: MouseEvent) {
    const k = keyOf(repo, r);
    const mod = e.ctrlKey || e.metaKey;
    picked = mod || e.shiftKey ? nextSelection({ ...picked, items: chosen }, { kind: "click", id: k, ctrl: mod, shift: e.shiftKey }, order) : { items: [k], anchor: k, focus: k };
    show(picked.focus ?? k);
  }

  function move(delta: number, shift = false) {
    const at = shown.findIndex((x) => isSelected(x.r, x.repo));
    const from = at < 0 ? null : keyOf(shown[at].repo, shown[at].r);
    picked = nextSelection({ items: chosen.length ? chosen : from ? [from] : [], anchor: picked.anchor ?? from, focus: from }, { kind: "move", delta, shift }, order);
    show(picked.focus);
  }

  /** Space on several: each file to the other side, per repo, staged ones out and the rest in. */
  async function toggleChosen() {
    const byRepo = new Map<string, ChangeRow[]>();
    for (const x of chosenRows()) byRepo.set(x.repo, [...(byRepo.get(x.repo) ?? []), x.r]);
    for (const [repo, rows] of byRepo) {
      if (busyIn(repo)) continue;
      const out = rows.filter((r) => r.source === "Staged").map((r) => r.path);
      const into = rows.filter((r) => r.source !== "Staged").map((r) => r.path);
      openIn(repo);
      if (out.length) await gitStore.unstage(out);
      if (into.length) await gitStore.stage(into);
    }
  }

  function onKey(e: KeyboardEvent) {
    const sel = flat.find((r) => isSelected(r));
    const repo = gitStore.repo;
    const mod = e.ctrlKey || e.metaKey;
    if (e.key === "ArrowDown" || e.key === "j") move(1, e.shiftKey);
    else if (e.key === "ArrowUp" || e.key === "k") move(-1, e.shiftKey);
    else if (mod && e.key.toLowerCase() === "a") picked = nextSelection(picked, { kind: "all" }, order);
    else if (e.key === "Escape" && chosen.length > 1) picked = emptySelection;
    else if (e.key === " " && chosen.length > 1) void toggleChosen();
    else if (e.key === "Delete" && chosen.length > 1 && repo && !busyIn(repo)) discard(chosenRows().filter((x) => x.repo === repo).map((x) => x.r), repo);
    else if (repo && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
      // Left folds the group of the selected file (its repo over all repos), right opens it again.
      const open = e.key === "ArrowRight";
      if (e.altKey) foldEverything(open);
      else if (all) fold.set("changesRepos", repo, open);
      else if (sel) fold.set("changesStatus", groups.find((g) => g.rows.includes(sel))?.id ?? "unstaged", open);
    } else if (e.key === " " && sel && repo && !busyIn(repo)) toggleStage(sel, repo);
    else if (e.key === "Delete" && sel && repo && !busyIn(repo)) discard([sel], repo);
    else return;
    e.preventDefault();
  }

  // ---- batch actions: a status group, a repo, a folder ------------------------------------------
  const stagedOf = (b: Block) => b.groups.filter((g) => g.id === "staged").flatMap((g) => g.rows.map((r) => r.path));
  const discardableOf = (b: Block) => b.groups.filter((g) => g.id === "unstaged" || g.id === "untracked").flatMap((g) => g.rows);

  /** One repo after the other: each opens, does its part, and the next follows. */
  async function inEach(list: Block[], part: (b: Block) => string[], act: "stage" | "unstage") {
    for (const b of list) {
      const paths = part(b);
      if (!paths.length) continue;
      openIn(b.path);
      await (act === "stage" ? gitStore.stage(paths) : gitStore.unstage(paths));
    }
  }

  function groupMenu(g: ChangeGroup, repo: string): MenuEntry[] {
    const busy = busyIn(repo);
    const paths = g.rows.map((r) => r.path);
    const keys = g.rows.map((r) => keyOf(repo, r));
    return [
      { heading: `${t.git.groups[g.id]} · ${g.rows.length}` },
      { group: t.select.group },
      { label: t.git.selectGroup(g.rows.length), keys: "Ctrl+A", run: () => (picked = nextSelection(picked, { kind: "set", ids: keys, mode: "only" }, order)) },
      { label: t.select.none, keys: "Esc", disabled: chosen.length < 2, run: () => (picked = emptySelection) },
      "sep",
      {
        tiles: [
          ...(g.id === "staged" ? [{ label: t.git.unstageAll, icon: Minus, disabled: busy, run: () => unstage(repo, paths) }] : []),
          ...(g.id === "unstaged" || g.id === "untracked" ? [{ label: t.git.stageAll, icon: Plus, disabled: busy, run: () => stage(repo, paths) }] : []),
          ...(g.id === "conflicts" ? [{ label: t.git.resolveAll, icon: Check, disabled: busy, run: () => stage(repo, paths) }] : []),
          { label: t.common.copyPaths, icon: Copy, run: () => toasts.copy(paths.join("\n")) },
        ],
      },
      ...(g.id === "unstaged" || g.id === "untracked" ? ["sep" as const, { label: t.git.discardAll, icon: Undo2, danger: true, disabled: busy, run: () => discard(g.rows, repo) }] : []),
    ];
  }

  function repoMenu(b: Block): MenuEntry[] {
    const busy = busyIn(b.path);
    const unstaged = unstagedOf(b);
    const staged = stagedOf(b);
    const dropping = discardableOf(b);
    return [
      { heading: repoName(b.path) },
      {
        tiles: [
          { label: t.git.stageAll, icon: Plus, disabled: busy || !unstaged.length, run: () => stage(b.path, unstaged) },
          { label: t.git.unstageAll, icon: Minus, disabled: busy || !staged.length, run: () => unstage(b.path, staged) },
          { label: t.common.openFolder, icon: FolderOpen, run: () => toasts.safely(() => api.openFolder(b.path)) },
          { label: t.common.openTerminal, icon: SquareTerminal, run: () => toasts.safely(() => api.openTerminal(b.path)) },
        ],
      },
      { group: t.git.repoGroup },
      { label: t.git.openRepo, icon: ExternalLink, hint: t.git.openRepoTip, run: () => openIn(b.path) },
      ...[prItem(b.path)].filter((x) => x !== null),
      ...(dropping.length ? ["sep" as const, { label: t.git.discardAllIn(dropping.length), icon: Undo2, danger: true, disabled: busy, run: () => discard(dropping, b.path) }] : []),
    ];
  }

  function folderMenu(f: { root: string; changed: Block[] }): MenuEntry[] {
    const busy = f.changed.some((b) => busyIn(b.path));
    const toStage = f.changed.filter((b) => unstagedOf(b).length);
    const toUnstage = f.changed.filter((b) => stagedOf(b).length);
    return [
      { heading: f.root },
      {
        tiles: [
          { label: t.git.stageAllRepos(toStage.length), icon: Plus, disabled: busy || !toStage.length, run: () => inEach(toStage, unstagedOf, "stage") },
          { label: t.git.unstageAllRepos(toUnstage.length), icon: Minus, disabled: busy || !toUnstage.length, run: () => inEach(toUnstage, stagedOf, "unstage") },
          { label: t.common.openFolder, icon: FolderOpen, run: () => toasts.safely(() => api.openFolder(f.root)) },
        ],
      },
      "sep",
      f.changed.some((b) => repoOpen(b.path))
        ? { label: t.git.foldAll, icon: FoldVertical, run: () => fold.setAll("changesRepos", f.changed.map((b) => b.path), false) }
        : { label: t.git.unfoldAll, icon: UnfoldVertical, run: () => fold.setAll("changesRepos", f.changed.map((b) => b.path), true) },
    ];
  }

  function menuFor(r: ChangeRow, repo: string): MenuEntry[] {
    const busy = busyIn(repo);
    const primary: MenuEntry =
      r.change === "Conflict"
        ? { label: t.git.markResolved, icon: Check, disabled: busy, run: () => stage(repo, [r.path]) }
        : r.source === "Staged"
          ? { label: t.git.unstage, icon: Minus, keys: "Space", disabled: busy, run: () => unstage(repo, [r.path]) }
          : { label: t.git.stage, icon: Plus, keys: "Space", disabled: busy, run: () => stage(repo, [r.path]) };
    const canDiscard = r.change !== "Conflict" && r.source !== "Staged";
    return [
      { heading: splitPath(r.path).name },
      {
        tiles: [
          { label: t.git.openEditor, icon: ExternalLink, run: () => toasts.safely(() => api.openFile(absolute(repo, r.path))) },
          { label: t.common.revealFile, icon: FolderOpen, run: () => toasts.safely(() => api.revealPath(absolute(repo, r.path))) },
          { label: t.common.copyPath, icon: Copy, run: () => toasts.copy(r.path) },
        ],
      },
      { group: t.git.fileGroup },
      primary,
      ...(canDiscard ? ["sep" as const, { label: t.git.discard, icon: Undo2, keys: "Del", danger: true, disabled: busy, run: () => discard([r], repo) }] : []),
    ];
  }
</script>

<!-- One changed file: its kind of change, its name, its directory, and what to do with it. -->
{#snippet fileRow(r: ChangeRow, repo: string, busy: boolean, partly: Set<string>, showDir: boolean)}
  {@const meta = CHANGE_META[r.change]}
  {@const p = splitPath(r.path)}
  {@const selected = isSelected(r, repo)}
  <!-- Keys belong to the list: arrows, Space and Delete in the list's handler. -->
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <div
    role="option"
    aria-selected={selected || isChosen(r, repo)}
    tabindex="-1"
    class="group flex h-7 cursor-pointer items-center gap-2 rounded-md pr-1 pl-2 text-sm {selected ? (chosen.length > 1 ? 'mbf-selected mbf-current' : 'mbf-selected') : isChosen(r, repo) ? 'mbf-selected' : 'hover:bg-hover/70'}"
    use:tooltip={{ title: r.path, text: t.changesRow.clickTip }}
    onclick={(e) => pick(r, repo, e)}
    use:contextmenu={() => menuFor(r, repo)}
  >
    <span class="w-3 shrink-0 text-center font-mono text-xs font-bold {meta.tone}" use:tooltip={t.git.change[r.change]}>{meta.short}</span>
    <span class="min-w-0 flex-1 truncate" use:tooltip={r.origPath ? { title: `${r.origPath} → ${r.path}`, text: t.changesRow.clickTip } : null}>
      <span class="text-fg">{p.name}</span>{#if showDir}<span class="ml-1.5 text-faint">{p.dir}</span>{/if}
    </span>
    {#if partly.has(r.path)}<span class="shrink-0 text-faint" use:tooltip={t.git.partlyStaged}><Layers2 size={13} /></span>{/if}
    <span class="flex gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100 {selected ? 'opacity-100' : ''}">
      {#if r.change === "Conflict"}
        <IconButton class="!size-6" icon={ExternalLink} size="sm" label={t.git.resolveEditor} onclick={(e) => { e.stopPropagation(); toasts.safely(() => api.openFile(absolute(repo, r.path))); }} />
        <IconButton class="!size-6" icon={Check} size="sm" label={t.git.markResolved} disabled={busy} onclick={(e) => { e.stopPropagation(); stage(repo, [r.path]); }} />
      {:else if r.source === "Staged"}
        <IconButton class="!size-6" icon={Minus} size="sm" label={t.git.unstage} keys="Space" disabled={busy} onclick={(e) => { e.stopPropagation(); unstage(repo, [r.path]); }} />
      {:else}
        <IconButton class="!size-6" icon={Plus} size="sm" label={t.git.stage} keys="Space" disabled={busy} onclick={(e) => { e.stopPropagation(); stage(repo, [r.path]); }} />
        <IconButton class="!size-6" icon={Undo2} size="sm" tone="danger" label={t.git.discard} keys="Del" disabled={busy} onclick={(e) => { e.stopPropagation(); discard([r], repo); }} />
      {/if}
    </span>
  </div>
{/snippet}

<!-- A status group of one repo, as git sees it; folds with everything under it. -->
{#snippet statusHead(g: ChangeGroup, repo: string)}
  {@const busy = busyIn(repo)}
  <GroupHead
    level={3}
    title={t.git.groups[g.id]}
    count={g.rows.length}
    open={statusOpen(g.id)}
    ontoggle={() => fold.toggle("changesStatus", g.id)}
    foldAll={statusFoldAll}
    tone={g.id === "conflicts" ? "text-unsafe" : ""}
    menu={() => groupMenu(g, repo)}
  >
    {#snippet actions()}
      {#if g.id === "unstaged" || g.id === "untracked"}
        <IconButton class="!size-6" icon={Undo2} size="sm" tone="danger" label={t.git.discardAll} disabled={busy} onclick={() => discard(g.rows, repo)} />
      {/if}
    {/snippet}
    {#snippet tools()}
      {#if g.id === "staged"}
        <IconButton class="!size-6" icon={Minus} size="sm" label={t.git.unstageAll} disabled={busy} onclick={() => groupAction(g, repo)} />
      {:else if g.id !== "conflicts"}
        <IconButton class="!size-6" icon={Plus} size="sm" label={t.git.stageAll} disabled={busy} onclick={() => groupAction(g, repo)} />
      {/if}
    {/snippet}
  </GroupHead>
{/snippet}

<!-- The head of one repo: whose files they are, and staging all of them at once. -->
{#snippet repoHead(b: Block)}
  {@const unstaged = unstagedOf(b)}
  <GroupHead
    level={2}
    title={repoName(b.path)}
    open={repoOpen(b.path)}
    ontoggle={() => fold.toggle("changesRepos", b.path)}
    onopen={() => openIn(b.path)}
    foldAll={repoFoldAll}
    menu={() => repoMenu(b)}
    class="bg-panel {b.path === gitStore.repo ? 'mbf-current-head' : ''}"
  >
    {#snippet label()}
      <span class="flex min-w-0 shrink items-center rounded {gitStatus.isRefreshing(b.path) ? 'mbf-refreshing' : ''}" use:tooltip={gitStatus.isStale(b.path) ? t.common.staleStatus : t.git.openRepoTip}><RepoName path={b.path} /></span>
      {#if b.st?.head.branch}<span class="flex min-w-0 shrink-[2] font-normal text-muted"><BranchName name={b.st.head.branch} size="xs" quiet /></span>{/if}
      <span class="mbf-count shrink-0 font-normal">{b.st?.entries.length ?? 0}</span>
    {/snippet}
    {#snippet tools()}
      <ProviderMark path={b.path} size="xs" />
      <PrBadge path={b.path} />
      {#if unstaged.length}
        <IconButton class="!size-6" icon={Plus} size="sm" label={t.git.stageAllIn(unstaged.length)} disabled={busyIn(b.path)} onclick={() => stage(b.path, unstaged)} />
      {/if}
      <IconButton class="!size-6" icon={Ellipsis} size="sm" label={t.git.repoActions} aria-haspopup="menu" onclick={(e) => openBelow(e.currentTarget as HTMLElement, repoMenu(b), repoName(b.path))} />
    {/snippet}
  </GroupHead>
{/snippet}

<!-- What one row of the list shows. -->
{#snippet content(it: ChangesItem)}
  {#if it.kind === "file"}
    {@render fileRow(it.row, it.repo!, busyIn(it.repo!), it.partly, it.showDir)}
  {:else if it.kind === "status"}
    {@render statusHead(it.group, it.repo!)}
  {:else if it.kind === "dir"}
    {@const key = dirKey(it.repo!, it.group, it.dir)}
    {@const repo = it.repo!}
    {@const g = it.group}
    <GroupHead
      level={3}
      title={it.dir}
      count={it.count}
      open={dirOpen(key)}
      ontoggle={() => fold.toggle("changesDirs", key)}
      foldAll={{ anyOpen: it.dirs.some((d) => dirOpen(dirKey(repo, g, d))), run: (open) => fold.setAll("changesDirs", it.dirs.map((d) => dirKey(repo, g, d)), open) }}
      class="font-normal"
    >
      {#snippet label()}<FolderOpen size={13} class="shrink-0 text-faint" /><span class="truncate" use:fullText={it.dir}>{it.dir}</span>{/snippet}
    </GroupHead>
  {:else if it.kind === "repo"}
    {@render repoHead(it.block)}
  {:else if it.kind === "folder"}
    {@const f = it.folder as Folder}
    <GroupHead level={1} title={f.root} count={f.changed.length} open={folderOpen(f.root)} ontoggle={() => fold.toggle("changesFolders", f.root)} foldAll={folderFoldAll} menu={() => folderMenu(f)}>
      {#snippet label()}{#if f.badge}<RootBadge badge={f.badge} root={f.root} />{/if}<FolderName path={f.root} class="truncate" />{/snippet}
      {#snippet tools()}
        <IconButton icon={Ellipsis} size="sm" label={t.git.folderActions} aria-haspopup="menu" onclick={(e) => openBelow(e.currentTarget as HTMLElement, folderMenu(f), f.root)} />
      {/snippet}
    </GroupHead>
  {:else if it.kind === "pending"}
    {@const b = it.block}
    <!-- Its status is on its way: whose files are coming is known, the head is there with its menu, only the list below is waiting. -->
    <div class="flex h-7 min-w-0 items-center gap-1.5 rounded-md pr-1 pl-6 text-sm font-medium mbf-refreshing" use:contextmenu={() => repoMenu(b)}>
      <span class="flex min-w-0 shrink items-center"><RepoName path={b.path} /></span>
      <span class="flex-1"></span>
      <PrBadge path={b.path} />
      <IconButton class="!size-6" icon={Ellipsis} size="sm" label={t.git.repoActions} aria-haspopup="menu" onclick={(e) => openBelow(e.currentTarget as HTMLElement, repoMenu(b), repoName(b.path))} />
    </div>
  {:else if it.kind === "skeleton"}
    <div class="py-1" aria-busy="true">
      <Skeleton class="h-3 w-24" />
      <Skeleton class="mt-2 h-3 w-2/3" />
    </div>
  {:else if it.kind === "cleanHead"}
    <div class="pt-1">
      <GroupHead level={3} title={t.git.cleanRepos(it.count)} open={cleanOpen} ontoggle={toggleClean}>
        {#snippet label()}<CircleCheck size={13} class="shrink-0 text-safe" /><span class="truncate">{t.git.cleanRepos(it.count)}</span>{/snippet}
      </GroupHead>
    </div>
  {:else if it.kind === "clean"}
    {@const path = it.path}
    <button type="button" class="flex h-7 w-full items-center gap-1.5 rounded-md px-2 text-left text-sm hover:bg-hover/70" use:tooltip={t.git.openRepoTip} onclick={() => openIn(path)}>
      <span class="flex min-w-0 items-center"><RepoName path={path} /></span>
    </button>
  {/if}
{/snippet}

<!-- The tree around a row, drawn row by row: the guide line of each level above it, and inside its folder's
     guide its piece of the repo's identity line. The pieces of consecutive rows meet without a seam. -->
{#snippet nest(it: ChangesItem, piece: IdPiece | null, level: number)}
  {#if level < it.outer}
    <div class="mbf-guide h-full">{@render nest(it, piece, level + 1)}</div>
  {:else if level === it.outer && it.repo}
    <div class="mbf-id-seg h-full" data-piece={piece} style="--tint-line: {identities.tintOf(it.repo) ?? 'transparent'}">{@render guides(it, 0)}</div>
  {:else}
    {@render guides(it, 0)}
  {/if}
{/snippet}
{#snippet guides(it: ChangesItem, level: number)}
  {#if level < it.inner}
    <div class="mbf-guide h-full">{@render guides(it, level + 1)}</div>
  {:else}
    {@render content(it)}
  {/if}
{/snippet}
{#snippet listRow(it: ChangesItem, piece: IdPiece | null)}
  {#if it.kind !== "pad"}
    <div class="min-w-0" style="height: {it.height * rem}px">{@render nest(it, piece, 0)}</div>
  {/if}
{/snippet}

<!-- The folder and repo the rows at the top belong to stay there while those rows scroll under them. -->
{#snippet stuckHeads()}
  {#if stuckFolder >= 0}
    <div class="absolute inset-x-0 top-0">{@render listRow(items[stuckFolder], null)}</div>
  {/if}
  {#if stuckRepo >= 0}
    {@const head = items[stuckRepo]}
    <div class="absolute inset-x-0" style="top: {stuckFolder >= 0 ? ROW_REM.folder * rem : 0}px">{@render listRow(head, head.id === "only" ? "only" : "mid")}</div>
  {/if}
{/snippet}

<div class="flex min-h-0 flex-1" bind:clientWidth={paneWidth}>
  <div
    class="relative flex flex-col {noDiff ? 'min-w-0 flex-1' : 'shrink-0 border-r border-line'}"
    style={noDiff ? undefined : `width: ${Math.min(listWidth, Math.max(260, paneWidth - 320))}px`}
  >
    <div class="flex shrink-0 flex-col gap-2 border-b border-line p-2">
      <div class="flex items-center gap-1.5">
        <Segmented
          label={t.git.changesScope}
          value={all ? "all" : "one"}
          options={[
            { id: "one", label: t.git.thisRepo, icon: SquareDashed, tip: t.git.thisRepoTip },
            { id: "all", label: t.git.allRepos, icon: Layers, tip: repoSelection.repos.length ? t.git.allReposSelectionTip : t.git.allReposTip },
          ]}
          onchange={(v) => settings.setUi({ gitChangesAll: v === "all" })}
        />
        {#if all && identities.activeRepoGroup}
          <span class="flex min-w-0 items-center gap-1.5 text-sm" use:tooltip={t.git.groupScopeTip}>
            <GroupMark id={identities.activeRepoGroup.id} /><span class="min-w-0 truncate">{identities.activeRepoGroup.name}</span>
          </span>
        {/if}
        <span class="flex-1"></span>
        {#if all}
          <IconButton icon={FolderTree} size="sm" label={t.git.byFolder} hint={t.git.byFolderTip} active={byFolder} onclick={() => settings.setUi({ gitChangesByFolder: !byFolder })} />
        {/if}
        <IconButton icon={ListTree} size="sm" label={t.git.byDir} hint={t.git.byDirTip} active={tree} onclick={() => settings.setUi({ gitChangesTree: !tree })} />
        <IconButton icon={anyOpen ? FoldVertical : UnfoldVertical} size="sm" label={anyOpen ? t.git.foldEverything : t.git.unfoldEverything} keys="Alt+← →" onclick={() => foldEverything(!anyOpen)} />
      </div>
      <Input bind:value={filter} icon={Search} placeholder={t.git.filterFiles} aria-label={t.git.filterFiles} clearable />
    </div>
    {#if all && !changed.length && !pending.length}
      <div class="min-h-0 flex-1">
        {#if filter}<EmptyState title={t.common.noMatch} />{:else}<EmptyState icon={CircleCheck} title={t.git.allClean} text={t.git.allCleanText(clean.length)} />{/if}
      </div>
    {:else if !all && !status}
      {#if showSkeleton.value}
        <div class="min-h-0 flex-1 px-3 py-3" aria-busy="true">
          <Skeleton class="h-2.5 w-20" />
          {#each [0, 1, 2, 3, 4] as i (i)}
            <div class="mt-3 flex items-center gap-2"><Skeleton class="h-3 w-3" /><Skeleton class={i % 2 ? "h-3 w-1/2" : "h-3 w-2/3"} /></div>
          {/each}
        </div>
      {:else}
        <div class="min-h-0 flex-1"></div>
      {/if}
    {:else if !all && flat.length === 0}
      <div class="min-h-0 flex-1">
        {#if filter}
          <EmptyState title={t.common.noMatch} />
        {:else}
          <EmptyState icon={CircleCheck} title={t.git.clean} text={t.git.cleanText} />
        {/if}
      </div>
    {:else}
      <!-- Only the rows in view are in the page: a working copy with thousands of changed files stays quick. -->
      <VirtualList
        {items}
        rowHeight={ROW_REM.file * rem}
        {heightOf}
        key={(it) => it.key}
        {activeKey}
        bind:scrollTop={listTop}
        class="flex-1 px-1 [scrollbar-gutter:auto]! pop-in"
        label={t.git.changedFiles}
        onkeydown={onKey}
      >
        {#snippet row(it)}{@render listRow(it, it.id)}{/snippet}
        {#snippet sticky()}{@render stuckHeads()}{/snippet}
      </VirtualList>
    {/if}
    <CommitBox staged={stagedCount} repo={gitStore.repo} />
    {#if !noDiff}<Resizer width={Math.min(listWidth, Math.max(260, paneWidth - 320))} min={260} max={Math.max(260, paneWidth - 320)} side="right" oninput={(w) => (listWidth = w)} onreset={() => (listWidth = 360)} />{/if}
  </div>
  {#if !noDiff}
    <div class="flex min-w-0 flex-1 flex-col">
      <GitError of={["diff"]} class="mx-3 mt-2" />
      <div class="min-h-0 flex-1">
        <!-- The source is that of the diff on screen, which stays the previous file's until the new one lands. -->
        <DiffView
          diff={gitStore.diff}
          loading={gitStore.diffLoading}
          source={gitStore.diffFor?.source ?? null}
          stale={gitStore.diffFor !== gitStore.selectedFile}
          onloadfull={() => gitStore.selectedFile && gitStore.selectFile(gitStore.selectedFile, true)}
        />
      </div>
    </div>
  {/if}
</div>
