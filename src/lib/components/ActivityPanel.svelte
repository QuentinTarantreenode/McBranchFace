<script lang="ts">
  // Below the status slot of the top bar: why the app refreshed (always), and, with the setting, what runs
  // now and what ran last, to see what hangs or fails.
  import { Ban, Check, CircleX, FileText, LoaderCircle, Square, Trash2 } from "@lucide/svelte";
  import { onMount, untrack } from "svelte";
  import { api } from "$lib/api";
  import { repoName } from "$lib/filter";
  import { i18n, t } from "$lib/i18n/index.svelte";
  import { activity, type Activity } from "$lib/stores/activity.svelte";
  import { triggers, type TriggerEntry } from "$lib/stores/triggers.svelte";
  import Segmented from "$lib/ui/Segmented.svelte";
  import Button from "$lib/ui/Button.svelte";
  import IconButton from "$lib/ui/IconButton.svelte";
  import { onDismiss } from "$lib/ui/dismiss";
  import { portal } from "$lib/ui/portal";
  import { tooltip } from "$lib/ui/tooltip";
  import { toasts } from "$lib/stores/toasts.svelte";
  import { settings } from "$lib/stores/settings.svelte";

  let { trigger, onclose }: { trigger: HTMLElement; onclose: () => void } = $props();

  let panel = $state<HTMLElement | null>(null);
  // Placed once, where the slot is when it opens. The viewport clamps it in CSS, so a narrower window
  // pushes it back inside without measuring again.
  const box = untrack(() => trigger.getBoundingClientRect());
  const width = 420;

  onMount(() => onDismiss(onclose));

  const running = $derived([...activity.running.values()].reverse());
  // The calls are listed only while the setting records them; the triggers always.
  const calls = $derived(activity.shown || running.length > 0 || activity.recent.length > 0);
  let view = $state<"triggers" | "calls">(untrack(() => (activity.running.size ? "calls" : "triggers")));
  const HELD: TriggerEntry["effect"][] = ["throttled", "off", "busy", "none"];
  const where = (e: TriggerEntry) => [e.path ? repoName(e.path) : "", e.files.join(", ")].filter(Boolean).join(" · ");
  const at = (ms: number) => new Date(ms).toLocaleTimeString(i18n.locale, { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const sub = (a: Activity) => [a.path ? repoName(a.path) : "", a.detail ?? ""].filter(Boolean).join(" · ");
  const tip = (a: Activity) => (sub(a) ? { title: a.text, text: sub(a), path: a.path ?? undefined } : null);

  function outside(e: PointerEvent) {
    if (panel && !panel.contains(e.target as Node) && !trigger.contains(e.target as Node)) onclose();
  }
</script>

<svelte:window onpointerdowncapture={outside} onblur={onclose} onkeydown={(e) => e.key === "Escape" && (e.preventDefault(), onclose())} />

{#snippet row(a: Activity)}
  <div class="grid grid-cols-[16px_minmax(0,1fr)_auto] items-center gap-x-2 rounded-md px-2 py-1 text-sm hover:bg-hover/60" use:tooltip={tip(a)}>
    <span class="grid place-items-center">
      {#if !a.outcome}<LoaderCircle size={13} class="animate-spin text-accent" />
      {:else if a.outcome === "ok"}<Check size={13} class="text-safe-ink" />
      {:else if a.outcome === "failed"}<CircleX size={13} class="text-unsafe-ink" />
      {:else}<Ban size={13} class="text-review-ink" />{/if}
    </span>
    <span class="flex min-w-0 flex-col">
      <span class="truncate">{a.text}{#if a.progress}<span class="ml-1.5 text-faint tabular-nums">{a.progress.done}/{a.progress.total}</span>{/if}</span>
      {#if a.path || a.detail}
        <!-- A failure keeps two lines: its cause sits at the end, where one line cut it off. -->
        <span class="text-xs {a.outcome === 'failed' ? 'line-clamp-2 text-unsafe-ink' : 'truncate text-faint'}">{sub(a)}</span>
      {/if}
    </span>
    <span class="flex items-center gap-2 text-xs text-faint tabular-nums">
      {#if a.ended}{at(a.started)}{/if}
      {#if a.cancel}
        <IconButton icon={Square} size="sm" class="!size-6" label={t.activity.stop} hint={t.activity.stopTip} onclick={() => a.cancel?.()} />
      {/if}
    </span>
  </div>
{/snippet}

<div
  bind:this={panel}
  use:portal
  class="fixed z-50 flex max-h-[70vh] flex-col overflow-hidden rounded-xl mbf-popover text-left"
  style="left: max(8px, min({box.left}px, calc(100vw - {width + 8}px))); top: {box.bottom + 6}px; width: {width}px"
  role="dialog"
  aria-label={t.activity.title}
  tabindex="-1"
>
  <div class="flex h-10 shrink-0 items-center gap-2 border-b border-(--popover-line) bg-(--popover-2) px-3">
    {#if calls}
      <Segmented
        label={t.activity.title}
        options={[
          { id: "triggers" as const, label: t.triggers.title, tip: t.triggers.tip },
          { id: "calls" as const, label: t.activity.title, tip: t.activity.panelTip },
        ]}
        value={view}
        onchange={(v) => (view = v)}
      />
      <span class="flex-1"></span>
    {:else}
      <span class="flex-1 font-medium" use:tooltip={t.triggers.tip}>{t.triggers.title}</span>
    {/if}
    {#if settings.config?.diagnostics}
      <Button size="sm" icon={FileText} onclick={() => toasts.safely(async () => api.revealPath((await api.appInfo()).diagnosticsLog))}>{t.activity.openLog}</Button>
    {/if}
    {#if view === "calls" && calls}
      <IconButton icon={Trash2} size="sm" class="!size-7" label={t.activity.clear} disabled={!activity.recent.length} onclick={() => activity.clear()} />
    {:else}
      <IconButton icon={Trash2} size="sm" class="!size-7" label={t.activity.clear} disabled={!triggers.entries.length} onclick={() => triggers.clear()} />
    {/if}
  </div>
  <div class="min-h-0 flex-1 overflow-y-auto p-1.5">
    {#if view === "calls" && calls}
      <h3 class="px-2 pt-1 pb-1 t-section">{t.activity.running}</h3>
      {#each running as a (a.id)}{@render row(a)}{:else}<p class="px-2 pb-1 t-meta">{t.activity.none}</p>{/each}
      {#if activity.recent.length}
        <h3 class="mt-2 px-2 pt-1 pb-1 t-section">{t.activity.recent}</h3>
        {#each activity.recent as a (a.id)}{@render row(a)}{/each}
      {/if}
    {:else}
      <!-- One line per trigger: when, what fired, where and from which file, what followed. -->
      {#each triggers.entries as e (e.id)}
        <div class="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 rounded-md px-2 py-1 text-sm hover:bg-hover/60" use:tooltip={e.path || e.files.length ? { title: t.triggers.kind[e.kind], path: e.path ?? undefined, text: e.files.join("\n") || undefined } : null}>
          <span class="text-xs text-faint tabular-nums">{at(e.at)}</span>
          <span class="flex min-w-0 flex-col">
            <span class="truncate">{t.triggers.kind[e.kind]}</span>
            {#if where(e)}<span class="truncate text-xs text-faint">{where(e)}</span>{/if}
          </span>
          <span class="rounded px-1.5 text-xs {HELD.includes(e.effect) ? 'text-faint ring-1 ring-line-strong' : 'bg-accent/12 text-accent-ink'}">{t.triggers.effect[e.effect]}</span>
        </div>
      {:else}
        <p class="px-2 py-1 t-meta">{t.triggers.none}</p>
      {/each}
    {/if}
  </div>
  {#if !settings.config?.diagnostics}
    <p class="shrink-0 border-t border-(--popover-line) px-3 py-2 text-xs text-faint">{t.activity.logOff}</p>
  {/if}
</div>
