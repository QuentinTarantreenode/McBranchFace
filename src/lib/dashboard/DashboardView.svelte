<script lang="ts">
  // What there is to do: the next steps on top, the tiles below as tables. Every line leads to the list of
  // what it names; the button beside it does the one thing right away.
  import {
    ArrowDownToLine, Broom, Check, ChevronRight, CircleAlert, CircleCheck, Clock, CloudUpload, ExternalLink, FileDiff, FolderTree, GitGraph, GitMerge, GitPullRequest,
    History, Hourglass, MessageSquareWarning, Trash2, Undo2, X,
  } from "@lucide/svelte";
  import { untrack } from "svelte";
  import type { Component, Snippet } from "svelte";
  import { repoName } from "$lib/filter";
  import { relativeTime } from "$lib/format";
  import { i18n, t } from "$lib/i18n/index.svelte";
  import { gitStatus } from "$lib/stores/gitStatus.svelte";
  import { identities } from "$lib/stores/identities.svelte";
  import { pullRequests } from "$lib/stores/pullRequests.svelte";
  import Button from "$lib/ui/Button.svelte";
  import IconButton from "$lib/ui/IconButton.svelte";
  import RootBadge from "$lib/ui/RootBadge.svelte";
  import Segmented from "$lib/ui/Segmented.svelte";
  import Skeleton from "$lib/ui/Skeleton.svelte";
  import StatusChip from "$lib/ui/StatusChip.svelte";
  import { fullText, tooltip } from "$lib/ui/tooltip";
  import type { DeletedEntry } from "$lib/bindings/DeletedEntry";
  import { isStashEntry, isWorktreeEntry } from "$lib/deleted";
  import { displayPath } from "$lib/paths";
  import type { PullRequestInfo } from "$lib/bindings/PullRequestInfo";
  import type { RepoStatus } from "$lib/bindings/RepoStatus";
  import { dashboard } from "./dashboard.svelte";
  import { runStep } from "./steps";
  import MiniGrid, { type MiniColumn } from "./MiniGrid.svelte";
  import { prBranches, type DashItem, type DashSection, type DashStep, type PrRow, type TodoKind } from "./model";
  import { settings } from "$lib/stores/settings.svelte";
  import { environment } from "$lib/stores/environment.svelte";
  import { clock } from "$lib/stores/clock.svelte";
  import { dialogs } from "$lib/stores/dialogs.svelte";
  import { scanResults } from "$lib/stores/scanResults.svelte";
  import { repoSelection } from "$lib/stores/repoSelection.svelte";
  import { cleanupView } from "$lib/stores/cleanupView.svelte";
  import { deletes } from "$lib/stores/deletes.svelte";
  import { scanner } from "$lib/services/scanner.svelte";
  import { deleting } from "$lib/services/deleting";

  // On mount, and when new repos, or a repo whose provider a scan just found, bring their pull requests
  // and identities along. Only this key is the cause: what load reads itself (what is loading, what is
  // loaded) must not run it again.
  const providers = $derived(`${scanResults.repos.map((r) => r.info.provider).join()} ${environment.tool("AzureCli")?.state} ${environment.tool("GitHubCli")?.state}`);
  $effect(() => {
    void providers;
    untrack(() => dashboard.load());
  });

  const NEXT = 8;
  const putAside = $derived(Object.keys(settings.config?.ui.dashboardDismissed ?? {}).length);

  const ICON: Record<TodoKind, Component<{ size?: number; class?: string }>> = {
    review: MessageSquareWarning,
    conflict: GitMerge,
    changes: CircleAlert,
    approved: CircleCheck,
    waiting: Clock,
    atRisk: CloudUpload,
    cleanup: Broom,
    worktrees: FolderTree,
    behind: ArrowDownToLine,
    dirty: FileDiff,
  };
  const TONE: Record<TodoKind, string> = {
    review: "text-accent-ink",
    conflict: "text-unsafe-ink",
    changes: "text-unsafe-ink",
    approved: "text-safe-ink",
    waiting: "text-review-ink",
    atRisk: "text-unsafe-ink",
    cleanup: "text-safe-ink",
    worktrees: "text-safe-ink",
    behind: "text-review-ink",
    dirty: "text-review-ink",
  };
  const isServer = (s: DashStep) => s.lens === "onlineMerged";

  /** What it is, in a few words: the column "What". */
  function title(s: DashStep): string {
    const d = t.dashboard.title;
    const pr = s.pr;
    switch (s.kind) {
      case "review":
      case "conflict":
      case "changes":
      case "approved":
      case "waiting":
        return d[s.kind](pr!.id, pr!.title);
      case "atRisk": return d.atRisk;
      case "cleanup": return isServer(s) ? d.cleanupServer : d.cleanupLocal;
      case "worktrees": return d.worktrees;
      case "behind": return d.behind(s.branch ?? "");
      case "dirty": return d.dirty;
    }
  }
  /** Why it is on the list, in one plain sentence: the column "Why". */
  function reason(s: DashStep): string {
    const d = t.dashboard.reason;
    switch (s.kind) {
      case "conflict": return d.conflict(s.pr!.targetRef.replace(/^refs\/heads\//, ""));
      case "waiting": return d.waiting(s.count ?? 0);
      case "cleanup": return isServer(s) ? d.cleanupServer : d.cleanupLocal;
      default: return d[s.kind];
    }
  }
  /** How much, always with its unit: one line, or a number and below it what it is spread over. */
  function size(s: DashStep): { main: string; sub?: string } {
    const z = t.dashboard.size;
    switch (s.kind) {
      case "atRisk": return { main: z.commits(s.count ?? 0), sub: z.onBranches(s.branches ?? 0) };
      case "cleanup": return { main: z.branches(s.count ?? 0) };
      case "worktrees": return { main: z.worktrees(s.count ?? 0) };
      case "behind": return { main: z.commits(s.count ?? 0) };
      case "dirty": return { main: z.files(s.count ?? 0) };
      default: return { main: s.pr?.createdAt ? z.created(relativeTime(s.pr.createdAt, clock.now)) : "" };
    }
  }
  /** The button: verb and object, and what it does in a sentence. */
  function actionOf(s: DashStep): { label: string; tip: string } {
    const a = s.action;
    const l = t.dashboard.actionLabel;
    const tip = t.dashboard.actionTip;
    switch (a.kind) {
      case "delete": return a.scope === "Online" ? { label: l.deleteServer(a.keys.length), tip: tip.deleteServer } : { label: l.delete(a.keys.length), tip: tip.delete };
      case "removeWorktrees": return { label: l.removeWorktrees(a.paths.length), tip: tip.removeWorktrees };
      case "url":
      case "git":
      case "pull":
      case "changes":
        return { label: l[a.kind], tip: tip[a.kind] };
      default: return { label: "", tip: "" };
    }
  }
  /** What a click on the line does, for the foot of its tooltip. */
  function clickOf(s: DashStep): string {
    const o = s.open;
    const c = t.dashboard.clickTip;
    if (o.kind === "focus") return s.pr ? t.dashboard.prRowTip : c.focus(o.keys.length);
    return o.kind === "url" || o.kind === "changes" || o.kind === "history" ? c[o.kind] : "";
  }
  const hasDetail = (s: DashStep) => !!s.pr || (s.items?.length ?? 0) > 0 || (s.split?.length ?? 0) > 1;
  function detailTip(s: DashStep): string {
    const d = t.dashboard.detailTip;
    if (s.pr) return d.pr;
    if (s.kind === "cleanup") return d.cleanup(s.split?.length ?? 0);
    if (s.kind === "atRisk") return d.atRisk(s.items?.length ?? 0);
    if (s.kind === "worktrees") return d.worktrees(s.items?.length ?? 0);
    return d.dirty(s.items?.length ?? 0);
  }

  const nextColumns: MiniColumn<DashStep>[] = $derived([
    { id: "what", label: t.dashboard.nextCol.what, width: "minmax(9rem,1fr)" },
    { id: "why", label: t.dashboard.nextCol.why, width: "minmax(8rem,1.3fr)" },
    { id: "where", label: t.dashboard.nextCol.where, width: "minmax(0,13rem)", tip: t.dashboard.nextColTip.where },
    { id: "size", label: t.dashboard.nextCol.size, width: "max-content", end: true, tip: t.dashboard.nextColTip.size },
    { id: "action", label: t.dashboard.nextCol.action, width: "max-content", tip: t.dashboard.nextColTip.action },
    { id: "aside", label: "", width: "28px" },
  ]);

  /** The reviews of a pull request: approved, changes asked, still open. */
  const reviews = (r: { pr: PullRequestInfo }) => ({
    ok: r.pr.reviewers.filter((x) => x.state === "Approved").length,
    changes: r.pr.reviewers.filter((x) => x.state === "Changes").length,
    open: r.pr.reviewers.filter((x) => x.state === "Pending").length,
  });
  // The display name where the provider has one; the login or e-mail only in the tooltip.
  const authorOf = (r: { pr: PullRequestInfo; mine?: boolean }) => (r.mine ? t.dashboard.you : r.pr.authorName || r.pr.author);

  const prAuthor = (r: PrRow) => authorOf({ pr: r.pr, mine: r.why === "mine" });

  // A line opens the list of what it names; the reason goes with it as the chip of the filtered table.
  const openStep = (s: DashStep) => runStep(s.open, title(s));
  function openPr(r: PrRow) {
    const at = prBranches(dashboard.branches, r);
    void runStep(at ? { kind: "focus", ...at } : { kind: "url", url: r.pr.url }, `#${r.pr.id} ${r.pr.title}`);
  }

  // ---- tiles ----------------------------------------------------------------------------------------
  const byText = (a: string, b: string) => a.localeCompare(b, i18n.locale, { sensitivity: "base" });

  const prColumns: MiniColumn<PrRow>[] = $derived([
    { id: "pr", label: t.dashboard.col.pr, width: "minmax(0,1fr)", sort: (a, b) => a.pr.id - b.pr.id },
    { id: "author", label: t.dashboard.col.author, width: "minmax(0,8rem)", sort: (a, b) => byText(prAuthor(a), prAuthor(b)) },
    { id: "age", label: t.dashboard.col.age, width: "7rem", end: true, sort: (a, b) => (b.pr.createdAt ?? 0) - (a.pr.createdAt ?? 0) },
    { id: "reviews", label: t.dashboard.col.reviews, width: "8.5rem", tip: t.dashboard.colTip.reviews, sort: (a, b) => reviews(b).ok - reviews(a).ok },
    { id: "open", label: "", width: "28px" },
  ]);

  type Changed = { path: string; s: RepoStatus };
  const changed: Changed[] = $derived(
    Object.entries(dashboard.statuses)
      .filter(([, s]) => s.entries.length || s.head.ahead || s.head.behind || s.stashes)
      .map(([path, s]) => ({ path, s }))
      .sort((a, b) => b.s.entries.length - a.s.entries.length),
  );
  const changeColumns: MiniColumn<Changed>[] = $derived([
    { id: "repo", label: t.dashboard.col.repo, width: "minmax(0,1fr)", sort: (a, b) => byText(repoName(a.path), repoName(b.path)) },
    { id: "branch", label: t.dashboard.col.branch, width: "minmax(0,1fr)", sort: (a, b) => byText(a.s.head.branch ?? "", b.s.head.branch ?? "") },
    { id: "changed", label: t.dashboard.col.changed, width: "5.5rem", end: true, tip: t.dashboard.colTip.changed, sort: (a, b) => b.s.entries.length - a.s.entries.length },
    { id: "ahead", label: t.dashboard.col.ahead, width: "4rem", end: true, tip: t.dashboard.colTip.ahead, sort: (a, b) => b.s.head.ahead - a.s.head.ahead },
    { id: "behind", label: t.dashboard.col.behind, width: "4rem", end: true, tip: t.dashboard.colTip.behind, sort: (a, b) => b.s.head.behind - a.s.head.behind },
    { id: "stash", label: t.dashboard.col.stash, width: "4rem", end: true, tip: t.dashboard.colTip.stash, sort: (a, b) => b.s.stashes - a.s.stashes },
  ]);

  type Tree = { repo: string; path: string; branch: string | null; merged: boolean; unpushed: number; dirty: number };
  // A worktree that is also scanned as a repo of its own is listed by both: once is enough.
  const trees: Tree[] = $derived.by(() => {
    const seen = new Map<string, Tree>();
    for (const r of dashboard.repos) {
      const merged = new Set(dashboard.mergedWorktrees.find((m) => m.repo === r.path)?.paths ?? []);
      for (const w of dashboard.statuses[r.path]?.worktrees ?? []) {
        if (w.isMain || w.foreign || seen.has(w.path)) continue;
        seen.set(w.path, {
          repo: r.path,
          path: w.path,
          branch: w.branch,
          merged: merged.has(w.path),
          unpushed: (w.branch && scanResults.allBranches.find((b) => b.repoPath === r.path && b.name === w.branch)?.unpushedCommitCount) || 0,
          dirty: gitStatus.statuses.get(w.path)?.entries.length ?? 0,
        });
      }
    }
    return [...seen.values()];
  });
  const mergedTrees = $derived(trees.filter((w) => w.merged));
  const treeColumns: MiniColumn<Tree>[] = $derived([
    { id: "worktree", label: t.dashboard.col.worktree, width: "minmax(0,1fr)", sort: (a, b) => byText(repoName(a.path), repoName(b.path)) },
    { id: "repo", label: t.dashboard.col.repo, width: "minmax(0,9rem)", sort: (a, b) => byText(repoName(a.repo), repoName(b.repo)) },
    { id: "branch", label: t.dashboard.col.branch, width: "minmax(0,1fr)", sort: (a, b) => byText(a.branch ?? "", b.branch ?? "") },
    { id: "state", label: t.dashboard.col.state, width: "minmax(0,9rem)", sort: (a, b) => Number(b.merged) - Number(a.merged) || b.unpushed - a.unpushed },
    { id: "action", label: "", width: "auto" },
  ]);

  const restorable = $derived(deletes.deleted.filter((d) => d.restoredAt === null).sort((a, b) => b.deletedAt - a.deletedAt));
  const deletedColumns: MiniColumn<DeletedEntry>[] = $derived([
    { id: "branch", label: t.dashboard.col.branch, width: "minmax(0,1fr)" },
    { id: "when", label: t.dashboard.col.deleted, width: "auto", end: true },
    { id: "action", label: "", width: "auto" },
  ]);
  const localLenses = $derived(dashboard.lenses.filter((l) => l.lens.scope === "Local"));
  const serverLenses = $derived(dashboard.lenses.filter((l) => l.lens.scope === "Online"));
</script>

<!-- A repo by the badge of its folder and its name: which of several copies is meant. -->
{#snippet mark(path: string, count: number | null = null)}
  {@const m = identities.markOf(path)}
  {@const label = scanResults.copyLabelBeside(path, { badge: m?.badge.name })}
  <span class="inline-flex max-w-full min-w-0 items-center gap-1.5 overflow-hidden">
    {#if m}<RootBadge badge={m.badge} root={m.root} />{/if}
    <!-- As everywhere: the name gives way first, the copy label tells two copies apart. -->
    <span class="min-w-[4ch] shrink-[10] truncate text-muted" use:fullText={repoName(path)}>{repoName(path)}</span>
    {#if label}<span class="shrink-0 text-faint">·</span><span class="mbf-truncate-start min-w-[5ch] shrink text-muted" use:fullText={label}><bdi>{label}</bdi></span>{/if}
    {#if count !== null}<span class="mbf-count">{count}</span>{/if}
  </span>
{/snippet}

<!-- The cells of a step: what, why, where, how much, and the one thing to do. -->
{#snippet stepCell(s: DashStep, c: MiniColumn<DashStep>)}
  {#if c.id === "what"}
    {@const Icon = ICON[s.kind]}
    <!-- The title wraps instead of cutting off: a row of this table may take two lines, never hide a word. -->
    <span class="flex min-w-0 items-start gap-2">
      <span class="grid h-5 shrink-0 place-items-center {TONE[s.kind]}"><Icon size={15} /></span>
      <span class="min-w-0 [overflow-wrap:break-word]">{title(s)}{#if s.pr?.isDraft}<span class="ml-1.5 rounded px-1.5 py-px text-xs text-faint ring-1 ring-line-strong">{t.dashboard.draft}</span>{/if}</span>
    </span>
  {:else if c.id === "why"}
    <span class="block text-muted">{reason(s)}</span>
  {:else if c.id === "where"}
    {#if s.split && s.split.length > 1}
      <span class="inline-flex h-[22px] items-center rounded-md border border-line px-1.5 text-xs text-muted" use:tooltip={{ text: t.dashboard.reposTip, rows: s.split.slice(0, 5).map((x) => ({ label: repoName(x.repo), value: t.dashboard.size.branches(x.count) })) }}>{t.dashboard.repos(s.split.length)}</span>
    {:else}
      <span class="flex min-w-0 items-center gap-1.5">
        {@render mark(s.repos[0])}
        {#if s.repos.length > 1}<span class="mbf-count" use:tooltip={{ title: t.dashboard.copies(s.repos.length), text: t.dashboard.copiesTip }}>+{s.repos.length - 1}</span>{/if}
      </span>
    {/if}
  {:else if c.id === "size"}
    {@const z = size(s)}
    <span class="flex flex-col items-end leading-tight whitespace-nowrap">
      <span>{z.main}</span>
      {#if z.sub}<span class="text-xs text-muted">{z.sub}</span>{/if}
    </span>
  {:else if c.id === "action"}
    {@const a = actionOf(s)}
    <Button size="sm" icon={s.action.kind === "url" ? ExternalLink : undefined} tip={a.tip} onclick={() => runStep(s.action, title(s))}>{a.label}</Button>
  {:else}
    <IconButton icon={X} size="sm" class="!size-7 !border-transparent hover:!border-line-strong" label={t.dashboard.putAside} hint={t.dashboard.putAsideTip} onclick={() => dashboard.dismiss(s)} />
  {/if}
{/snippet}

<!-- What a step names, as a small table of its own: the branches, worktrees, files or repos behind the number. -->
{#snippet stepDetail(s: DashStep)}
  {@const d = t.dashboard.detailCol}
  {#if s.pr}
    {@const pr = s.pr}
    {@const v = reviews({ pr })}
    <dl class="grid grid-cols-[max-content_minmax(0,1fr)] items-center gap-x-4 gap-y-1 text-sm">
      <dt class="t-meta">{d.author}</dt>
      <dd class="min-w-0 truncate" use:tooltip={s.pr.authorName ? { text: s.pr.author } : null}>{authorOf({ pr, mine: s.mine })}</dd>
      <dt class="t-meta">{d.target}</dt>
      <dd class="min-w-0 truncate font-mono text-xs" use:fullText={s.pr.targetRef.replace(/^refs\/heads\//, "")}>{s.pr.targetRef.replace(/^refs\/heads\//, "")}</dd>
      {#if s.pr.createdAt}<dt class="t-meta">{d.created}</dt><dd>{relativeTime(s.pr.createdAt, clock.now)}</dd>{/if}
      <dt class="t-meta">{d.reviews}</dt>
      <dd>{@render reviewChips(v)}</dd>
      {#if s.repos.length > 1}
        <dt class="self-start t-meta">{d.copies}</dt>
        <dd class="flex min-w-0 flex-col gap-1">{#each s.repos as r (r)}{@render mark(r)}{/each}</dd>
      {/if}
    </dl>
  {:else if s.kind === "cleanup"}
    <MiniGrid
      label={d.repo}
      columns={[{ id: "repo", label: d.repo, width: "minmax(0,1fr)" }, { id: "count", label: d.branches, width: "max-content", end: true }]}
      rows={s.split ?? []}
      key={(x) => x.repo}
      cell={splitCell}
      empty=""
    />
  {:else if s.kind === "atRisk"}
    <MiniGrid
      label={d.branch}
      columns={[{ id: "name", label: d.branch, width: "minmax(0,1fr)" }, { id: "agent", label: "", width: "max-content" }, { id: "count", label: d.commits, width: "max-content", end: true }]}
      rows={s.items ?? []}
      key={(x) => x.name}
      cell={itemCell}
      empty=""
    />
  {:else if s.kind === "worktrees"}
    <MiniGrid
      label={d.worktree}
      columns={[{ id: "name", label: d.worktree, width: "minmax(0,1fr)" }, { id: "branch", label: d.branch, width: "minmax(0,1fr)" }]}
      rows={s.items ?? []}
      key={(x) => x.name}
      cell={itemCell}
      empty=""
    />
  {:else}
    <MiniGrid label={d.file} columns={[{ id: "file", label: d.file, width: "minmax(0,1fr)" }]} rows={s.items ?? []} key={(x) => x.name} cell={itemCell} empty="" />
  {/if}
{/snippet}

{#snippet splitCell(x: { repo: string; count: number }, c: MiniColumn<{ repo: string; count: number }>)}
  {#if c.id === "repo"}{@render mark(x.repo)}{:else}<span class="whitespace-nowrap">{t.dashboard.size.branches(x.count)}</span>{/if}
{/snippet}

{#snippet itemCell(x: DashItem, c: MiniColumn<DashItem>)}
  {#if c.id === "name"}<span class="block truncate font-mono text-xs" use:fullText={x.name}>{x.name}</span>
  {:else if c.id === "file"}<span class="block truncate font-mono text-xs" use:fullText={x.name}>{x.name}</span>
  {:else if c.id === "branch"}<span class="block truncate font-mono text-xs text-muted" use:fullText={x.branch ?? ""}>{x.branch ?? t.dashboard.wtState.detached}</span>
  {:else if c.id === "agent"}{#if x.agent}<span class="rounded px-1.5 py-px text-xs text-muted ring-1 ring-line-strong" use:tooltip={t.dashboard.agentTip}>{t.dashboard.agent}</span>{/if}
  {:else}<span class="whitespace-nowrap">{t.dashboard.size.commits(x.count ?? 0)}</span>{/if}
{/snippet}

{#snippet reviewChips(v: { ok: number; changes: number; open: number })}
  <span class="inline-flex items-center gap-1 text-xs tabular-nums" use:tooltip={t.dashboard.reviewsTip(v.ok, v.changes, v.open)}>
    <span class="inline-flex h-[22px] items-center gap-1 rounded-md border border-line px-1.5 text-xs leading-none {v.ok ? 'text-safe-ink' : 'text-faint'}"><Check size={12} />{v.ok}</span>
    <span class="inline-flex h-[22px] items-center gap-1 rounded-md border border-line px-1.5 text-xs leading-none {v.changes ? 'text-unsafe-ink' : 'text-faint'}"><CircleAlert size={12} />{v.changes}</span>
    <span class="inline-flex h-[22px] items-center gap-1 rounded-md border border-line px-1.5 text-xs leading-none {v.open ? 'text-review-ink' : 'text-faint'}"><Hourglass size={12} />{v.open}</span>
  </span>
{/snippet}

{#snippet tile(title: string, tip: string, icon: Component<{ size?: number; class?: string }>, count: number | null, body: Snippet, tools?: Snippet, busy = false)}
  {@const Icon = icon}
  <section class="flex min-w-0 flex-col rounded-xl border border-line bg-panel {busy ? 'mbf-refreshing' : ''}" aria-label={title}>
    <header class="flex h-11 shrink-0 items-center gap-2 border-b border-line px-4">
      <Icon size={15} class="text-faint" />
      <h2 class="min-w-0 flex-1 truncate font-medium" use:tooltip={tip}>{title}</h2>
      {#if count !== null}<span class="mbf-count">{count}</span>{/if}
      {@render tools?.()}
    </header>
    <div class="min-h-0 flex-1 p-2">{@render body()}</div>
  </section>
{/snippet}

<div class="@container min-h-0 flex-1 overflow-y-auto">
  {#if !scanResults.loaded}
    <!-- The first scan is still on its way: the shape of what comes. -->
    <div class="grid gap-4 p-4" aria-busy="true">
      <Skeleton class="h-56 w-full rounded-xl" />
      <div class="grid gap-4 @min-[900px]:grid-cols-[minmax(0,2fr)_minmax(300px,1fr)]">
        <div class="grid gap-4">{#each [0, 1] as i (i)}<Skeleton class="h-44 rounded-xl" />{/each}</div>
        <div class="grid gap-4">{#each [0, 1] as i (i)}<Skeleton class="h-44 rounded-xl" />{/each}</div>
      </div>
    </div>
  {:else}
    <div class="grid content-start gap-4 p-4">
      {#if dashboard.narrowed}
        <p class="flex items-center gap-3 t-meta">
          {t.dashboard.narrowed(repoSelection.repos.length)}
          <Button size="sm" tip={t.dashboard.showEverythingTip} onclick={() => (repoSelection.repos = [])}>{t.dashboard.showEverything}</Button>
        </p>
      {/if}

      <!-- Next: a table grouped by what the step is about. A row opens the list of what it names, its
           chevron unfolds that list in place, its button does the one thing right away. -->
      <section class="rounded-xl border border-line bg-panel" aria-label={t.dashboard.next}>
        <header class="flex h-11 items-center gap-2 border-b border-line px-4">
          <h2 class="font-medium" use:tooltip={t.dashboard.nextTip}>{t.dashboard.next}</h2>
          <span class="mbf-count">{dashboard.steps.length}</span>
          {#if putAside}
            <Button size="sm" class="ml-auto" tip={t.dashboard.restoreTip} onclick={() => dashboard.restore()}>{t.dashboard.restore}</Button>
          {/if}
        </header>
        {#if dashboard.steps.length}
          <div class="p-2">
            <MiniGrid
              label={t.dashboard.next}
              columns={nextColumns}
              rows={dashboard.steps}
              key={(s) => s.key}
              cell={stepCell}
              onrow={openStep}
              rowTip={(s) => clickOf(s)}
              group={(s) => s.section}
              groupOf={(id, rows) => ({ title: t.dashboard.section[id as DashSection], tip: t.dashboard.sectionTip[id as DashSection], count: rows.length })}
              detail={stepDetail}
              {hasDetail}
              {detailTip}
              limit={NEXT}
              empty={t.dashboard.allDone}
            />
          </div>
        {:else}
          <p class="flex items-center gap-2 px-4 py-6 text-muted"><CircleCheck size={16} class="text-safe" />{t.dashboard.allDone}</p>
        {/if}
      </section>

      <!-- Two columns that stack each on its own: the tables wide on the left, the counters on the right.
           No row ties a short tile to a tall one, so no gaps open. -->
      <div class="grid items-start gap-4 @min-[900px]:grid-cols-[minmax(0,2fr)_minmax(300px,1fr)]">
        <div class="flex min-w-0 flex-col gap-4">
          {#snippet prTools()}
            <Segmented
              label={t.dashboard.prs}
              options={[
                { id: "mine" as const, label: t.dashboard.prsMine, tip: dashboard.knowsMe ? t.dashboard.prsMineTip : t.dashboard.prsNoIdentity },
                { id: "all" as const, label: t.dashboard.prsAll, tip: t.dashboard.prsAllTip },
              ]}
              value={dashboard.mode}
              onchange={(v) => settings.setUi({ dashboardPrs: v })}
            />
          {/snippet}
          {#snippet prCell(r: PrRow, c: MiniColumn<PrRow>)}
            {#if c.id === "pr"}
              <!-- The title, and below it the repo: the title needs the width more than a repo column would. -->
              <span class="flex min-w-0 flex-col gap-0.5">
                <span class="flex min-w-0 items-center gap-1.5">
                  <span class="truncate" use:fullText={`#${r.pr.id} ${r.pr.title}`}><span class="text-muted tabular-nums">#{r.pr.id}</span> {r.pr.title}</span>
                  {#if r.pr.isDraft}<span class="shrink-0 rounded px-1.5 py-px text-xs text-faint ring-1 ring-line-strong">{t.dashboard.status.draft}</span>{/if}
                  {#if r.pr.hasConflicts}<span class="shrink-0 rounded bg-unsafe/12 px-1.5 py-px text-xs text-unsafe-ink">{t.dashboard.status.conflict}</span>{/if}
                  {#if r.why === "review"}<span class="shrink-0 rounded bg-accent/12 px-1.5 py-px text-xs text-accent-ink">{t.dashboard.status.review}</span>{/if}
                </span>
                <span class="flex min-w-0 items-center gap-1.5 t-meta">
                  {@render mark(r.repos[0].path)}
                  {#if r.repos.length > 1}<span class="mbf-count" use:tooltip={{ title: t.dashboard.copies(r.repos.length), text: t.dashboard.copiesTip, path: r.repos.map((x) => x.path).join("\n") }}>+{r.repos.length - 1}</span>{/if}
                </span>
              </span>
            {:else if c.id === "author"}
              <span class="block truncate {r.why === 'mine' ? 'text-muted' : ''}" use:tooltip={r.pr.authorName ? { text: `${r.pr.authorName} · ${r.pr.author}` } : { text: r.pr.author, overflow: true }}>{prAuthor(r)}</span>
            {:else if c.id === "age"}
              <span class="whitespace-nowrap text-muted">{r.pr.createdAt ? relativeTime(r.pr.createdAt, clock.now) : ""}</span>
            {:else if c.id === "reviews"}
              {@render reviewChips(reviews(r))}
            {:else}
              <IconButton icon={ExternalLink} size="sm" class="!size-7 !border-transparent hover:!border-line-strong" label={t.dashboard.openInBrowser} hint={t.dashboard.openInBrowserTip} onclick={() => runStep({ kind: "url", url: r.pr.url })} />
            {/if}
          {/snippet}
          {#snippet prsBody()}
            <MiniGrid
              label={t.dashboard.prs}
              columns={prColumns}
              rows={dashboard.prs}
              key={(r) => r.pr.url || `${r.repos[0].path}#${r.pr.id}`}
              cell={prCell}
              onrow={openPr}
              rowTip={(r) => ({ title: `#${r.pr.id} ${r.pr.title}`, text: r.repos.map((x) => repoName(x.path)).join(", "), foot: prBranches(dashboard.branches, r) ? t.dashboard.prRowTip : t.dashboard.clickTip.url })}
              limit={8}
              empty={dashboard.mode === "mine" && !dashboard.knowsMe ? t.dashboard.prsNoIdentity : t.dashboard.prsNone}
            />
          {/snippet}
          {@render tile(t.dashboard.prs, t.dashboard.prsTip, GitPullRequest, dashboard.prs.length, prsBody, prTools, pullRequests.loading.size > 0)}

          {#snippet changeCell(r: Changed, c: MiniColumn<Changed>)}
            {#if c.id === "repo"}{@render mark(r.path)}
            {:else if c.id === "branch"}<span class="block truncate font-mono text-xs text-muted" use:fullText={r.s.head.branch ?? ""}>{r.s.head.branch ?? r.s.head.oid?.slice(0, 7)}</span>
            {:else if c.id === "changed"}{#if r.s.entries.length}<StatusChip kind="dirty" count={r.s.entries.length} />{/if}
            {:else if c.id === "ahead"}{#if r.s.head.ahead}<StatusChip kind="ahead" count={r.s.head.ahead} />{/if}
            {:else if c.id === "behind"}{#if r.s.head.behind}<StatusChip kind="behind" count={r.s.head.behind} />{/if}
            {:else if r.s.stashes}<StatusChip kind="stash" count={r.s.stashes} />{/if}
          {/snippet}
          {#snippet changesBody()}
            <MiniGrid
              label={t.dashboard.changes}
              columns={changeColumns}
              rows={changed}
              key={(r) => r.path}
              cell={changeCell}
              onrow={(r) => runStep({ kind: "changes", path: r.path })}
              rowTip={(r) => ({ title: repoName(r.path), path: r.path, foot: t.dashboard.clickTip.changes })}
              empty={t.dashboard.changesNone}
            />
          {/snippet}
          {@render tile(t.dashboard.changes, t.dashboard.changesTip, GitGraph, changed.length, changesBody, undefined, gitStatus.refreshing.size > 0)}

          {#snippet treeTools()}
            {#if mergedTrees.length}
              <Button size="sm" icon={Trash2} tip={t.dashboard.actionTip.removeWorktrees} onclick={() => {
                const repos = new Set(mergedTrees.map((w) => w.repo));
                for (const repo of repos) void runStep({ kind: "removeWorktrees", repo, paths: mergedTrees.filter((w) => w.repo === repo).map((w) => w.path) });
              }}>{t.dashboard.removeMerged(mergedTrees.length)}</Button>
            {/if}
          {/snippet}
          {#snippet treeCell(w: Tree, c: MiniColumn<Tree>)}
            {#if c.id === "worktree"}<span class="block truncate" use:fullText={repoName(w.path)}>{repoName(w.path)}</span>
            {:else if c.id === "repo"}{@render mark(w.repo)}
            {:else if c.id === "branch"}<span class="block truncate font-mono text-xs text-muted" use:fullText={w.branch ?? ""}>{w.branch ?? t.dashboard.wtState.detached}</span>
            {:else if c.id === "state"}
              <span class="flex min-w-0 flex-wrap items-center gap-x-2 text-xs">
                {#if w.merged}<span class="text-safe-ink">{t.dashboard.wtState.merged}</span>{/if}
                {#if w.unpushed}<span class="text-unsafe-ink">{t.dashboard.wtState.unpushed(w.unpushed)}</span>{/if}
                {#if w.dirty}<span class="text-review-ink">{t.dashboard.wtState.dirty(w.dirty)}</span>{/if}
                {#if !w.merged && !w.unpushed && !w.dirty}<span class="text-faint">{t.dashboard.wtState.clean}</span>{/if}
              </span>
            {:else if w.merged}
              <Button size="sm" tip={t.dashboard.removeTip} onclick={() => runStep({ kind: "removeWorktrees", repo: w.repo, paths: [w.path] })}>{t.dashboard.remove}</Button>
            {/if}
          {/snippet}
          {#snippet treesBody()}
            <MiniGrid
              label={t.dashboard.worktrees}
              columns={treeColumns}
              rows={trees}
              key={(w) => w.path}
              cell={treeCell}
              onrow={(w) => runStep({ kind: "changes", path: w.path })}
              rowTip={(w) => ({ title: repoName(w.path), path: w.path, foot: t.dashboard.clickTip.changes })}
              empty={t.dashboard.worktreesNone}
            />
          {/snippet}
          {@render tile(t.dashboard.worktrees, t.dashboard.worktreesTip, FolderTree, trees.length, treesBody, treeTools)}
        </div>

        <div class="flex min-w-0 flex-col gap-4">
          {#snippet lensRows(list: typeof dashboard.lenses, title: string)}
            <h3 class="px-2 pt-1 pb-1 t-section">{title}</h3>
            {#each list as { lens, count } (lens.id)}
              <button
                type="button"
                class="group flex h-8 w-full items-center gap-2 rounded-md border border-transparent px-2 text-left text-sm hover:border-line-strong hover:bg-hover/60 disabled:opacity-50 disabled:hover:border-transparent disabled:hover:bg-transparent"
                disabled={!count}
                use:tooltip={{ title: t.dashboard.lens[lens.id], text: t.dashboard.lensTip[lens.id], foot: count ? t.dashboard.lensClickTip : undefined }}
                onclick={() => cleanupView.applyLens(lens)}
              >
                <span class="min-w-0 flex-1 truncate">{t.dashboard.lens[lens.id]}</span>
                <span class="mbf-count">{count}</span>
                <ChevronRight size={14} class="text-faint" />
              </button>
            {/each}
          {/snippet}
          {#snippet cleanupTools()}<Button size="sm" tip={t.dashboard.openCleanupTip} onclick={() => settings.setUi({ perspective: "Cleanup" })}>{t.dashboard.open}</Button>{/snippet}
          {#snippet cleanupBody()}
            {@render lensRows(localLenses, t.dashboard.sectionLocal)}
            <div class="mt-2">{@render lensRows(serverLenses, t.dashboard.sectionServer)}</div>
          {/snippet}
          {@render tile(t.dashboard.cleanup, t.dashboard.cleanupTip, Broom, null, cleanupBody, cleanupTools, scanner.scanning)}

          {#snippet deletedTools()}
            {#if deletes.deleted.length}<Button size="sm" tip={t.dashboard.allDeletedTip} onclick={() => (dialogs.deletedOpen = true)}>{t.dashboard.all}</Button>{/if}
          {/snippet}
          {#snippet deletedCell(d: DeletedEntry, c: MiniColumn<DeletedEntry>)}
            {#if c.id === "branch"}
              {@const name = isStashEntry(d) ? t.journal.stashEntry(d.droppedStashes[0]?.message ?? "") : isWorktreeEntry(d) ? t.journal.worktreeEntry(repoName(displayPath(d.removedWorktree ?? ""))) : d.branch}
              <span class="flex min-w-0 flex-col">
                <span class="truncate font-mono text-xs" use:fullText={name}>{name}</span>
                {@render mark(d.repoPath)}
              </span>
            {:else if c.id === "when"}<span class="text-xs text-muted">{relativeTime(d.deletedAt, clock.now)}</span>
            {:else}<IconButton icon={Undo2} size="sm" label={t.dashboard.restoreOne} hint={t.dashboard.restoreOneTip} onclick={() => deleting.restore([d.id])} />{/if}
          {/snippet}
          {#snippet deletedBody()}
            <MiniGrid label={t.dashboard.deleted} columns={deletedColumns} rows={restorable} key={(d) => d.id} cell={deletedCell} limit={5} empty={t.dashboard.deletedNone} />
          {/snippet}
          {@render tile(t.dashboard.deleted, t.dashboard.deletedTip, History, restorable.length, deletedBody, deletedTools)}
        </div>
      </div>
    </div>
  {/if}
</div>
