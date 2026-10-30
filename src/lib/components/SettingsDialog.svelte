<script lang="ts">
  import { displayPath } from "$lib/paths";
  import { fullText, tooltip } from "$lib/ui/tooltip";
  import {
    ArrowDown, ArrowUp, Bell, Bot, Download, EyeOff, FileCog, FolderGit2, FolderPlus, Globe, Info, Lock, Monitor, Palette, Scale, TerminalSquare, Trash2, Upload, Wrench,
  } from "@lucide/svelte";
  import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
  import { api, isFailure } from "$lib/api";
  import { LENSES, type LensId } from "$lib/alerts";
  import { t } from "$lib/i18n/index.svelte";
  import BranchName from "$lib/ui/BranchName.svelte";
  import type { Config } from "$lib/bindings/Config";
  import type { ImportFailure } from "$lib/bindings/ImportFailure";
  import type { ImportPreview } from "$lib/bindings/ImportPreview";
  import type { Language } from "$lib/bindings/Language";
  import type { Theme } from "$lib/bindings/Theme";
  import Button from "$lib/ui/Button.svelte";
  import Checkbox from "$lib/ui/Checkbox.svelte";
  import IconButton from "$lib/ui/IconButton.svelte";
  import Input from "$lib/ui/Input.svelte";
  import Modal from "$lib/ui/Modal.svelte";
  import NumberField from "$lib/ui/NumberField.svelte";
  import Segmented from "$lib/ui/Segmented.svelte";
  import TextArea from "$lib/ui/TextArea.svelte";
  import ToolList from "./ToolList.svelte";
  import { dateOnly } from "$lib/format";
  import type { Ignore } from "$lib/bindings/Ignore";
  import { SCALES, DEFAULT_SCALE } from "$lib/scale";
  import { SETTINGS_PAGES, type SettingsPage } from "$lib/settingsPages";
  import { KIND_OF } from "$lib/promptKinds";
  import { planRootAdds } from "$lib/roots";
  import { settingsPatch } from "$lib/settingsPatch";
  import { untrack } from "svelte";
  import { toasts } from "$lib/stores/toasts.svelte";
  import { settings } from "$lib/stores/settings.svelte";
  import { dialogs } from "$lib/stores/dialogs.svelte";
  import { environment } from "$lib/stores/environment.svelte";
  import { scanResults } from "$lib/stores/scanResults.svelte";
  import { rules } from "$lib/stores/rules.svelte";
  import { scanner } from "$lib/services/scanner.svelte";

  const ICONS: Record<SettingsPage, typeof Palette> = {
    appearance: Palette,
    repos: FolderGit2,
    updates: Bell,
    window: Monitor,
    rules: Scale,
    online: Globe,
    commands: TerminalSquare,
    prompts: Bot,
    env: Wrench,
    config: FileCog,
    about: Info,
  };
  const page = $derived(t.settings.pages[dialogs.settingsTab]);

  let draft = $state<Config | null>(null);
  /** The config as the dialog opened: Save writes only what changed since, over the config as it is then. */
  let opened = $state.raw<Config | null>(null);
  let protectedText = $state("");
  let candidatesText = $state("");
  let emailsText = $state("");
  let overridesText = $state("");
  let depthText = $state("4");
  let concurrencyText = $state("6");
  let autoFetchText = $state("0");
  let serverCheckText = $state("5");
  // On or off is a switch; the minutes are only the interval. "0 = off" in a number field was a code to learn.
  // Switching off keeps the last interval, so switching on again brings it back.
  let lastAutoFetch = "15";
  let lastServerCheck = "5";
  const autoFetchOn = $derived(Number(autoFetchText) > 0);
  const serverCheckOn = $derived(Number(serverCheckText) > 0);
  function toggleInterval(which: "autoFetch" | "serverCheck", on: boolean) {
    if (which === "autoFetch") {
      if (!on && autoFetchOn) lastAutoFetch = autoFetchText;
      autoFetchText = on ? lastAutoFetch : "0";
    } else {
      if (!on && serverCheckOn) lastServerCheck = serverCheckText;
      serverCheckText = on ? lastServerCheck : "0";
    }
  }
  let refsGapText = $state("30");
  let staleText = $state("30");
  let preview = $state<ImportPreview | null>(null);

  function load(c: Config) {
    opened = c;
    draft = structuredClone(c);
    protectedText = c.protectedPatterns.join("\n");
    candidatesText = c.defaultBranchCandidates.join(", ");
    emailsText = c.myEmails.join("\n");
    overridesText = Object.entries(c.defaultBranchOverrides)
      .map(([k, v]) => `${k} = ${v}`)
      .join("\n");
    depthText = String(c.scanDepth);
    concurrencyText = String(c.concurrency);
    autoFetchText = String(c.autoFetchMinutes);
    serverCheckText = String(c.serverCheckMinutes);
    refsGapText = String(c.ui.refsGapSeconds);
    staleText = String(c.staleDays);
  }

  // Loaded when the dialog opens, not on every config change: theme, size or a lock applied at once
  // must not wipe what was typed on another page.
  $effect(() => {
    if (dialogs.settingsOpen) untrack(() => settings.config && load($state.snapshot(settings.config) as Config));
  });

  const lines = (s: string) => s.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  // An empty or invalid field falls back; 0 is a valid value ("off") and must not.
  const clamp = (text: string, min: number, max: number, fallback: number) => {
    const n = Number(text);
    return text.trim() === "" || !Number.isFinite(n) ? fallback : Math.max(min, Math.min(max, Math.round(n)));
  };

  const lensLabel = {
    localSafe: () => t.lens.localSafe,
    localReview: () => t.lens.localReview,
    localForgotten: () => t.lens.localForgotten,
    onlineMerged: () => t.lens.onlineMerged,
    onlineInactive: () => t.lens.onlineInactive,
  } satisfies Record<LensId, () => string>;
  const lensHint = {
    localSafe: () => t.lens.localSafeHint,
    localReview: () => t.lens.localReviewHint,
    localForgotten: () => t.lens.localForgottenHint,
    onlineMerged: () => t.lens.onlineMergedHint,
    onlineInactive: () => t.lens.onlineInactiveHint(Number(staleText) || 30),
  } satisfies Record<LensId, () => string>;
  const languages = $derived([
    { id: "Auto" as Language, label: t.settings.languageAuto },
    { id: "De" as Language, label: "Deutsch" },
    { id: "En" as Language, label: "English" },
  ]);
  const themes = $derived([
    { id: "System" as Theme, label: t.settings.themeSystem },
    { id: "Dark" as Theme, label: t.settings.themeDark },
    { id: "Light" as Theme, label: t.settings.themeLight },
  ]);
  const scales = SCALES.map((s) => ({ id: String(s), label: `${s} %` }));
  const repoOfIdentity = (identity: string) => scanResults.repos.find((r) => r.info.identity === identity)?.info.name ?? identity;

  async function addRoot() {
    const picked = await openDialog({ directory: true, multiple: true, title: t.settings.pickRoot });
    if (!draft || !picked) return;
    // Same rule as the repo list: a folder already listed, or inside one, is not added twice.
    const plan = planRootAdds(draft.roots, (Array.isArray(picked) ? picked : [picked]).map((path) => ({ path, dir: true })));
    draft.roots = [...draft.roots, ...plan.add];
  }

  function moveRootBy(i: number, d: -1 | 1) {
    if (!draft) return;
    const j = i + d;
    if (j < 0 || j >= draft.roots.length) return;
    const next = [...draft.roots];
    [next[i], next[j]] = [next[j], next[i]];
    draft.roots = next;
  }

  /** What Save writes: the fields this dialog changed, over the config as it is now (see settingsPatch). */
  function collect(): Partial<Config> | null {
    if (!draft || !opened || !settings.config) return null;
    const overrides: Record<string, string> = {};
    for (const l of lines(overridesText)) {
      const [k, ...rest] = l.split("=");
      if (k && rest.length) overrides[k.trim()] = rest.join("=").trim();
    }
    const edited: Config = {
      ...draft,
      protectedPatterns: lines(protectedText),
      defaultBranchCandidates: candidatesText.split(",").map((s) => s.trim()).filter(Boolean),
      myEmails: lines(emailsText),
      defaultBranchOverrides: overrides,
      scanDepth: clamp(depthText, 1, 8, 4),
      concurrency: clamp(concurrencyText, 1, 32, 6),
      autoFetchMinutes: clamp(autoFetchText, 0, 1440, 0),
      serverCheckMinutes: clamp(serverCheckText, 0, 1440, 5),
      // The watcher switches apply at once like the other view settings; the gap is a typed number.
      ui: { ...draft.ui, refsGapSeconds: clamp(refsGapText, 0, 600, 30) },
      staleDays: clamp(staleText, 1, 3650, 30),
    };
    return settingsPatch(opened, edited, settings.config);
  }

  // What applies at once (theme, size, the watcher) is saved already: only what waits for Save makes the
  // dialog "changed". Unchanged, Save is off and the other button closes instead of cancelling.
  const dirty = $derived.by(() => Object.keys(collect() ?? {}).length > 0);

  async function apply(next: Config) {
    const rescan = JSON.stringify(next.roots) !== JSON.stringify(settings.config?.roots) || next.scanOnline !== settings.config?.scanOnline;
    if (await settings.saveConfig(next)) {
      dialogs.settingsOpen = false;
      if (rescan && next.roots.length) scanner.scan(false);
    }
  }

  /** Saves without closing, e.g. before a test run of a command. */
  async function saveQuietly() {
    const patch = collect();
    return !!patch && (await settings.saveWith(patch));
  }

  async function save() {
    const patch = collect();
    if (!patch || !settings.config) return;
    const rescan = (!!patch.roots && JSON.stringify(patch.roots) !== JSON.stringify(settings.config.roots)) || (patch.scanOnline !== undefined && patch.scanOnline !== settings.config.scanOnline);
    if (await settings.saveWith(patch, false)) {
      dialogs.settingsOpen = false;
      if (rescan && settings.config.roots.length) scanner.scan(false);
    }
  }

  async function exportConfig() {
    const path = await saveDialog({
      defaultPath: "mcbranchface-settings.json",
      filters: [{ name: t.settings.fileFilter, extensions: ["json"] }],
    });
    if (!path) return;
    try {
      await api.exportConfig(path);
      toasts.toast("success", t.settings.exported(path));
    } catch (e) {
      toasts.fail(e);
    }
  }

  async function importConfig() {
    const path = await openDialog({ multiple: false, filters: [{ name: t.settings.fileFilter, extensions: ["json"] }] });
    if (!path || Array.isArray(path)) return;
    try {
      preview = await api.importConfig(path);
    } catch (e) {
      if (isFailure<ImportFailure>(e)) {
        const m = t.settings.importFailure[e.kind];
        toasts.toast("error", m.title, { detail: [m.hint, e.detail].filter(Boolean).join(" · ") });
      }
      else toasts.fail(e);
    }
  }

  async function applyImport() {
    if (!preview || !settings.config) return;
    const next: Config = { ...preview.config, theme: settings.config.theme, ui: settings.config.ui };
    preview = null;
    await apply(next);
  }

  /** Same path as the context menu: a lock change applies at once, not with "Save". */
  async function removeLock(i: number) {
    const l = draft?.locks[i];
    const repo = l && scanResults.repos.find((r) => r.info.identity === l.identity);
    if (!draft || !l) return;
    if (repo) await rules.setLock(repo.info.path, l.branch, false);
    else if (settings.config) await settings.saveConfig({ ...($state.snapshot(settings.config) as Config), locks: settings.config.locks.filter((x) => x !== l) }, true);
    draft.locks = [...(settings.config?.locks ?? [])];
  }

  async function removeIgnore(i: Ignore) {
    await rules.removeIgnore(i);
    if (draft) draft.ignores = [...(settings.config?.ignores ?? [])];
  }

  const scopeLabel = (i: Ignore) => (i.scope === "Both" ? t.settings.scopeBoth : i.scope === "Online" ? t.cleanup.scopeOnline : t.cleanup.scopeLocal);

  function onNavKey(e: KeyboardEvent) {
    const d = e.key === "ArrowDown" ? 1 : e.key === "ArrowUp" ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    const i = SETTINGS_PAGES.indexOf(dialogs.settingsTab);
    const next = SETTINGS_PAGES[(i + d + SETTINGS_PAGES.length) % SETTINGS_PAGES.length];
    dialogs.settingsTab = next;
    (e.currentTarget as HTMLElement).querySelector<HTMLElement>(`[data-page="${next}"]`)?.focus();
  }
