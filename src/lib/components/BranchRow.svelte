<script lang="ts">
  import { ArrowDownToLine, ArrowUpFromLine, EyeOff, ExternalLink, FolderOpen, GitPullRequest, Laptop, Lock, StickyNote, Trash2 } from "@lucide/svelte";
  import { tagColor } from "$lib/annotations";
  import { api } from "$lib/api";
  import type { BranchReport } from "$lib/bindings/BranchReport";
  import { unpushedView } from "$lib/commitViews";
  import { needsForce } from "$lib/filter";
  import { absoluteTime, relativeTime } from "$lib/format";
  import { t } from "$lib/i18n/index.svelte";
  import { branchUrl } from "$lib/links";
  import { identities } from "$lib/stores/identities.svelte";
  import type { ColumnId } from "$lib/table/columns";
  import type { BranchRow } from "$lib/table/rows";
  import BranchName from "$lib/ui/BranchName.svelte";
  import Checkbox from "$lib/ui/Checkbox.svelte";
  import IconButton from "$lib/ui/IconButton.svelte";
  import IconChip from "$lib/ui/IconChip.svelte";
  import { contextmenu } from "$lib/ui/menu.svelte";
  import StatusChip from "$lib/ui/StatusChip.svelte";
  import TagPill from "$lib/ui/TagPill.svelte";
  import { fullText, tooltip } from "$lib/ui/tooltip";
  import { PR_TONE } from "$lib/verdict";
  import RepoName from "./RepoName.svelte";
  import VerdictBadge from "./VerdictBadge.svelte";
  import { toasts } from "$lib/stores/toasts.svelte";
  import { dialogs } from "$lib/stores/dialogs.svelte";
  import { clock } from "$lib/stores/clock.svelte";
  import { scanResults } from "$lib/stores/scanResults.svelte";
  import { rules } from "$lib/stores/rules.svelte";
  import { cleanupView } from "$lib/stores/cleanupView.svelte";
  import { repoActions } from "$lib/services/repoActions.svelte";

  /** One branch of the table: the mark, a cell per shown column, the delete button on hover. */
  let {
    r,
    shown,
    authorShown,
    markable,
    rowHeight,
    ondelete,
  }: {
    r: BranchRow;
    shown: ColumnId[];
    /** The author has a column or a group head of its own; else it goes next to the subject. */
    authorShown: boolean;
    markable: boolean;
    rowHeight: number;
    ondelete: (r: BranchRow) => void;
  } = $props();

  // Menus and tips load on first use; the table does not need them to show.
  const tips = () => import("./branchTip");
  const menu = () => import("./tableMenus").then((m) => m.rowMenu(r.b));

  const b = $derived(r.b);
  const selected = $derived(cleanupView.selectedKey === r.key);
  const busy = $derived(cleanupView.busy.has(r.key));
  const edge = $derived(identities.tintOf(b.repoPath));
</script>

