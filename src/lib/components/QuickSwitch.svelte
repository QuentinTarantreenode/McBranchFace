<script lang="ts">
  import { gitClaims } from "$lib/stores/gitClaims.svelte";
  import { gitStatus } from "$lib/stores/gitStatus.svelte";
  import { ChevronDown, GitBranch, TriangleAlert } from "@lucide/svelte";
  import { t } from "$lib/i18n/index.svelte";
  import { repoName } from "$lib/filter";
  import BranchName from "$lib/ui/BranchName.svelte";
  import { tooltip } from "$lib/ui/tooltip";

  /**
   * The branch of a repo or worktree as a button: a dropdown with search switches it, creates a new
   * branch, and can take other repos with the same branch along.
   */
  let {
    path,
    branch,
    sha,
    unreferenced = 0,
    size = "sm",
    fill = false,
  }: {
    path: string;
    branch: string | null;
    sha: string | null;
    unreferenced?: number;
    size?: "xs" | "sm";
    /** Takes the whole width it is given, the chevron at the end: buttons in a column line up. */
    fill?: boolean;
  } = $props();

  let open = $state(false);
  let trigger: HTMLButtonElement | undefined = $state();
  // Seven characters: the pill on a narrow sidebar card has room for no more.
  const short = $derived((sha ?? "").slice(0, 7));
  // The dropdown's code loads on the first opening; the sidebar does not need it to start.
  const panel = () => import("./QuickSwitchPanel.svelte");

  // The name heads the tip only while the button shows part of it; otherwise it would repeat it.
  function tip() {
    const foot = stale ? t.common.staleStatus : refreshing ? t.common.refreshing : undefined;
    if (!branch) return { title: t.sidebar.detachedTitle, text: unreferenced ? t.quick.stranded(short, unreferenced) : t.quick.detached(short), foot };
    const cut = [...(trigger?.querySelectorAll<HTMLElement>(".mbf-seg > span") ?? [])].some((s) => s.scrollWidth > s.clientWidth + 1);
    return cut || foot ? { title: cut ? branch : undefined, text: t.quick.tip, foot } : t.quick.tip;
  }

  // Not disabled: a disabled button shows no tip, and this one has to say what it waits for.
  const running = $derived(gitClaims.gitRunning(path));
  const stale = $derived(gitStatus.isStale(path));
  const refreshing = $derived(gitStatus.isRefreshing(path));

  function toggle(e: MouseEvent) {
    e.stopPropagation();
    if (running) return;
    open = !open;
  }
</script>

<button
  bind:this={trigger}
  type="button"
  class="inline-flex max-w-full min-w-0 items-center gap-1 overflow-hidden rounded-md border border-line-strong/70 font-mono text-xs transition-colors hover:border-faint/60 hover:bg-hover aria-disabled:cursor-default aria-disabled:opacity-50
    {size === 'xs' ? 'h-[22px] px-1' : 'h-[24px] px-1.5'} {fill ? 'w-full' : ''} {open ? 'bg-hover' : ''} {refreshing ? 'mbf-refreshing' : ''}"
  aria-haspopup="dialog"
  aria-expanded={open}
  aria-label={t.quick.label(repoName(path))}
  aria-disabled={!!running}
  use:tooltip={open ? null : running ? running : tip}
  onclick={toggle}
>
  {#if branch}
    <GitBranch size={11} class="shrink-0 text-faint" />
    <span class="flex min-w-0 text-muted"><BranchName name={branch} size="xs" /></span>
  {:else}
    <!-- No branch icon: HEAD is on no branch. The warning only where commits would be lost. -->
    {#if unreferenced}<TriangleAlert size={11} class="shrink-0 text-unsafe" />{/if}
    <span class="min-w-0 truncate rounded bg-panel px-1.5 text-review-ink ring-1 ring-review/40" aria-label={`${t.sidebar.detachedPill} ${short}`}>{short}</span>
  {/if}
  <ChevronDown size={11} class="shrink-0 text-faint {fill ? 'ml-auto' : ''}" />
</button>

{#if open && trigger}
  {#await panel() then m}
    <m.default {path} {branch} {sha} {unreferenced} {trigger} onclose={() => (open = false)} />
  {/await}
{/if}
