<script lang="ts">
  import { CircleCheck, CircleDashed, Copy, ExternalLink, RefreshCw, SquareTerminal, TriangleAlert } from "@lucide/svelte";
  import { api } from "$lib/api";
  import { t } from "$lib/i18n/index.svelte";
  import { TOOL_TONE } from "$lib/verdict";
  import type { ToolId } from "$lib/bindings/ToolId";
  import Button from "$lib/ui/Button.svelte";
  import Skeleton from "$lib/ui/Skeleton.svelte";
  import { fullText, tooltip } from "$lib/ui/tooltip";
  import { toasts } from "$lib/stores/toasts.svelte";
  import { environment } from "$lib/stores/environment.svelte";

  let { only }: { only?: ToolId[] } = $props();

  const tools = $derived(only ? environment.tools.filter((x) => only.includes(x.id)) : environment.tools);

  function copy(text: string) {
    toasts.safely(async () => {
      await navigator.clipboard.writeText(text);
      toasts.toast("success", t.tool.commandCopied);
    });
  }
</script>

<div class="flex flex-col gap-2">
  {#if !environment.envChecked}
    {#each only ?? [0, 1, 2] as i (i)}
      <div class="grid grid-cols-[20px_minmax(0,1fr)_auto] gap-x-3 rounded-xl border border-line p-3.5" aria-busy="true">
        <Skeleton class="size-4 rounded-full" />
        <div><Skeleton class="h-3.5 w-28" /><Skeleton class="mt-2 h-3 w-4/5" /></div>
        <Skeleton class="h-3 w-16" />
      </div>
    {/each}
  {/if}

  {#each tools as tool (tool.id)}
    {@const tone = TOOL_TONE[tool.state]}
    {@const info = t.tool.info[tool.id]}
    <!-- Grid: icon column | content column | state column. Every line of the content starts at one edge. -->
    <article class="grid grid-cols-[20px_minmax(0,1fr)_auto] items-start gap-x-3 rounded-xl border border-line bg-panel-2/60 p-3.5">
      <span class="mt-px {tone.text}">
        {#if tool.state === "Ready"}<CircleCheck size={17} />{:else if tool.state === "Missing"}<CircleDashed size={17} />{:else}<TriangleAlert size={17} />{/if}
      </span>
      <div class="min-w-0">
        <div class="flex items-center gap-2">
          <h3 class="text-base font-semibold">{info.name}</h3>
          <span class="rounded px-1.5 text-xs font-medium {tool.required ? 'bg-accent/12 text-accent-ink' : 'bg-panel-2 text-faint'}">
            {tool.required ? t.common.required : t.common.optional}
          </span>
        </div>
        <p class="mt-1 text-sm leading-snug text-muted">{info.purpose}</p>
        {#if tool.account}<p class="mt-1 t-meta">{t.tool.signedInAs} <span class="text-muted">{tool.account}</span></p>{/if}
        {#if tool.detail}<p class="selectable mt-1 font-mono text-xs [overflow-wrap:break-word] text-review">{tool.detail}</p>{/if}

        {#if tool.state !== "Ready"}
          <div class="mt-3 flex flex-col gap-2">
            {#each tool.commands as c (c.action)}
              <div class="flex items-center gap-2">
                <!-- Read-only command: code styling, deliberately not the inset look of an editable input. -->
                <code class="selectable min-w-0 flex-1 truncate rounded-md bg-bg/70 px-2.5 py-1.5 font-mono text-sm text-muted" use:fullText={c.command}>
                  {c.command}
                </code>
                <Button size="sm" icon={Copy} tip={t.tool.copyTip} onclick={() => copy(c.command)}>{t.common.copy}</Button>
                <Button size="sm" variant="primary" icon={SquareTerminal} tip={t.tool.runTip} onclick={() => environment.runTool(tool.id, c.action)}>
                  {t.tool.action[c.action]}
                </Button>
              </div>
            {/each}
            <div>
              <Button size="sm" icon={ExternalLink} tip={tool.downloadUrl} onclick={() => toasts.safely(() => api.openUrl(tool.downloadUrl))}>
                {t.tool.officialPage}
              </Button>
            </div>
          </div>
        {/if}
      </div>
      <div class="flex flex-col items-end gap-0.5 text-right">
        <span class="text-sm font-medium whitespace-nowrap {tone.text}">{t.tool.state[tool.state]}</span>
        {#if tool.version}
          <span class="font-mono text-xs text-faint" use:tooltip={tool.minVersion ? t.tool.minVersion(tool.minVersion) : null}>{tool.version}</span>
        {/if}
      </div>
    </article>
  {/each}

  <div class="flex items-center gap-3 pt-1">
    <Button icon={RefreshCw} disabled={environment.envChecking} tip={t.tool.recheckTip} onclick={() => environment.refreshEnvironment()}>
      {environment.envChecking ? t.tool.rechecking : t.tool.recheck}
    </Button>
    <span class="t-meta">{t.tool.recheckHint}</span>
  </div>
</div>
