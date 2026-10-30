<script lang="ts">
  import { Globe, Laptop, RotateCcw, Trash2 } from "@lucide/svelte";
  import { api } from "$lib/api";
  import { isStashEntry, isWorktreeEntry, onlineVerdictOf } from "$lib/deleted";
  import { repoName } from "$lib/filter";
  import { absoluteTime, relativeTime, shortSha } from "$lib/format";
  import { i18n, t } from "$lib/i18n/index.svelte";
  import { displayPath } from "$lib/paths";
  import BranchName from "$lib/ui/BranchName.svelte";
  import Button from "$lib/ui/Button.svelte";
  import IconButton from "$lib/ui/IconButton.svelte";
  import Modal from "$lib/ui/Modal.svelte";
  import { fullText, tooltip } from "$lib/ui/tooltip";
  import RepoName from "./RepoName.svelte";
  import VerdictBadge from "./VerdictBadge.svelte";
  import { settings } from "$lib/stores/settings.svelte";
  import { clock } from "$lib/stores/clock.svelte";
  import { dialogs } from "$lib/stores/dialogs.svelte";
  import { deletes } from "$lib/stores/deletes.svelte";
  import { deleting } from "$lib/services/deleting";

  /** Backups older than this are offered for removal together; nothing goes without being asked. */
  const OLD_DAYS = 90;
  const DAY = 24 * 3600;

  const restored = $derived(deletes.deleted.filter((d) => d.restoredAt !== null));
  const old = $derived(deletes.deleted.filter((d) => d.deletedAt < clock.now - OLD_DAYS * DAY));

  // What the backups take on disk, read again whenever the list changes while the dialog is open.
  let size = $state<number | null>(null);
  $effect(() => {
    if (!dialogs.deletedOpen || !deletes.deleted) return;
    let current = true;
    api
      .backupsSize()
      .then((bytes) => {
        if (current) size = bytes;
      })
      .catch(() => {
        if (current) size = null;
      });
    return () => {
      current = false;
    };
  });

  const UNITS = ["byte", "kilobyte", "megabyte", "gigabyte", "terabyte"] as const;
  function bytes(n: number): string {
    let unit = 0;
    let value = n;
    while (value >= 1024 && unit < UNITS.length - 1) {
      value /= 1024;
      unit++;
    }
    const digits = unit > 0 && value < 10 ? 1 : 0;
    return new Intl.NumberFormat(i18n.locale, { style: "unit", unit: UNITS[unit], unitDisplay: "short", maximumFractionDigits: digits }).format(value);
  }

  function purgeOld() {
    const ids = old.map((d) => d.id);
    dialogs.ask = { title: t.deleted.purgeOldTitle(ids.length), text: t.deleted.purgeOldText, action: t.deleted.purgeOldAction, danger: true, run: () => deleting.purge(ids) };
  }
</script>

<Modal open={dialogs.deletedOpen} title={t.deleted.title} width="760px" resizable {...settings.dialogSize("deleted")} onclose={() => (dialogs.deletedOpen = false)}>
  <p class="mb-3 text-sm leading-snug text-muted">
    {t.deleted.intro}
    {#if size !== null && size > 0}{t.deleted.size(bytes(size))}{/if}
  </p>
  <ul class="flex flex-col gap-1.5">
    {#each deletes.deleted as d (d.id)}
      {@const stash = isStashEntry(d)}
      {@const worktree = isWorktreeEntry(d)}
      <li class="flex items-center gap-3 rounded-lg bg-panel-2/60 px-3 py-2.5 {d.restoredAt ? 'opacity-55' : ''}">
        <!-- Where it was deleted: the leading icon, vertically centred. -->
        <span class="shrink-0 text-faint" use:tooltip={d.remote ? t.deleted.online : undefined}>
          {#if d.remote}<Globe size={15} />{:else}<Laptop size={15} />{/if}
        </span>
        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-2">
            {#if stash}
              {@const label = t.journal.stashEntry(d.droppedStashes[0]?.message ?? "")}
              <span class="min-w-0 truncate font-medium" use:fullText={label}>{label}</span>
            {:else if worktree}
              {@const label = t.journal.worktreeEntry(repoName(displayPath(d.removedWorktree ?? "")))}
              <span class="min-w-0 truncate font-medium" use:tooltip={{ path: d.removedWorktree ?? "" }}>{label}</span>
              {#if d.worktreeBranch}<BranchName name={d.worktreeBranch} class="text-muted" />{/if}
            {:else}
              <BranchName name={d.branch} remote={d.remote} class="font-medium" />
              {#if d.remote}<VerdictBadge online={onlineVerdictOf(d)} />{:else}<VerdictBadge verdict={d.verdict} />{/if}
            {/if}
            {#if d.forced}<span class="rounded bg-unsafe/12 px-1.5 text-xs font-semibold text-unsafe-ink">{t.deleted.forced}</span>{/if}
          </div>
          <!-- The repo as everywhere, with the copy it goes back into. -->
          <div class="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-1 t-meta">
            <RepoName path={d.repoPath} />{#if d.sha} · {shortSha(d.sha)}{/if} ·
            <span use:tooltip={absoluteTime(d.deletedAt)}>{relativeTime(d.deletedAt, clock.now)}</span>
            {#if d.droppedStashes.length && !stash} · {t.deleted.stashes(d.droppedStashes.length)}{/if}
            {#if d.removedWorktree && !worktree} · {t.deleted.worktreeRemoved}{/if}
            {#if d.restoredAt} · {t.deleted.restoredAt(relativeTime(d.restoredAt, clock.now))}{/if}
          </div>
        </div>
        {#if !d.restoredAt}
          <Button
            size="sm"
            icon={RotateCcw}
            tip={stash ? t.deleted.stashRestoreTip : worktree ? t.deleted.worktreeRestoreTip : d.remote ? t.deleted.restoreOnlineTip : t.deleted.restoreTip}
            onclick={() => deleting.restore([d.id])}
          >
            {t.deleted.restore}
          </Button>
        {/if}
        <IconButton
          icon={Trash2}
          size="sm"
          tone="danger"
          label={t.deleted.purge}
          hint={stash ? t.deleted.stashPurgeTip : worktree ? t.deleted.worktreePurgeTip : t.deleted.purgeTip}
          onclick={() => deleting.purge([d.id])}
        />
      </li>
    {:else}
      <li class="rounded-lg border border-dashed border-line-strong px-3 py-6 text-center t-meta">{t.deleted.empty}</li>
    {/each}
  </ul>

  {#snippet footer()}
    {#if restored.length || old.length}
      <div class="mr-auto flex flex-wrap gap-2">
        {#if restored.length}
          <Button variant="ghost" tip={t.deleted.purgeRestoredTip} onclick={() => deleting.purge(restored.map((d) => d.id))}>
            {t.deleted.purgeRestored(restored.length)}
          </Button>
        {/if}
        {#if old.length}
          <Button variant="ghost" tip={t.deleted.purgeOldTip} onclick={purgeOld}>{t.deleted.purgeOld}</Button>
        {/if}
      </div>
    {/if}
    <Button variant="primary" onclick={() => (dialogs.deletedOpen = false)}>{t.common.close}</Button>
  {/snippet}
</Modal>
