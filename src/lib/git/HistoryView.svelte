<script lang="ts">
  import { untrack } from "svelte";
  import { gitStatus } from "$lib/stores/gitStatus.svelte";
  import { ChevronDown, Copy, GitCommitHorizontal, History, Search } from "@lucide/svelte";
  import { absoluteTime, relativeTime, shortSha } from "$lib/format";
  import { t } from "$lib/i18n/index.svelte";
  import type { LogEntry } from "$lib/bindings/LogEntry";
  import EmptyState from "$lib/ui/EmptyState.svelte";
  import Input from "$lib/ui/Input.svelte";
  import Resizer from "$lib/ui/Resizer.svelte";
  import Skeleton from "$lib/ui/Skeleton.svelte";
  import VirtualList from "$lib/ui/VirtualList.svelte";
  import { debounced, delayed } from "$lib/ui/delay.svelte";
  import { contextmenu, openBelow, type MenuEntry } from "$lib/ui/menu.svelte";
  import Button from "$lib/ui/Button.svelte";
  import { logScopes, type LogScope } from "./logScope";
  import { fullText, tooltip } from "$lib/ui/tooltip";
  import { CHANGE_META, splitPath } from "./changes";
  import DiffView from "./DiffView.svelte";
  import GitError from "./GitError.svelte";
  import { gitStore } from "./gitStore.svelte";
  import { toasts } from "$lib/stores/toasts.svelte";
  import { clock } from "$lib/stores/clock.svelte";
  import { scanResults } from "$lib/stores/scanResults.svelte";

  const ROW = 44;

  const defaultBranch = $derived((gitStore.repo ? scanResults.repoByPath.get(gitStore.repo)?.defaultBranch : null) ?? null);
  const headBranch = $derived(gitStore.repo ? (gitStatus.statuses.get(gitStore.repo)?.head.branch ?? null) : null);
  const scopes = $derived(logScopes(gitStore.rev, headBranch, defaultBranch));
  const scope = $derived(scopes.find((s) => s.rev === gitStore.rev) ?? scopes[0]);

  function scopeLabel(s: LogScope): string {
    if (s.kind === "branch") return t.git.scope.branch(s.branch!);
    if (s.kind === "new") return t.git.scope.new(s.branch!, defaultBranch!);
    return s.kind === "head" ? t.git.scope.head : t.git.scope.range;
  }

  function scopeMenu(e: MouseEvent) {
    const entries: MenuEntry[] = scopes.map((s) => ({ label: scopeLabel(s), hint: s.rev, checked: s.rev === gitStore.rev, run: () => gitStore.setRev(s.rev) }));
    openBelow(e.currentTarget as HTMLElement, entries, t.git.logScope);
  }
  // What a double click on the list's edge goes back to.
  const LIST_DEFAULT = 460;
  let listWidth = $state(LIST_DEFAULT);
  let paneWidth = $state(1200);
  // The commit list may take any width that leaves the details beside it room to read.
  const listMax = $derived(Math.max(300, paneWidth - 320));
  let query = $state(gitStore.logQuery);
  const activeIndex = $derived(gitStore.log.findIndex((c) => c.sha === gitStore.selectedSha));
  const d = $derived(gitStore.detail?.entry.sha === gitStore.selectedSha ? gitStore.detail : null);
  const listSkeleton = delayed(() => gitStore.logLoading && gitStore.log.length === 0);
  // A failed load says so above the pane instead of a shape that waits for ever.
  const detailSkeleton = delayed(() => !!gitStore.selectedSha && !d && !gitStore.errors.detail);

  // The search runs in git; it waits for a typing pause.
  debounced(() => query, 250, (q) => gitStore.setLogQuery(q), { flush: true });

  // The selection always belongs to the list: after a search or a reload it moves to the first entry.
  // Follows the list only: the selection it writes must not run it again.
  $effect(() => {
    const log = gitStore.log;
    untrack(() => {
      if (log.length && !log.some((c) => c.sha === gitStore.selectedSha)) gitStore.selectCommit(log[0].sha);
    });
  });

  function onKey(e: KeyboardEvent) {
    const i = activeIndex;
    const next = e.key === "ArrowDown" || e.key === "j" ? i + 1 : e.key === "ArrowUp" || e.key === "k" ? i - 1 : null;
    if (next === null) return;
    e.preventDefault();
    const c = gitStore.log[Math.min(gitStore.log.length - 1, Math.max(0, next))];
    if (c) gitStore.selectCommit(c.sha);
  }

  function menuFor(c: LogEntry): MenuEntry[] {
    return [
      { heading: shortSha(c.sha) },
      {
        tiles: [
          { label: t.common.copySha, icon: Copy, run: () => toasts.copy(c.sha) },
          { label: t.git.copySubject, icon: Copy, run: () => toasts.copy(c.subject) },
        ],
      },
    ];
  }
