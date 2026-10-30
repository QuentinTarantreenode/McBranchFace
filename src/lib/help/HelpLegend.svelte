<script lang="ts">
  import {
    ArrowUpFromLine, Boxes, CloudOff, EyeOff, FolderOpen, FolderTree, GitFork, GlobeLock, Laptop, Lock,
    RefreshCw, StickyNote, TriangleAlert,
  } from "@lucide/svelte";
  import VerdictBadge from "$lib/components/VerdictBadge.svelte";
  import BranchName from "$lib/ui/BranchName.svelte";
  import StatusChip from "$lib/ui/StatusChip.svelte";
  import RootBadge from "$lib/ui/RootBadge.svelte";
  import IconChip from "$lib/ui/IconChip.svelte";
  import { t } from "$lib/i18n/index.svelte";
  import type { HelpLegend } from "./types";

  /**
   * The elements of the UI as they look, each beside its explanation. The pictures are the real
   * components, so the legend cannot drift from what the app shows.
   */
  let { legend }: { legend: HelpLegend } = $props();

  const rows = $derived(Object.entries(legend.items));
  // Sample data for the pictures, not interface text.
  const SAMPLE = { copy: "copy-2", sha: "a1b2c3d", group: "Release" };
</script>

{#snippet picture(key: string)}
  {#if legend.visual === "verdicts"}
    {#if key === "Safe" || key === "Review" || key === "Unsafe" || key === "Blocked"}<VerdictBadge verdict={key} />
    {:else if key === "Merged" || key === "Inactive" || key === "Active"}<VerdictBadge online={key} />{/if}
  {:else if legend.visual === "segments"}
    {#if key === "remote"}<BranchName remote="origin" name="main" size="sm" />
    {:else if key === "namespace"}<BranchName name="2.4/release/x" size="sm" />
    {:else if key === "prefix"}<BranchName name="feature/login" size="sm" />
    {:else if key === "rest"}<BranchName name="login-form" size="sm" />{/if}
  {:else if legend.visual === "sidebar"}
    {#if key === "repoGroup"}<span class="inline-flex h-6 items-center gap-1.5 rounded-md border border-group-line bg-group px-1.5 text-sm"><Boxes size={13} class="text-faint" /><span class="font-semibold">{SAMPLE.group}</span><span class="mbf-count">3</span></span>
    {:else if key === "repoIcon"}<RootBadge badge={{ text: "AP", color: "var(--id-0)", name: "Acme_Platform" }} root="Acme_Platform" tip={false} />
    {:else if key === "copyLabel"}<span class="mbf-copy-pill rounded px-1.5 text-xs font-medium" style="--pill: var(--id-0)">{SAMPLE.copy}</span>
    {:else if key === "gone"}<StatusChip kind="gone" count={4} />
    {:else if key === "goneUnsafe"}<StatusChip kind="gone" count={4} alert />
    {:else if key === "ahead"}<StatusChip kind="ahead" count={2} />
    {:else if key === "behind"}<StatusChip kind="behind" count={1} />
    {:else if key === "dirty"}<StatusChip kind="dirty" count={3} />
    {:else if key === "stash"}<StatusChip kind="stash" count={2} />
    {:else if key === "foreign"}<IconChip icon={GitFork} tone="review" />
    {:else if key === "note"}<IconChip icon={StickyNote} />
    {:else if key === "more"}<span class="mbf-count">+2</span>
    {:else if key === "locked"}<IconChip icon={Lock} />
    {:else if key === "onlineExcluded"}<IconChip icon={GlobeLock} />
    {:else if key === "problem"}<IconChip icon={TriangleAlert} tone="review" />{/if}
  {:else if legend.visual === "worktree"}
    {#if key === "worktree"}<FolderTree size={12} class="text-faint" />
    {:else if key === "detached"}<span class="inline-flex items-center gap-1 font-mono text-xs"><span class="rounded px-1 font-sans text-[11px] text-review-ink ring-1 ring-review/40">{t.sidebar.detachedPill}</span><span class="text-muted">{SAMPLE.sha}</span></span>
    {:else if key === "stranded"}<IconChip icon={TriangleAlert} tone="unsafe" />{/if}
  {:else if legend.visual === "table"}
    {#if key === "unpushed"}<span class="inline-flex h-5 items-center gap-0.5 rounded-md border border-unsafe/35 px-1.5 text-unsafe-ink"><ArrowUpFromLine size={12} /><span class="text-xs font-semibold">2</span></span>
    {:else if key === "dirty"}<StatusChip kind="dirty" count={3} />
    {:else if key === "checkedOut"}<IconChip icon={FolderOpen} tone="blocked" />
    {:else if key === "stashes"}<StatusChip kind="stash" count={1} />
    {:else if key === "locked"}<Lock size={12} class="text-faint" />
    {:else if key === "ignored"}<EyeOff size={12} class="text-faint" />
    {:else if key === "note"}<IconChip icon={StickyNote} />
    {:else if key === "gone"}<CloudOff size={13} class="text-review" />
    {:else if key === "copies"}<span class="inline-flex items-center gap-1 text-sm text-muted"><Laptop size={13} />2</span>{/if}
  {:else if legend.visual === "topbar"}
    {#if key === "refresh"}<span class="inline-flex h-6 items-center rounded-md bg-accent px-1.5 text-accent-fg"><RefreshCw size={13} /></span>
    {:else if key === "local"}<span class="inline-flex h-6 items-center rounded-md bg-accent px-1.5 text-accent-fg"><CloudOff size={13} /></span>{/if}
  {/if}
{/snippet}

<dl class="mt-4 flex flex-col" data-legend={legend.visual}>
  {#each rows as [key, text] (key)}
    <div class="grid grid-cols-[112px_minmax(0,1fr)] items-center gap-3 rounded-md px-2 py-1.5 odd:bg-row-alt">
      <dt class="flex min-w-0 items-center" aria-hidden="true">{@render picture(key)}</dt>
      <dd class="text-sm leading-snug text-muted">{text}</dd>
    </div>
  {/each}
</dl>
