<script lang="ts">
  import { Copy, EyeOff, FolderGit2, Lock } from "@lucide/svelte";
  import type { Snippet } from "svelte";
  import { repoName } from "$lib/filter";
  import { shortSha } from "$lib/format";
  import { t } from "$lib/i18n/index.svelte";
  import { identities } from "$lib/stores/identities.svelte";
  import BranchName from "$lib/ui/BranchName.svelte";
  import IconButton from "$lib/ui/IconButton.svelte";
  import MetaChip from "$lib/ui/MetaChip.svelte";
  import RootBadge from "$lib/ui/RootBadge.svelte";
  import { untilText } from "./ignoreMenu";
  import { openInGit } from "./openInGit";
  import { copyLabelIn } from "$lib/repoLabel";
  import { toasts } from "$lib/stores/toasts.svelte";
  import { rules } from "$lib/stores/rules.svelte";

  /**
   * Which branch the detail is about, the same for a local and a server branch: the name, then one row
   * of chips – repo, commit, where it tracks (children) and the states a branch action set.
   */
  let {
    name,
    remote = null,
    repoPath,
    sha,
    locked = false,
    ignored = false,
    children,
  }: { name: string; remote?: string | null; repoPath: string; sha: string; locked?: boolean; ignored?: boolean; children?: Snippet } = $props();

  const badge = $derived(identities.markOf(repoPath));
  // Only where the label says more than the folder's badge: two copies below one root.
  const copyLabel = $derived.by(() => {
    const l = copyLabelIn(repoPath);
    return l && l !== badge?.badge.name ? l : null;
  });
  const repoTip = () => import("./repoTip").then((m) => ({ ...m.repoTip(repoPath, true), foot: t.detail.openInGitTip }));
</script>

<div class="flex min-w-0 items-center gap-1.5">
  <div class="selectable flex min-w-0"><BranchName {name} {remote} size="lg" class="font-semibold" /></div>
  <IconButton size="sm" class="!size-6 !rounded-md" icon={Copy} label={t.common.copyBranch} onclick={() => toasts.copy(name)} />
</div>
<div class="mt-2.5 flex flex-wrap items-center gap-1.5">
  <MetaChip tip={repoTip} onclick={() => openInGit(repoPath)}>
    {#if badge}<RootBadge badge={badge.badge} root={badge.root} tip={false} />{:else}<FolderGit2 size={13} class="shrink-0 text-faint" />{/if}
    <span class="min-w-0 truncate text-fg">{repoName(repoPath)}</span>
    {#if copyLabel}<span class="min-w-0 truncate text-faint">{copyLabel}</span>{/if}
  </MetaChip>
  <MetaChip mono icon={Copy} label={shortSha(sha)} tip={t.detail.copySha} onclick={() => toasts.copy(sha)} />
  {@render children?.()}
  {#if locked}<MetaChip icon={Lock} label={t.detail.lockedChip} tip={t.detail.lockedNote} />{/if}
  {#if ignored}
    <MetaChip icon={EyeOff} label={t.detail.ignoredChip} tip={() => t.detail.ignoredNote(untilText(rules.ignoreOf(repoPath, name)?.until ?? null))} />
  {/if}
</div>
