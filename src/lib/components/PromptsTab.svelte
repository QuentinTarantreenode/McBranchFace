<script lang="ts">
  import { untrack } from "svelte";
  import { ArrowDown, ArrowUp, Braces, Copy, FileText, Plus, RotateCcw, Trash2 } from "@lucide/svelte";
  import { i18n, t } from "$lib/i18n/index.svelte";
  import type { Config } from "$lib/bindings/Config";
  import type { PromptScope } from "$lib/bindings/PromptScope";
  import type { PromptTemplate } from "$lib/bindings/PromptTemplate";
  import type { BranchReport } from "$lib/bindings/BranchReport";
  import type { RemoteBranchReport } from "$lib/bindings/RemoteBranchReport";
  import { branchKey, onlineKey } from "$lib/filter";
  import { buildPrompt, defaultBody, describe, PROMPT_TEXT, PROMPT_VARIABLES, type PromptKind } from "$lib/prompts";
  import Button from "$lib/ui/Button.svelte";
  import Checkbox from "$lib/ui/Checkbox.svelte";
  import IconButton from "$lib/ui/IconButton.svelte";
  import Input from "$lib/ui/Input.svelte";
  import Segmented from "$lib/ui/Segmented.svelte";
  import { openBelow } from "$lib/ui/menu.svelte";
  import { BUILTIN_OF } from "$lib/promptKinds";
  import { fits, promptContext } from "./promptMenu";
  import { scanResults } from "$lib/stores/scanResults.svelte";
  import { branchCommits } from "$lib/stores/branchCommits.svelte";
  import { cleanupView } from "$lib/stores/cleanupView.svelte";

  /**
   * Prompt templates: the four built-in ones, whose text can be changed and reset, and the user's own.
   * Edits go into the settings draft; the preview renders at once against a real branch.
   */
  let { draft = $bindable() }: { draft: Config } = $props();

  const x = $derived(PROMPT_TEXT[i18n.lang]);
  const KINDS: PromptKind[] = ["merge", "pr", "cleanup", "rebase"];
  type Selection = { builtin: PromptKind } | { id: string };
  let selected = $state<Selection>({ builtin: "merge" });

  const override = (kind: PromptKind) => draft.prompts.find((p) => p.builtin === BUILTIN_OF[kind]);
  const own = $derived(draft.prompts.filter((p) => !p.builtin));
  const custom = $derived("id" in selected ? (own.find((p) => p.id === (selected as { id: string }).id) ?? null) : null);
  const kind = $derived("builtin" in selected ? selected.builtin : null);
  const body = $derived(kind ? (override(kind)?.body ?? defaultBody(kind, i18n.lang)) : (custom?.body ?? ""));

  /** A built-in text back at its default is no override: it follows the shipped text again. */
  function setBody(text: string) {
    if (custom) {
      custom.body = text;
      return;
    }
    if (!kind) return;
    const rest = draft.prompts.filter((p) => p.builtin !== BUILTIN_OF[kind]);
    const same = text === defaultBody(kind, i18n.lang);
    draft.prompts = same ? rest : [...rest, { id: `builtin-${kind}`, name: "", body: text, scope: "Both", needsOwnCommits: false, builtin: BUILTIN_OF[kind] }];
  }

  function add(from?: string) {
    const id = `prompt-${Date.now().toString(36)}`;
    const p: PromptTemplate = { id, name: from ? `${nameOf(selected)} 2` : x.ui.unnamed, body: from ?? "{{goal.merge}}\n\n{{situation}}\n\n{{rules}}\n", scope: "Both", needsOwnCommits: false, builtin: null };
    draft.prompts = [...draft.prompts, p];
    selected = { id };
  }
  function remove(id: string) {
    const i = own.findIndex((p) => p.id === id);
    draft.prompts = draft.prompts.filter((p) => p.id !== id);
    const next = own[Math.min(i, own.length - 1)];
    selected = next ? { id: next.id } : { builtin: "merge" };
  }
  function move(id: string, d: number) {
    const list = [...draft.prompts];
    const i = list.findIndex((p) => p.id === id);
    // Moves among the user's own templates only; the built-in overrides keep no order.
    let j = i + d;
    while (j >= 0 && j < list.length && list[j].builtin) j += d;
    if (i < 0 || j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    draft.prompts = list;
  }
  const nameOf = (s: Selection) => ("builtin" in s ? t.prompt[s.builtin] : (own.find((p) => p.id === s.id)?.name ?? ""));
  const isSelected = (s: Selection) => ("builtin" in s && "builtin" in selected ? s.builtin === selected.builtin : "id" in s && "id" in selected && s.id === selected.id);

  let bodyEl: HTMLTextAreaElement | undefined = $state();
  function insert(name: string) {
    if (!bodyEl) return;
    const token = `{{${name}}}`;
    const [a, b] = [bodyEl.selectionStart, bodyEl.selectionEnd];
    setBody(body.slice(0, a) + token + body.slice(b));
    queueMicrotask(() => {
      bodyEl?.focus();
      bodyEl?.setSelectionRange(a + token.length, a + token.length);
    });
  }

  // The preview renders against a branch the template is offered on: the selected one, else the first.
  const candidates = $derived<(BranchReport | RemoteBranchReport)[]>([...scanResults.allBranches, ...(scanResults.allOnline ?? [])]);
  const keyOf = (b: BranchReport | RemoteBranchReport) => ("remote" in b ? onlineKey(b) : branchKey(b));
  let previewKey = $state<string | null>(untrack(() => (cleanupView.selected ? keyOf(cleanupView.selected) : null)));
  const offered = $derived(custom ? candidates.filter((b) => fits(custom, b)) : candidates);
  const previewBranch = $derived(offered.find((b) => keyOf(b) === previewKey) ?? offered[0] ?? null);
  const preview = $derived(previewBranch ? buildPrompt(body, promptContext(previewBranch)) : null);
  // The preview lists the own commits as the copied prompt does: read once the branch is shown.
  $effect(() => {
    if (previewBranch && !("remote" in previewBranch) && previewBranch.ownCommitCount) branchCommits.ensure(previewBranch);
  });

  const scopes = $derived<{ id: PromptScope; label: string }[]>([
    { id: "Local", label: x.ui.scopeLocal },
    { id: "Online", label: x.ui.scopeOnline },
    { id: "Both", label: x.ui.scopeBoth },
  ]);
  // One submenu per group, every variable with what it holds as its hint: 40 chips were a wall.
  function variableMenu(e: MouseEvent) {
    const groups = [...new Set(PROMPT_VARIABLES.map((v) => v.group))];
    openBelow(
      e.currentTarget as HTMLElement,
      groups.map((g) => ({
        label: x.ui.groups[g],
        run: () => {},
        submenu: PROMPT_VARIABLES.filter((v) => v.group === g).map((v) => ({ label: `{{${v.name}}}`, hint: describe(v.name, i18n.lang), run: () => insert(v.name) })),
      })),
      x.ui.insert,
    );
  }
</script>

<div class="flex flex-col gap-4">
  <section>
    <div class="mb-2 flex items-center justify-between">
      <h3 class="t-section">{x.ui.templates}</h3>
      <Button size="sm" icon={Plus} onclick={() => add()}>{x.ui.add}</Button>
    </div>
    <ul class="zebra flex flex-col overflow-hidden rounded-lg border border-line">
      <li class="px-2 pt-2 pb-1 t-meta">{x.ui.builtin}</li>
      {#each KINDS as k (k)}
        <li class="flex items-center gap-2 py-1 pr-1 pl-2 {isSelected({ builtin: k }) ? '!bg-accent/10' : ''}">
          <button type="button" class="flex min-w-0 flex-1 items-center gap-2 py-1 text-left" onclick={() => (selected = { builtin: k })}>
            <span class="truncate text-base font-medium">{t.prompt[k]}</span>
            {#if override(k)}<span class="rounded bg-accent/12 px-1.5 text-xs text-accent-ink">{x.ui.changed}</span>{/if}
          </button>
          <IconButton icon={Copy} size="sm" label={x.ui.duplicate} onclick={() => add(override(k)?.body ?? defaultBody(k, i18n.lang))} />
        </li>
      {/each}
      <li class="px-2 pt-2 pb-1 t-meta">{x.ui.own}</li>
      {#each own as p (p.id)}
        <li class="flex items-center gap-2 py-1 pr-1 pl-2 {isSelected({ id: p.id }) ? '!bg-accent/10' : ''}">
          <button type="button" class="flex min-w-0 flex-1 items-center gap-2 py-1 text-left" onclick={() => (selected = { id: p.id })}>
            <FileText size={14} class="shrink-0 text-faint" />
            <span class="truncate text-base font-medium">{p.name}</span>
            <span class="min-w-0 flex-1 truncate font-mono text-xs text-faint">{p.body.split("\n")[0]}</span>
          </button>
          <IconButton icon={ArrowUp} size="sm" label={t.commands.moveUp} onclick={() => move(p.id, -1)} />
          <IconButton icon={ArrowDown} size="sm" label={t.commands.moveDown} onclick={() => move(p.id, 1)} />
          <IconButton icon={Copy} size="sm" label={x.ui.duplicate} onclick={() => add(p.body)} />
          <IconButton icon={Trash2} size="sm" tone="danger" label={x.ui.remove} onclick={() => remove(p.id)} />
        </li>
      {/each}
      {#if !own.length}<li class="px-3 py-2 t-meta">{x.ui.empty}</li>{/if}
    </ul>
  </section>

  <section class="flex flex-col gap-3 rounded-xl bg-panel-2/60 p-4">
    {#if custom}
      <Input label={x.ui.name} bind:value={custom.name} maxlength={60} />
      <div class="grid grid-cols-[max-content_minmax(0,1fr)] items-center gap-x-4 gap-y-3">
        <span class="text-sm font-medium">{x.ui.scope}</span>
        <div class="flex"><Segmented options={scopes} value={custom.scope} onchange={(v) => custom && (custom.scope = v)} label={x.ui.scope} /></div>
      </div>
      <Checkbox bind:checked={custom.needsOwnCommits} label={x.ui.needsOwn} />
    {:else if kind}
      <div class="flex items-center gap-2">
        <h3 class="text-base font-semibold">{t.prompt[kind]}</h3>
        <span class="ml-auto"></span>
        <Button size="sm" variant="ghost" icon={RotateCcw} disabled={!override(kind)} onclick={() => kind && setBody(defaultBody(kind, i18n.lang))}>{x.ui.reset}</Button>
      </div>
    {/if}

    <label class="block">
      <span class="mb-1 block text-sm font-medium">{x.ui.body}</span>
      <textarea
        bind:this={bodyEl}
        value={body}
        oninput={(e) => setBody((e.currentTarget as HTMLTextAreaElement).value)}
        rows="10"
        spellcheck="false"
        class="block w-full resize-y rounded-lg border border-line-strong bg-input px-2.5 py-2 font-mono text-sm text-fg outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
      ></textarea>
    </label>
    <div class="flex">
      <Button size="sm" icon={Braces} tip={x.ui.insertTip} aria-haspopup="menu" onclick={variableMenu}>{x.ui.insert}</Button>
    </div>

    <div class="flex flex-col gap-1.5">
      <div class="flex items-center gap-2">
        <span class="text-sm font-medium">{x.ui.preview}</span>
        {#if offered.length}
          <select
            value={previewBranch ? keyOf(previewBranch) : ""}
            onchange={(e) => (previewKey = (e.currentTarget as HTMLSelectElement).value)}
            class="h-7 min-w-0 flex-1 rounded-md border border-line-strong bg-input px-1.5 text-sm text-fg outline-none focus:border-accent"
            aria-label={x.ui.previewFor}
          >
            {#each offered.slice(0, 300) as b (keyOf(b))}<option value={keyOf(b)}>{"remote" in b ? `${b.remote}/${b.name}` : b.name} · {scanResults.repoByPath.get(b.repoPath)?.name ?? ""}</option>{/each}
          </select>
        {/if}
      </div>
      {#if preview}
        {#if preview.unknown.length}<p class="text-sm text-unsafe">{x.ui.unknown(preview.unknown.map((n) => `{{${n}}}`).join(", "))}</p>{/if}
        <pre class="selectable max-h-72 overflow-auto rounded-lg border border-line bg-input px-2.5 py-2 font-mono text-xs whitespace-pre-wrap text-fg">{preview.text}</pre>
      {:else}
        <p class="t-meta">{x.ui.noBranch}</p>
      {/if}
    </div>
  </section>
</div>
