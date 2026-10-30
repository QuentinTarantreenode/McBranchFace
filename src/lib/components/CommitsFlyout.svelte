<script lang="ts">
  import { untrack } from "svelte";
  import { Latest } from "$lib/latest";
  import { CalendarRange, Copy, GitGraph, Info, Search } from "@lucide/svelte";
  import { api } from "$lib/api";
  import { t } from "$lib/i18n/index.svelte";
  import { absoluteTime, dateOnly, relativeTime, shortSha } from "$lib/format";
  import { filterCommits, span } from "$lib/commitFilter";
  import type { CommitInfo } from "$lib/bindings/CommitInfo";
  import BranchName from "$lib/ui/BranchName.svelte";
  import Button from "$lib/ui/Button.svelte";
  import Input from "$lib/ui/Input.svelte";
  import IconButton from "$lib/ui/IconButton.svelte";
  import Modal from "$lib/ui/Modal.svelte";
  import VirtualList from "$lib/ui/VirtualList.svelte";
  import { fullText, tooltip } from "$lib/ui/tooltip";
  import { toasts } from "$lib/stores/toasts.svelte";
  import { settings } from "$lib/stores/settings.svelte";
  import { dialogs } from "$lib/stores/dialogs.svelte";
  import { clock } from "$lib/stores/clock.svelte";
  import { navigation } from "$lib/services/navigation";

  // One window for every commit list: after the last push, own commits, the commits of a PR.
  const v = $derived(dialogs.commitsView);

  let commits = $state<CommitInfo[]>([]);
  let total = $state(0);
  let fromProvider = $state(false);
  let loading = $state(false);
  let failed = $state<string | null>(null);
  let query = $state("");
  let from = $state("");
  let to = $state("");

  // Start from what the view brings; a loader (a PR) replaces it once it answers.
  $effect(() => {
    const view = dialogs.commitsView;
    // Another view, or none: what is still loading for the last one must not land in it.
    untrack(() => loads.next());
    if (!view) return;
    untrack(() => {
      commits = view.commits;
      total = view.total ?? view.commits.length;
      fromProvider = false;
      failed = null;
      loading = false;
      if (view.load) void load(view.load);
    });
  });

  const loads = new Latest();
  async function load(fn: () => Promise<{ commits: CommitInfo[]; fromProvider: boolean; total?: number }>) {
    const current = loads.next();
    loading = true;
    try {
      const r = await fn();
      if (!current()) return;
      commits = r.commits;
      total = r.total ?? r.commits.length;
      fromProvider = r.fromProvider;
    } catch (e) {
      if (current()) failed = String((e as { message?: string })?.message ?? e);
    } finally {
      if (current()) loading = false;
    }
  }

  // The scan keeps at most a few hundred; the full list comes from git on request.
  async function loadAll() {
    const view = v;
    if (!view?.range) return;
    const range = view.range;
    await load(async () => {
      const log = await api.gitLog(view.repoPath, range, 0, 5000, null);
      return { commits: log.map((e) => ({ sha: e.sha, subject: e.subject, authorEmail: e.email, authoredAt: e.time })), fromProvider: false };
    });
  }

  const shown = $derived(filterCommits(commits, query, from, to));
  // While a list whose length is known loads, the window already has its size: nothing moves when it lands.
  const waiting = $derived(loading && !commits.length);
  const rows = $derived(waiting ? total : shown.length);
  const extent = $derived(span(shown));
  const filtered = $derived(query.trim() !== "" || from !== "" || to !== "");

  function open(c: CommitInfo) {
    const view = v;
    if (!view) return;
    dialogs.commitsView = null;
    navigation.openHistory(view.repoPath, { rev: view.range, sha: c.sha });
  }
</script>

