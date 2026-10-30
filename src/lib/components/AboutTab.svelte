<script lang="ts">
  import { displayPath } from "$lib/paths";
  import { FolderOpen } from "@lucide/svelte";
  import { api } from "$lib/api";
  import { absoluteTime } from "$lib/format";
  import { t } from "$lib/i18n/index.svelte";
  import type { AppInfo } from "$lib/bindings/AppInfo";
  import type { Config } from "$lib/bindings/Config";
  import logo from "$lib/assets/logo.webp";
  import Button from "$lib/ui/Button.svelte";
  import Checkbox from "$lib/ui/Checkbox.svelte";
  import { tooltip } from "$lib/ui/tooltip";
  import { toasts } from "$lib/stores/toasts.svelte";
  import { settings } from "$lib/stores/settings.svelte";

  let { draft = $bindable() }: { draft: Config } = $props();
  let info = $state<AppInfo | null>(null);
  $effect(() => {
    api.appInfo().then((i) => (info = i)).catch((e) => toasts.fail(e));
  });
</script>

<div class="flex flex-col gap-5">
  <!-- The full logo only here and in onboarding; the portrait is the icon everywhere else. -->
  <section class="flex items-center gap-5 rounded-xl bg-panel-2/60 p-4">
    <img src={logo} alt="McBranchFace" width="120" height="120" class="shrink-0 select-none" draggable="false" />
    <div class="min-w-0">
      <div class="text-xl font-semibold">McBranchFace</div>
      {#if info}
        <div class="mt-1 text-sm text-muted">{t.settings.version(info.version)}{#if info.builtAt}{` · ${t.settings.built(absoluteTime(info.builtAt))}`}{/if}</div>
      {/if}
      <p class="mt-2 text-sm leading-snug text-muted">{t.settings.aboutText}</p>
    </div>
  </section>

  {#if info}
    {@const dir = info.appDir}
    <section>
      <h3 class="mb-2.5 t-section">{t.settings.appData}</h3>
      <div class="flex items-center gap-2.5 rounded-lg border border-line bg-panel-2 py-1 pr-1 pl-3">
        <span class="selectable min-w-0 flex-1 truncate font-mono text-sm" use:tooltip={{ path: dir, overflow: true }}>{displayPath(dir)}</span>
        <Button size="sm" icon={FolderOpen} onclick={() => toasts.safely(() => api.openFolder(dir))}>{t.common.openFolder}</Button>
      </div>
      <p class="mt-1.5 text-xs text-faint">
        {info.crashLogs.length ? t.settings.crashLogs(info.crashLogs.length) : t.settings.noCrashLogs}
      </p>
    </section>

    <section>
      <h3 class="mb-2.5 t-section">{t.settings.diagnostics}</h3>
      <Checkbox checked={settings.config?.ui.activityShown ?? false} onchange={(v) => settings.setUi({ activityShown: v })} label={t.settings.showActivity} description={t.settings.showActivityHint} />
      <div class="mt-2.5"><Checkbox bind:checked={draft.diagnostics} label={t.settings.diagnosticsOn} description={t.settings.diagnosticsHint} /></div>
      <p class="mt-1.5 ml-[26px] truncate font-mono text-xs text-faint" use:tooltip={{ path: info.diagnosticsLog, overflow: true }}>{displayPath(info.diagnosticsLog)}</p>
    </section>
  {/if}
</div>
