<script lang="ts">
  import { gitStatus } from "$lib/stores/gitStatus.svelte";
  import { ArrowDownToLine, ArrowUpFromLine, LoaderCircle, RefreshCw, X, CopyPlus } from "@lucide/svelte";
  import { onMount, untrack } from "svelte";
  import { t } from "$lib/i18n/index.svelte";
  import Button from "$lib/ui/Button.svelte";
  import EmptyState from "$lib/ui/EmptyState.svelte";
  import IconButton from "$lib/ui/IconButton.svelte";
  import { tooltip, type TooltipContent } from "$lib/ui/tooltip";
  import ToolGroup from "$lib/ui/ToolGroup.svelte";
  import RepoName from "$lib/components/RepoName.svelte";
  import QuickSwitch from "$lib/components/QuickSwitch.svelte";
  import ProviderMark from "$lib/components/ProviderMark.svelte";
  import Part from "$lib/ui/Part.svelte";
  import { identities } from "$lib/stores/identities.svelte";
  import Skeleton from "$lib/ui/Skeleton.svelte";
  import UpstreamState from "$lib/components/UpstreamState.svelte";
  import BranchesView from "./BranchesView.svelte";
  import ChangesView from "./ChangesView.svelte";
  import GitDialogs from "./GitDialogs.svelte";
  import { gitStore, type GitTab } from "./gitStore.svelte";
  import HistoryView from "./HistoryView.svelte";
  import { dialogs } from "$lib/stores/dialogs.svelte";
  import { scanResults } from "$lib/stores/scanResults.svelte";
  import { repoSelection } from "$lib/stores/repoSelection.svelte";

  onMount(() => gitStore.attach());

  /** What a sync button does, and the exact command it runs: nothing about the network is implicit. */
  const syncTip = (text: string, command: string): TooltipContent => ({
    text,
    rows: [{ label: t.git.command, value: command, kind: "mono" }],
  });

  /** "origin/feat/x" → the remote and the branch on it, as the push command spells them out. */
  function upstreamParts(upstream: string): [string, string] {
    const i = upstream.indexOf("/");
    return i > 0 ? [upstream.slice(0, i), upstream.slice(i + 1)] : ["origin", upstream];
  }

  // In this perspective the sidebar selects one repo; without a choice the first one is shown.
  const repo = $derived(repoSelection.gitRepo ?? scanResults.repos[0]?.info.path ?? null);
  // Follows the repo only: what setRepo reads and resets of the store must not run it again.
  $effect(() => {
    const path = repo;
    untrack(() => gitStore.setRepo(path));
  });
  const edge = $derived(repo ? identities.tintOf(repo) : undefined);

  const status = $derived(repo ? gitStatus.statuses.get(repo) : undefined);
  const head = $derived(status?.head);
  // The scan knows whether the server still has the upstream; a worktree reads its repo's result.
  const upstreamGone = $derived.by(() => {
    const owner = repo ? scanResults.resultOf(gitStatus.ownerOf(repo)) : null;
    return !!owner?.tracking.find((x) => x.branch === head?.branch)?.gone;
  });

  const tabs = $derived<{ id: GitTab; label: string; keys: string }[]>([
    { id: "changes", label: t.git.tabs.changes, keys: "Alt 1" },
    { id: "history", label: t.git.tabs.history, keys: "Alt 2" },
    { id: "branches", label: t.git.tabs.branches, keys: "Alt 3" },
  ]);

  function onKey(e: KeyboardEvent) {
    if (!e.altKey || document.querySelector("dialog[open]")) return;
    const tab = tabs[Number(e.key) - 1];
    if (tab) {
      gitStore.setTab(tab.id);
      e.preventDefault();
    }
  }
</script>

<svelte:window onkeydown={onKey} />