</script>

<!-- A card: one topic of a page, with a heading and a sentence on what it is for. -->
{#snippet card(title: string | null, text: string | null, body: import("svelte").Snippet)}
  <section class="rounded-xl border border-line bg-panel-2 p-4">
    {#if title}<h3 class="t-section">{title}</h3>{/if}
    {#if text}<p class="mt-1 mb-3 text-sm text-muted">{text}</p>{:else if title}<div class="mb-3"></div>{/if}
    {@render body()}
  </section>
{/snippet}

<Modal open={dialogs.settingsOpen} title={t.settings.title} width="880px" resizable {...settings.dialogSize("settings")} onclose={() => (dialogs.settingsOpen = false)}>
  {#if draft}
    <div class="grid grid-cols-[196px_minmax(0,1fr)] gap-6">
      <div class="sticky top-0 flex flex-col gap-0.5 self-start" role="tablist" aria-orientation="vertical" aria-label={t.settings.pagesLabel} tabindex="-1" onkeydown={onNavKey}>
        {#each SETTINGS_PAGES as id (id)}
          {@const Icon = ICONS[id]}
          {@const on = dialogs.settingsTab === id}
          <button
            type="button"
            role="tab"
            data-page={id}
            aria-selected={on}
            tabindex={on ? 0 : -1}
            class="flex h-8 items-center gap-2.5 rounded-lg px-2.5 text-left text-base transition-colors
              {on ? 'bg-accent/12 font-medium text-fg shadow-[inset_2px_0_0_var(--accent)]' : 'text-muted hover:bg-hover hover:text-fg'}"
            onclick={() => (dialogs.settingsTab = id)}
          >
            <Icon size={15} class="shrink-0 {on ? 'text-accent' : ''}" />
            <span class="truncate">{t.settings.pages[id].label}</span>
          </button>
        {/each}
      </div>

      <div class="flex min-w-0 flex-col gap-4" role="tabpanel" aria-label={page.label}>
        <header>
          <h2 class="t-title">{page.label}</h2>
          <p class="mt-0.5 text-sm text-muted">{page.text}</p>
        </header>

        {#if dialogs.settingsTab === "appearance"}
          {#snippet looks()}
            <!-- Label column and control column: every control starts at the same edge. -->
            <div class="grid grid-cols-[160px_minmax(0,1fr)] items-center gap-x-4 gap-y-3">
              <span class="text-sm font-medium">{t.settings.language}</span>
              <div><Segmented label={t.settings.language} options={languages} value={settings.config?.language ?? "Auto"} onchange={(v) => settings.setLanguage(v)} /></div>
              <span class="text-sm font-medium">{t.settings.theme}</span>
              <div><Segmented label={t.settings.theme} options={themes} value={settings.config?.theme ?? "System"} onchange={(v) => settings.setTheme(v)} /></div>
              <span class="self-start pt-1.5 text-sm font-medium">{t.settings.scale}</span>
              <div>
                <Segmented label={t.settings.scale} options={scales} value={String(settings.config?.ui.scale ?? DEFAULT_SCALE)} onchange={(v) => settings.setScale(Number(v))} />
                <span class="mt-1 block text-xs text-faint">{t.settings.scaleHint}</span>
              </div>
              <span class="self-start pt-1.5 text-sm font-medium">{t.settings.motion}</span>
              <div>
                <Segmented
                  label={t.settings.motion}
                  options={[
                    { id: "on", label: t.settings.motionOn },
                    { id: "system", label: t.settings.motionSystem },
                    { id: "off", label: t.settings.motionOff },
                  ]}
                  value={settings.config?.ui.motion ?? "on"}
                  onchange={(v) => settings.setUi({ motion: v })}
                />
                <span class="mt-1 block text-xs text-faint">{t.settings.motionHint}</span>
              </div>
            </div>
          {/snippet}
          <!-- The page is titled already; a card repeating it would only push the content down. -->
          {@render card(null, null, looks)}
        {:else if dialogs.settingsTab === "repos"}
          {#snippet folders()}
            <div class="mb-2 flex justify-end">
              <Button size="sm" icon={FolderPlus} tip={t.settings.addRootTip} onclick={addRoot}>{t.settings.addRoot}</Button>
            </div>
            <ul class="flex flex-col gap-1">
              {#each draft!.roots as root, i (root)}
                <li class="flex items-center gap-2.5 rounded-lg border border-line bg-panel py-1 pr-1 pl-3">
                  <FolderGit2 size={15} class="shrink-0 text-faint" />
                  <span class="selectable min-w-0 flex-1 truncate font-mono text-sm" use:tooltip={{ path: root, overflow: true }}>{displayPath(root)}</span>
                  <IconButton icon={ArrowUp} size="sm" label={t.settings.moveUp} disabled={i === 0} onclick={() => moveRootBy(i, -1)} />
                  <IconButton icon={ArrowDown} size="sm" label={t.settings.moveDown} disabled={i === draft!.roots.length - 1} onclick={() => moveRootBy(i, 1)} />
                  <IconButton icon={Trash2} size="sm" tone="danger" label={t.settings.removeRoot} onclick={() => draft && draft.roots.splice(i, 1)} />
                </li>
              {:else}
                <li class="rounded-lg border border-dashed border-line-strong px-3 py-4 text-center t-meta">{t.settings.noRoot}</li>
              {/each}
            </ul>
            <p class="mt-1.5 text-xs text-faint">{t.settings.rootsHint}</p>
          {/snippet}
          {@render card(t.settings.roots, null, folders)}
          {#snippet scan()}
            <div class="grid grid-cols-[160px_minmax(0,1fr)] gap-x-4 gap-y-3">
              <NumberField label={t.settings.depth} unit={t.settings.levels} min={1} max={8} bind:value={depthText} hint={t.settings.depthHint} />
              <NumberField label={t.settings.concurrency} unit={t.settings.repos} min={1} max={32} bind:value={concurrencyText} hint={t.settings.concurrencyHint} />
            </div>
            <div class="mt-4 flex flex-col gap-3">
              <Checkbox bind:checked={draft!.fetchOnScan} label={t.settings.fetchOnScan} description={t.settings.fetchOnScanHint} />
              <Checkbox bind:checked={draft!.useProviders} label={t.settings.providers} description={t.settings.providersHint} />
            </div>
          {/snippet}
          {@render card(t.settings.scanSection, null, scan)}
        {:else if dialogs.settingsTab === "updates"}
          {#snippet timing()}
            <!-- The bell only learns about new branches through a scan, so the interval lives here. -->
            <div class="flex flex-col gap-3">
              <Checkbox checked={autoFetchOn} onchange={(v) => toggleInterval("autoFetch", v)} label={t.settings.autoFetch} description={t.settings.autoFetchHint} />
              <div class="ml-[26px] grid grid-cols-[160px_minmax(0,1fr)] gap-x-4 {autoFetchOn ? '' : 'pointer-events-none opacity-50'}">
                <NumberField label={t.settings.every} unit={t.settings.minutes} min={1} max={1440} bind:value={autoFetchText} />
              </div>
              <Checkbox checked={serverCheckOn} disabled={!draft!.alerts.enabled} onchange={(v) => toggleInterval("serverCheck", v)} label={t.settings.serverCheck} description={t.settings.serverCheckHint} />
              <div class="ml-[26px] grid grid-cols-[160px_minmax(0,1fr)] gap-x-4 {serverCheckOn && draft!.alerts.enabled ? '' : 'pointer-events-none opacity-50'}">
                <NumberField label={t.settings.every} unit={t.settings.minutes} min={1} max={1440} bind:value={serverCheckText} />
              </div>
            </div>
          {/snippet}
          {@render card(t.settings.intervals, null, timing)}
          {#snippet watcher()}
            <div class="flex flex-col gap-3">
              <Checkbox checked={settings.config?.ui.watchFiles ?? true} onchange={(v) => settings.setUi({ watchFiles: v })} label={t.settings.watchFiles} description={t.settings.watchFilesHint} />
              <Checkbox checked={settings.config?.ui.watchRefs ?? true} onchange={(v) => settings.setUi({ watchRefs: v })} label={t.settings.watchRefs} description={t.settings.watchRefsHint} />
              <div class="ml-[26px] grid grid-cols-[160px_minmax(0,1fr)] gap-x-4 {settings.config?.ui.watchRefs !== false ? '' : 'pointer-events-none opacity-50'}">
                <NumberField label={t.settings.refsGap} unit={t.settings.seconds} min={0} max={600} bind:value={refsGapText} hint={t.settings.refsGapHint} />
              </div>
            </div>
          {/snippet}
          {@render card(t.settings.watchSection, null, watcher)}
          {#snippet bell()}
            <div class="flex flex-col gap-3">
              <Checkbox bind:checked={draft!.alerts.enabled} label={t.settings.alertsOn} description={t.settings.alertsOnHint} />
              <div class="ml-[26px] flex flex-col gap-2 {draft!.alerts.enabled ? '' : 'pointer-events-none opacity-50'}">
                <span class="text-sm font-medium">{t.settings.lensesCount}</span>
                {#each LENSES as l (l.id)}
                  <Checkbox bind:checked={draft!.alerts[l.pref]} label={lensLabel[l.id]()} description={lensHint[l.id]()} />
                {/each}
              </div>
              <Checkbox bind:checked={draft!.alerts.notify} disabled={!draft!.alerts.enabled} label={t.settings.notify} description={t.settings.notifyHint} />
            </div>
          {/snippet}
          {@render card(t.settings.alerts, null, bell)}
        {:else if dialogs.settingsTab === "window"}
          {#snippet win()}
            <div class="flex flex-col gap-3">
              <Checkbox
                bind:checked={draft!.window.closeToTray}
                disabled={!environment.windowCaps.tray}
                label={t.settings.closeToTray}
                description={environment.windowCaps.tray ? t.settings.closeToTrayHint : t.settings.trayUnavailable}
              />
              <Checkbox
                bind:checked={draft!.window.minimizeToTray}
                disabled={!environment.windowCaps.tray}
                label={t.settings.minimizeToTray}
                description={environment.windowCaps.tray ? t.settings.minimizeToTrayHint : t.settings.trayUnavailable}
              />
              <Checkbox
                bind:checked={draft!.window.autostart}
                disabled={!environment.windowCaps.autostart}
                label={t.settings.autostart}
                description={environment.windowCaps.autostart ? t.settings.autostartHint : t.settings.autostartUnavailable}
              />
              <div class="ml-[26px] {draft!.window.autostart && environment.windowCaps.tray ? '' : 'pointer-events-none opacity-50'}">
                <Checkbox bind:checked={draft!.window.startHidden} label={t.settings.startHidden} description={t.settings.startHiddenHint} />
              </div>
            </div>
          {/snippet}
          {@render card(t.settings.windowSection, null, win)}
        {:else if dialogs.settingsTab === "online"}
          {#snippet onl()}
            <div class="flex flex-col gap-3">
              <Checkbox bind:checked={draft!.scanOnline} label={t.settings.scanOnline} description={t.settings.scanOnlineHint} />
              <div class="ml-[26px] grid grid-cols-[134px_minmax(0,1fr)] gap-x-4">
                <NumberField label={t.settings.staleDays} unit={t.settings.days} min={1} max={3650} bind:value={staleText} hint={t.settings.staleDaysHint} disabled={!draft!.scanOnline} />
              </div>
            </div>
          {/snippet}
          {@render card(t.settings.online, null, onl)}
        {:else if dialogs.settingsTab === "config"}
          {#snippet cfg()}
            <div class="flex gap-2">
              <Button icon={Download} tip={t.settings.exportTip} onclick={exportConfig}>{t.settings.export}</Button>
              <Button icon={Upload} tip={t.settings.importTip} onclick={importConfig}>{t.settings.import}</Button>
            </div>
          {/snippet}
          {@render card(t.settings.config, null, cfg)}
        {:else if dialogs.settingsTab === "env"}
          <ToolList />
        {:else if dialogs.settingsTab === "commands"}
          <!-- This page and the two below change the draft in place, so it is bound to them; through a getter
               and setter, as `draft!` itself cannot be bound. -->
          {#await import("./CommandsTab.svelte") then m}<m.default bind:draft={() => draft!, (v) => (draft = v)} save={saveQuietly} />{/await}
        {:else if dialogs.settingsTab === "prompts"}
          {#await import("./PromptsTab.svelte") then m}<m.default bind:draft={() => draft!, (v) => (draft = v)} />{/await}
        {:else if dialogs.settingsTab === "about"}
          {#await import("./AboutTab.svelte") then m}<m.default bind:draft={() => draft!, (v) => (draft = v)} />{/await}
        {:else}
          {#snippet mine()}
            <div class="flex flex-col gap-4">
              <TextArea label={t.settings.emails} rows={2} mono bind:value={emailsText} hint={t.settings.emailsHint} />
              <TextArea label={t.settings.protected} rows={3} mono bind:value={protectedText} hint={t.settings.protectedHint} />
              <Input label={t.settings.candidates} mono bind:value={candidatesText} hint={t.settings.candidatesHint} />
              <TextArea
                label={t.settings.overrides}
                rows={2}
                mono
                bind:value={overridesText}
                placeholder={t.settings.overridesPlaceholder}
                hint={t.settings.overridesHint}
              />
            </div>
          {/snippet}
          {@render card(t.settings.branchRules, null, mine)}
          {#snippet kept()}
            <span class="mb-1 block text-sm font-medium">{t.settings.locks}</span>
            <ul class="flex flex-col gap-1">
              {#each draft!.locks as l, i (`${l.identity}\u0000${l.branch ?? ""}`)}
                <li class="flex items-center gap-2.5 rounded-lg border border-line bg-panel py-1 pr-1 pl-3 text-sm">
                  <Lock size={13} class="shrink-0 text-faint" />
                  <span class="shrink-0 font-medium" use:tooltip={l.identity}>{repoOfIdentity(l.identity)}</span>
                  <span class="min-w-0 flex-1 truncate font-mono {l.branch ? '' : 'text-faint'}">{l.branch ?? t.settings.lockWholeRepo}</span>
                  <IconButton icon={Trash2} size="sm" tone="danger" label={t.settings.removeLock} onclick={() => removeLock(i)} />
                </li>
              {:else}
                <li class="rounded-lg border border-dashed border-line-strong px-3 py-3 text-center t-meta">{t.settings.locksEmpty}</li>
              {/each}
            </ul>
            <p class="mt-1 text-xs text-faint">{t.settings.locksHint}</p>
            <span class="mt-4 mb-1 block text-sm font-medium">{t.settings.ignores}</span>
            <ul class="flex flex-col gap-1">
              {#each draft!.ignores as i (`${i.identity}\u0000${i.branch}\u0000${i.scope}`)}
                <li class="flex items-center gap-2.5 rounded-lg border border-line bg-panel py-1 pr-1 pl-3 text-sm">
                  <EyeOff size={13} class="shrink-0 text-faint" />
                  <span class="shrink-0 font-medium" use:tooltip={i.identity}>{repoOfIdentity(i.identity)}</span>
                  <span class="flex min-w-0 flex-1"><BranchName name={i.branch} size="sm" /></span>
                  <span class="shrink-0 text-xs text-faint">{scopeLabel(i)} · {i.until === null ? t.settings.forever : t.settings.until(dateOnly(i.until))}</span>
                  <IconButton icon={Trash2} size="sm" tone="danger" label={t.settings.removeIgnore} onclick={() => removeIgnore(i)} />
                </li>
              {:else}
                <li class="rounded-lg border border-dashed border-line-strong px-3 py-3 text-center t-meta">{t.settings.ignoresEmpty}</li>
              {/each}
            </ul>
            <p class="mt-1 text-xs text-faint">{t.settings.ignoresHint}</p>
          {/snippet}
          {@render card(t.settings.keptSection, t.settings.keptText, kept)}
        {/if}
      </div>
    </div>
  {/if}

  {#snippet footer()}
    <Button variant="ghost" onclick={() => (dialogs.settingsOpen = false)}>{dirty ? t.common.cancel : t.common.close}</Button>
    <Button variant="primary" disabled={!dirty} tip={dirty ? undefined : t.settings.nothingChanged} onclick={save}>{t.common.save}</Button>
  {/snippet}
</Modal>

<Modal open={preview !== null} title={t.settings.importTitle} width="560px" onclose={() => (preview = null)}>
  {#if preview}
    {@const c = preview.config}
    <p class="mb-3 text-sm text-muted">{t.settings.importIntro}</p>
    <dl class="grid grid-cols-[max-content_minmax(0,1fr)] gap-x-4 gap-y-2 rounded-lg bg-panel-2/60 p-3 text-sm">
      <dt class="text-faint">{t.settings.roots}</dt>
      <dd class="font-mono text-xs">{#each c.roots as r (r)}<div class="truncate" use:tooltip={{ path: r, overflow: true }}>{displayPath(r)}</div>{:else}{t.common.none}{/each}</dd>
      <dt class="text-faint">{t.settings.emails}</dt>
      <dd class="truncate">{c.myEmails.join(", ") || t.common.none}</dd>
      <dt class="text-faint">{t.settings.protected}</dt>
      <dd class="truncate font-mono text-xs">{c.protectedPatterns.join("  ")}</dd>
      <dt class="text-faint">{t.settings.locks}</dt>
      <dd>{c.locks.length}</dd>
      <dt class="text-faint">{t.settings.tabCommands}</dt>
      <dd>
        {#each c.commands as cmd (cmd.id)}
          <!-- Commands run on this machine: every one is shown with its script before the import. -->
          <div class="flex min-w-0 gap-2"><span class="shrink-0 font-medium">{cmd.name}</span><span class="truncate font-mono text-xs text-faint" use:fullText={cmd.script}>{cmd.script}</span></div>
        {:else}{t.common.none}{/each}
      </dd>
      <dt class="text-faint">{t.settings.pages.prompts.label}</dt>
      <dd>
        {#each c.prompts as p (p.id)}
          <!-- A prompt is copied, not run; its name says enough, the text is in the settings afterwards. -->
          <div class="truncate">{p.builtin ? t.prompt[KIND_OF[p.builtin]] : p.name}</div>
        {:else}{t.common.none}{/each}
      </dd>
      <dt class="text-faint">{t.settings.ignores}</dt>
      <dd>{c.ignores.length}</dd>
      <dt class="text-faint">{t.settings.annotations}</dt>
      <dd>{Object.keys(c.annotations).length}</dd>
      <dt class="text-faint">{t.settings.language}</dt>
      <dd>{languages.find((l) => l.id === c.language)?.label}</dd>
    </dl>
    {#if preview.adjusted.length}
      <p class="mt-3 text-sm text-review">{t.settings.importAdjusted(preview.adjusted.join(", "))}</p>
    {/if}
  {/if}
  {#snippet footer()}
    <Button variant="ghost" onclick={() => (preview = null)}>{t.common.cancel}</Button>
    <Button variant="primary" data-autofocus onclick={applyImport}>{t.settings.importApply}</Button>
  {/snippet}
</Modal>
