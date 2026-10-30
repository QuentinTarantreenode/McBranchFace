<script lang="ts">
  import { commandRuns } from "$lib/stores/commandRuns.svelte";
  import { ChevronDown, ChevronUp, CircleCheck, CircleX, Copy, LoaderCircle, OctagonX, RotateCcw, Trash2, X } from "@lucide/svelte";
  import type { CommandRun } from "$lib/stores/commandRuns.svelte";
  import { t } from "$lib/i18n/index.svelte";
  import { repoName } from "$lib/filter";
  import Button from "$lib/ui/Button.svelte";
  import IconButton from "$lib/ui/IconButton.svelte";
  import VirtualList from "$lib/ui/VirtualList.svelte";
  import { tooltip } from "$lib/ui/tooltip";
  import { normalizePath } from "$lib/paths";
  import { toasts } from "$lib/stores/toasts.svelte";

  let expanded = $state(true);
  const running = $derived(commandRuns.runs.filter((r) => r.status === "running").length);
  const open = $derived(commandRuns.runs.find((r) => r.runId === commandRuns.openRun) ?? null);

  const statusText = (r: CommandRun) =>
    r.status === "running" ? t.commands.running : r.status === "ok" ? t.commands.ok : r.status === "cancelled" ? t.commands.cancelled : t.commands.failedShort;
  const seconds = (ms: number | null) => (ms === null ? "" : `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)} s`);

  function copyOutput(r: CommandRun) {
    toasts.copy(r.lines.map((l) => l.text).join("\n"));
  }
</script>

{#snippet statusIcon(r: CommandRun)}
  {#if r.status === "running"}<LoaderCircle size={14} class="animate-spin text-accent" />
  {:else if r.status === "ok"}<CircleCheck size={14} class="text-safe" />
  {:else if r.status === "cancelled"}<OctagonX size={14} class="text-faint" />
  {:else}<CircleX size={14} class="text-unsafe" />{/if}
{/snippet}

<!-- Runs of background commands: a persistent card at the bottom right, the output in a drawer above. -->
<section
  bind:clientHeight={commandRuns.runsPanelHeight}
  class="fixed right-[24px] bottom-[24px] z-40 flex w-[400px] max-w-[calc(100vw-2.5rem)] flex-col overflow-hidden rounded-xl border border-line bg-panel shadow-panel"
  aria-label={t.commands.title}
>
  <div class="flex h-10 shrink-0 items-center gap-2 border-b border-line bg-panel-2 px-3">
    {#if running}<LoaderCircle size={14} class="animate-spin text-accent" />{/if}
    <span class="min-w-0 flex-1 truncate text-sm font-medium">{t.commands.runs(commandRuns.runs.length)}</span>
    <IconButton icon={Trash2} size="sm" label={t.commands.clear} disabled={running === commandRuns.runs.length} onclick={() => commandRuns.clearRuns()} />
    <IconButton icon={expanded ? ChevronDown : ChevronUp} size="sm" label={expanded ? t.common.collapse : t.common.expand} onclick={() => (expanded = !expanded)} />
  </div>
  {#if expanded}
    <ul class="zebra max-h-56 overflow-y-auto">
      {#each commandRuns.runs as r (r.runId)}
        <li>
          <button
            type="button"
            class="flex w-full items-center gap-2.5 px-3 py-2 text-left hover:bg-hover/70 {commandRuns.openRun === r.runId ? 'mbf-selected' : ''}"
            onclick={() => (commandRuns.openRun = commandRuns.openRun === r.runId ? null : r.runId)}
          >
            {@render statusIcon(r)}
            <span class="min-w-0 flex-1">
              <span class="block truncate text-sm font-medium">{r.command.name}</span>
              <span class="block truncate text-xs text-faint">{repoName(r.repoPath)}{r.branch ? ` · ${r.branch}` : ""}</span>
            </span>
            <span class="shrink-0 text-xs tabular-nums text-muted">
              {statusText(r)}{#if r.code !== null && r.status !== "ok"}{` · ${r.code}`}{/if}{#if r.durationMs !== null}{` · ${seconds(r.durationMs)}`}{/if}
            </span>
          </button>
        </li>
      {/each}
    </ul>
  {/if}
</section>

{#if open}
  <section
    class="fixed right-[24px] bottom-[24px] z-50 flex h-[min(520px,calc(100vh-7rem))] w-[min(760px,calc(100vw-2.5rem))] flex-col overflow-hidden rounded-xl border border-line bg-panel shadow-panel"
    aria-label={open.command.name}
    style="bottom: 28px"
  >
    <div class="flex shrink-0 items-center gap-2 border-b border-line bg-panel-2 px-3 py-2">
      {@render statusIcon(open)}
      <div class="min-w-0 flex-1">
        <div class="truncate text-base font-medium">{open.command.name}</div>
        <div class="truncate font-mono text-xs text-faint" use:tooltip={{ path: open.repoPath }}>{normalizePath(open.repoPath)}{open.branch ? ` · ${open.branch}` : ""}</div>
      </div>
      {#if open.status === "running"}
        <Button size="sm" variant="danger-outline" icon={OctagonX} onclick={() => commandRuns.cancelRun(open.runId)}>{t.commands.cancel}</Button>
      {:else}
        <Button size="sm" icon={RotateCcw} onclick={() => commandRuns.runCommand(open.command, open.repoPath, open.branch)}>{t.commands.again}</Button>
      {/if}
      <IconButton icon={Copy} size="sm" label={t.commands.copyOutput} disabled={!open.lines.length} onclick={() => copyOutput(open)} />
      <IconButton icon={X} size="sm" label={t.common.close} keys="Esc" onclick={() => (commandRuns.openRun = null)} />
    </div>
    <VirtualList items={open.lines.map((l, i) => ({ ...l, i }))} rowHeight={18} key={(l) => String(l.i)} class="flex-1 bg-input py-2 font-mono text-xs" label={t.commands.showOutput}>
      {#snippet row(l)}
        <div class="selectable h-[18px] truncate px-3 leading-[18px] whitespace-pre {l.err ? 'text-review' : 'text-fg'}">{l.text || " "}</div>
      {/snippet}
      {#snippet empty()}
        <p class="px-3 py-2 t-meta">{t.commands.noOutput}</p>
      {/snippet}
    </VirtualList>
  </section>
{/if}

<svelte:window onkeydown={(e) => e.key === "Escape" && commandRuns.openRun && !document.querySelector("dialog[open]") && (commandRuns.openRun = null)} />
