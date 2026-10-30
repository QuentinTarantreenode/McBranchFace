<script lang="ts">
  import FolderName from "$lib/ui/FolderName.svelte";
  import { tooltip } from "$lib/ui/tooltip";
  import { CircleCheck, CircleDashed, CircleMinus, CircleX, Globe, LoaderCircle, RotateCcw, ShieldCheck, TriangleAlert } from "@lucide/svelte";
  import type { LocalJob } from "$lib/stores/deletes.svelte";
  import { t } from "$lib/i18n/index.svelte";
  import BranchName from "$lib/ui/BranchName.svelte";
  import RichText from "$lib/ui/RichText.svelte";
  import { evidenceTarget } from "$lib/checks";
  import { branchKey } from "$lib/filter";
  import type { BranchReport } from "$lib/bindings/BranchReport";
  import type { MergeEvidence } from "$lib/bindings/MergeEvidence";
  import type { PullRequestInfo } from "$lib/bindings/PullRequestInfo";
  import type { ItemStatus, JobItem } from "$lib/deleteJob.svelte";
  import type { RemoteBranchReport } from "$lib/bindings/RemoteBranchReport";
  import Button from "$lib/ui/Button.svelte";
  import Checkbox from "$lib/ui/Checkbox.svelte";
  import Input from "$lib/ui/Input.svelte";
  import Modal from "$lib/ui/Modal.svelte";
  import ForceWarnings from "./ForceWarnings.svelte";
  import RepoName from "./RepoName.svelte";
  import PathText from "$lib/ui/PathText.svelte";
  import { scanResults } from "$lib/stores/scanResults.svelte";
  import { deletes } from "$lib/stores/deletes.svelte";
  import { deleting } from "$lib/services/deleting";

  const job = $derived(deletes.deleteJob);
  const online = $derived(job?.mode === "online");

  let confirmText = $state("");
  let dropStashes = $state(false);
  let removeWorktree = $state(false);

  $effect(() => {
    if (job) {
      confirmText = "";
      dropStashes = false;
      removeWorktree = false;
    }
  });

  const total = $derived(job?.active.length ?? 0);
  const single = $derived(job?.force && job.items.length === 1 ? job.items[0].branch : null);
  const remoteOf = (i: JobItem) => i.branch as RemoteBranchReport;
  const foreign = $derived(online ? (job?.items.filter((i) => !remoteOf(i).isMine) ?? []) : []);
  const copyCount = $derived.by(() => {
    if (!online || !job) return 0;
    return job.items
      .filter((i) => i.status !== "excluded")
      .reduce((n, i) => n + scanResults.localCountOf(remoteOf(i)), 0);
  });
  const localForce = $derived(!online && single ? (single as BranchReport) : null);
  const linked = $derived(localForce?.worktree && !localForce.worktree.isMain ? localForce.worktree : null);
  const needsName = $derived(!!job?.force && !!single && !localForce?.worktree?.isMain);
  const canConfirm = $derived(
    !!job &&
      total > 0 &&
      (!job.force || (!!single && !localForce?.worktree?.isMain && confirmText.trim() === single.name && (!linked || removeWorktree))),
  );
  const groups = $derived.by(() => {
    const m = new Map<string, JobItem[]>();
    for (const i of job?.items ?? []) {
      const k = i.branch.repoPath;
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(i);
    }
    return [...m.entries()];
  });
  const summary = $derived(
    [
      { n: job?.succeeded.length ?? 0, text: t.delete.deleted, tone: "text-safe" },
      { n: job?.failed.length ?? 0, text: t.delete.failed, tone: "text-unsafe" },
      { n: job?.skipped.length ?? 0, text: t.delete.skipped, tone: "text-faint" },
    ]
      .filter((p) => p.n > 0)
      .map((p) => ({ text: `${p.n} ${p.text}`, tone: p.tone })),
  );
  const unfinished = $derived((job?.failed.length ?? 0) + (job?.skipped.length ?? 0));

  const title = $derived.by(() => {
    if (!job) return "";
    if (job.phase === "running") return t.delete.runningTitle(total);
    if (job.phase === "done") return job.failed.length ? t.delete.doneErrors : t.delete.done;
    if (job.force) return online ? t.delete.onlineForce : t.delete.force;
    if (online) return total === 1 ? t.delete.onlineConfirmOne : t.delete.onlineConfirmMany(total);
    return total === 1 ? t.delete.confirmOne : t.delete.confirmMany(total);
  });

  function start() {
    if (!job || !canConfirm) return;
    if (!online && job.force && localForce) {
      (job as LocalJob).overrides = { force: true, removeWorktree, dropStashes: dropStashes ? localForce.stashes.map((s) => s.sha) : [] };
    }
    deleting.runDelete();
  }

  function evidenceOf(i: JobItem): { e: MergeEvidence | null; pr: PullRequestInfo | null } {
    const b = i.branch as { mergeEvidence?: MergeEvidence | null; pullRequest?: PullRequestInfo | null };
    return { e: b.mergeEvidence ?? null, pr: b.pullRequest ?? null };
  }

  const statusTone: Record<ItemStatus, string> = {
    pending: "text-faint",
    running: "text-accent",
    ok: "text-safe",
    failed: "text-unsafe",
    skipped: "text-faint",
    excluded: "text-faint",
  };
