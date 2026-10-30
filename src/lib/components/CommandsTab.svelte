<script lang="ts">
  import { commandRuns } from "$lib/stores/commandRuns.svelte";
  import { untrack } from "svelte";
  import { ArrowDown, ArrowUp, Copy, Play, Plus, SquareTerminal, Trash2 } from "@lucide/svelte";
  import { explainError, api } from "$lib/api";
  import { folderLabel } from "$lib/groups";
  import { t } from "$lib/i18n/index.svelte";
  import type { Config } from "$lib/bindings/Config";
  import type { CustomCommand } from "$lib/bindings/CustomCommand";
  import type { Shell } from "$lib/bindings/Shell";
  import type { RunMode } from "$lib/bindings/RunMode";
  import Button from "$lib/ui/Button.svelte";
  import Checkbox from "$lib/ui/Checkbox.svelte";
  import IconButton from "$lib/ui/IconButton.svelte";
  import Input from "$lib/ui/Input.svelte";
  import Segmented from "$lib/ui/Segmented.svelte";
  import { scanResults } from "$lib/stores/scanResults.svelte";

  let { draft = $bindable(), save }: { draft: Config; save: () => Promise<boolean> } = $props();

  const PLACEHOLDERS = ["path", "repo", "identity", "branch", "remote", "default"];
  let selected = $state<string | null>(untrack(() => draft.commands[0]?.id ?? null));
  const current = $derived(draft.commands.find((c) => c.id === selected) ?? null);
  // "Selected only" with nothing ticked yet still means every repo; the choice is kept per command shown.
  let pickRepos = $state(false);
  $effect(() => {
    const c = current;
    untrack(() => (pickRepos = !!c && c.repos.length > 0));
  });
  const scopes = $derived([
    { id: "all", label: t.commands.scopeAll },
    { id: "some", label: t.commands.scopeSome },
  ]);
  let scriptEl: HTMLTextAreaElement | undefined = $state();

  // One entry per repository identity: a command is offered for every working copy of it.
  const repos = $derived([...new Map(scanResults.repos.map((r) => [r.info.identity, r.info])).values()]);
  let previewRepo = $state(scanResults.repos[0]?.info.path ?? "");
  let preview = $state<{ ok: boolean; text: string } | null>(null);

  const shells = $derived([
    { id: "Default" as Shell, label: t.commands.shellDefault },
    { id: "Pwsh" as Shell, label: "PowerShell" },
    { id: "Cmd" as Shell, label: "cmd" },
    { id: "Bash" as Shell, label: "bash" },
    { id: "Sh" as Shell, label: "sh" },
  ]);
  const modes = $derived([
    { id: "Terminal" as RunMode, label: t.commands.modeTerminal },
    { id: "Background" as RunMode, label: t.commands.modeBackground },
  ]);

  // Rendered by the backend, the same code that runs it; shows unknown placeholders at once.
  $effect(() => {
    const c = current;
    if (!c || !previewRepo) return void (preview = null);
    const [script, shell, repo] = [c.script, c.shell, previewRepo];
    const branch = c.branches ? (scanResults.allBranches.find((b) => b.repoPath === repo)?.name ?? "feature/example") : null;
    const timer = setTimeout(() => {
      api
        .previewCustomCommand(script, shell, repo, branch)
        .then((text) => (preview = { ok: true, text }))
        .catch((e) => {
          const x = explainError(e);
          preview = { ok: false, text: x.detail ? `${x.text} ${x.detail}` : x.text };
        });
    }, 250);
    return () => clearTimeout(timer);
  });

  function add(from?: CustomCommand) {
    const id = `cmd-${Date.now().toString(36)}`;
    const c: CustomCommand = from
      ? { ...$state.snapshot(from), id, name: `${from.name} 2` }
      : { id, name: t.commands.unnamed, script: "git status", shell: "Default", mode: "Background", repos: [], branches: false, confirm: false };
    draft.commands = [...draft.commands, c];
    selected = id;
  }

  function remove(id: string) {
    const i = draft.commands.findIndex((c) => c.id === id);
    draft.commands = draft.commands.filter((c) => c.id !== id);
    selected = draft.commands[Math.min(i, draft.commands.length - 1)]?.id ?? null;
  }

  function move(id: string, d: number) {
    const i = draft.commands.findIndex((c) => c.id === id);
    const j = i + d;
    if (i < 0 || j < 0 || j >= draft.commands.length) return;
    const list = [...draft.commands];
    [list[i], list[j]] = [list[j], list[i]];
    draft.commands = list;
  }

  function insert(name: string) {
    if (!current || !scriptEl) return;
    const token = `{{${name}}}`;
    const [a, b] = [scriptEl.selectionStart, scriptEl.selectionEnd];
    current.script = current.script.slice(0, a) + token + current.script.slice(b);
    queueMicrotask(() => {
      scriptEl?.focus();
      scriptEl?.setSelectionRange(a + token.length, a + token.length);
    });
  }

  function toggleRepo(identity: string) {
    if (!current) return;
    current.repos = current.repos.includes(identity) ? current.repos.filter((x) => x !== identity) : [...current.repos, identity];
  }

  // The backend runs saved commands only, so a test run saves first.
  async function testRun() {
    if (!current || !previewRepo) return;
    const c = $state.snapshot(current) as CustomCommand;
    if (await save()) commandRuns.runCommand({ ...c, confirm: false }, previewRepo, c.branches ? (scanResults.allBranches.find((b) => b.repoPath === previewRepo)?.name ?? null) : null);
  }
</script>

