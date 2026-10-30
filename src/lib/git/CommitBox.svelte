<script lang="ts">
  import { GitCommitHorizontal } from "@lucide/svelte";
  import { t } from "$lib/i18n/index.svelte";
  import Button from "$lib/ui/Button.svelte";
  import Checkbox from "$lib/ui/Checkbox.svelte";
  import { tooltip } from "$lib/ui/tooltip";
  import { gitStore } from "./gitStore.svelte";
  import RepoName from "$lib/components/RepoName.svelte";

  /** `repo`: named above the message, so it is plain where the commit goes; each repo keeps its own draft. */
  let { staged, repo = null }: { staged: number; repo?: string | null } = $props();

  const SUMMARY_LIMIT = 72;

  const SUMMARY_HINT = 50;
  const summary = $derived(gitStore.commitMessage.split("\n")[0] ?? "");
  const canCommit = $derived(!gitStore.locked && !!gitStore.commitMessage.trim() && (staged > 0 || gitStore.amend));
  const why = $derived(
    gitStore.elsewhere ??
      (gitStore.busy ? t.git.busy : !gitStore.commitMessage.trim() ? t.git.noMessage : staged === 0 && !gitStore.amend ? t.git.nothingStaged : null),
  );

  function onKey(e: KeyboardEvent) {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter" && canCommit) {
      e.preventDefault();
      gitStore.commit();
    }
  }
</script>

<div class="shrink-0 border-t border-line bg-panel-2 p-3">
  {#if repo}
    <div class="mb-2 flex min-w-0 items-center gap-1.5 t-meta"><span class="shrink-0">{t.git.commitIn}</span><span class="flex min-w-0 items-center"><RepoName path={repo} /></span></div>
  {/if}
  <label class="block">
    <span class="sr-only">{t.git.message}</span>
    <textarea
      bind:value={gitStore.commitMessage}
      onkeydown={onKey}
      rows="3"
      placeholder={t.git.messagePlaceholder}
      class="block w-full resize-y rounded-lg border border-line-strong bg-input px-2.5 py-2 text-base outline-none placeholder:text-faint focus:border-accent focus:ring-2 focus:ring-accent/20"
    ></textarea>
  </label>
  <!-- One row: amend on the left (box on the first text line, hint below the label), counter and commit on the right. -->
  <div class="mt-2 flex items-start gap-3">
    <Checkbox checked={gitStore.amend} label={t.git.amend} description={t.git.amendHint} onchange={(v) => gitStore.setAmend(v)} />
    <div class="ml-auto flex items-center gap-3">
      <!-- The counter matters near the limit only; below it, it is noise next to the button. -->
      {#if summary.length >= SUMMARY_HINT}
        <span class="text-xs tabular-nums {summary.length > SUMMARY_LIMIT ? 'text-review' : 'text-faint'}" use:tooltip={summary.length > SUMMARY_LIMIT ? t.git.summaryLong : null}>
          {summary.length}/{SUMMARY_LIMIT}
        </span>
      {/if}
      <Button variant="primary" icon={GitCommitHorizontal} disabled={!canCommit} tip={why ?? { text: t.git.commitTip, keys: "Ctrl Enter" }} onclick={() => gitStore.commit()}>
        {gitStore.amend ? t.git.amend : `${t.git.commit}${staged ? ` (${staged})` : ""}`}
      </Button>
    </div>
  </div>
</div>
