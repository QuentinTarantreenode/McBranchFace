<script lang="ts">
  import { Latest } from "$lib/latest";
  import { Copy, GitGraph, Search } from "@lucide/svelte";
  import { api, errorText } from "$lib/api";
  import type { CommitHit } from "$lib/bindings/CommitHit";
  import type { RepoHits } from "$lib/bindings/RepoHits";
  import { absoluteTime, relativeTime, shortSha } from "$lib/format";
  import { t } from "$lib/i18n/index.svelte";
  import BranchName from "$lib/ui/BranchName.svelte";
  import IconButton from "$lib/ui/IconButton.svelte";
  import Input from "$lib/ui/Input.svelte";
  import Modal from "$lib/ui/Modal.svelte";
  import RefName from "$lib/ui/RefName.svelte";
  import { fullText, tooltip } from "$lib/ui/tooltip";
  import RepoName from "./RepoName.svelte";
  import { toasts } from "$lib/stores/toasts.svelte";
  import { settings } from "$lib/stores/settings.svelte";
  import { dialogs } from "$lib/stores/dialogs.svelte";
  import { clock } from "$lib/stores/clock.svelte";
  import { scanResults } from "$lib/stores/scanResults.svelte";
  import { navigation } from "$lib/services/navigation";

  /** Branches named in a row before the rest are counted: a commit on main is in nearly every branch. */
  const SHOWN = 3;

  let query = $state("");
  let results = $state<RepoHits[] | null>(null);
  let searching = $state(false);
  const searches = new Latest();

  // A SHA prefix may be short; words need three letters before a search over every repo is worth it.
  const ready = (q: string) => q.length >= 3 || (q.length >= 4 && /^[0-9a-f]+$/i.test(q));

  // Typing waits a moment; an answer to an older text is dropped.
  $effect(() => {
    const q = query.trim();
    const current = searches.next();
    if (!ready(q)) {
      results = null;
      searching = false;
      return;
    }
    const timer = setTimeout(async () => {
      searching = true;
      try {
        const found = await api.findCommit(
          scanResults.repos.map((r) => r.info.path),
          q,
        );
        if (current()) results = found;
      } catch (e) {
        if (current()) toasts.fail(e);
      } finally {
        if (current()) searching = false;
      }
    }, 300);
    return () => clearTimeout(timer);
  });

  const withHits = $derived((results ?? []).filter((r) => r.hits.length || r.error));
  const total = $derived(withHits.reduce((s, r) => s + r.hits.length, 0));

  function open(repoPath: string, h: CommitHit) {
    const rev = h.local[0] ? `refs/heads/${h.local[0]}` : h.remote[0] ? `refs/remotes/${h.remote[0]}` : h.commit.sha;
    dialogs.commitSearchOpen = false;
    navigation.openHistory(repoPath, { rev, sha: h.commit.sha });
  }
</script>

<Modal open title={t.find.title} width="820px" resizable {...settings.dialogSize("findCommit")} onclose={() => (dialogs.commitSearchOpen = false)}>
  <div class="flex flex-col gap-3">
    <Input bind:value={query} icon={Search} placeholder={t.find.placeholder} aria-label={t.find.placeholder} autofocus />
    <p class="t-meta">
      {#if searching}{t.find.searching}{:else if results}{t.find.count(total, withHits.filter((r) => r.hits.length).length)}{:else}{t.find.hint}{/if}
    </p>

    <div class="h-[min(56vh,560px)] min-h-[200px] overflow-auto rounded-lg border border-line">
      {#if results && !withHits.length && !searching}
        <p class="p-4 t-meta">{t.find.none}</p>
      {/if}
      {#each withHits as r (r.repoPath)}
        <section class="border-b border-line last:border-b-0">
          <!-- The repo once, above its hits: the rows only say what differs. -->
          <h3 class="sticky top-0 z-10 flex items-center gap-2 border-b border-line bg-panel-2 px-3 py-1.5">
            <RepoName path={r.repoPath} />
            <span class="rounded bg-panel px-1.5 text-xs tabular-nums text-muted">{r.hits.length}</span>
            {#if r.capped}<span class="t-meta">{t.find.capped(r.hits.length)}</span>{/if}
          </h3>
          {#if r.error}
            <p class="px-3 py-2 text-sm text-unsafe-ink">{errorText(r.error)}</p>
          {/if}
          {#each r.hits as h (h.commit.sha)}
            {@const branches = [...h.local.map((name) => ({ name, remote: false })), ...h.remote.map((name) => ({ name, remote: true }))]}
            <div class="grid grid-cols-[76px_minmax(0,1fr)_96px_28px] items-start gap-3 border-b border-line/60 px-3 py-2 text-sm last:border-b-0 hover:bg-hover/60">
              <button
                type="button"
                class="inline-flex h-6 items-center gap-1 justify-self-start rounded-md border border-line-strong px-1.5 font-mono text-xs transition-colors hover:bg-hover"
                use:tooltip={t.commits.copySha}
                onclick={() => toasts.copy(h.commit.sha)}
              >
                {shortSha(h.commit.sha)}<Copy size={10} />
              </button>
              <div class="flex min-w-0 flex-col gap-1">
                <span class="selectable min-w-0 truncate" use:fullText={h.commit.subject}>{h.commit.subject}</span>
                <span class="flex min-w-0 flex-wrap items-center gap-1.5">
                  <span class="t-meta">{h.commit.author}</span>
                  {#if !branches.length}
                    <span class="t-meta">· {t.find.nowhere}</span>
                  {/if}
                  {#each branches.slice(0, SHOWN) as b (b.name + b.remote)}
                    {#if b.remote}<span class="flex min-w-0"><RefName ref={`refs/remotes/${b.name}`} /></span>
                    {:else}<span class="flex min-w-0"><BranchName name={b.name} size="xs" /></span>{/if}
                  {/each}
                  {#if branches.length > SHOWN}
                    <span
                      class="rounded bg-panel-2 px-1.5 text-xs tabular-nums text-muted"
                      use:tooltip={{ title: t.find.inBranches(branches.length), rows: branches.slice(SHOWN).map((b) => ({ value: b.name, kind: "branch" as const })) }}
                    >+{branches.length - SHOWN}</span>
                  {/if}
                </span>
              </div>
              <span class="pt-0.5 text-right text-faint tabular-nums" use:tooltip={absoluteTime(h.commit.time)}>{relativeTime(h.commit.time, clock.now)}</span>
              <!-- As wide as the button: the column is wider at small UI zoom, and the tip's wrapper must cover the button exactly. -->
              <span class="flex justify-self-start"><IconButton icon={GitGraph} size="sm" label={t.commits.open} hint={t.commits.openTip} onclick={() => open(r.repoPath, h)} /></span>
            </div>
          {/each}
        </section>
      {/each}
    </div>
  </div>
</Modal>
