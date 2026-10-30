<script lang="ts">
  import { gitStatus } from "$lib/stores/gitStatus.svelte";
  import {
    Bell, BellRing, Broom, LayoutDashboard, CircleHelp, Clock, GitGraph, History, Moon, PlugZap, SearchCode, PanelLeft, PanelRight, Pin, PinOff, RefreshCw, Settings, Sun, CloudOff,
    LoaderCircle, Square,
  } from "@lucide/svelte";
  import { activity } from "$lib/stores/activity.svelte";
  import { relativeTime } from "$lib/format";
  import { repoName } from "$lib/filter";
  import { t } from "$lib/i18n/index.svelte";
  import { TOOL_TONE } from "$lib/verdict";
  import type { ProviderKind } from "$lib/bindings/ProviderKind";
  import type { ToolId } from "$lib/bindings/ToolId";
  import Button from "$lib/ui/Button.svelte";
  import IconButton from "$lib/ui/IconButton.svelte";
  import ViewTabs from "$lib/ui/ViewTabs.svelte";
  import { onMount } from "svelte";
  import ToolGroup from "$lib/ui/ToolGroup.svelte";
  import { openBelow } from "$lib/ui/menu.svelte";
  import { tooltip } from "$lib/ui/tooltip";
  import { settings } from "$lib/stores/settings.svelte";
  import { clock } from "$lib/stores/clock.svelte";
  import { environment } from "$lib/stores/environment.svelte";
  import { dialogs } from "$lib/stores/dialogs.svelte";
  import { scanResults } from "$lib/stores/scanResults.svelte";
  import { repoSelection } from "$lib/stores/repoSelection.svelte";
  import { cleanupView } from "$lib/stores/cleanupView.svelte";
  import { lenses } from "$lib/stores/lenses.svelte";
  import { deletes } from "$lib/stores/deletes.svelte";
  import { scanner } from "$lib/services/scanner.svelte";

  let { detailAvailable }: { detailAvailable: boolean } = $props();

  const ui = $derived(settings.config?.ui);
  const openDeleted = $derived(deletes.deleted.filter((d) => d.restoredAt === null).length);
  /** What the slot names: the user's own run first, else (when shown) the newest background work. */
  const act = $derived(activity.front);
  const own = $derived(act?.own ? act : null);
  const progress = $derived(
    own?.progress ? own.progress.done / own.progress.total : scanResults.repos.length ? scanner.doneRepos / scanResults.repos.length : 0,
  );
  let slot = $state<HTMLElement | null>(null);
  let activityOpen = $state(false);
  const noRoots = $derived(!settings.config?.roots.length);

  // The Git tab counts the changes of the repo it opens: a reason to go there. In both perspectives,
  // so the switch keeps its width when it is used.
  const gitPath = $derived(repoSelection.gitRepo ?? scanResults.repos[0]?.info.path ?? null);
  const gitChanges = $derived(gitPath ? (gitStatus.statuses.get(gitPath)?.entries.length ?? 0) : 0);
  let barWidth = $state(1600);
  const compactTabs = $derived(barWidth < 1180);
  // The dashboard's count loads with it, after the first paint: the bar does not wait for it.
  let dash = $state<typeof import("$lib/dashboard/dashboard.svelte") | null>(null);
  onMount(() => void import("$lib/dashboard/dashboard.svelte").then((m) => (dash = m)));
  const steps = $derived(dash?.dashboard.steps.length ?? 0);
  const safe = $derived(dash?.dashboard.lenses.find((l) => l.lens.id === "localSafe")?.count ?? 0);
  const perspectives = $derived([
    { id: "Dashboard" as const, label: t.top.dashboard, icon: LayoutDashboard, badge: steps || undefined, tip: { title: compactTabs ? t.top.dashboard : undefined, text: t.top.dashboardTip, keys: "Ctrl 1" } },
    { id: "Cleanup" as const, label: t.top.cleanup, icon: Broom, badge: safe || undefined, tip: { title: compactTabs ? t.top.cleanup : undefined, text: t.top.cleanupTip, keys: "Ctrl 2" } },
    {
      id: "Git" as const,
      label: t.top.git,
      icon: GitGraph,
      badge: gitChanges || undefined,
      tip: { title: compactTabs ? t.top.git : undefined, text: t.top.gitTip, keys: "Ctrl 3", foot: gitChanges && gitPath ? t.top.gitChanges(gitChanges, repoName(gitPath)) : undefined },
    },
  ]);

  const PROVIDERS: { tool: ToolId; kind: ProviderKind }[] = [
    { tool: "AzureCli", kind: "Azure" },
    { tool: "GitHubCli", kind: "GitHub" },
  ];

  /** The repo the provider menu acts on: the one open in Git, else the one of the selected branch. */
  const focusRepo = $derived.by(() => {
    const path =
      ui?.perspective === "Git"
        ? (repoSelection.gitRepo ?? scanResults.repos[0]?.info.path)
        : (cleanupView.selected?.repoPath ?? cleanupView.selectedOnline?.repoPath ?? (repoSelection.repos.length === 1 ? repoSelection.repos[0] : null));
    return path ? scanResults.repoByPath.get(path) : undefined;
  });
  const focusBranch = $derived(
    ui?.perspective === "Git" && focusRepo ? gitStatus.statuses.get(focusRepo.path)?.head.branch : (cleanupView.selectedOnline?.name ?? null),
  );

  // Menus load on first open; the bar does not need them to show.
  const menus = () => import("./topMenus");
  const name = (p: (typeof PROVIDERS)[number]) => (p.kind === "Azure" ? t.provider.azure : t.provider.github);
  const providerMenu = (e: MouseEvent, p: (typeof PROVIDERS)[number]) =>
    openBelow(e.currentTarget as HTMLElement, menus().then((m) => m.providerMenu(p, focusRepo, focusBranch)), name(p));
  const bellMenu = (e: MouseEvent) => openBelow(e.currentTarget as HTMLElement, menus().then((m) => m.bellMenu()), t.top.alerts);
