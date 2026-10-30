<script lang="ts">
  import { ExternalLink, GitCommitHorizontal, GitPullRequest } from "@lucide/svelte";
  import { api } from "$lib/api";
  import { t } from "$lib/i18n/index.svelte";
  import { absoluteTime, relativeTime, shortSha } from "$lib/format";
  import { PR_TONE } from "$lib/verdict";
  import type { PullRequestInfo } from "$lib/bindings/PullRequestInfo";
  import Button from "$lib/ui/Button.svelte";
  import RefName from "$lib/ui/RefName.svelte";
  import { tooltip } from "$lib/ui/tooltip";
  import { toasts } from "$lib/stores/toasts.svelte";
  import { clock } from "$lib/stores/clock.svelte";
  import { dialogs } from "$lib/stores/dialogs.svelte";

  /** One pull request: what it is, where it goes, when, and its commits on request. */
  let { pr, repoPath }: { pr: PullRequestInfo; repoPath: string } = $props();

  const closedText = $derived(pr.closedAt ? (pr.state === "Merged" ? t.pr.merged : t.pr.closed)(relativeTime(pr.closedAt, clock.now)) : null);

  function showCommits() {
    dialogs.commitsView = { title: t.commits.pr(pr.id), repoPath, commits: [], load: () => api.prCommits(repoPath, pr) };
  }
</script>

<div class="flex flex-col gap-2 rounded-lg bg-panel-2/60 px-3 py-2.5 text-sm">
  <div class="flex min-w-0 items-start gap-2">
    <GitPullRequest size={14} class="mt-0.5 shrink-0 text-faint" />
    <div class="min-w-0 flex-1">
      <div class="selectable font-semibold">PR {pr.id} · {pr.title}</div>
      <div class="mt-1 flex min-w-0 flex-wrap items-center gap-1.5">
        <RefName ref={pr.sourceRef} />
        <span class="text-faint" aria-hidden="true">→</span>
        <RefName ref={pr.targetRef} />
      </div>
    </div>
    <span class="shrink-0 rounded-md px-1.5 py-0.5 text-xs font-medium {PR_TONE[pr.state]}">{t.prState[pr.state]}</span>
  </div>
  <div class="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 t-meta">
    {#if pr.author}<span>{pr.author}</span>{/if}
    {#if pr.createdAt}
      <span aria-hidden="true">·</span>
      <span use:tooltip={absoluteTime(pr.createdAt)}>{t.pr.created(relativeTime(pr.createdAt, clock.now))}</span>
    {/if}
    {#if closedText && pr.closedAt}
      <span aria-hidden="true">·</span>
      <span use:tooltip={absoluteTime(pr.closedAt)}>{closedText}</span>
    {/if}
    {#if pr.sourceSha}
      <span aria-hidden="true">·</span>
      <span use:tooltip={t.pr.sourceCommit}><span class="font-mono">{shortSha(pr.sourceSha)}</span></span>
    {/if}
  </div>
  <div class="flex flex-wrap gap-1.5">
    <Button size="sm" variant="ghost" icon={GitCommitHorizontal} tip={t.pr.commitsTip} onclick={showCommits}>{t.pr.showCommits}</Button>
    <Button size="sm" variant="ghost" icon={ExternalLink} onclick={() => toasts.safely(() => api.openUrl(pr.url))}>{t.pr.open}</Button>
  </div>
</div>
