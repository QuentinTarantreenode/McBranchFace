<script lang="ts">
  import {
    Bell, BookOpen, Broom, ChevronLeft, ChevronRight, CircleAlert, CircleHelp, Cloud, Copy, Eye, GitGraph, Keyboard, LayoutDashboard, Lock, Search, Settings,
    SquareTerminal, X,
  } from "@lucide/svelte";
  import type { Component } from "svelte";
  import { i18n, t } from "$lib/i18n/index.svelte";
  import Button from "$lib/ui/Button.svelte";
  import IconButton from "$lib/ui/IconButton.svelte";
  import Input from "$lib/ui/Input.svelte";
  import { buildTopics, contextTopic, paragraphKind, searchHelp, TOPIC_GROUP } from "./content";
  import type { HelpDict, HelpGroup, HelpSection, HelpTopic, HelpTopicId } from "./types";
  import { settings } from "$lib/stores/settings.svelte";
  import { dialogs } from "$lib/stores/dialogs.svelte";
  import { cleanupView } from "$lib/stores/cleanupView.svelte";
  import { navigation } from "$lib/services/navigation";

  // The icon of the part of the app a topic explains, the same one the app shows there.
  const ICON: Record<HelpTopicId, Component<{ size?: number; class?: string }>> = {
    overview: LayoutDashboard,
    local: Broom,
    online: Cloud,
    protect: Lock,
    alerts: Bell,
    copies: Copy,
    git: GitGraph,
    settings: Settings,
    commands: SquareTerminal,
    legend: BookOpen,
    keys: Keyboard,
    errors: CircleAlert,
  };
  const GROUPS: HelpGroup[] = ["start", "cleanup", "git", "setup", "reference"];

  // The help texts load on first open, in the active language only.
  let dict = $state<HelpDict | null>(null);
  $effect(() => {
    const lang = i18n.lang;
    // The language may change before its texts arrive: only those of the current one land.
    let current = true;
    (lang === "de" ? import("./de") : import("./en")).then((m) => current && (dict = m.help));
    return () => (current = false);
  });

  let query = $state("");
  const topics = $derived(dict ? buildTopics(dict, t) : []);
  const at = $derived(dialogs.helpAt);
  const topic = $derived(topics.find((x) => x.id === at.topic) ?? null);
  const section = $derived(topic?.sections.find((s) => s.id === at.section) ?? null);
  const hits = $derived(searchHelp(topics, query));
  const here = $derived(
    topics.find(
      (x) => x.id === contextTopic({ settingsOpen: dialogs.settingsOpen, perspective: settings.config?.ui.perspective ?? "Dashboard", scope: cleanupView.scope }),
    ),
  );

  function open(tp: HelpTopic | null, s: HelpSection | null = null) {
    query = "";
    dialogs.helpAt = { topic: tp?.id ?? null, section: s?.id ?? null };
  }

  function back() {
    if (section) open(topic);
    else open(null);
  }
</script>

