<script lang="ts">
  import {
    Archive,
    ArrowDownToLine,
    ArrowRightLeft,
    ArrowUpFromLine,
    FilePen,
    FolderX,
    GitPullRequest,
    History,
  } from "@lucide/svelte";
  import type { Component } from "svelte";
  import { api } from "$lib/api";
  import type { BranchReport } from "$lib/bindings/BranchReport";
  import { t } from "$lib/i18n/index.svelte";
  import { path, ref, type Rich } from "$lib/rich";
  import type { Todo } from "$lib/todos";
  import Button from "$lib/ui/Button.svelte";
  import RichText from "$lib/ui/RichText.svelte";
  import { toasts } from "$lib/stores/toasts.svelte";
  import { navigation } from "$lib/services/navigation";
  import { repoActions } from "$lib/services/repoActions.svelte";
  import { deleting } from "$lib/services/deleting";

  /** The steps between a branch and its cleanup, each with the button that does it where one exists. */
  let {
    b,
    items,
    defaultBranch,
    busy,
    onstashes,
    oncommits,
  }: { b: BranchReport; items: Todo[]; defaultBranch: string | null; busy: boolean; onstashes: () => void; oncommits: () => void } = $props();

  type Step = {
    icon: Component<{ size?: number; class?: string }>;
    title: Rich | string;
    detail: Rich | string;
    action?: { label: Rich | string; run: () => unknown; disabled?: boolean; primary?: boolean };
  };

  const shown = (d: string | null) => ref(d ?? t.detail.defaultBranch);

  function step(x: Todo): Step {
    const k = t.todo;
    switch (x.kind) {
      case "commit":
        return { icon: FilePen, title: k.commit, detail: k.commitDetail(x.count), action: { label: k.openChanges, run: () => navigation.openChanges(x.path) } };
      case "stash":
        return { icon: Archive, title: k.stash, detail: k.stashDetail(x.count), action: { label: k.showStashes, run: onstashes } };
      case "push":
        return {
          icon: ArrowUpFromLine,
          title: x.first ? k.pushFirst : k.push,
          detail: x.gone ? k.pushGone(x.count) : !x.ready ? k.pushBlocked(x.count) : x.first ? k.pushFirstDetail(x.count) : k.pushDetail(x.count),
          action: x.ready ? { label: k.push, run: () => repoActions.push(b), primary: true } : undefined,
        };
      case "fastForward":
        return { icon: ArrowDownToLine, title: k.fastForward, detail: k.fastForwardDetail(x.count), action: { label: k.fastForward, run: () => repoActions.fastForward(b) } };
      case "pr":
        return { icon: GitPullRequest, title: k.pr(x.id), detail: k.prDetail, action: { label: k.openPr, run: () => toasts.safely(() => api.openUrl(x.url)) } };
      case "review":
        return { icon: History, title: k.review, detail: k.reviewDetail(x.count), action: { label: k.showCommits, run: oncommits } };
      case "worktree":
        return { icon: FolderX, title: k.worktree, detail: k.worktreeDetail(path(x.path)), action: { label: k.removeWorktree, run: () => repoActions.removeWorktree(b.repoPath, x.path) } };
      case "checkout":
        return {
          icon: ArrowRightLeft,
          title: k.checkout(shown(defaultBranch)),
          detail: x.clean ? k.checkoutDetail : k.checkoutDirtyDetail,
          action: {
            // The title names the target already; the plain button does not say it twice.
            label: x.andDelete ? t.detail.checkoutAndDelete(shown(defaultBranch)) : k.checkoutButton,
            run: () => (x.andDelete ? deleting.checkoutAndDelete(b) : repoActions.checkoutDefault(b.repoPath)),
            disabled: !x.clean || !defaultBranch,
            primary: x.andDelete,
          },
        };
    }
  }
</script>

<!-- One card, one numbered step per obstacle: the order is the order in which git lets them be done. -->
<ol class="flex flex-col divide-y divide-line overflow-hidden rounded-lg bg-panel-2/60" aria-label={t.todo.title}>
  {#each items as x, i (x.kind)}
    {@const s = step(x)}
    <li class="flex gap-3 px-3 py-3" data-todo={x.kind}>
      <span class="mt-px flex size-5 shrink-0 items-center justify-center rounded-full bg-review/15 text-xs font-semibold text-review-ink tabular-nums">{i + 1}</span>
      <div class="min-w-0 flex-1">
        <!-- The step and its button on one line: what to do, and where to do it. A long title takes
             the line and pushes the button below, rather than breaking after every word. -->
        <div class="flex flex-wrap items-start gap-x-2 gap-y-1.5">
          <div class="flex min-w-0 grow items-start gap-1.5 text-base font-medium"><s.icon size={14} class="mt-[5px] shrink-0 text-muted" /><RichText text={s.title} /></div>
          {#if s.action}
            {@const a = s.action}
            <span class="-my-0.5 ml-auto shrink-0">
              <Button size="sm" variant={a.primary && items.findIndex((y) => !!step(y).action) === i ? "primary" : "secondary"} disabled={busy || a.disabled} onclick={a.run}><RichText text={a.label} /></Button>
            </span>
          {/if}
        </div>
        <!-- eslint-disable-next-line mbf/no-break-all -- the detail may carry a worktree path as one long token -->
        <p class="selectable mt-1 text-sm leading-snug text-muted [overflow-wrap:anywhere]"><RichText text={s.detail} /></p>
      </div>
    </li>
  {/each}
</ol>
