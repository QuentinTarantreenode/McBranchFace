<script lang="ts">
  import { tooltip } from "$lib/ui/tooltip";
  import { displayPath } from "$lib/paths";
  import { Check, FolderGit2, FolderPlus, Trash2 } from "@lucide/svelte";
  import { open as openDialog } from "@tauri-apps/plugin-dialog";
  import { t } from "$lib/i18n/index.svelte";
  import type { Config } from "$lib/bindings/Config";
  import type { Language } from "$lib/bindings/Language";
  import Button from "$lib/ui/Button.svelte";
  import IconButton from "$lib/ui/IconButton.svelte";
  import Segmented from "$lib/ui/Segmented.svelte";
  import logo from "$lib/assets/logo.webp";
  import ToolList from "./ToolList.svelte";
  import { settings } from "$lib/stores/settings.svelte";
  import { environment } from "$lib/stores/environment.svelte";
  import { scanner } from "$lib/services/scanner.svelte";

  let step = $state(0);
  let roots = $state<string[]>([...(settings.config?.roots ?? [])]);

  const gitReady = $derived(environment.tool("Git")?.state === "Ready");
  const steps = $derived([
    { title: t.onboarding.envTitle, sub: t.onboarding.envStep, text: t.onboarding.envText, done: gitReady },
    { title: t.onboarding.reposTitle, sub: t.onboarding.reposStep, text: t.onboarding.reposText, done: roots.length > 0 },
    { title: t.onboarding.providersTitle, sub: t.onboarding.providersStep, text: t.onboarding.providersText, done: false },
  ]);
  const canNext = $derived(step === 0 ? gitReady : step === 1 ? roots.length > 0 : true);
  const blocked = $derived(step === 0 ? t.onboarding.needGit : t.onboarding.needFolder);
  // Steps are reachable once everything before them is done.
  const reachable = (i: number) => steps.slice(0, i).every((s) => s.done);

  const languages = $derived([
    { id: "Auto" as Language, label: t.settings.languageAuto },
    { id: "De" as Language, label: "Deutsch" },
    { id: "En" as Language, label: "English" },
  ]);

  async function addRoot() {
    const picked = await openDialog({ directory: true, multiple: true, title: t.settings.pickRoot });
    if (!picked) return;
    roots = [...new Set([...roots, ...(Array.isArray(picked) ? picked : [picked])])];
  }

  async function finish() {
    if (!settings.config) return;
    const next: Config = { ...($state.snapshot(settings.config) as Config), roots };
    if (await settings.saveConfig(next, true)) scanner.scan(true);
  }
</script>

<main class="grid flex-1 place-items-center overflow-y-auto p-8">
  <div class="grid w-full max-w-[900px] grid-cols-[250px_minmax(0,1fr)] overflow-hidden rounded-2xl border border-line bg-panel shadow-panel">
    <!-- Step rail: identity, the three steps, and the language (it matters before anything is read). -->
    <aside class="flex flex-col border-r border-line bg-panel-2/50 p-6 surface-glow">
      <img src={logo} alt="McBranchFace" width="168" height="168" class="mx-auto -mt-1 select-none" draggable="false" />
      <h1 class="mt-3 text-xl font-semibold tracking-tight">{t.onboarding.welcome}</h1>
      <p class="mt-2 text-sm leading-snug text-muted">{t.onboarding.intro}</p>

      <ol class="mt-6 flex flex-col gap-1" aria-label={t.onboarding.steps}>
        {#each steps as s, i (i)}
          {@const current = i === step}
          <li>
            <button
              type="button"
              disabled={!reachable(i)}
              aria-current={current ? "step" : undefined}
              class="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors
                {current ? 'bg-panel shadow-sm' : 'hover:bg-hover/60'} disabled:pointer-events-none disabled:opacity-50"
              onclick={() => (step = i)}
            >
              <span
                class="grid size-7 shrink-0 place-items-center rounded-full text-sm font-semibold
                  {s.done && !current ? 'bg-safe text-white dark:text-bg' : current ? 'bg-accent text-accent-fg' : 'border border-line-strong text-faint'}"
              >
                {#if s.done && !current}<Check size={14} />{:else}{i + 1}{/if}
              </span>
              <span class="min-w-0">
                <span class="block text-base {current ? 'font-semibold text-fg' : 'text-muted'}">{s.title}</span>
                <span class="block t-meta">{s.done ? t.onboarding.done : s.sub}</span>
              </span>
            </button>
          </li>
        {/each}
      </ol>

      <div class="mt-auto pt-6">
        <div class="mb-1.5 t-section">{t.settings.language}</div>
        <Segmented label={t.settings.language} options={languages} value={settings.config?.language ?? "Auto"} onchange={(v) => settings.setLanguage(v)} />
      </div>
    </aside>

    <section class="flex min-h-[500px] flex-col">
      <header class="px-7 pt-6">
        <h2 class="text-xl font-semibold tracking-tight">{steps[step].title}</h2>
        <p class="mt-1.5 text-base leading-relaxed text-muted">{steps[step].text}</p>
      </header>

      <div class="min-h-0 flex-1 overflow-y-auto px-7 py-5">
        {#if step === 0}
          <ToolList only={["Git"]} />
        {:else if step === 1}
          <ul class="flex flex-col gap-1.5">
            {#each roots as root, i (root)}
              <li class="flex items-center gap-2.5 rounded-lg border border-line bg-panel-2 py-1 pr-1 pl-3">
                <FolderGit2 size={15} class="shrink-0 text-faint" />
                <span class="selectable min-w-0 flex-1 truncate font-mono text-sm" use:tooltip={{ path: root, overflow: true }}>{displayPath(root)}</span>
                <IconButton icon={Trash2} size="sm" tone="danger" label={t.onboarding.removeFolder} onclick={() => roots.splice(i, 1)} />
              </li>
            {:else}
              <li class="rounded-lg border border-dashed border-line-strong px-3 py-8 text-center text-base text-faint">{t.onboarding.noFolder}</li>
            {/each}
          </ul>
          <div class="mt-3"><Button icon={FolderPlus} onclick={addRoot}>{t.settings.addRoot}</Button></div>
        {:else}
          <ToolList only={["AzureCli", "GitHubCli", "GitHubDesktop"]} />
        {/if}
      </div>

      <!-- Action bar: back on the left, the way forward on the right, always in the same place. -->
      <footer class="flex items-center gap-2 border-t border-line bg-panel-2/60 px-7 py-3">
        {#if step > 0}<Button variant="ghost" onclick={() => step--}>{t.common.back}</Button>{/if}
        <div class="ml-auto flex items-center gap-2">
          {#if step < 2}
            <Button variant="primary" disabled={!canNext} tip={!canNext ? blocked : undefined} onclick={() => step++}>{t.common.next}</Button>
          {:else}
            <Button variant="primary" onclick={finish}>{t.onboarding.start}</Button>
          {/if}
        </div>
      </footer>
    </section>
  </div>
</main>