{#if v}
<Modal open title={v.title} width="760px" resizable {...settings.dialogSize("commits")} onclose={() => (dialogs.commitsView = null)}>
  <div class="flex flex-col gap-3">
    {#if v.branch}
      <div class="flex min-w-0 items-center gap-2"><BranchName name={v.branch} size="sm" /></div>
    {/if}
    <!-- Filters in one row: text, then the date range. -->
    <div class="flex flex-wrap items-end gap-2">
      <Input bind:value={query} icon={Search} placeholder={t.commits.search} aria-label={t.commits.search} class="min-w-[220px] flex-1" />
      <label class="flex flex-col gap-1 t-meta">
        {t.commits.from}
        <input type="date" bind:value={from} class="h-8 rounded-md border border-line-strong bg-panel px-2 text-sm text-fg" />
      </label>
      <label class="flex flex-col gap-1 t-meta">
        {t.commits.to}
        <input type="date" bind:value={to} class="h-8 rounded-md border border-line-strong bg-panel px-2 text-sm text-fg" />
      </label>
      {#if filtered}
        <Button size="sm" variant="ghost" onclick={() => ((query = ""), (from = ""), (to = ""))}>{t.common.resetFilter}</Button>
      {/if}
    </div>

    <div class="flex flex-wrap items-center gap-x-3 gap-y-1 t-meta">
      <span class="font-medium text-fg">{t.commits.count(rows, total)}</span>
      {#if extent}
        <span class="inline-flex items-center gap-1" use:tooltip={`${absoluteTime(extent.first)} – ${absoluteTime(extent.last)}`}>
          <CalendarRange size={12} />{t.commits.span(dateOnly(extent.first), dateOnly(extent.last))}
        </span>
      {/if}
      {#if !waiting && total > commits.length && v.range}
        <span>{t.commits.capped(commits.length, total)}</span>
        <Button size="sm" variant="ghost" onclick={loadAll} disabled={loading}>{t.commits.loadAll}</Button>
      {/if}
    </div>
    {#if fromProvider}
      <p class="flex items-start gap-2 text-sm text-muted"><Info size={14} class="mt-0.5 shrink-0 text-faint" />{t.commits.fromProvider}</p>
    {/if}
    {#if failed}
      <p class="text-sm text-unsafe">{failed}</p>
    {/if}

    <!-- As tall as its commits, up to the cap: two commits in a list the size of the window left it empty. -->
    <div class="min-h-[82px] overflow-hidden rounded-lg border border-line" style="height: min(52vh, 520px, {Math.max(2, rows) * 40 + 2}px)">
      {#if waiting}
        <p class="p-4 t-meta">{t.commits.loading}</p>
      {:else}
        <VirtualList items={shown} rowHeight={40} key={(c) => c.sha} label={v.title} class="h-full">
          {#snippet row(c)}
            <div class="grid h-10 grid-cols-[76px_minmax(0,1fr)_minmax(0,180px)_96px_28px] items-center gap-3 border-b border-line/60 px-3 text-sm hover:bg-hover/60">
              <button type="button" class="inline-flex h-6 items-center gap-1 justify-self-start rounded-md border border-line-strong px-1.5 font-mono text-xs transition-colors hover:bg-hover" use:tooltip={t.commits.copySha} onclick={() => toasts.copy(c.sha)}>
                {shortSha(c.sha)}<Copy size={10} />
              </button>
              <span class="selectable min-w-0 truncate" use:fullText={c.subject}>{c.subject}</span>
              <span class="min-w-0 truncate text-muted" use:fullText={c.authorEmail}>{c.authorEmail}</span>
              <span class="text-right text-faint tabular-nums" use:tooltip={absoluteTime(c.authoredAt)}>{relativeTime(c.authoredAt, clock.now)}</span>
              <!-- As wide as the button: the column is wider at small UI zoom, and the tip's wrapper must cover the button exactly. -->
              <span class="flex justify-self-start"><IconButton icon={GitGraph} size="sm" label={t.commits.open} hint={t.commits.openTip} onclick={() => open(c)} /></span>
            </div>
          {/snippet}
          {#snippet empty()}
            <p class="p-4 t-meta">{commits.length ? t.common.noMatch : t.commits.none}</p>
          {/snippet}
        </VirtualList>
      {/if}
    </div>
  </div>
</Modal>
{/if}