{#snippet icon(id: HelpTopicId, size = 15)}
  {@const I = ICON[id]}
  <span class="grid size-8 shrink-0 place-items-center rounded-lg bg-accent/10 text-accent"><I {size} /></span>
{/snippet}

{#snippet row(title: string, text: string, onclick: () => void, strong = false, topicId: HelpTopicId | null = null)}
  <!-- Every entry is a card of its own: a border and a surface, so it reads as something to open. -->
  <button
    type="button"
    class="flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors hover:bg-hover
      {strong ? 'border-accent/35 bg-accent/8' : 'border-line bg-panel-2/60'}"
    {onclick}
  >
    {#if topicId}{@render icon(topicId)}{/if}
    <span class="min-w-0 flex-1">
      <span class="block text-base font-medium">{title}</span>
      <span class="mt-0.5 line-clamp-2 text-sm leading-snug text-muted">{text}</span>
    </span>
    <ChevronRight size={14} class="shrink-0 text-faint" />
  </button>
{/snippet}

<!-- A layer opened on demand over the view (data-overlay): what it covers is back once it closes. -->
<aside
  class="absolute top-0 right-0 bottom-0 z-30 flex w-[360px] max-w-full flex-col border-l border-line bg-panel shadow-panel pop-in"
  aria-label={dict?.title ?? t.top.help}
  data-overlay
>
  <div class="flex h-12 shrink-0 items-center gap-1.5 border-b border-line pr-2 pl-3">
    {#if topic && !query}
      <IconButton icon={ChevronLeft} size="sm" label={dict?.back ?? ""} onclick={back} />
    {:else}
      <CircleHelp size={16} class="mx-1 shrink-0 text-accent" />
    {/if}
    <!-- Breadcrumb: where in the drill-down this page is. -->
    <nav class="flex min-w-0 flex-1 items-center gap-1 text-sm" aria-label={dict?.title}>
      <button type="button" class="shrink-0 font-semibold text-accent underline-offset-2 hover:underline" onclick={() => open(null)}>{dict?.title ?? t.top.help}</button>
      {#if topic && !query}
        <ChevronRight size={12} class="shrink-0 text-faint" />
        <button type="button" class="min-w-0 truncate {section ? 'text-accent underline-offset-2 hover:underline' : 'font-medium'}" onclick={() => open(topic)}>{topic.title}</button>
      {/if}
      {#if section && !query}
        <ChevronRight size={12} class="shrink-0 text-faint" />
        <span class="min-w-0 truncate font-medium">{section.title}</span>
      {/if}
    </nav>
    <IconButton icon={X} size="sm" label={t.common.close} keys="F1" onclick={() => (dialogs.helpOpen = false)} />
  </div>

  {#if dict}
    <div class="shrink-0 border-b border-line p-3">
      <Input bind:value={query} icon={Search} placeholder={dict.search} aria-label={dict.search} />
    </div>

    <div class="min-h-0 flex-1 overflow-y-auto p-3">
      {#if query.trim()}
        <div class="flex flex-col gap-1.5">
          {#each hits as h (h.topic.id + h.section.id)}
            {@render row(h.section.title, h.topic.title, () => open(h.topic, h.section), false, h.topic.id)}
          {:else}
            <p class="px-1 py-2 t-meta">{dict.noMatch}</p>
          {/each}
        </div>
      {:else if section && topic}
        <div class="flex items-center gap-3">
          {@render icon(topic.id)}
          <div class="min-w-0">
            <div class="t-meta">{dict.groups[TOPIC_GROUP[topic.id]]} · {topic.title}</div>
            <h2 class="t-title">{section.title}</h2>
          </div>
        </div>
        <div class="selectable mt-3 flex flex-col gap-3 text-base leading-relaxed text-muted">
          {#each section.body as p, i (i)}
            {#if paragraphKind(p) === "list"}
              <ul class="flex flex-col gap-1.5 pl-4">
                {#each p.split("\n") as line, n (n)}<li class="list-disc">{line.slice(2)}</li>{/each}
              </ul>
            {:else}
              <p>{p}</p>
            {/if}
          {/each}
        </div>
        {#if section.legend}
          {@const legend = section.legend}
          <!-- The pictures load with the first legend opened; the text above is searchable without them. -->
          {#await import("./HelpLegend.svelte") then m}<m.default {legend} />{/await}
        {/if}
        {#if section.show}
          {@const target = section.show}
          <div class="mt-4">
            <Button size="sm" icon={Eye} onclick={() => navigation.show(target)}>{dict.show}</Button>
          </div>
        {/if}
        {@const i = topic.sections.indexOf(section)}
        {#if topic.sections.length > 1}
          <div class="mt-6 flex flex-col gap-1.5 border-t border-line pt-4">
            {#each topic.sections.filter((s) => s !== section) as s (s.id)}
              {@render row(s.title, s.body[0].split("\n")[0].replace(/^- /, ""), () => open(topic, s), topic.sections.indexOf(s) === i + 1)}
            {/each}
          </div>
        {/if}
      {:else if topic}
        <div class="flex items-center gap-3">
          {@render icon(topic.id)}
          <div class="min-w-0">
            <div class="t-meta">{dict.groups[TOPIC_GROUP[topic.id]]}</div>
            <h2 class="t-title">{topic.title}</h2>
          </div>
        </div>
        <p class="mt-2 mb-3 text-base text-muted">{topic.summary}</p>
        {#if topic.id === "keys"}
          <!-- The shortcut list needs no further step. -->
          <ul class="selectable flex flex-col gap-1 text-base">
            {#each topic.sections[0].body.join("\n").split("\n") as line, n (n)}
              {@const [keys, ...label] = line.slice(2).split(" – ")}
              <li class="flex items-center gap-3 rounded-md px-2 py-1.5 {n % 2 ? 'bg-row-alt' : ''}">
                <kbd class="w-[92px] shrink-0 font-mono text-xs text-muted">{keys}</kbd>
                <span class="min-w-0 flex-1">{label.join(" – ")}</span>
              </li>
            {/each}
          </ul>
        {:else}
          <div class="flex flex-col gap-1.5">
            {#each topic.sections as s (s.id)}
              {@render row(s.title, s.body[0].split("\n")[0].replace(/^- /, ""), () => open(topic, s))}
            {/each}
          </div>
        {/if}
      {:else}
        {#if here}
          <div class="mb-1.5 px-1 t-section">{dict.forView}</div>
          {@render row(here.title, here.summary, () => open(here), true, here.id)}
        {/if}
        {#each GROUPS as g (g)}
          {@const inGroup = topics.filter((x) => TOPIC_GROUP[x.id] === g && x !== here)}
          {#if inGroup.length}
            <div class="mt-4 mb-1.5 px-1 t-section">{dict.groups[g]}</div>
            <div class="flex flex-col gap-1.5">
              {#each inGroup as tp (tp.id)}
                {@render row(tp.title, tp.summary, () => open(tp), false, tp.id)}
              {/each}
            </div>
          {/if}
        {/each}
      {/if}
    </div>
  {/if}
</aside>