<section class="flex min-w-0 flex-1 flex-col bg-bg">
  {#if !repo}
    <EmptyState title={t.git.noRepo} text={t.git.noRepoText} />
  {:else}
    <div class="relative flex h-12 shrink-0 items-center gap-3 px-4 {edge ? 'mbf-tint-edge' : ''}" style="--tint-line: {edge ?? 'transparent'}">
      <span class="t-title"><RepoName path={repo} /></span>
      <ProviderMark path={repo} />
      <!-- The same dropdown as in the sidebar: one way to switch, wherever it is opened. -->
      {#if head}
        <QuickSwitch path={repo} branch={head.branch} sha={head.oid} unreferenced={head.unreferenced} />
      {:else}
        <span class="contents" aria-busy="true"><Skeleton class="h-[24px] w-32 rounded-md" /></span>
      {/if}
      <Part ready={!!head} shape="h-4 w-24 rounded">
        {#if head?.upstream}<span class="flex min-w-0 items-center gap-1.5 text-xs text-faint"><span aria-hidden="true">→</span><UpstreamState upstream={head.upstream} gone={upstreamGone} /></span>{/if}
      </Part>

      <!-- Right-aligned: what comes and goes (a run elsewhere, own progress) stands first and grows into the
           free room on the left, so the copy button and the sync buttons never move. -->
      <div class="ml-auto flex items-center gap-1.5">
        {#if gitStore.elsewhere}
          <!-- Started elsewhere: no progress or cancel of its own here, but the reason the buttons wait. -->
          <span class="flex items-center gap-1.5 text-xs text-muted" role="status"><LoaderCircle size={12} class="shrink-0 animate-spin" />{gitStore.elsewhere}</span>
        {/if}
        {#if gitStore.progress}
          <div class="flex w-56 items-center gap-2">
            <span class="min-w-0 flex-1 truncate text-xs text-muted">{gitStore.progress.phase}</span>
            <div class="h-1.5 w-20 overflow-hidden rounded-full bg-line">
              {#if gitStore.progress.percent !== null}
                <div class="h-full bg-accent transition-[width] duration-200" style="width: {gitStore.progress.percent}%"></div>
              {:else}
                <div class="scan-bar h-full w-1/3 bg-accent"></div>
              {/if}
            </div>
            <IconButton icon={X} size="sm" label={t.git.cancel} onclick={() => gitStore.cancel()} />
          </div>
        {/if}
        <IconButton icon={CopyPlus} size="sm" label={t.copies.menu} onclick={() => dialogs.openCopies(repo, head?.branch ?? null)} />
        <ToolGroup label={t.git.syncGroup}>
          <Button
            size="sm"
            variant="ghost"
            icon={RefreshCw}
            disabled={gitStore.locked}
            tip={gitStore.elsewhere ?? syncTip(t.git.fetchTip, "git fetch --all --prune")}
            onclick={() => gitStore.remote("Fetch")}
          >
            Fetch
          </Button>
          <Button
            size="sm"
            variant={head?.behind && !head?.ahead ? "primary" : "ghost"}
            icon={ArrowDownToLine}
            disabled={gitStore.locked || !head?.upstream}
            tip={gitStore.elsewhere ?? (head?.upstream ? syncTip(t.git.pullTip(head.upstream), "git pull --ff-only --no-rebase") : t.git.pullNoUpstream)}
            onclick={() => gitStore.remote("Pull")}
          >
            Pull{#if head?.behind} ↓{head.behind}{/if}
          </Button>
          {#if head?.upstream}
            {@const [remoteName, upstreamBranch] = upstreamParts(head.upstream)}
            <Button
              size="sm"
              variant={head.ahead ? "primary" : "ghost"}
              icon={ArrowUpFromLine}
              disabled={gitStore.locked || !head.branch}
              tip={gitStore.elsewhere ??
                (upstreamBranch === head.branch
                  ? syncTip(t.git.pushTip(head.upstream), `git push ${remoteName} ${head.branch}:${upstreamBranch}`)
                  : { title: t.failure.UpstreamMismatch.title, text: t.failure.UpstreamMismatch.hint })}
              onclick={() => gitStore.remote("Push")}
            >
              Push{#if head.ahead} ↑{head.ahead}{/if}
            </Button>
          {:else}
            <Button
              size="sm"
              variant={head?.branch ? "primary" : "ghost"}
              icon={ArrowUpFromLine}
              disabled={gitStore.locked || !head?.branch}
              tip={gitStore.elsewhere ?? syncTip(t.git.publishTip, `git push -u origin ${head?.branch ?? ""}`)}
              onclick={() => gitStore.remote("Push")}
            >
              {t.git.publish}
            </Button>
          {/if}
        </ToolGroup>
      </div>
    </div>

    <div class="flex shrink-0 gap-1 px-3" role="tablist">
      {#each tabs as tab (tab.id)}
        {@const count = tab.id === "changes" ? status?.entries.length : tab.id === "branches" ? gitStore.branches?.local.length : undefined}
        <button
          type="button"
          role="tab"
          aria-selected={gitStore.tab === tab.id}
          use:tooltip={{ keys: tab.keys }}
          class="-mb-px inline-flex h-10 items-center gap-2 border-b-2 px-3 text-base transition-colors
            {gitStore.tab === tab.id ? 'border-accent font-medium text-fg' : 'border-transparent text-muted hover:text-fg'}"
          onclick={() => gitStore.setTab(tab.id)}
        >
          {tab.label}
          {#if count}<span class="rounded bg-panel-2 px-1.5 text-xs tabular-nums text-muted">{count}</span>{/if}
        </button>
      {/each}
    </div>

    {#if gitStore.tab === "branches"}
      <BranchesView />
    {:else}
      <div class="mx-3 mt-2 mb-3 flex min-h-0 flex-1 overflow-hidden rounded-xl border border-line bg-panel">
        {#if gitStore.tab === "changes"}<ChangesView />{:else}<HistoryView />{/if}
      </div>
    {/if}
  {/if}
</section>
<GitDialogs />
