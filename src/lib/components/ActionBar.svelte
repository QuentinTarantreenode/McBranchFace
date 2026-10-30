<script lang="ts">
  import { commandRuns } from "$lib/stores/commandRuns.svelte";
  import { Bot, ExternalLink, EyeOff, TerminalSquare, FolderOpen, GitGraph, Globe, History, Lock, SquareTerminal } from "@lucide/svelte";
  import type { Snippet } from "svelte";
  import { api } from "$lib/api";
  import { t } from "$lib/i18n/index.svelte";
  import type { BranchReport } from "$lib/bindings/BranchReport";
  import type { RemoteBranchReport } from "$lib/bindings/RemoteBranchReport";
  import Button from "$lib/ui/Button.svelte";
  import IconButton from "$lib/ui/IconButton.svelte";
  import ToolGroup from "$lib/ui/ToolGroup.svelte";
  import { openBelow } from "$lib/ui/menu.svelte";
  import { ignoreChoices, untilText } from "./ignoreMenu";
  import { commandsItem } from "./commandMenu";
  import { openInGit } from "./openInGit";
  import { toasts } from "$lib/stores/toasts.svelte";
  import { environment } from "$lib/stores/environment.svelte";
  import { rules } from "$lib/stores/rules.svelte";
  import { navigation } from "$lib/services/navigation";

  let {
    where,
    repoPath,
    branchUrl,
    locked,
    onlock,
    folder = true,
    branch,
    logRev,
    online,
    ignored,
    report,
    primary,
  }: {
    /** Folder the local actions open (worktree or repo). */
    where: string;
    repoPath: string;
    branchUrl?: string | null;
    locked: boolean;
    onlock: (locked: boolean) => void;
    folder?: boolean;
    branch: string;
    /** The full ref whose history "Show log" opens. */
    logRev: string;
    online: boolean;
    ignored: boolean;
    /** The branch the prompts describe. */
    report: BranchReport | RemoteBranchReport;
    /** The branch's main action (delete), first in its row. */
    primary?: Snippet;
  } = $props();

  // A toggle that is on: the accent of IconButton's active state, over the variant's own colours.
  const on = "!border-accent/60 !bg-accent/14 !text-accent-ink hover:!bg-accent/20";
  // Borderless inside the group's frame, so the group is exactly one button high.
  const tool = "!size-[26px] !rounded-[5px] !border-transparent";

</script>

<!-- One row: what to do with the branch on the left, where to look at it grouped on the right. The
     states a branch action set show as chips in the identity above, so the toggles stay one line. -->
<div class="flex flex-wrap items-center gap-1.5" role="toolbar" aria-label={t.detail.actions}>
  <div class="flex flex-wrap items-center gap-1.5" role="group" aria-label={t.detail.branchGroup}>
    {@render primary?.()}
    <Button size="sm" class="!rounded-md {locked ? on : ''}" icon={Lock} aria-pressed={locked} tip={locked ? t.detail.unlockTip : t.detail.lockTip} onclick={() => onlock(!locked)}>
      {t.common.lock}
    </Button>
    {#if ignored}
      <Button size="sm" class="!rounded-md {on}" icon={EyeOff} aria-pressed={true} tip={{ title: t.detail.unignore, text: untilText(rules.ignoreOf(repoPath, branch)?.until ?? null) }} onclick={() => rules.clearIgnore(repoPath, branch, online)}
        >{t.detail.ignore}</Button
      >
    {:else}
      <Button
        size="sm"
        class="!rounded-md"
        icon={EyeOff}
        aria-pressed={false}
        tip={t.detail.ignoreTip}
        aria-haspopup="menu"
        onclick={(e: MouseEvent) => openBelow(e.currentTarget as HTMLElement, ignoreChoices(repoPath, branch, online), t.detail.ignore)}>{t.detail.ignore}</Button
      >
    {/if}
    {#if commandRuns.commandsFor(repoPath, branch).length}
      <Button
        size="sm"
        class="!rounded-md"
        icon={TerminalSquare}
        aria-haspopup="menu"
        onclick={(e: MouseEvent) => openBelow(e.currentTarget as HTMLElement, commandsItem([repoPath], branch).submenu ?? [], t.commands.menu)}>{t.commands.menu}</Button
      >
    {/if}
  </div>
  <ToolGroup label={t.detail.openGroup} class="ml-auto h-7 !gap-0 !rounded-md !border-line-strong !p-0">
    {#if folder}
      <IconButton size="sm" class={tool} icon={FolderOpen} label={t.common.openFolder} hint={t.detail.openFolderTip(where)} onclick={() => toasts.safely(() => api.openFolder(where))} />
      <IconButton size="sm" class={tool} icon={SquareTerminal} label={t.common.openTerminal} hint={t.detail.openTerminalTip(where)} onclick={() => toasts.safely(() => api.openTerminal(where))} />
      {#if environment.githubDesktop}
        <IconButton size="sm" class={tool} icon={ExternalLink} label={t.common.githubDesktop} hint={t.detail.githubDesktopTip} onclick={() => toasts.safely(() => api.openGithubDesktop(where))} />
      {/if}
    {/if}
    <IconButton size="sm" class={tool} icon={Bot} label={t.prompt.button} hint={t.prompt.hint} aria-haspopup="menu" onclick={(e: MouseEvent) => openBelow(e.currentTarget as HTMLElement, import("./promptMenu").then((m) => m.promptEntries(report)), t.prompt.menu)} />
    <IconButton size="sm" class={tool} icon={GitGraph} label={t.detail.openInGit} hint={t.detail.openInGitTip} onclick={() => openInGit(repoPath)} />
    <IconButton size="sm" class={tool} icon={History} label={t.menu.log} hint={t.detail.logTip} onclick={() => navigation.openHistory(repoPath, { rev: logRev })} />
    {#if branchUrl}
      {@const url = branchUrl}
      <IconButton size="sm" class={tool} icon={Globe} label={t.common.openOnline} hint={t.detail.openBranchTip} onclick={() => toasts.safely(() => api.openUrl(url))} />
    {/if}
  </ToolGroup>
</div>
