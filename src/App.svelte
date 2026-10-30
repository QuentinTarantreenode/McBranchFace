<script lang="ts">
  import { commandRuns } from "$lib/stores/commandRuns.svelte";
  import { identities } from "$lib/stores/identities.svelte";
  import { layout } from "$lib/stores/layout.svelte";
  import { X } from "@lucide/svelte";
  import { onMount } from "svelte";
  import { bootstrap } from "$lib/app/bootstrap.svelte";
  import { api } from "$lib/api";
  import { i18n, t } from "$lib/i18n/index.svelte";
  import Sidebar from "$lib/components/Sidebar.svelte";
  import Toasts from "$lib/components/Toasts.svelte";
  import TopBar from "$lib/components/TopBar.svelte";
  import { menu } from "$lib/ui/menu.svelte";
  import IconButton from "$lib/ui/IconButton.svelte";
  import Resizer from "$lib/ui/Resizer.svelte";
  import ViewBoundary from "$lib/ui/ViewBoundary.svelte";
  import { installGlobalHandlers } from "$lib/errors";
  import { minTableWidth } from "$lib/table/columns";
  import { DEFAULT_SCALE, stepScale } from "$lib/scale";
  import { debounced } from "$lib/ui/delay.svelte";
  import { toasts } from "$lib/stores/toasts.svelte";
  import { settings } from "$lib/stores/settings.svelte";
  import { environment } from "$lib/stores/environment.svelte";
  import { dialogs } from "$lib/stores/dialogs.svelte";
  import { cleanupView } from "$lib/stores/cleanupView.svelte";
  import { lenses } from "$lib/stores/lenses.svelte";
  import { deletes } from "$lib/stores/deletes.svelte";
  import { scanner } from "$lib/services/scanner.svelte";

  onMount(() => {
    const off = installGlobalHandlers((e) => toasts.fail(e));
    void bootstrap.init();
    return off;
  });

  const ui = $derived(settings.config?.ui);

  // Tray tooltip and menu follow the bell and the language.
  debounced(
    () => (settings.config && i18n.dict && environment.windowCaps.tray ? lenses.trayStatus() : null),
    300,
    (status) => status && api.setTrayStatus(status).catch(() => {}),
  );
  // Below this the cards lose their names to the signs beside them.
  const SIDEBAR_MIN = 240;
  // What a double click on a pane's edge goes back to.
  const SIDEBAR_DEFAULT = 248;
  const DETAIL_DEFAULT = 380;
  const DETAIL_MIN = 320;
  // While an edge is dragged its width is the draft; let go, the saved setting is the width again.
  let sidebarDraft = $state<number | null>(null);
  let detailDraft = $state<number | null>(null);
  const sidebarWidth = $derived(sidebarDraft ?? Math.max(SIDEBAR_MIN, ui?.sidebarWidth ?? SIDEBAR_DEFAULT));
  const detailWidth = $derived(detailDraft ?? ui?.detailWidth ?? DETAIL_DEFAULT);

  // Layout budget: the table needs the sum of its column widths. When sidebar + table + detail pane do
  // not fit, the pane floats from the top of the list instead of taking width from the whole view: the
  // bars above keep their room, the list ends beside the pane and scrolls sideways. No column is ever
  // squeezed, and nothing of the table lies under the pane where it cannot be clicked.
  const TABLE_MIN = $derived(Math.min(900, minTableWidth(cleanupView.columns)));
  let windowWidth = $state(innerWidth);
  // The panes take what the user drags them to; only the room in the window limits them. The main view
  // keeps enough to stay usable, and a narrower window narrows the panes without overwriting the choice.
  const MAIN_MIN = 360;
  const sidebarMax = $derived(Math.max(SIDEBAR_MIN, windowWidth - MAIN_MIN));
  const sidebarShown = $derived(Math.min(sidebarWidth, sidebarMax));
  const detailMax = $derived(Math.max(DETAIL_MIN, windowWidth - 120));
  const detailShown = $derived(Math.min(detailWidth, detailMax));
  const overlay = $derived(windowWidth < (ui?.sidebarCollapsed ? 0 : sidebarShown) + TABLE_MIN + detailShown);

  // One rule, beside the table or over it: the detail shows what is selected, unless the user hid it on
  // purpose (the X, Esc over the table, Ctrl J, the top bar). Nothing selected, nothing to show.
  const view = $derived(ui?.perspective ?? "Dashboard");
  const cleanup = $derived(view === "Cleanup");
  const hasSelection = $derived(cleanupView.scope === "Online" ? !!cleanupView.selectedOnline : !!cleanupView.selected);
  const showDetail = $derived(cleanup && !!ui && hasSelection && !ui.detailCollapsed);
  // Code-split: every view loads on first use; the app starts on the dashboard, so the table and Git
  // follow when they are opened.
  const gitView = $derived(view === "Git" ? import("$lib/git/GitView.svelte") : null);
  const tableView = $derived(cleanup ? import("$lib/components/BranchTable.svelte") : null);
  let table: { focusSearch: () => void } | undefined = $state();

  const typing = (e: KeyboardEvent) => !!(e.target as HTMLElement | null)?.closest("input, textarea, [contenteditable]");

  function onKey(e: KeyboardEvent) {
    const mod = e.ctrlKey || e.metaKey;
    const inDialog = !!document.querySelector("dialog[open]");
    if (mod && e.key === "b") settings.setUi({ sidebarCollapsed: !ui?.sidebarCollapsed });
    else if (mod && e.key === "j" && cleanup) settings.setUi({ detailCollapsed: !ui?.detailCollapsed });
    else if (mod && e.key === "1") settings.setUi({ perspective: "Dashboard" });
    else if (mod && e.key === "2") settings.setUi({ perspective: "Cleanup" });
    else if (mod && e.key === "3") settings.setUi({ perspective: "Git" });
    // Before Ctrl F: with Shift the key reads "F", and it searches every repo instead of the table.
    else if (mod && e.shiftKey && e.key.toLowerCase() === "f" && !inDialog) dialogs.commitSearchOpen = true;
    else if (mod && e.key === "f" && !inDialog && cleanup) table?.focusSearch();
    else if (mod && e.key === ",") dialogs.openSettings();
    else if (mod && (e.key === "+" || e.key === "=")) settings.setScale(stepScale(ui?.scale ?? DEFAULT_SCALE, 1));
    else if (mod && e.key === "-") settings.setScale(stepScale(ui?.scale ?? DEFAULT_SCALE, -1));
    else if (mod && e.key === "0") settings.setScale(DEFAULT_SCALE);
    else if (e.key === "F5" && !inDialog) scanner.scan(!e.shiftKey);
    else if (e.key === "F1") dialogs.toggleHelp();
    else if (e.key === "?" && !typing(e) && !inDialog) dialogs.shortcutsOpen = true;
    else if (e.key === "Escape" && dialogs.helpOpen && !inDialog && !menu.current) dialogs.helpOpen = false;
    else if (e.key === "Escape" && overlay && showDetail && !inDialog && !menu.current) settings.setUi({ detailCollapsed: true });
    else return;
    e.preventDefault();
  }

  // The browser menu (reload, inspect …) makes no sense in an app; text fields and selectable text keep theirs.
  function onContextMenu(e: MouseEvent) {
    const target = e.target as HTMLElement | null;
    if (target?.closest("input, textarea, [contenteditable], .selectable")) return;
    e.preventDefault();
  }