</script>

{#snippet statusIcon(s: ItemStatus)}
  <span class="shrink-0 {statusTone[s]}">
    {#if s === "running"}<LoaderCircle size={14} class="animate-spin" />
    {:else if s === "ok"}<CircleCheck size={14} />
    {:else if s === "failed"}<CircleX size={14} />
    {:else if s === "skipped"}<CircleMinus size={14} />
    {:else}<CircleDashed size={14} />{/if}
  </span>
{/snippet}

{#snippet itemRow(i: JobItem)}
  {@const ev = evidenceOf(i)}
  <li class="rounded-md px-2 py-1.5">
    <div class="flex items-center gap-2.5 text-base {i.status === 'excluded' ? 'opacity-55' : ''}">
      {#if job?.phase === "confirm" && online && job.items.length > 1}
        <Checkbox
          checked={i.status !== "excluded"}
          ariaLabel={i.branch.name}
          tip={t.delete.includeTip}
          onchange={(on) => (on ? job?.include(i.key) : job?.exclude(i.key))}
        />
      {:else if job?.phase !== "confirm"}{@render statusIcon(i.status)}{/if}
      <span class="flex min-w-0 flex-1"><BranchName name={i.branch.name} /></span>
      {#if online && !remoteOf(i).isMine}
        <span class="shrink-0 rounded bg-review/12 px-1.5 text-xs text-review-ink" use:tooltip={remoteOf(i).lastCommitAuthor}>{t.delete.notMine}</span>
      {/if}
      {#if i.status === "excluded" && job?.phase !== "confirm"}
        <span class="shrink-0 text-xs text-faint">{t.delete.notSelected}</span>
      {:else if i.status === "skipped"}
        <span class="shrink-0 text-xs text-faint">{t.delete.skipped}</span>
      {:else if i.status === "failed" && i.failure}
        <span class="shrink-0 text-xs text-unsafe">{t.failure[i.failure.kind].title}</span>
      {:else if ev.e}
        <span class="flex shrink-0 items-center gap-1 text-xs text-faint">
          {t.mergeKind[ev.e.kind]} → <RichText text={[evidenceTarget(ev.e)]} />{ev.pr && ev.e.kind !== "PullRequest" ? ` · PR ${ev.pr.id}` : ""}
        </span>
      {/if}
    </div>

    {#if i.status === "failed" && i.failure}
      {@const f = i.failure}
      <div class="mt-1.5 ml-6 rounded-lg border border-unsafe/25 bg-unsafe/6 p-2.5 text-sm">
        <p class="leading-snug">{t.failure[f.kind].hint}</p>
        {#if f.path}<p class="selectable mt-1 text-xs text-muted"><PathText path={f.path} /></p>{/if}
        {#if f.filesBackup}<p class="mt-1 text-sm text-muted">{t.delete.filesKept} <PathText path={f.filesBackup} /></p>{/if}
        {#if f.changed}
          <p class="mt-1.5 font-semibold text-unsafe">{t.delete.changedAt(t.step[f.step])}</p>
        {:else}
          <p class="mt-1 text-xs text-faint">{t.delete.unchangedAt(t.step[f.step])}</p>
        {/if}
        <details class="mt-1">
          <summary class="cursor-pointer text-xs text-faint">{t.common.details}</summary>
          <pre class="selectable mt-1 font-mono text-xs whitespace-pre-wrap text-muted">{f.detail}</pre>
        </details>
      </div>
    {/if}

    {#if i.outcome?.filesBackup}
      <!-- The worktree is gone, its changed files are not: say where they are. -->
      <p class="mt-1 ml-6 text-sm text-muted">{t.delete.filesKept} <PathText path={i.outcome.filesBackup} /></p>
    {/if}
    {#each i.outcome?.warnings ?? [] as w, n (n)}
      <div class="mt-1 ml-6 flex items-start gap-1.5 text-sm text-review">
        <TriangleAlert size={12} class="mt-0.5 shrink-0" />
        <span>{w.step in t.warning ? t.warning[w.step as keyof typeof t.warning] : t.step[w.step]}{#if w.path}<FolderName path={w.path} class="ml-1 font-medium" />{/if}</span>
      </div>
    {/each}
  </li>
{/snippet}

{#snippet note(icon: "safe" | "online" | "danger" | "warn", text: string)}
  <!-- Icon top-left of the surface, text aligned next to it. -->
  <div
    class="mb-3 flex gap-2.5 rounded-lg p-3 text-sm leading-snug
      {icon === 'danger' ? 'border border-unsafe/30 bg-unsafe/8 text-fg' : icon === 'warn' ? 'border border-review/30 bg-review/8 text-fg' : 'bg-panel-2/70 text-muted'}"
  >
    {#if icon === "safe"}<ShieldCheck size={16} class="mt-px shrink-0 text-safe" />
    {:else if icon === "online"}<Globe size={16} class="mt-px shrink-0 text-review" />
    {:else}<TriangleAlert size={16} class="mt-px shrink-0 {icon === 'warn' ? 'text-review' : 'text-unsafe'}" />{/if}
    <span>{text}</span>
  </div>
{/snippet}

<Modal
  open={job !== null}
  {title}
  tone={job?.force && job.phase === "confirm" ? "danger" : "default"}
  width="620px"
  dismissible={job?.phase !== "running"}
  onclose={() => deletes.closeDelete()}
>
  {#if job}
    {#if job.phase === "confirm" && single}
      <p class="mb-1"><BranchName name={single.name} remote={online ? (single as RemoteBranchReport).remote : null} size="lg" class="font-semibold" /></p>
      <p class="mb-3 t-meta"><RepoName path={single.repoPath} /></p>
      {#if localForce}
        <ForceWarnings branch={localForce} bind:dropStashes bind:removeWorktree />
      {:else}
        {@render note("danger", t.delete.onlineForceNote)}
      {/if}
      {#if needsName}
        <Input
          class="mt-4"
          label={t.delete.typeName}
          mono
          data-autofocus
          bind:value={confirmText}
          onkeydown={(e) => e.key === "Enter" && start()}
          placeholder={single.name}
          spellcheck="false"
        />
      {/if}
    {:else}
      {#if job.phase === "confirm"}
        {@render note(online ? "online" : "safe", online ? t.delete.onlineNote : t.delete.safeNote)}
        {#if foreign.length && job.items.length > 1}
          {@render note("warn", t.delete.foreignNote(foreign.length))}
        {/if}
      {:else}
        <div class="mb-3">
          <div class="flex items-baseline justify-between text-sm">
            <span class="font-medium">
              {#if job.phase === "running"}
                {job.current ? job.current.branch.name : "…"}
              {:else}
                {#each summary as part, n (part.text)}
                  {#if n > 0}<span class="mx-1.5 text-faint">·</span>{/if}<span class={part.tone}>{part.text}</span>
                {/each}
              {/if}
            </span>
            <span class="tabular-nums text-faint">{job.finished} / {total}</span>
          </div>
          <div class="mt-1.5 h-1.5 overflow-hidden rounded-full bg-line">
            <div
              class="h-full rounded-full transition-[width] duration-300
                {!job.failed.length ? 'bg-safe' : job.succeeded.length ? 'bg-review' : 'bg-unsafe'}"
              style="width: {total ? (job.finished / total) * 100 : 0}%"
            ></div>
          </div>
        </div>
      {/if}

      <div class="max-h-[46vh] overflow-y-auto pr-1">
        {#each groups as [repo, items] (repo)}
          <div class="mt-2 first:mt-0">
            <div class="text-xs font-semibold text-faint"><RepoName path={repo} /></div>
            <ul class="zebra mt-1">
              {#each items as i (i.key)}{@render itemRow(i)}{/each}
            </ul>
          </div>
        {/each}
        {#if job.followUps.length}
          <div class="mt-4">
            <div class="text-xs font-semibold text-faint">{t.delete.localCopiesTitle}</div>
            <ul class="zebra mt-1">
              {#each job.followUps as f (branchKey({ repoPath: f.repoPath, name: f.branch }))}
                <li class="flex items-center gap-2.5 rounded-md px-2 py-1.5 text-base">
                  {@render statusIcon(f.status)}
                  <span class="flex min-w-0 flex-1"><BranchName name={f.branch} /></span>
                  <span class="shrink-0 text-xs text-faint"><RepoName path={f.repoPath} /></span>
                  {#if f.reason}<span class="shrink-0 text-xs {f.status === 'failed' ? 'text-unsafe' : 'text-faint'}">{f.reason}</span>{/if}
                </li>
              {/each}
            </ul>
          </div>
        {/if}
      </div>
      {#if job.phase === "confirm" && online && !job.force && copyCount > 0}
        <div class="mt-4 border-t border-line pt-3">
          <Checkbox bind:checked={job.alsoLocal} label={t.delete.alsoLocal(copyCount)} description={t.delete.alsoLocalHint} />
        </div>
      {/if}
    {/if}
  {/if}

  {#snippet footer()}
    {#if job?.phase === "confirm"}
      <Button variant="ghost" onclick={() => deletes.closeDelete()}>{t.common.cancel}</Button>
      <Button
        variant={job.force ? "danger" : "delete"}
        data-autofocus={needsName || online ? undefined : true}
        disabled={!canConfirm}
        tip={needsName && !canConfirm ? t.delete.typeNameFirst : undefined}
        onclick={start}
      >
        {#if job.force && !online}{t.delete.force}{:else if online}{total === 1 ? t.delete.deleteOnlineOne : t.delete.deleteOnlineMany(total)}{:else if total === 1}{t.delete.deleteOne}{:else}{t.delete.deleteMany(total)}{/if}
      </Button>
    {:else if job?.phase === "running" && !online}
      <Button variant="ghost" disabled={job.stopRequested} tip={t.delete.stopTip} onclick={() => job && (job.stopRequested = true)}>
        {job.stopRequested ? t.delete.stopping : t.delete.stop}
      </Button>
    {:else if job?.phase === "done"}
      {#if job.succeeded.length}
        <div class="mr-auto">
          <Button variant="ghost" icon={RotateCcw} tip={t.delete.undoTip} onclick={() => deleting.undoDelete()}>
            {job.succeeded.length === 1 ? t.delete.undo : t.delete.undoAll(job.succeeded.length)}
          </Button>
        </div>
      {/if}
      {#if unfinished}
        <Button tip={t.delete.retryTip} onclick={() => deleting.retryDelete()}>
          {unfinished === 1 ? t.delete.retry : t.delete.retryMany(unfinished)}
        </Button>
      {/if}
      <Button variant="primary" onclick={() => deletes.closeDelete()}>{t.common.close}</Button>
    {/if}
  {/snippet}
</Modal>