</script>

<div class="flex min-h-0 flex-1" bind:clientWidth={paneWidth}>
  <div class="relative flex shrink-0 flex-col border-r border-line" style="width: {Math.min(listWidth, listMax)}px">
    <div class="flex shrink-0 flex-col gap-1.5 border-b border-line p-2">
      <!-- The button sits in a wrapper span (for its tooltip): the wrapper takes the width. -->
      <div class="flex *:flex-1">
      <Button
        size="sm"
        variant="ghost"
        icon={History}
        class="w-full justify-start"
        aria-haspopup="menu"
        tip={{ title: t.git.logScope, text: t.git.logScopeTip, rows: [{ value: `git log ${scope.rev}`, kind: "mono" }] }}
        onclick={scopeMenu}
      >
        <span class="min-w-0 flex-1 truncate text-left">{scopeLabel(scope)}</span><ChevronDown size={13} class="shrink-0" />
      </Button>
      </div>
      <Input bind:value={query} icon={Search} placeholder={t.git.searchHistory} aria-label={t.git.searchHistory} clearable />
    </div>
    <GitError of={["log"]} class="mx-2 mt-2" />
    {#if listSkeleton.value}
      <div class="min-h-0 flex-1 overflow-hidden" aria-busy="true">
        {#each [0, 1, 2, 3, 4, 5, 6, 7, 8] as i (i)}
          <div class="flex flex-col justify-center gap-2 border-b border-line/50 px-3" style="height: {ROW}px">
            <Skeleton class={i % 3 ? "h-3 w-2/3" : "h-3 w-4/5"} />
            <Skeleton class="h-2.5 w-1/3" />
          </div>
        {/each}
      </div>
    {:else}
      <VirtualList
        items={gitStore.log}
        rowHeight={ROW}
        key={(c) => c.sha}
        activeKey={gitStore.selectedSha}
        class="flex-1"
        label="Commits"
        onkeydown={onKey}
        onnearend={() => gitStore.loadMoreLog()}
      >
        {#snippet row(c, i)}
          {@const selected = c.sha === gitStore.selectedSha}
          <!-- Keys belong to the list: arrows in the list's handler. -->
          <!-- svelte-ignore a11y_click_events_have_key_events -->
          <div
            role="option"
            aria-selected={selected}
            tabindex="-1"
            class="flex cursor-pointer flex-col justify-center border-b border-line/50 px-3 {selected ? 'mbf-selected' : i % 2 ? 'bg-row-alt hover:bg-hover/70' : 'hover:bg-hover/70'}"
            style="height: {ROW}px"
            onclick={() => gitStore.selectCommit(c.sha)}
            use:contextmenu={() => menuFor(c)}
            use:tooltip={() => ({ text: t.git.commitRowTip, gestures: true })}
          >
            <div class="flex items-center gap-2">
              <span class="min-w-0 flex-1 truncate text-base" use:fullText={c.subject}>{c.subject}</span>
              {#each c.refs.slice(0, 2) as r (r)}
                <span class="max-w-[140px] shrink-0 truncate rounded bg-accent/12 px-1.5 font-mono text-xs text-accent-ink" use:fullText={r}>{r.replace("HEAD -> ", "HEAD → ").replace(/^tag: /, "")}</span>
              {/each}
              {#if c.refs.length > 2}<span class="mbf-count" use:tooltip={c.refs.slice(2).join("\n")}>+{c.refs.length - 2}</span>{/if}
            </div>
            <div class="flex items-center gap-2 text-xs text-faint">
              <span class="font-mono">{shortSha(c.sha)}</span>
              <span class="truncate" use:fullText={c.author}>{c.author}</span>
              <span class="ml-auto shrink-0" use:tooltip={absoluteTime(c.time)}>{relativeTime(c.time, clock.now)}</span>
            </div>
          </div>
        {/snippet}
        {#snippet empty()}
          {#if !gitStore.logLoading}
            <EmptyState title={gitStore.logQuery ? t.git.noCommitsMatch : t.git.noCommits} />
          {/if}
        {/snippet}
      </VirtualList>
    {/if}
    <Resizer width={Math.min(listWidth, listMax)} min={300} max={listMax} side="right" oninput={(w) => (listWidth = w)} onreset={() => (listWidth = LIST_DEFAULT)} />
  </div>

  <div class="flex min-w-0 flex-1 flex-col">
    <GitError of={["detail", "commitDiff"]} class="mx-3 mt-2" />
    {#if d}
      <div class="shrink-0 border-b border-line p-4 pop-in">
        <p class="selectable t-title">{d.entry.subject}</p>
        {#if d.body}<pre class="selectable mt-2 max-h-32 overflow-y-auto font-sans text-sm whitespace-pre-wrap text-muted">{d.body}</pre>{/if}
        <div class="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 t-meta">
          <button type="button" class="inline-flex h-6 items-center gap-1 rounded-md border border-line-strong px-1.5 font-mono transition-colors hover:border-faint/60 hover:bg-hover hover:text-fg" use:tooltip={t.common.copySha} onclick={() => toasts.copy(d.entry.sha)}>
            {shortSha(d.entry.sha)}<Copy size={11} />
          </button>
          <span use:tooltip={d.entry.email}>{d.entry.author}</span>
          <span>{absoluteTime(d.entry.time)}</span>
          {#if d.entry.parents.length > 1}<span class="text-review">{t.git.merge(d.entry.parents.length)}</span>{/if}
        </div>
        <ul class="mt-3 flex max-h-36 flex-col overflow-y-auto">
          {#each d.files as f (f.path)}
            {@const meta = CHANGE_META[f.change]}
            {@const p = splitPath(f.path)}
            <li>
              <button
                type="button"
                class="flex h-6 w-full items-center gap-2 rounded px-1.5 text-left text-sm {gitStore.commitFile === f.path ? 'mbf-selected' : 'hover:bg-hover/60'}"
                use:tooltip={f.origPath ? `${f.origPath} → ${f.path}` : null}
                onclick={() => gitStore.selectCommitFile(f.path)}
              >
                <span class="w-3 shrink-0 text-center font-mono text-xs font-bold {meta.tone}">{meta.short}</span>
                <span class="min-w-0 flex-1 truncate"><span class="text-fg">{p.name}</span> <span class="text-faint">{p.dir}</span></span>
              </button>
            </li>
          {/each}
        </ul>
      </div>
      <div class="min-h-0 flex-1">
        <DiffView diff={gitStore.commitFileDiff} loading={gitStore.commitDiffLoading} onloadfull={() => gitStore.commitFile && gitStore.selectCommitFile(gitStore.commitFile, true)} />
      </div>
    {:else if detailSkeleton.value}
      <div class="shrink-0 border-b border-line p-4" aria-busy="true">
        <Skeleton class="h-4 w-2/3" />
        <Skeleton class="mt-3 h-3 w-1/3" />
        <div class="mt-4 flex flex-col gap-2">
          {#each [0, 1, 2] as i (i)}<Skeleton class="h-3 w-1/2" />{/each}
        </div>
      </div>
    {:else if !gitStore.selectedSha}
      <EmptyState icon={GitCommitHorizontal} title={t.git.pickCommit} />
    {/if}
  </div>
</div>