</script>

<!-- What runs: the user's own runs with progress and stop, background work when the setting shows it.
     Clickable while there is something to look at: the list of what ran. -->
{#snippet status()}
  {#if act && (act.own || !scanner.scanning || activity.shown)}
    <span class="inline-flex min-w-0 items-center gap-1" use:tooltip={{ title: act.text, path: act.path ?? undefined, text: t.activity.panelTip }}>
      <LoaderCircle size={12} class="shrink-0 animate-spin text-accent" /><span class="max-w-[18rem] truncate">{act.text}{#if act.path && !act.own}{` · ${repoName(act.path)}`}{/if}</span>
      {#if act.progress}<span class="shrink-0">{act.progress.done}/{act.progress.total}</span>{/if}
    </span>
  {:else if scanner.scanning}
    <span class="inline-flex items-center gap-1" use:tooltip={{ title: t.top.stageTitle, text: scanner.stage === "local" ? t.top.stageTipLocal : t.top.stageTipServer, foot: activity.shown ? undefined : t.top.stageFoot }}>
      <LoaderCircle size={12} class="shrink-0 animate-spin text-accent" />{scanner.onlinePending
        ? t.top.refreshingOnline
        : scanner.stage === "local"
          ? t.top.stageLocal(scanner.doneRepos, scanResults.repos.length)
          : scanner.stage === "server"
            ? t.top.stageServer(scanner.doneRepos, scanResults.repos.length)
            : t.top.refreshing(scanner.doneRepos, scanResults.repos.length)}
    </span>
  {:else if scanner.scannedAt}
    <span class="inline-flex items-center gap-1" use:tooltip={{ title: t.time.scannedTitle, text: t.time.lastRun(((scanner.lastDurationMs ?? 0) / 1000).toFixed(1)), foot: t.time.triggersFoot }}>
      <Clock size={12} class="shrink-0" />{relativeTime(scanner.scannedAt / 1000, clock.now)}
    </span>
  {/if}
{/snippet}

<header class="relative flex h-12 shrink-0 items-center gap-2 border-b border-line bg-panel px-3" bind:clientWidth={barWidth}>
  {#if !environment.needsOnboarding}
  <!-- Panel buttons say what a click does (show / hide) instead of a pressed state: the panel itself
       shows whether it is open, a pressed look on top would light up the bar all the time. -->
  <IconButton
    icon={PanelLeft}
    label={ui?.sidebarCollapsed ? t.top.sidebarShow : t.top.sidebarHide}
    keys="Ctrl B"
    onclick={() => settings.setUi({ sidebarCollapsed: !ui?.sidebarCollapsed })}
  />
  <ViewTabs label={t.top.perspective} options={perspectives} value={ui?.perspective ?? "Dashboard"} compact={compactTabs} onchange={(v) => settings.setUi({ perspective: v })} />
  <!-- The tabs stand on the bottom edge, the tools sit in the middle: a divider makes them two zones. -->
  <span class="mx-1 my-2 w-px shrink-0 self-stretch bg-line-strong" aria-hidden="true"></span>

  {#if PROVIDERS.some((p) => environment.tool(p.tool))}
  <ToolGroup label={t.top.connections} class="min-w-0">
    <span class="grid size-7 shrink-0 place-items-center text-faint" use:tooltip={{ title: t.top.connections, text: t.top.connectionsTip }}><PlugZap size={14} /></span>
    {#each PROVIDERS as p (p.tool)}
      {@const tool = environment.tool(p.tool)}
      {#if tool}
        <button
          type="button"
          class="inline-flex h-7 items-center gap-1.5 rounded-full border border-line-strong px-2.5 text-sm whitespace-nowrap text-muted transition-colors hover:bg-hover hover:text-fg"
          aria-haspopup="menu"
          use:tooltip={{ title: `${name(p)}: ${t.tool.state[tool.state]}`, text: tool.account ? t.provider.signedInAs(tool.account) : undefined, foot: t.top.connectionMenu }}
          onclick={(e) => providerMenu(e, p)}
        >
          <span class="size-1.5 rounded-full {TOOL_TONE[tool.state].dot}"></span>
          {name(p)}
        </button>
      {/if}
    {/each}
  </ToolGroup>
  {/if}
  <!-- Read left to right: where the data comes from, then refresh and the state of the data. The status
       slot changes width with what it shows; last in the row, it moves nothing beside it. -->
  <ToolGroup label={t.top.dataGroup} class="min-w-0">
    <span class="inline-flex">
      <Button
        variant="primary"
        icon={RefreshCw}
        busy={scanner.scanKind === "fetch"}
        class="rounded-r-none"
        disabled={scanner.scanning || noRoots}
        tip={scanner.scanning ? undefined : { text: t.top.refreshTip, keys: "F5" }}
        onclick={() => scanner.scan(true)}
      >
        <!-- One label in every state: a caption that counts would change the width of the whole bar. -->
        {t.top.refresh}
      </Button>
      <!-- While a scan runs, the half that starts one stops it instead: stop sits beside refresh, and the
           bar keeps its width. -->
      {#if scanner.scanning}
        <Button
          variant="primary"
          icon={Square}
          class="rounded-l-none border-l border-accent-fg/25 !px-2"
          aria-label={t.activity.scanStop}
          tip={{ title: t.activity.scanStop, text: t.activity.scanStopTip }}
          onclick={() => scanner.cancelScan()}
        />
      {:else}
        <Button
          variant="primary"
          icon={CloudOff}
          class="rounded-l-none border-l border-accent-fg/25 !px-2"
          aria-label={t.top.localOnly}
          disabled={noRoots}
          tip={{ title: t.top.localOnly, text: t.top.localOnlyTip, keys: "Shift F5" }}
          onclick={() => scanner.scan(false)}
        />
      {/if}
    </span>
    <!-- The status slot: the progress while it runs, the age of the data after. A least width keeps it
         from twitching when one turns into the other. -->
    <span class="inline-flex min-w-[11.5rem] items-center gap-1 t-meta px-1.5 whitespace-nowrap tabular-nums" aria-live="polite">
      <button
        type="button"
        bind:this={slot}
        class="inline-flex h-6 min-w-0 items-center gap-1 rounded-md border border-line-strong/70 px-1.5 transition-colors hover:border-faint/60 hover:bg-hover"
        aria-haspopup="dialog"
        aria-expanded={activityOpen}
        onclick={() => (activityOpen = !activityOpen)}
      >
        {@render status()}
      </button>
      {#if own?.cancel}
        <IconButton icon={Square} size="sm" class="!size-6" label={t.activity.stop} hint={t.activity.stopTip} onclick={() => own?.cancel?.()} />
      {/if}
    </span>
  </ToolGroup>
  {/if}

  <div class="ml-auto flex items-center gap-2">
    {#if !environment.needsOnboarding}
      <ToolGroup label={t.top.noticeGroup}>
        <IconButton
          icon={lenses.bellCount ? BellRing : Bell}
          label={t.top.alerts}
          hint={lenses.bellCount ? t.top.alertsCount(lenses.bellCount) : t.top.alertsNone}
          badge={lenses.bellCount || undefined}
          badgeTone="danger"
          aria-haspopup="menu"
          onclick={bellMenu}
        />
        <IconButton icon={SearchCode} label={t.find.title} keys="Ctrl Shift F" onclick={() => (dialogs.commitSearchOpen = true)} />
        <IconButton icon={History} label={t.top.deleted} badge={openDeleted || undefined} onclick={() => (dialogs.deletedOpen = true)} />
      </ToolGroup>
    {/if}
    <ToolGroup label={t.top.windowGroup}>
      {#if !environment.needsOnboarding}
        <IconButton
          icon={ui?.alwaysOnTop ? PinOff : Pin}
          label={ui?.alwaysOnTop ? t.top.pinOff : t.top.pinOn}
          onclick={() => settings.setAlwaysOnTop(!ui?.alwaysOnTop)}
        />
      {/if}
      <IconButton
        icon={settings.resolvedTheme === "light" ? Moon : Sun}
        label={settings.resolvedTheme === "light" ? t.top.themeDark : t.top.themeLight}
        hint={t.top.themeHint}
        onclick={() => settings.setTheme(settings.resolvedTheme === "light" ? "Dark" : "Light")}
      />
      {#if !environment.needsOnboarding}
        <IconButton
          icon={PanelRight}
          label={ui?.detailCollapsed ? t.top.detailShow : t.top.detailHide}
          keys="Ctrl J"
          disabled={!detailAvailable}
          onclick={() => settings.setUi({ detailCollapsed: !ui?.detailCollapsed })}
        />
      {/if}
    </ToolGroup>
    <ToolGroup label={t.top.helpGroup}>
      <IconButton icon={CircleHelp} label={t.top.help} keys="F1" active={dialogs.helpOpen} onclick={() => dialogs.toggleHelp()} />
      <IconButton icon={Settings} label={t.top.settings} keys="Ctrl ," onclick={() => dialogs.openSettings()} />
    </ToolGroup>
  </div>

  {#if scanner.scanning || own}
    <!-- On the bar's upper edge: the lower one belongs to the tabs, which run into the view below. -->
    <div class="absolute inset-x-0 top-0 z-20 h-0.5 overflow-hidden bg-line">
      {#if progress > 0 && (own?.progress || (scanner.scanning && !scanner.onlinePending))}
        <div class="h-full bg-accent transition-[width] duration-300" style="width: {progress * 100}%"></div>
      {:else}
        <div class="scan-bar h-full w-1/3 bg-accent"></div>
      {/if}
    </div>
  {/if}
</header>

{#if activityOpen && slot}
  {#await import("./ActivityPanel.svelte") then m}<m.default trigger={slot} onclose={() => (activityOpen = false)} />{/await}
{/if}