</script>

<svelte:window bind:innerWidth={windowWidth} onkeydown={onKey} oncontextmenu={onContextMenu} />

{#if i18n.dict}
<div class="flex h-screen flex-col">
  <TopBar detailAvailable={cleanup} />
  {#if environment.needsOnboarding}
    {#await import("$lib/components/Onboarding.svelte") then m}<m.default />{/await}
  {:else if settings.config}
    <main class="relative flex min-h-0 flex-1">
      {#if !ui?.sidebarCollapsed}
        <aside class="relative shrink-0 bg-bg" style="width: {sidebarShown}px">
          <ViewBoundary><Sidebar /></ViewBoundary>
          <Resizer
            width={sidebarShown}
            min={SIDEBAR_MIN}
            max={sidebarMax}
            side="right"
            oninput={(w) => (sidebarDraft = w)}
            onend={(w) => (settings.setUi({ sidebarWidth: w }), (sidebarDraft = null))}
            onreset={() => settings.setUi({ sidebarWidth: SIDEBAR_DEFAULT })}
          />
        </aside>
      {/if}

      <ViewBoundary>
        {#if tableView}
          {#await tableView then m}
            <m.default bind:this={table} detailInset={overlay && showDetail ? detailShown : 0} />
          {/await}
        {:else if gitView}
          {#await gitView then m}
            <m.default />
          {/await}
        {:else}
          {#await import("$lib/dashboard/DashboardView.svelte") then m}<m.default />{/await}
        {/if}
      </ViewBoundary>

      {#if dialogs.helpOpen}
        {#await import("$lib/help/HelpPanel.svelte") then m}<m.default />{/await}
      {/if}

      {#if showDetail}
        <aside
          class="flex shrink-0 flex-col pr-3 pb-3
            {overlay ? 'pointer-events-none absolute right-0 bottom-0 z-20' : 'relative bg-bg'} {overlay && cleanup ? '' : 'pt-3'}"
          style="width: {detailShown}px; {overlay ? `top: ${cleanup ? layout.tableTop : 0}px` : ''}"
        >
          <Resizer
            width={detailShown}
            min={DETAIL_MIN}
            max={detailMax}
            side="left"
            oninput={(w) => (detailDraft = w)}
            onend={(w) => (settings.setUi({ detailWidth: w }), (detailDraft = null))}
            onreset={() => settings.setUi({ detailWidth: DETAIL_DEFAULT })}
          />
          <div class="pointer-events-auto relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-line bg-panel {overlay ? 'shadow-panel' : ''}">
            <!-- On the line of the verdict and on the content's right edge (the header's padding): it belongs to
                 the head of the pane, not to the card's corner. -->
            <div class="absolute top-[22px] right-5 z-10">
              <IconButton
                icon={X}
                size="sm"
                label={t.top.detailHide}
                keys={overlay ? "Esc" : "Ctrl J"}
                onclick={() => settings.setUi({ detailCollapsed: true })}
              />
            </div>
            <ViewBoundary>
              {#if cleanupView.scope === "Online"}
                {#await import("$lib/components/OnlineDetail.svelte") then m}<m.default />{/await}
              {:else}
                {#await import("$lib/components/DetailPane.svelte") then m}<m.default />{/await}
              {/if}
            </ViewBoundary>
          </div>
        </aside>
      {/if}
    </main>
  {/if}
</div>

<!-- Rarely needed at start: loaded on first use to keep the initial bundle small. -->
{#if deletes.deleteJob}{#await import("$lib/components/DeleteDialog.svelte") then m}<m.default />{/await}{/if}
{#if identities.identityTarget}{@const target = identities.identityTarget}{#await import("$lib/components/IdentityDialog.svelte") then m}<m.default {target} onclose={() => (identities.identityTarget = null)} />{/await}{/if}
{#if dialogs.settingsOpen}{#await import("$lib/components/SettingsDialog.svelte") then m}<m.default />{/await}{/if}
{#if dialogs.deletedOpen}{#await import("$lib/components/DeletedDialog.svelte") then m}<m.default />{/await}{/if}
{#if dialogs.commitSearchOpen}{#await import("$lib/components/CommitSearchDialog.svelte") then m}<m.default />{/await}{/if}
{#if dialogs.shortcutsOpen}{#await import("$lib/components/ShortcutsDialog.svelte") then m}<m.default />{/await}{/if}
{#if dialogs.cloneOpen}{#await import("$lib/components/CloneDialog.svelte") then m}<m.default />{/await}{/if}
{#if dialogs.copiesFor}{#await import("$lib/components/CopiesDialog.svelte") then m}<m.default />{/await}{/if}
{#if dialogs.ask}{#await import("$lib/components/AskDialog.svelte") then m}<m.default />{/await}{/if}
{#if dialogs.commitsView}{#await import("$lib/components/CommitsFlyout.svelte") then m}<m.default />{/await}{/if}
{#if commandRuns.runs.length}{#await import("$lib/components/RunsPanel.svelte") then m}<m.default />{/await}{/if}
{#if menu.current}{#await import("$lib/ui/ContextMenu.svelte") then m}<m.default />{/await}{/if}
<Toasts />
{/if}