{#snippet localFlags(lb: BranchReport)}
  {#if lb.unpushedCommitCount && !lb.mergeEvidence}
    <!-- Opens the list of these commits; the row itself stays selected as it was. -->
    <button
      type="button"
      class="inline-flex h-5 shrink-0 items-center gap-0.5 rounded-md border border-unsafe/35 px-1.5 text-unsafe-ink transition-colors hover:bg-unsafe/10"
      use:tooltip={() => ({ title: t.cleanup.unpushed(lb.unpushedCommitCount), text: t.commits.showTip })}
      onclick={(e) => {
        e.stopPropagation();
        dialogs.commitsView = unpushedView(lb);
      }}
    >
      <ArrowUpFromLine size={12} /><span class="text-xs font-semibold">{lb.unpushedCommitCount}</span>
    </button>
  {/if}
  {#if lb.behind}
    <!-- Only a fast-forward to what the last fetch brought: it cannot lose anything, so no question first. -->
    <button
      type="button"
      class="inline-flex h-5 shrink-0 items-center gap-0.5 rounded-md border border-blocked/35 px-1.5 text-blocked-ink transition-colors hover:bg-blocked/10"
      use:tooltip={() => ({ title: t.cleanup.fastForwardedTip(lb.behind), text: t.cleanup.fastForwardHint })}
      onclick={(e) => {
        e.stopPropagation();
        repoActions.fastForward(lb);
      }}
    >
      <ArrowDownToLine size={12} /><span class="text-xs font-semibold">{lb.behind}</span>
    </button>
  {/if}
  <!-- The same chips as the sidebar cards: a framed sign with its count, never a bare icon. -->
  {#if lb.worktree?.files.length}
    <StatusChip kind="dirty" count={lb.worktree.files.length} tip={t.cleanup.dirtyFiles(lb.worktree.files.length)} />
  {:else if lb.worktree}
    {@const where = lb.worktree.path}
    <IconChip icon={FolderOpen} tone="blocked" tip={() => ({ title: t.cleanup.checkedOut, path: where })} />
  {/if}
  {#if lb.stashes.length}
    <StatusChip kind="stash" count={lb.stashes.length} tip={t.cleanup.stashes(lb.stashes.length)} />
  {/if}
{/snippet}

{#snippet cell(id: ColumnId)}
  {#if id === "status"}
    <div class="min-w-0">{#if r.kind === "local"}<VerdictBadge verdict={r.b.verdict} />{:else}<VerdictBadge online={r.b.verdict} />{/if}</div>
  {:else if id === "branch"}
    <!-- Own note and tags only: the repo's are in the sidebar and would repeat on every row. -->
    {@const a = rules.annotationOf(b.repoPath, b.name)}
    <!-- Top-aligned with a fixed first line, like the repo cell: names sit at the same height in every row,
         whatever chips or pills a row carries. -->
    <div class="min-w-0 self-start overflow-hidden pt-[3px]" use:tooltip={(wanted) => tips().then(async (m) => ({ ...(await m.branchTip(r.b, wanted)), foot: t.cleanup.rowClickTip }))}>
      <div class="flex min-h-5 min-w-0 items-center gap-1.5">
        {#if b.locked}<Lock size={12} class="shrink-0 text-faint" />{:else if b.ignored}<EyeOff size={12} class="shrink-0 text-faint" />{/if}
        {#if r.underName}<span class="min-w-0 truncate" use:fullText={b.lastCommitSubject}>{b.lastCommitSubject}</span>
        {:else}<BranchName name={b.name} quiet class="font-medium" />{/if}
        {#if a.note}
          {@const note = a.note}
          <IconChip icon={StickyNote} tip={() => ({ title: t.cleanup.noteTip, text: note })} />
        {/if}
        {#if r.kind === "local"}<span class="ml-auto flex shrink-0 items-center gap-1.5 pl-1">{@render localFlags(r.b)}</span>{/if}
      </div>
      <div class="flex min-w-0 items-center gap-1.5 text-sm text-faint">
        {#if !r.underName}
        <span class="min-w-0 truncate" use:fullText={authorShown ? b.lastCommitSubject : `${b.lastCommitSubject} · ${b.lastCommitAuthor}`}>
          {b.lastCommitSubject}{#if !authorShown}<span class="mx-1.5">·</span><span class={b.isMine ? "text-muted" : ""}>{b.lastCommitAuthor}</span>{/if}
        </span>
        {:else if !authorShown}<span class="min-w-0 truncate {b.isMine ? 'text-muted' : ''}">{b.lastCommitAuthor}</span>{/if}
        {#each a.tags.slice(0, 2) as tag (tag)}<TagPill {tag} />{/each}
        {#if a.tags.length > 2}
          {@const rest = a.tags.slice(2)}
          <span class="shrink-0 text-xs text-muted" use:tooltip={() => ({ pills: rest.map((tag) => ({ text: tag, color: tagColor(tag) })) })}>+{rest.length}</span>
        {/if}
      </div>
    </div>
  {:else if id === "repo"}
    <!-- One line or two (with the copy pill): the name line stays level with the branch name either way. -->
    <div class="min-w-0 self-start overflow-hidden pt-[3px] text-sm text-muted [&>span>span:first-child]:min-h-5">
      <RepoName path={b.repoPath} stacked inFolder={cleanupView.tableGroup === "Folder" ? cleanupView.groupKeyOf(b, "Folder") : null} />
    </div>
  {:else if id === "author"}
    <div class="min-w-0 truncate text-sm {b.isMine ? 'text-muted' : 'text-faint'}">{b.lastCommitAuthor}</div>
  {:else if id === "commit"}
    <div class="min-w-0 truncate text-sm text-muted" use:tooltip={() => absoluteTime(b.lastCommitAt)}>
      {relativeTime(b.lastCommitAt, clock.now)}
    </div>
  {:else if id === "pr"}
    {@const pr = b.pullRequest}
    <div class="min-w-0">
      {#if pr}
        <span class="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 font-mono text-xs {PR_TONE[pr.state]}" use:tooltip={() => ({ title: `PR ${pr.id} · ${t.prState[pr.state]}`, text: pr.title })}>
          <GitPullRequest size={11} />{pr.id}
        </span>
      {:else}
        <span class="text-faint">{t.common.none}</span>
      {/if}
    </div>
  {:else if id === "source" && r.kind === "online"}
    {@const info = scanResults.repoByPath.get(r.b.repoPath)}
    {@const url = info?.links ? branchUrl(info.links, r.b.name) : null}
    {@const provider = info?.provider === "Azure" ? t.provider.azure : info?.provider === "GitHub" ? t.provider.github : null}
    {@const remote = r.b.remote}
    <div class="min-w-0">
      {#if url}
        <button
          type="button"
          class="inline-flex max-w-full items-center gap-1 rounded-md border border-line-strong px-1.5 py-0.5 text-xs text-muted transition-colors hover:bg-hover hover:text-fg"
          use:tooltip={() => ({ title: t.provider.openBranch, text: provider ? `${provider} · ${remote}` : remote, rows: [{ value: url, kind: "path" }], wide: true })}
          onclick={(e) => {
            e.stopPropagation();
            toasts.safely(() => api.openUrl(url));
          }}
        >
          <ExternalLink size={11} class="shrink-0" /><span class="truncate">{provider ? `${provider} · ` : ""}{remote}</span>
        </button>
      {:else}
        <span class="block truncate text-xs text-faint" use:tooltip={t.cleanup.noSourceLink}>{remote}</span>
      {/if}
    </div>
  {:else if id === "local" && r.kind === "online"}
    {@const online = r.b}
    {@const copies = scanResults.localCopiesOf(online)}
    <div class="min-w-0">
      <span class="inline-flex items-center gap-1 text-xs {copies.length ? 'text-muted' : 'text-faint'}" use:tooltip={() => tips().then((m) => m.localCopiesTip(copies, online.repoPath))}>
        <Laptop size={13} />{copies.length ? t.cleanup.localCopies(copies.length) : t.cleanup.noLocalShort}
      </span>
    </div>
  {:else}
    <div></div>
  {/if}
{/snippet}

<!-- Keys belong to the list: arrows, Space and Delete in the table's handler. -->
<!-- svelte-ignore a11y_click_events_have_key_events -->
<div
  data-key={r.key}
  role="option"
  aria-selected={selected}
  tabindex="-1"
  class="mbf-grid group cursor-pointer {edge ? 'mbf-tint-edge' : ''} {r.grouped ? 'mbf-group-row' : ''}
    {selected ? 'mbf-selected' : r.alt ? 'bg-row-alt hover:bg-hover/70' : 'hover:bg-hover/70'} {busy ? 'opacity-50' : ''} {b.locked || b.ignored ? 'text-muted' : ''}"
  style="height: {rowHeight}px; --tint-line: {edge ?? 'transparent'}"
  onclick={(e) => !(e.target as HTMLElement).closest("label, button") && cleanupView.selectKey(r.key)}
  use:contextmenu={menu}
  use:tooltip={() => ({ text: t.cleanup.rowClickTip, gestures: true })}
>
  <span class="inline-flex w-4">
    {#if markable}
      <Checkbox checked={cleanupView.checked.has(r.key)} ariaLabel={t.cleanup.mark} tip={t.cleanup.markTip} onchange={() => cleanupView.toggleChecked(r.key)} />
    {/if}
  </span>
  {#each shown as id (id)}{@render cell(id)}{/each}
  <div class="flex justify-end">
    {#if !b.locked && !(r.kind === "local" && r.b.worktree?.isMain)}
      <span class="opacity-0 group-hover:opacity-100 focus-within:opacity-100">
        <IconButton
          icon={Trash2}
          size="sm"
          tone="danger"
          label={r.kind === "online" ? t.cleanup.deleteOnline : needsForce(r.b) ? t.cleanup.forceDelete : t.cleanup.delete}
          keys="Del"
          disabled={busy}
          onclick={(e) => {
            e.stopPropagation();
            ondelete(r);
          }}
        />
      </span>
    {/if}
  </div>
</div>
