<script lang="ts">
  import { Latest } from "$lib/latest";
  import { gitStatus } from "$lib/stores/gitStatus.svelte";
  import { CircleCheck, CircleX, FolderOpen, LoaderCircle, TriangleAlert } from "@lucide/svelte";
  import { open as openDialog } from "@tauri-apps/plugin-dialog";
  import { api, explainError, onOpProgress } from "$lib/api";
  import type { BranchList } from "$lib/bindings/BranchList";
  import type { CopyKind } from "$lib/bindings/CopyKind";
  import type { CopyOutcome } from "$lib/bindings/CopyOutcome";
  import type { CopyTarget } from "$lib/bindings/CopyTarget";
  import type { TargetCheck } from "$lib/bindings/TargetCheck";
  import { t } from "$lib/i18n/index.svelte";
  import { commonParent, normalizePath, pathKey } from "$lib/paths";
  import BranchName from "$lib/ui/BranchName.svelte";
  import Button from "$lib/ui/Button.svelte";
  import IconButton from "$lib/ui/IconButton.svelte";
  import Input from "$lib/ui/Input.svelte";
  import Modal from "$lib/ui/Modal.svelte";
  import Panel from "$lib/ui/Panel.svelte";
  import PathText from "$lib/ui/PathText.svelte";
  import { fullText } from "$lib/ui/tooltip";
  import Radio from "$lib/ui/Radio.svelte";
  import Segmented from "$lib/ui/Segmented.svelte";
  import { debounced } from "$lib/ui/delay.svelte";
  import RepoName from "./RepoName.svelte";
  import { toasts } from "$lib/stores/toasts.svelte";
  import { settings } from "$lib/stores/settings.svelte";
  import { dialogs } from "$lib/stores/dialogs.svelte";
  import { scanResults } from "$lib/stores/scanResults.svelte";
  import { scanner } from "$lib/services/scanner.svelte";
  import { repoActions } from "$lib/services/repoActions.svelte";

  const MAX = 8;
  const repo = dialogs.copiesFor!.repoPath;
  const given = dialogs.copiesFor!.branch;
  const info = scanResults.repoByPath.get(repo);

  let kind = $state<CopyKind>("Worktree");
  let count = $state(1);
  let mode = $state<"new" | "existing">(given ? "existing" : "new");
  let template = $state("agent/{n}");
  let start = $state(info?.defaultBranch ?? "HEAD");
  let existing = $state(given ?? "");
  let folders = $state<string[]>([]);
  /** Rows the user typed or picked a folder for; a new count keeps them. */
  const edited = new Set<number>();
  let branches = $state<BranchList | null>(null);
  let checks = $state<TargetCheck[]>([]);
  let phase = $state<"edit" | "running" | "done">("edit");
  let progress = $state<{ phase: string; percent: number | null } | null>(null);
  let outcomes = $state<CopyOutcome[]>([]);

  api.branchList(repo).then(
    (b) => {
      branches = b;
      // Work for agents starts from the server state, not from a possibly stale local branch.
      const def = info?.defaultBranch;
      if (def && b.remote.some((r) => r.name === `origin/${def}`)) start = `origin/${def}`;
    },
    // Without the list the start can still be typed; why it is missing is said.
    (e) => toasts.fail(e),
  );

  // Late answers of an older count or target list must not overwrite a newer one.
  const folderAnswers = new Latest();
  $effect(() => {
    const n = count;
    const current = folderAnswers.next();
    api.freeCopyFolders(repo, "agent", MAX).then((free) => {
      if (current()) folders = Array.from({ length: n }, (_, i) => (edited.has(i) && folders[i]) || free[i] || "");
    }, (e) => toasts.fail(e));
  });

  // {n} follows the folder ("…-agent-3" → agent/3), so folder and branch of a copy match.
  const numberOf = (path: string, i: number) => Number(/-(\d+)$/.exec(path)?.[1] ?? i + 1);

  const targets = $derived<CopyTarget[]>(
    folders.map((path, i) => ({ path, branch: mode === "new" ? template.replaceAll("{n}", String(numberOf(path, i))) : existing.trim(), create: mode === "new" })),
  );

  const checkAnswers = new Latest();
  debounced(
    () => ({ list: $state.snapshot(targets) as CopyTarget[], k: kind, current: checkAnswers.next() }),
    180,
    ({ list, k, current }) =>
      api.checkCopyTargets(repo, k, list).then((c) => {
        if (current()) checks = c;
      }, () => {}),
  );

  const known = $derived(new Set([...(branches?.local ?? []).map((b) => b.name), ...(branches?.remote ?? []).map((b) => b.name.replace(/^origin\//, ""))]));
  const sameBranchTwice = $derived(kind === "Worktree" && mode === "existing" && count > 1);

  function issue(i: number): string | null {
    const tg = targets[i];
    const c = checks[i];
    if (!tg?.path.trim()) return t.copies.taken;
    const norm = (p: string) => pathKey(normalizePath(p));
    if (targets.some((x, j) => j < i && norm(x.path) === norm(tg.path))) return t.copies.duplicateFolder;
    if (mode === "new" && targets.some((x, j) => j < i && x.branch === tg.branch)) return t.copies.duplicateBranch;
    if (!c) return null;
    if (c.pathTaken) return t.copies.taken;
    if (c.nameInvalid) return t.copies.invalid;
    // A clone has branches of its own; only a worktree shares them with the original.
    if (mode === "new" && kind === "Worktree" && c.branchExists) return t.copies.branchTaken;
    if (mode === "existing" && branches && !c.branchExists && !known.has(tg.branch)) return t.copies.missingBranch;
    if (c.checkedOutAt) return t.copies.checkedOutAt(normalizePath(c.checkedOutAt));
    return null;
  }

  const issues = $derived(targets.map((_, i) => issue(i)));
  const blocked = $derived(sameBranchTwice || issues.some(Boolean) || checks.length !== targets.length || !targets.length);

  const q = (p: string) => `"${normalizePath(p)}"`;
  const commandLines = $derived(
    targets.map((tg) =>
      kind === "Worktree"
        ? tg.create
          ? `git worktree add -b ${tg.branch} ${q(tg.path)} ${start}`
          : `git worktree add ${q(tg.path)} ${tg.branch}`
        : `git clone ${q(repo)} ${q(tg.path)} && git switch ${tg.create ? `-c ${tg.branch} ${start}` : tg.branch}`,
    ),
  );

  /** Folder and name of a target, in one separator style; the rows edit the name only. */
  function split(p: string) {
    const n = normalizePath(p);
    const i = Math.max(n.lastIndexOf("\\"), n.lastIndexOf("/"));
    return i < 0 ? { dir: "", name: n } : { dir: n.slice(0, i), name: n.slice(i + 1) };
  }
  const join = (dir: string, name: string) => (dir ? `${dir}${dir.includes("/") && !dir.includes("\\") ? "/" : "\\"}${name}` : name);
  const shared = $derived.by(() => {
    const dirs = [...new Set(folders.map((f) => split(f).dir))];
    return dirs.length === 1 ? dirs[0] : null;
  });

  async function pick(i: number) {
    const dir = await openDialog({ directory: true, defaultPath: folders[i] || undefined });
    if (typeof dir === "string") {
      edited.add(i);
      folders[i] = dir;
    }
  }

  const created = $derived(outcomes.filter((o) => !o.failure));
  const outside = $derived(kind === "Clone" && created.length > 0 && !created.every((o) => repoActions.underRoots(o.path)));
  const parent = $derived(commonParent(created.map((o) => o.path)) || normalizePath(created[0]?.path ?? "").replace(/[\\/][^\\/]+$/, ""));

  async function create() {
    phase = "running";
    const id = `copies-${Date.now()}`;
    const stop = await onOpProgress((p) => p.id === id && (progress = { phase: p.phase, percent: p.percent }));
    try {
      outcomes = await api.createWorkingCopies(repo, kind, start.trim(), $state.snapshot(targets) as CopyTarget[], id);
    } catch (e) {
      toasts.fail(e);
      outcomes = [];
    } finally {
      stop();
    }
    phase = "done";
    // The dialog shows the result itself; a toast would say it twice.
    const ok = outcomes.filter((o) => !o.failure).length;
    await gitStatus.refreshStatus(repo);
    await scanner.rescan(repo);
    if (kind === "Clone" && ok && !outside) await scanner.scan(false);
  }

  const close = () => (dialogs.copiesFor = null);
  const kinds = $derived([
    { id: "Worktree" as CopyKind, label: t.copies.worktree },
    { id: "Clone" as CopyKind, label: t.copies.clone },
  ]);
  const counts = Array.from({ length: MAX }, (_, i) => ({ id: String(i + 1), label: String(i + 1) }));
</script>

<Modal open title={t.copies.title} width="680px" resizable {...settings.dialogSize("copies")} onclose={close} dismissible={phase !== "running"}>
  <p class="-mt-1 mb-4 flex flex-wrap items-center gap-x-1.5 t-meta"><RepoName path={repo} /> · {t.copies.intro}</p>

  <fieldset class="flex flex-col gap-4" disabled={phase !== "edit"}>
    <div class="grid grid-cols-[110px_minmax(0,1fr)] items-start gap-x-4 gap-y-3">
      <span class="pt-1.5 text-sm font-medium text-muted">{t.copies.kind}</span>
      <div class="flex flex-col items-start gap-1">
        <Segmented options={kinds} value={kind} onchange={(v) => (kind = v)} label={t.copies.kind} />
        <p class="text-sm text-faint">{kind === "Worktree" ? t.copies.worktreeHint : t.copies.cloneHint}</p>
      </div>

      <span class="pt-1.5 text-sm font-medium text-muted">{t.copies.count}</span>
      <div class="flex items-start">
        <Segmented options={counts} value={String(count)} onchange={(v) => (count = Number(v))} label={t.copies.count} />
      </div>

      <span class="pt-0.5 text-sm font-medium text-muted">{t.copies.branch}</span>
      <div class="flex flex-col gap-2">
        <div class="flex flex-wrap gap-x-5 gap-y-1">
          <Radio bind:group={mode} value="new" name="copy-branch" label={t.copies.newBranch} />
          <Radio bind:group={mode} value="existing" name="copy-branch" label={t.copies.existingBranch} />
        </div>
        {#if mode === "new"}
          <div class="grid grid-cols-2 gap-3">
            <Input label={t.copies.template} bind:value={template} mono hint={t.copies.templateHint} spellcheck={false} />
            <Input label={t.copies.start} bind:value={start} mono list="copy-branches" spellcheck={false} />
          </div>
        {:else}
          <Input label={t.copies.existing} bind:value={existing} mono list="copy-branches" spellcheck={false} error={sameBranchTwice ? t.copies.oneWorktreePerBranch : null} />
        {/if}
        <datalist id="copy-branches">
          {#each branches?.local ?? [] as b (b.fullRef)}<option value={b.name}></option>{/each}
          {#each branches?.remote ?? [] as b (b.fullRef)}<option value={b.name}></option>{/each}
        </datalist>
      </div>

      <span class="pt-2 text-sm font-medium text-muted">{t.copies.folders}</span>
      <div class="flex min-w-0 flex-col gap-1.5">
        <p class="text-sm text-faint">
          {t.copies.foldersHint}
          {#if shared}<span class="block text-xs text-muted">{t.copies.inFolder} <PathText path={shared} /></span>{/if}
        </p>
        <ul class="flex flex-col gap-1.5">
          {#each folders as f, i (i)}
            {@const o = outcomes[i]}
            {@const at = split(f)}
            <li class="rounded-lg bg-panel-2/60 px-3 py-2">
              <div class="flex items-center gap-2">
                <span class="grid size-5 shrink-0 place-items-center rounded-full text-xs font-semibold tabular-nums {o || phase === 'running' ? '' : 'bg-accent/10 text-accent-ink'}">
                  {#if o}{#if o.failure}<CircleX size={14} class="text-unsafe" />{:else}<CircleCheck size={14} class="text-safe" />{/if}
                  {:else if phase === "running"}<LoaderCircle size={14} class="animate-spin text-accent" />
                  {:else}{i + 1}{/if}
                </span>
                <Input
                  class="min-w-0 flex-1"
                  value={at.name}
                  mono
                  spellcheck={false}
                  aria-label={t.copies.folderName(i + 1)}
                  oninput={(e) => {
                    edited.add(i);
                    folders[i] = join(at.dir, (e.currentTarget as HTMLInputElement).value);
                  }}
                />
                <IconButton icon={FolderOpen} size="sm" label={t.copies.pickFolder} onclick={() => pick(i)} />
              </div>
              {#if at.dir !== shared}<p class="mt-1 pl-6 text-xs text-faint"><PathText path={at.dir} /></p>{/if}
              <div class="mt-1 flex min-w-0 items-center gap-1.5 pl-6 text-xs">
                {#if o?.failure}
                  <span class="shrink-0 text-unsafe">{explainError(o.failure).text}</span>
                  {#if o.failure.detail}<span class="min-w-0 truncate font-mono text-faint" use:fullText={o.failure.detail}>{o.failure.detail}</span>{/if}
                {:else if issues[i] && phase === "edit"}
                  <TriangleAlert size={12} class="shrink-0 text-review" /><span class="text-review">{issues[i]}</span>
                {:else if targets[i]?.branch}
                  <span class="text-faint">→</span><span class="flex min-w-0"><BranchName name={targets[i].branch} size="xs" /></span>
                {/if}
              </div>
            </li>
          {/each}
        </ul>
      </div>
    </div>

    <Panel title={t.copies.commands} open={false}>
      <pre class="selectable overflow-x-auto rounded-lg bg-input px-3 py-2 font-mono text-xs leading-5 text-muted">{commandLines.join("\n")}</pre>
    </Panel>
  </fieldset>

  {#if phase === "running" && progress}
    <div class="mt-4 flex items-center gap-3">
      <span class="min-w-0 flex-1 truncate text-sm text-muted">{t.copies.creating} {progress.phase}</span>
      <div class="h-1.5 w-40 overflow-hidden rounded-full bg-line">
        <div class="h-full bg-accent transition-[width] duration-200" style="width: {progress.percent ?? 0}%"></div>
      </div>
    </div>
  {/if}
  {#if phase === "done"}
    <p class="mt-4 text-sm {created.length === outcomes.length ? 'text-safe' : 'text-review'}">
      {created.length === outcomes.length ? t.copies.done(created.length) : t.copies.partly(created.length, outcomes.length)}
    </p>
    {#if outside}
      <div class="mt-2 flex items-start gap-2 rounded-lg bg-review/10 px-3 py-2 text-sm text-review-ink">
        <TriangleAlert size={14} class="mt-0.5 shrink-0" />
        <span class="min-w-0 flex-1">{t.copies.outsideRoots} <PathText path={parent} class="text-xs text-muted" /></span>
      </div>
    {/if}
  {/if}

  {#snippet footer()}
    {#if phase === "done"}
      {#if outside}<Button onclick={() => repoActions.addRoot(parent)}>{t.copies.addRoot}</Button>{/if}
      {#if created.length}<Button variant="ghost" icon={FolderOpen} onclick={() => toasts.safely(() => api.openFolder(created[0].path))}>{t.copies.openFolder}</Button>{/if}
      <Button variant="primary" data-autofocus onclick={close}>{t.common.close}</Button>
    {:else}
      <Button variant="ghost" disabled={phase === "running"} onclick={close}>{t.common.cancel}</Button>
      <Button variant="primary" disabled={blocked || phase === "running"} onclick={create}>{t.copies.create(count)}</Button>
    {/if}
  {/snippet}
</Modal>
