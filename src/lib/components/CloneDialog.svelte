<script lang="ts">
  import { FolderOpen, TriangleAlert } from "@lucide/svelte";
  import { open as openDialog } from "@tauri-apps/plugin-dialog";
  import { api, explainError, isFailure, onOpProgress } from "$lib/api";
  import type { OpFailure } from "$lib/bindings/OpFailure";
  import { cloneTarget, folderNameProblem, repoNameFromUrl } from "$lib/cloneTarget";
  import { t } from "$lib/i18n/index.svelte";
  import { normalizePath } from "$lib/paths";
  import { dialogs } from "$lib/stores/dialogs.svelte";
  import { settings } from "$lib/stores/settings.svelte";
  import { toasts } from "$lib/stores/toasts.svelte";
  import { scanner } from "$lib/services/scanner.svelte";
  import { repoActions } from "$lib/services/repoActions.svelte";
  import Button from "$lib/ui/Button.svelte";
  import IconButton from "$lib/ui/IconButton.svelte";
  import Input from "$lib/ui/Input.svelte";
  import Modal from "$lib/ui/Modal.svelte";
  import PathText from "$lib/ui/PathText.svelte";
  import { fullText } from "$lib/ui/tooltip";

  let url = $state("");
  let parent = $state(dialogs.cloneOpen?.parent ?? settings.config?.roots[0] ?? "");
  /** Follows the address until the user types a name of their own. */
  let typedName = $state<string | null>(null);
  let phase = $state<"edit" | "running" | "done">("edit");
  let progress = $state<{ phase: string; percent: number | null } | null>(null);
  let failure = $state<OpFailure | null>(null);
  let id = "";

  const name = $derived(typedName ?? repoNameFromUrl(url));
  const nameProblem = $derived(url.trim() && name ? folderNameProblem(name) : null);
  const target = $derived(cloneTarget(parent, name));
  const ready = $derived(!!url.trim() && !!target && !nameProblem);
  const underRoots = $derived(repoActions.underRoots(target));
  const message = $derived(failure ? explainError(failure) : null);

  async function pick() {
    const dir = await openDialog({ directory: true, defaultPath: parent || undefined });
    if (typeof dir === "string") parent = dir;
  }

  async function start() {
    phase = "running";
    failure = null;
    progress = null;
    id = `clone-${Date.now()}`;
    const stop = await onOpProgress((p) => p.id === id && (progress = { phase: p.phase, percent: p.percent }));
    try {
      await api.gitClone(url.trim(), target, id);
    } catch (e) {
      stop();
      phase = "edit";
      // A stop the user asked for is no failure.
      if (isFailure<OpFailure>(e) && e.kind === "Cancelled") return;
      if (isFailure<OpFailure>(e)) failure = e;
      else toasts.fail(e);
      return;
    }
    stop();
    phase = "done";
    // The new repo must be found: under a listed folder the scan sees it, elsewhere it becomes a folder of its own.
    if (underRoots) await scanner.scan(false);
    else await repoActions.addRoot(target);
  }

  const close = () => (dialogs.cloneOpen = null);
</script>

<Modal open title={t.clone.title} width="620px" onclose={close} dismissible={phase !== "running"}>
  <p class="-mt-1 mb-4 t-meta">{t.clone.intro}</p>

  <form
    id="clone-form"
    class="flex flex-col gap-4"
    onsubmit={(e) => {
      e.preventDefault();
      if (ready && phase === "edit") start();
    }}
  >
    <fieldset class="flex flex-col gap-4" disabled={phase !== "edit"}>
      <Input label={t.clone.url} bind:value={url} hint={t.clone.urlHint} mono spellcheck={false} autocomplete="off" data-autofocus />
      <div class="flex items-end gap-2">
        <Input class="min-w-0 flex-1" label={t.clone.folder} bind:value={parent} hint={t.clone.folderHint} mono spellcheck={false} />
        <IconButton icon={FolderOpen} label={t.clone.pickFolder} class="mb-5" onclick={pick} />
      </div>
      <Input
        label={t.clone.name}
        value={name}
        oninput={(e) => (typedName = (e.currentTarget as HTMLInputElement).value)}
        mono
        spellcheck={false}
        error={nameProblem ? t.clone.nameInvalid : null}
      />
    </fieldset>
  </form>

  {#if target && !nameProblem}
    <p class="mt-4 flex min-w-0 flex-wrap items-center gap-x-1.5 text-sm text-muted">{t.clone.target} <PathText path={normalizePath(target)} class="text-fg" /></p>
  {/if}

  {#if phase === "running"}
    <div class="mt-4 flex items-center gap-3">
      <span class="min-w-0 flex-1 truncate text-sm text-muted">{t.clone.cloning} {progress?.phase ?? ""}</span>
      <div class="h-1.5 w-40 overflow-hidden rounded-full bg-line">
        <div class="h-full bg-accent transition-[width] duration-200" style="width: {progress?.percent ?? 0}%"></div>
      </div>
    </div>
  {/if}
  {#if message}
    <div class="mt-4 flex items-start gap-2 rounded-lg bg-unsafe/10 px-3 py-2 text-sm text-unsafe-ink" role="alert">
      <TriangleAlert size={14} class="mt-0.5 shrink-0" />
      <span class="min-w-0 flex-1">
        {message.text}
        {#if failure?.detail}<span class="block max-h-24 overflow-y-auto font-mono text-xs text-muted" use:fullText={failure.detail}>{failure.detail}</span>{/if}
      </span>
    </div>
  {/if}
  {#if phase === "done"}
    <p class="mt-4 text-sm text-safe">{t.clone.done(name)}</p>
    <p class="mt-1 text-sm text-muted">{underRoots ? t.clone.scanned : t.clone.addedRoot}</p>
  {/if}

  {#snippet footer()}
    {#if phase === "done"}
      <Button variant="ghost" icon={FolderOpen} onclick={() => toasts.safely(() => api.openFolder(target))}>{t.clone.openFolder}</Button>
      <Button variant="primary" data-autofocus onclick={close}>{t.common.close}</Button>
    {:else if phase === "running"}
      <Button variant="ghost" tip={t.clone.stopTip} onclick={() => toasts.safely(() => api.gitCancel(id))}>{t.clone.stop}</Button>
    {:else}
      <Button variant="ghost" onclick={close}>{t.common.cancel}</Button>
      <Button variant="primary" form="clone-form" type="submit" tip={t.clone.startTip} disabled={!ready}>{t.clone.start}</Button>
    {/if}
  {/snippet}
</Modal>
