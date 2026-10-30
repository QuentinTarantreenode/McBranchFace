<script lang="ts">
  import { GitBranchPlus } from "@lucide/svelte";
  import { t } from "$lib/i18n/index.svelte";
  import Button from "$lib/ui/Button.svelte";
  import Checkbox from "$lib/ui/Checkbox.svelte";
  import Input from "$lib/ui/Input.svelte";
  import Modal from "$lib/ui/Modal.svelte";
  import Radio from "$lib/ui/Radio.svelte";
  import { fullText } from "$lib/ui/tooltip";
  import { gitStore } from "./gitStore.svelte";
  import { api } from "$lib/api";
  import { Latest } from "$lib/latest";
  import { debounced } from "$lib/ui/delay.svelte";

  const c = $derived(gitStore.confirm);

  function act(fn: () => unknown) {
    gitStore.confirm = null;
    fn();
  }

  // ---- create branch
  let name = $state("");
  let fromCurrent = $state(true);
  let startRef = $state("");
  let switchTo = $state(true);
  $effect(() => {
    if (gitStore.createOpen) {
      name = "";
      fromCurrent = true;
      startRef = "";
      switchTo = true;
    }
  });

  // git's own rule decides while typing (check-ref-format in the backend), as for new working copies.
  let nameCheck = $state<{ name: string; invalid: boolean; exists: boolean } | null>(null);
  const nameChecks = new Latest();
  debounced(
    () => name,
    180,
    (typed) => {
      const repo = gitStore.repo;
      const current = nameChecks.next();
      if (!typed.trim() || !repo) return;
      api.checkCopyTargets(repo, "Clone", [{ path: "", branch: typed, create: true }]).then(
        ([c]) => current() && c && (nameCheck = { name: typed, invalid: c.nameInvalid, exists: c.branchExists }),
        () => {},
      );
    },
  );
  const nameProblem = $derived.by(() => {
    const n = name.trim();
    if (!n) return null;
    if (gitStore.branches?.local.some((b) => b.name === n)) return t.git.nameExists;
    const c = nameCheck?.name === name ? nameCheck : null;
    if (c?.invalid) return t.git.nameInvalid;
    if (c?.exists) return t.git.nameExists;
    return null;
  });
  const canCreate = $derived(!!name.trim() && !nameProblem && (fromCurrent || !!startRef.trim()) && !gitStore.busy);

  function create() {
    if (canCreate) gitStore.createBranch(name.trim(), fromCurrent ? null : startRef.trim(), switchTo);
  }
</script>

<Modal open={c !== null} title={c?.title ?? ""} tone={c?.danger ? "danger" : "default"} width="560px" onclose={() => (gitStore.confirm = null)}>
  {#if c}
    <p class="text-base leading-relaxed text-muted">{c.text}</p>
    {#if c.items.length}
      <ul class="mt-3 max-h-48 overflow-y-auto rounded-lg border border-line bg-panel-2/50 px-3 py-2 font-mono text-sm">
        {#each c.items as item (item)}<li class="truncate py-0.5" use:fullText={item}>{item}</li>{/each}
      </ul>
    {/if}
  {/if}
  {#snippet footer()}
    <Button variant="ghost" onclick={() => (gitStore.confirm = null)}>{t.common.cancel}</Button>
    {#if c?.alt}
      {@const alt = c.alt}
      <Button onclick={() => act(alt.run)}>{alt.label}</Button>
    {/if}
    {#if c}
      {@const run = c.run}
      <Button variant={c.danger ? "danger" : "primary"} data-autofocus onclick={() => act(run)}>{c.action}</Button>
    {/if}
  {/snippet}
</Modal>

<Modal open={gitStore.createOpen} title={t.git.createTitle} width="520px" onclose={() => (gitStore.createOpen = false)}>
  <div class="flex flex-col gap-5">
    <Input
      label={t.git.name}
      mono
      data-autofocus
      bind:value={name}
      placeholder={t.git.namePlaceholder}
      spellcheck="false"
      error={nameProblem}
      hint={t.git.nameHint}
      onkeydown={(e) => e.key === "Enter" && create()}
    />
    <fieldset class="flex flex-col gap-2">
      <legend class="mb-2 text-sm font-medium">{t.git.startPoint}</legend>
      <Radio name="start" bind:group={fromCurrent} value={true} label={t.git.fromHead} />
      <Radio name="start" bind:group={fromCurrent} value={false} label={t.git.fromOther} />
      {#if !fromCurrent}
        <div class="ml-[26px]"><Input mono bind:value={startRef} placeholder={t.git.startPlaceholder} aria-label={t.git.fromOther} spellcheck="false" /></div>
      {/if}
    </fieldset>
    <Checkbox bind:checked={switchTo} label={t.git.switchAfter} />
  </div>
  {#snippet footer()}
    <Button variant="ghost" onclick={() => (gitStore.createOpen = false)}>{t.common.cancel}</Button>
    <Button variant="primary" icon={GitBranchPlus} disabled={!canCreate} tip={nameProblem ?? undefined} onclick={create}>{t.git.create}</Button>
  {/snippet}
</Modal>
