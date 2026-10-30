<script lang="ts">
  import { path } from "$lib/rich";
  import RichText from "$lib/ui/RichText.svelte";
  import FolderName from "$lib/ui/FolderName.svelte";
  import { fullText, tooltip } from "$lib/ui/tooltip";
  import { Archive, FolderOpen, TriangleAlert } from "@lucide/svelte";
  import type { BranchReport } from "$lib/bindings/BranchReport";
  import Checkbox from "$lib/ui/Checkbox.svelte";
  import { shortSha } from "$lib/format";
  import { t } from "$lib/i18n/index.svelte";
  import { branchCommits } from "$lib/stores/branchCommits.svelte";
  import Skeleton from "$lib/ui/Skeleton.svelte";

  let {
    branch: b,
    dropStashes = $bindable(false),
    removeWorktree = $bindable(false),
  }: { branch: BranchReport; dropStashes?: boolean; removeWorktree?: boolean } = $props();

  const linked = $derived(b.worktree && !b.worktree.isMain ? b.worktree : null);
  // What the delete would leave on no branch: the own commits, read when the dialog shows them.
  const unmerged = $derived(!b.mergeEvidence && b.ownCommitCount > 0);
  const lists = $derived(branchCommits.of(b));
  const failed = $derived(branchCommits.failure(b));
  const unpushed = $derived(new Set(lists?.unpushed.map((c) => c.sha)));
  $effect(() => {
    if (unmerged) branchCommits.ensure(b);
  });
  /** Placeholder lines while the commits are read: as many as the list shows before it scrolls. */
  const WAITING_ROWS = 6;
</script>

<!-- Each risk is its own surface with its icon top-left; the title and everything below share one edge. -->
<div class="flex flex-col gap-3">
  {#if b.worktree?.isMain}
    <div class="flex gap-2.5 rounded-lg border border-blocked/30 bg-blocked/8 p-3 text-base">
      <FolderOpen size={16} class="mt-0.5 shrink-0 text-blocked" />
      <p><RichText text={t.delete.currentBranchNote(path(b.worktree.path))} /></p>
    </div>
  {/if}

  {#if unmerged}
    <div class="flex gap-2.5 rounded-lg border border-unsafe/30 bg-unsafe/8 p-3">
      <TriangleAlert size={16} class="mt-0.5 shrink-0 text-unsafe" />
      <div class="min-w-0 flex-1">
        <div class="text-base font-semibold text-unsafe">{t.delete.unmerged(b.ownCommitCount)}</div>
        {#if lists}
          <ul class="mt-2 max-h-36 overflow-y-auto pop-in">
            {#each lists.own as c (c.sha)}
              <li class="flex gap-2 py-0.5 text-sm">
                <span class="font-mono text-xs text-faint">{shortSha(c.sha)}</span>
                <span class="min-w-0 flex-1 truncate" use:fullText={c.subject}>{c.subject}</span>
                {#if unpushed.has(c.sha)}
                  <span class="shrink-0 text-xs font-semibold text-unsafe">{t.delete.neverPushed}</span>
                {/if}
              </li>
            {/each}
          </ul>
        {:else if failed !== undefined}
          <p class="mt-2 text-sm text-muted">{t.commits.readFailed}</p>
        {:else}
          <!-- Lines as tall as a commit's, as many as the list will show: nothing moves when it arrives. -->
          <ul class="mt-2 max-h-36 overflow-hidden" aria-busy="true" aria-label={t.commits.loading}>
            {#each Array.from({ length: Math.min(b.ownCommitCount, WAITING_ROWS) }, (_, i) => i) as i (i)}
              <li class="flex items-center gap-2 py-0.5 text-sm">
                <span class="flex h-5 items-center"><Skeleton class="h-3 w-14" /></span>
                <span class="flex h-5 min-w-0 flex-1 items-center"><Skeleton class={i % 2 ? "h-3 w-2/3" : "h-3 w-1/2"} /></span>
              </li>
            {/each}
          </ul>
        {/if}
        <p class="mt-2 text-sm text-muted">{t.delete.unmergedNote}</p>
      </div>
    </div>
  {/if}

  {#if linked}
    <div class="flex gap-2.5 rounded-lg border border-unsafe/30 bg-unsafe/8 p-3">
      <FolderOpen size={16} class="mt-0.5 shrink-0 text-unsafe" />
      <div class="min-w-0 flex-1">
        <div class="text-base font-semibold text-unsafe">{t.delete.linkedTitle}</div>
        <p class="mt-1 text-sm"><FolderName path={linked.path} /></p>
        <p class="mt-2 text-sm text-muted">{t.delete.linkedMoved}</p>
        {#if linked.files.length}
          <p class="mt-2 text-sm font-semibold">{t.delete.linkedLoss(linked.files.length)}</p>
          <ul class="mt-1 max-h-28 overflow-y-auto font-mono text-xs text-muted">
            {#each linked.files as f (f.path)}<li class="truncate" use:fullText={f.path}>{f.path}</li>{/each}
          </ul>
        {/if}
        <div class="mt-2">
          <Checkbox tone="danger" bind:checked={removeWorktree} label={linked.files.length ? t.delete.removeWorktreeForce : t.delete.removeWorktree} />
        </div>
      </div>
    </div>
  {/if}

  {#if b.stashes.length}
    <div class="flex gap-2.5 rounded-lg border border-review/30 bg-review/8 p-3">
      <Archive size={16} class="mt-0.5 shrink-0 text-review" />
      <div class="min-w-0 flex-1">
        <div class="text-base font-semibold text-review">{t.delete.stashTitle(b.stashes.length)}</div>
        <ul class="mt-1 text-sm">
          {#each b.stashes as s (s.sha)}
            <li class="truncate" use:tooltip={s.message}><span class="font-mono text-xs text-faint">{s.selector}</span> {s.message}</li>
          {/each}
        </ul>
        <div class="mt-2">
          <Checkbox tone="danger" bind:checked={dropStashes} label={t.delete.dropStashes} description={t.delete.dropStashesHint} />
        </div>
      </div>
    </div>
  {/if}
</div>
