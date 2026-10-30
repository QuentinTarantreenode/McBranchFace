<script lang="ts">
  import DetailIdentity from "./DetailIdentity.svelte";
  import { Broom, CircleCheck, GitGraph, Info, Laptop, Trash2, TriangleAlert } from "@lucide/svelte";
  import { branchKey, onlineKey } from "$lib/filter";
  import { t } from "$lib/i18n/index.svelte";
  import BranchName from "$lib/ui/BranchName.svelte";
  import Button from "$lib/ui/Button.svelte";
  import IconButton from "$lib/ui/IconButton.svelte";
  import Panel from "$lib/ui/Panel.svelte";
  import ActionBar from "./ActionBar.svelte";
  import AnnotationEditor from "./AnnotationEditor.svelte";
  import RepoName from "./RepoName.svelte";
  import { openInGit } from "./openInGit";
  import VerdictBadge from "./VerdictBadge.svelte";
  import RichText from "$lib/ui/RichText.svelte";
  import PrCard from "./PrCard.svelte";
  import { evidenceTarget } from "$lib/checks";
  import { branchUrl as linkOf } from "$lib/links";
  import { scanResults } from "$lib/stores/scanResults.svelte";
  import { rules } from "$lib/stores/rules.svelte";
  import { cleanupView } from "$lib/stores/cleanupView.svelte";
  import { deletes } from "$lib/stores/deletes.svelte";

  const b = $derived(cleanupView.selectedOnline);
  const busy = $derived(b ? cleanupView.busy.has(onlineKey(b)) : false);
  const repo = $derived(b ? scanResults.repoByPath.get(b.repoPath) : undefined);
  const copies = $derived(b ? scanResults.localCopiesOf(b) : []);
  const branchUrl = $derived(b && repo?.links ? linkOf(repo.links, b.name) : null);
  const merged = $derived(b?.verdict === "Merged");

  function showLocal(repoPath: string, branch: string) {
    cleanupView.setScope("Local");
    cleanupView.selectKey(branchKey({ repoPath, name: branch }));
  }
</script>

{#if b}
  <!-- The same head as the local detail: verdict, name, the row of chips, then the row of actions. -->
  <div class="border-b border-line p-5 surface-glow">
    <div class="flex h-8 items-center pr-9"><VerdictBadge online={b.verdict} size="md" /></div>
    <div class="mt-2.5"><DetailIdentity name={b.name} remote={b.remote} repoPath={b.repoPath} sha={b.sha} locked={b.locked} ignored={b.ignored} /></div>
    <div class="mt-4">
      <ActionBar
        where={b.repoPath}
        repoPath={b.repoPath}
        {branchUrl}
        locked={b.locked}
        folder={false}
        onlock={(on) => rules.setLock(b.repoPath, b.name, on)}
        branch={b.name}
        logRev={`refs/remotes/${b.remote}/${b.name}`}
        online={true}
        ignored={b.ignored}
        report={b}
      >
        {#snippet primary()}
          {#if !b.locked}
            <Button size="sm" class="!rounded-md" variant={merged ? "delete" : "danger-outline"} icon={Trash2} disabled={busy} tip={merged ? t.detail.deleteTip : t.detail.forceTip} onclick={() => deletes.openOnlineDelete([b], !merged)}>
              {t.cleanup.deleteOnline}
            </Button>
          {/if}
        {/snippet}
      </ActionBar>
    </div>
  </div>

  <div class="min-h-0 flex-1 overflow-y-auto px-5 pb-6">
    <!-- The order of the local detail: checks, pull request, copies, note last. -->
    <Panel title={t.detail.checks}>
      <div class="flex gap-2.5 rounded-lg bg-panel-2/60 px-3 py-2.5">
        {#if b.mergeEvidence}
          <span class="mt-0.5 shrink-0 text-safe"><CircleCheck size={15} /></span>
          <div class="min-w-0">
            <div class="text-base font-medium"><RichText text={t.check.merged(evidenceTarget(b.mergeEvidence))} /></div>
            <div class="mt-0.5 text-sm text-muted"><RichText text={t.check.mergeDetail[b.mergeEvidence.kind](evidenceTarget(b.mergeEvidence))} /></div>
          </div>
        {:else}
          <span class="mt-0.5 shrink-0 {b.verdict === 'Inactive' ? 'text-review' : 'text-faint'}">
            {#if b.verdict === "Inactive"}<TriangleAlert size={15} />{:else}<Info size={15} />{/if}
          </span>
          <div class="min-w-0">
            <div class="text-base font-medium">{t.check.noEvidence}</div>
            <div class="mt-0.5 text-sm text-muted">{t.detail.onlineCommits(b.ownCommitCount)}</div>
          </div>
        {/if}
      </div>
    </Panel>

    {#if b.pullRequest}
      {@const pr = b.pullRequest}
      <Panel title={t.detail.pullRequest}>
        <PrCard {pr} repoPath={b.repoPath} />
      </Panel>
    {/if}

    <Panel title={t.detail.localCopies} count={copies.length}>
      {#if copies.length === 0}
        <p class="t-meta">{t.detail.localCopiesNone}</p>
      {:else}
        <ul class="flex flex-col gap-1">
          {#each copies as c (c.repoPath + c.branch)}
            <li class="flex items-center gap-2.5 rounded-lg bg-panel-2/60 px-3 py-2.5 text-sm">
              <Laptop size={14} class="shrink-0 text-faint" />
              <div class="min-w-0 flex-1">
                <div class="flex min-w-0"><BranchName name={c.branch} size="sm" /></div>
                <div class="flex items-center gap-1.5 t-meta">
                  <RepoName path={c.repoPath} />
                  {#if c.checkedOut}· <span class="text-blocked">{t.detail.checkedOut}</span>{/if}
                  {#if c.ahead}· <span class="text-accent">{t.detail.ahead(c.ahead)}</span>{/if}
                  {#if c.behind}· <span class="text-blocked">{t.detail.behind(c.behind)}</span>{/if}
                </div>
              </div>
              {#if c.gone}
                <IconButton icon={Broom} size="sm" label={t.detail.showInCleanup} onclick={() => showLocal(c.repoPath, c.branch)} />
              {/if}
              <!-- This copy's own Git view is the button above; only the other copies get one here. -->
              {#if c.repoPath !== b.repoPath}<IconButton icon={GitGraph} size="sm" label={t.detail.openInGit} onclick={() => openInGit(c.repoPath)} />{/if}
            </li>
          {/each}
        </ul>
      {/if}
    </Panel>
    <Panel title={t.detail.annotation}>
      <AnnotationEditor repoPath={b.repoPath} branch={b.name} />
    </Panel>
  </div>
{/if}
