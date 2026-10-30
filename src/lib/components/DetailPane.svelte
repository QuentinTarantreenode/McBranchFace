<script lang="ts">
  import DetailIdentity from "./DetailIdentity.svelte";
  import { ChevronRight, CircleCheck, CircleX, CloudOff, GitGraph, Info, Trash2, TriangleAlert } from "@lucide/svelte";
  import { api, errorText } from "$lib/api";
  import { checkText } from "$lib/checks";
  import { branchKey, isOrphaned } from "$lib/filter";
  import { absoluteTime, relativeTime, shortSha } from "$lib/format";
  import { t } from "$lib/i18n/index.svelte";
  import { siblingGone } from "$lib/identity";
  import type { Check } from "$lib/bindings/Check";
  import type { CheckOutcome } from "$lib/bindings/CheckOutcome";
  import type { CommitInfo } from "$lib/bindings/CommitInfo";
  import Button from "$lib/ui/Button.svelte";
  import Panel from "$lib/ui/Panel.svelte";
  import { fullText, tooltip } from "$lib/ui/tooltip";
  import ActionBar from "./ActionBar.svelte";
  import AnnotationEditor from "./AnnotationEditor.svelte";
  import RepoName from "./RepoName.svelte";
  import VerdictBadge from "./VerdictBadge.svelte";
  import RichText from "$lib/ui/RichText.svelte";
  import PrCard from "./PrCard.svelte";
  import { ownView, unpushedView } from "$lib/commitViews";
  import { branchCommits } from "$lib/stores/branchCommits.svelte";
  import Skeleton from "$lib/ui/Skeleton.svelte";
  import UpstreamState from "./UpstreamState.svelte";
  import MetaChip from "$lib/ui/MetaChip.svelte";
  import { todos } from "$lib/todos";
  import TodoList from "./TodoList.svelte";
  import { GitPullRequest } from "@lucide/svelte";
  import { pullRequests } from "$lib/stores/pullRequests.svelte";
  import { openBelow } from "$lib/ui/menu.svelte";
  import { dialogs } from "$lib/stores/dialogs.svelte";
  import { clock } from "$lib/stores/clock.svelte";
  import { scanResults } from "$lib/stores/scanResults.svelte";
  import { rules } from "$lib/stores/rules.svelte";
  import { cleanupView } from "$lib/stores/cleanupView.svelte";
  import { navigation } from "$lib/services/navigation";
  import { deletes } from "$lib/stores/deletes.svelte";
  import { repoActions } from "$lib/services/repoActions.svelte";

  const b = $derived(cleanupView.selected);
  const busy = $derived(b ? cleanupView.busy.has(branchKey(b)) : false);
  const repo = $derived(b ? scanResults.repoByPath.get(b.repoPath) : undefined);
  const problems = $derived(b?.checks.filter((c) => c.outcome === "Fail" || c.outcome === "Warn") ?? []);
  const fine = $derived(b?.checks.filter((c) => c.outcome === "Pass" || c.outcome === "Info") ?? []);
  const siblings = $derived(b ? siblingGone(b, scanResults.allBranches, scanResults.identityOf) : []);
  const steps = $derived(b ? todos(b) : []);
  // The passed checks fold into one line: what is fine needs no reading, what is open stays in view.
  let fineOpen = $state(false);
  let stashesOpen = $state(true);
  // Another branch starts as every branch does: the passed checks folded, its stashes in view.
  const key = $derived(b ? branchKey(b) : null);
  $effect(() => {
    void key;
    fineOpen = false;
    stashesOpen = true;
  });
  let stashesAt: HTMLElement | undefined = $state();
  function showStashes() {
    stashesOpen = true;
    queueMicrotask(() => stashesAt?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }

  const outcomeTone: Record<CheckOutcome, string> = { Pass: "text-safe", Warn: "text-review", Fail: "text-unsafe", Info: "text-faint" };

  let stashStats = $state<Record<string, string>>({});
  async function loadStash(sha: string) {
    if (!b || stashStats[sha] !== undefined) return;
    stashStats[sha] = t.common.loading;
    try {
      stashStats[sha] = (await api.stashStat(b.repoPath, sha)).trim() || t.detail.noStashFiles;
    } catch (e) {
      stashStats[sha] = errorText(e);
    }
  }

  const where = $derived(b ? (b.worktree?.path ?? b.repoPath) : "");

  const PREVIEW = 5;
  // The lists in the pane show the first commits; the window has them all, with search and dates.
  const showUnpushed = () => b && (dialogs.commitsView = unpushedView(b));
  const showOwn = () => b && (dialogs.commitsView = ownView(b, repo?.defaultBranch));
  // The results carry only the counts: the commits are read when the pane shows a branch that has some.
  const lists = $derived(b ? branchCommits.of(b) : undefined);
  const listsFailed = $derived(b ? branchCommits.failure(b) : undefined);
  $effect(() => {
    if (b && (b.unpushedCommitCount || b.ownCommitCount)) branchCommits.ensure(b);
  });
  const readAgain = () => b && branchCommits.load(b).catch(() => {});
</script>

{#snippet outcomeIcon(o: CheckOutcome)}
  {#if o === "Pass"}<CircleCheck size={15} />{:else if o === "Warn"}<TriangleAlert size={15} />{:else if o === "Fail"}<CircleX size={15} />{:else}<Info size={15} />{/if}
{/snippet}

<!-- The first commits of a list, the button to all of them below: what is not on the server, or what the
     branch has of its own (dimmer, with author and age). -->
{#snippet commits(list: CommitInfo[] | undefined, count: number, own: boolean, show: () => unknown)}
  {#if !list && listsFailed !== undefined}
    <div class="flex flex-wrap items-center gap-2 px-2 py-1.5">
      <span class="t-meta" use:tooltip={errorText(listsFailed)}>{t.commits.readFailed}</span>
      <Button size="sm" variant="ghost" tip={t.commits.readAgainTip} onclick={readAgain}>{t.commits.readAgain}</Button>
    </div>
  {:else if !list}
    <!-- As many rows as the list will have, each as tall as a commit's line: nothing moves when it arrives. -->
    <ul class="zebra" aria-busy="true" aria-label={t.commits.loading}>
      {#each Array.from({ length: Math.min(count, PREVIEW) }, (_, i) => i) as i (i)}
        <li class="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm">
          <span class="flex h-5 items-center"><Skeleton class="h-3 w-14" /></span>
          <span class="flex h-5 min-w-0 flex-1 items-center"><Skeleton class={i % 2 ? "h-3 w-2/3" : "h-3 w-1/2"} /></span>
        </li>
      {/each}
    </ul>
  {:else}
  <ul class="zebra pop-in">
    {#each list.slice(0, PREVIEW) as c (c.sha)}
      <li class="flex {own ? 'items-baseline ' : ''}gap-2 rounded-md px-2 py-1.5 text-sm">
        {#if own}
          <span class="font-mono text-xs text-faint">{shortSha(c.sha)}</span>
          <span class="selectable min-w-0 flex-1 truncate" use:tooltip={{ title: c.subject, text: c.authorEmail }}>{c.subject}</span>
          <span class="shrink-0 text-xs text-faint" use:tooltip={absoluteTime(c.authoredAt)}>{relativeTime(c.authoredAt, clock.now)}</span>
        {:else}
          <span class="font-mono text-unsafe">{shortSha(c.sha)}</span>
          <span class="selectable min-w-0 flex-1 truncate" use:fullText={c.subject}>{c.subject}</span>
        {/if}
      </li>
    {/each}
  </ul>
  {/if}
  {#if count > PREVIEW}
    <div class="mt-1.5"><Button size="sm" variant="ghost" tip={t.commits.showTip} onclick={show}>{t.commits.show(count)}</Button></div>
  {/if}
{/snippet}

{#snippet checkRow(c: Check)}
  {@const text = checkText(c.code)}
  <!-- Icon top-left, title and detail share one left edge. -->
  <li class="flex gap-2.5 rounded-lg bg-panel-2/60 px-3 py-2.5">
    <span class="mt-0.5 shrink-0 {outcomeTone[c.outcome]}">{@render outcomeIcon(c.outcome)}</span>
    <div class="min-w-0">
      <div class="text-base font-medium"><RichText text={text.title} /></div>
      <!-- eslint-disable-next-line mbf/no-break-all -- details may carry a ref or path as one long token; it must not leave the card -->
      <div class="selectable mt-0.5 text-sm leading-snug text-muted [overflow-wrap:anywhere]"><RichText text={text.detail} /></div>
    </div>
  </li>
{/snippet}

{#if b}
  <!-- What it is, then what to do with it: the verdict beside the close button, the name, one row of
       chips for where it lives and what was set on it, then one row of actions. -->
  <div class="border-b border-line p-5 surface-glow">
    <div class="flex h-8 items-center pr-9"><VerdictBadge verdict={b.verdict} size="md" /></div>
    <div class="mt-2.5">
      <DetailIdentity name={b.name} repoPath={b.repoPath} sha={b.sha} locked={b.locked} ignored={b.ignored}>
        {#if isOrphaned(b) && b.upstream}
          <MetaChip icon={CloudOff} tone="review" label={t.branchTip.gone} tip={{ text: t.cleanup.upstreamGone, rows: [{ label: t.branchTip.upstream, value: b.upstream, kind: "branch" }] }} />
        {:else}
          <!-- Tracking the integration line is no upstream of its own: it shows as "local only". -->
          <MetaChip><UpstreamState upstream={b.upstreamState === "None" ? null : b.upstream} gone={false} branch={b.name} /></MetaChip>
        {/if}
      </DetailIdentity>
    </div>
    <div class="mt-4">
      <ActionBar
        {where}
        repoPath={b.repoPath}
        locked={b.locked}
        onlock={(on) => rules.setLock(b.repoPath, b.name, on)}
        branch={b.name}
        logRev={`refs/heads/${b.name}`}
        online={false}
        ignored={b.ignored}
        report={b}
      >
        {#snippet primary()}
          {#if b.locked}
            <!-- Locked: no delete; the chip above says why. -->
          {:else if b.verdict === "Safe"}
            <Button size="sm" class="!rounded-md" variant="delete" icon={Trash2} disabled={busy} tip={{ text: t.detail.deleteTip, keys: "Del" }} onclick={() => deletes.openDelete([b])}>{t.detail.delete}</Button>
          {:else if !b.worktree}
            <!-- A checked-out branch gets no delete button: git refuses it, the to-do says how to free it. -->
            <Button size="sm" class="!rounded-md" variant="danger-outline" icon={Trash2} disabled={busy} tip={{ text: t.detail.forceTip, keys: "Del" }} onclick={() => deletes.openDelete([b], true)}>{t.cleanup.forceDelete}</Button>
          {/if}
        {/snippet}
      </ActionBar>
    </div>
  </div>

  <div class="min-h-0 flex-1 overflow-y-auto px-5 pb-6">
    <!-- What to do first, then why: the steps lead, the checks behind them are the reasons. -->
    {#if steps.length}
      <Panel title={t.todo.title} count={steps.length}>
        <TodoList {b} items={steps} defaultBranch={repo?.defaultBranch ?? null} {busy} onstashes={showStashes} oncommits={showOwn} />
      </Panel>
    {/if}
    {#if b.checks.length}
      <!-- The steps above say what to do; the checks are their reasons, folded while there are steps. -->
      <Panel title={t.detail.checks} open={!steps.length}>
        <ul class="flex flex-col gap-1.5">
          {#each problems as c (c.kind)}{@render checkRow(c)}{/each}
          {#if fine.length}
            <li>
              <button
                type="button"
                class="flex w-full items-center gap-2.5 rounded-lg bg-safe/10 px-3 py-2.5 text-left text-sm hover:bg-safe/16"
                aria-expanded={fineOpen}
                onclick={() => (fineOpen = !fineOpen)}
              >
                <CircleCheck size={15} class="shrink-0 text-safe" />
                <span class="min-w-0 flex-1 font-medium">{t.detail.checksSummary(fine.length, b.checks.length)}</span>
                <ChevronRight size={14} class="shrink-0 text-faint transition-transform {fineOpen ? 'rotate-90' : ''}" />
              </button>
            </li>
            {#if fineOpen}{#each fine as c (c.kind)}{@render checkRow(c)}{/each}{/if}
          {/if}
        </ul>
      </Panel>
    {/if}
    <!-- Commits: what is not on the server, then what the branch has of its own. -->
    {#if b.unpushedCommitCount}
      <!-- A push step already names them: the list stays at hand, folded. -->
      <Panel title={t.detail.unpushed} count={b.unpushedCommitCount} tone="text-unsafe" open={!steps.some((x) => x.kind === "push")}>
        {@render commits(lists?.unpushed, b.unpushedCommitCount, false, showUnpushed)}
      </Panel>
    {/if}

    {#if b.ownCommitCount || b.verdict !== "Safe"}
    <Panel title={t.detail.ownCommits} count={b.ownCommitCount} open={b.verdict !== "Safe"}>
      {#if b.ownCommitCount === 0}
        <p class="t-meta">{t.detail.noOwnCommits}</p>
      {:else}
        {@render commits(lists?.own, b.ownCommitCount, true, showOwn)}
      {/if}
    </Panel>
    {/if}
    <!-- The working state of its worktree: changed files and stashes. -->
    {#if b.worktree?.files.length}
      <Panel title={t.detail.dirty} count={b.worktree.files.length} tone="text-unsafe">
        <ul class="zebra">
          {#each b.worktree.files as f (f.path)}
            <li class="flex gap-2 rounded-md px-2 py-1.5 text-sm">
              <span class="w-[110px] shrink-0 text-xs {f.kind === 'Conflicted' ? 'text-unsafe' : 'text-review'}">{t.detail.fileKind[f.kind]}</span>
              <span class="selectable min-w-0 flex-1 truncate font-mono text-xs" use:fullText={f.path}>{f.path}</span>
            </li>
          {/each}
        </ul>
        <div class="mt-1.5"><Button size="sm" variant="ghost" icon={GitGraph} onclick={() => b.worktree && navigation.openChanges(b.worktree.path)}>{t.todo.openChanges}</Button></div>
      </Panel>
    {/if}

    {#if b.stashes.length}
      <div bind:this={stashesAt} class="scroll-mt-2">
      <Panel title={t.detail.stashes} count={b.stashes.length} tone="text-review" bind:open={stashesOpen}>
        <ul class="flex flex-col gap-1.5">
          {#each b.stashes as s (s.sha)}
            <li class="rounded-lg bg-panel-2/60 px-3 py-2.5 text-sm">
              <div class="flex gap-2">
                <span class="font-mono text-xs text-faint">{s.selector}</span>
                <span class="selectable min-w-0 flex-1 truncate" use:fullText={s.message}>{s.message}</span>
              </div>
              {#if stashStats[s.sha] !== undefined}
                <pre class="selectable mt-1.5 max-h-40 overflow-auto font-mono text-xs whitespace-pre text-muted">{stashStats[s.sha]}</pre>
              {/if}
              <div class="mt-2 flex flex-wrap gap-1.5">
                {#if stashStats[s.sha] === undefined}<Button size="sm" onclick={() => loadStash(s.sha)}>{t.detail.showStashFiles}</Button>{/if}
                <Button size="sm" disabled={busy || !b.worktree} tip={b.worktree ? t.stash.applyTip : t.stash.applyNeedsCheckout} onclick={() => repoActions.stashApply(b, s.sha)}>{t.stash.apply}</Button>
                <Button size="sm" variant="danger-outline" disabled={busy} tip={t.stash.dropTip} onclick={() => repoActions.stashDrop(b, s)}>{t.stash.drop}</Button>
              </div>
            </li>
          {/each}
        </ul>
      </Panel>
      </div>
    {/if}

    {#if b.pullRequest}
      <Panel title={t.detail.pullRequest}>
        <PrCard pr={b.pullRequest} repoPath={b.repoPath} />
      </Panel>
    {/if}
    <!-- The other open pull requests of the repo: one line that leads to them, never a list of its own here. -->
    {#if pullRequests.count(b.repoPath) > (b.pullRequest ? 1 : 0)}{@const others = pullRequests.count(b.repoPath)}
      <button
        type="button"
        class="mt-2 flex w-full items-center gap-1.5 rounded-md px-1 py-1 text-left text-sm text-muted hover:bg-hover hover:text-fg"
        aria-haspopup="menu"
        onclick={(e) => openBelow(e.currentTarget as HTMLElement, import("./prMenu").then((m) => m.prEntries(b.repoPath)), t.prs.menu)}
      >
        <GitPullRequest size={13} class="shrink-0" />{t.prs.count(others)}
      </button>
    {/if}

    {#if siblings.length}
      <Panel title={t.detail.otherCopies} count={siblings.length}>
        <p class="mb-1.5 t-meta">{t.detail.otherCopiesHint}</p>
        <ul class="flex flex-col gap-1">
          {#each siblings as path (path)}
            {@const other = scanResults.allBranches.find((x) => x.repoPath === path && x.name === b.name)}
            <li>
              <button
                type="button"
                class="flex w-full items-center gap-2 rounded-lg bg-panel-2/60 px-3 py-2.5 text-left text-sm hover:bg-hover"
                onclick={() => cleanupView.selectKey(branchKey({ repoPath: path, name: b.name }))}
              >
                <RepoName {path} />
                <span class="ml-auto shrink-0">{#if other}<VerdictBadge verdict={other.verdict} />{/if}</span>
              </button>
            </li>
          {/each}
        </ul>
      </Panel>
    {/if}

    <Panel title={t.detail.annotation}>
      <AnnotationEditor repoPath={b.repoPath} branch={b.name} />
    </Panel>

  </div>
{/if}