<div class="flex flex-col gap-4">
  <p class="text-sm leading-snug text-muted">{t.commands.intro}</p>

  <section>
    <div class="mb-2 flex items-center justify-between">
      <h3 class="t-section">{t.commands.title}</h3>
      <Button size="sm" icon={Plus} onclick={() => add()}>{t.commands.add}</Button>
    </div>
    <ul class="zebra flex flex-col overflow-hidden rounded-lg border border-line">
      {#each draft.commands as c, i (c.id)}
        <li class="flex items-center gap-2 py-1 pr-1 pl-2 {selected === c.id ? '!bg-accent/10' : ''}">
          <button type="button" class="flex min-w-0 flex-1 items-center gap-2 py-1 text-left" onclick={() => (selected = c.id)}>
            {#if c.mode === "Terminal"}<SquareTerminal size={14} class="shrink-0 text-faint" />{:else}<Play size={14} class="shrink-0 text-faint" />{/if}
            <span class="truncate text-base font-medium">{c.name}</span>
            <span class="min-w-0 flex-1 truncate font-mono text-xs text-faint">{c.script.split("\n")[0]}</span>
          </button>
          <IconButton icon={ArrowUp} size="sm" label={t.commands.moveUp} disabled={i === 0} onclick={() => move(c.id, -1)} />
          <IconButton icon={ArrowDown} size="sm" label={t.commands.moveDown} disabled={i === draft.commands.length - 1} onclick={() => move(c.id, 1)} />
          <IconButton icon={Copy} size="sm" label={t.commands.duplicate} onclick={() => add(c)} />
          <IconButton icon={Trash2} size="sm" tone="danger" label={t.commands.remove} onclick={() => remove(c.id)} />
        </li>
      {:else}
        <li class="px-3 py-4 text-center t-meta">{t.commands.empty}</li>
      {/each}
    </ul>
  </section>

  {#if current}
    <section class="flex flex-col gap-3 rounded-xl bg-panel-2/60 p-4">
      <Input label={t.commands.name} bind:value={current.name} placeholder={t.commands.namePlaceholder} maxlength={60} />
      <div class="grid grid-cols-[max-content_minmax(0,1fr)] items-center gap-x-4 gap-y-3">
        <span class="text-sm font-medium">{t.commands.shell}</span>
        <div class="flex"><Segmented options={shells} value={current.shell} onchange={(v) => current && (current.shell = v)} label={t.commands.shell} /></div>
        <span class="text-sm font-medium">{t.commands.mode}</span>
        <div class="flex flex-col items-start gap-1">
          <Segmented options={modes} value={current.mode} onchange={(v) => current && (current.mode = v)} label={t.commands.mode} />
          <span class="text-xs text-faint">{t.commands.modeHint}</span>
        </div>
      </div>

      <label class="block">
        <span class="mb-1 block text-sm font-medium">{t.commands.script}</span>
        <textarea
          bind:this={scriptEl}
          bind:value={current.script}
          rows="6"
          spellcheck="false"
          class="block w-full resize-y rounded-lg border border-line-strong bg-input px-2.5 py-2 font-mono text-sm text-fg outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
        ></textarea>
      </label>
      <div class="flex flex-wrap items-center gap-1.5">
        <span class="mr-1 text-xs text-faint">{t.commands.placeholders}</span>
        {#each PLACEHOLDERS as p (p)}
          <button
            type="button"
            class="rounded-md border border-line bg-panel px-1.5 py-0.5 font-mono text-xs hover:border-accent hover:text-accent disabled:opacity-40"
            disabled={p === "branch" && !current.branches}
            onclick={() => insert(p)}>{`{{${p}}}`}</button
          >
        {/each}
      </div>

      <div class="flex flex-col gap-2">
        <span class="text-sm font-medium">{t.commands.scope}</span>
        <div class="flex"><Segmented
          options={scopes}
          value={pickRepos ? "some" : "all"}
          label={t.commands.scope}
          onchange={(v) => {
            pickRepos = v === "some";
            if (!pickRepos && current) current.repos = [];
          }}
        /></div>
        {#if pickRepos}
          <div class="grid grid-cols-2 gap-x-4 gap-y-1.5">
            {#each repos as r (r.identity)}
              <Checkbox checked={current.repos.includes(r.identity)} label={r.name} onchange={() => toggleRepo(r.identity)} />
            {/each}
          </div>
        {/if}
        <Checkbox bind:checked={current.branches} label={t.commands.branches} />
        <Checkbox bind:checked={current.confirm} label={t.commands.confirm} />
      </div>

      <div class="flex flex-col gap-1.5">
        <div class="flex items-center gap-2">
          <span class="text-sm font-medium">{t.commands.preview}</span>
          <select
            bind:value={previewRepo}
            class="h-7 min-w-0 rounded-md border border-line-strong bg-input px-1.5 text-sm text-fg outline-none focus:border-accent"
            aria-label={t.commands.previewFor("")}
          >
            {#each scanResults.repos as r (r.info.path)}<option value={r.info.path}>{t.commands.previewFor(r.info.name)} · {scanResults.groupOf(r.info.path)?.labels[r.info.path] ?? folderLabel(r.info.root)}</option>{/each}
          </select>
          <span class="ml-auto"></span>
          <Button size="sm" icon={Play} disabled={!preview?.ok} onclick={testRun}>{t.commands.testRun}</Button>
        </div>
        {#if preview}
          <pre class="selectable max-h-40 overflow-auto rounded-lg border border-line bg-input px-2.5 py-2 font-mono text-xs whitespace-pre-wrap {preview.ok ? 'text-fg' : 'text-unsafe'}">{preview.text}</pre>
        {/if}
      </div>
    </section>
  {/if}
</div>
