<script lang="ts">
  import { nameParts, prefixColor } from "$lib/branchName";
  import { copyBranchEntries } from "$lib/branchCopy";
  import { t } from "$lib/i18n/index.svelte";
  import { dataMenu } from "./menu.svelte";
  import { fullText } from "./tooltip";

  /**
   * A branch name as powerline segments, like a shell prompt shows a path: remote and namespace in a
   * muted segment, the prefix in its own colour, the rest on a neutral segment; each ends in an arrow
   * that reaches into the next. Only the rest truncates, once: its start gives way, its end stays, because
   * branches of one family differ at the end ("Contoso/rc-1/main", "Contoso/rc-3/main").
   */
  let {
    name,
    remote = null,
    size = "base",
    quiet = false,
    class: cls = "",
  }: {
    name: string;
    remote?: string | null;
    /** lg for headers. Every size stays on one line: wrapped, the segments before the rest grew as tall as it. */
    size?: "xs" | "sm" | "base" | "lg";
    /** In a list of many: the prefix tinted instead of filled, so it names the branch without shouting. */
    quiet?: boolean;
    class?: string;
  } = $props();

  const parts = $derived(nameParts(name));
  const full = $derived(remote ? `${remote}/${name}` : name);
  // The last one or two path steps, while short enough to stay whole: the part that tells siblings apart.
  const TAIL = 22;
  const split = $derived.by(() => {
    const steps = parts.rest.split("/");
    if (steps.length < 2) return { head: parts.rest, tail: "" };
    const two = steps.slice(-2).join("/");
    const tail = steps.length > 2 && two.length <= TAIL ? two : steps.at(-1)!.length <= TAIL ? steps.at(-1)! : "";
    return { head: tail ? parts.rest.slice(0, parts.rest.length - tail.length) : parts.rest, tail };
  });
  const head = $derived(split.head);
  const tail = $derived(split.tail);
  const lead = $derived([remote, parts.namespace].filter(Boolean).join("/"));

  // Selected text reads without slashes; the clipboard gets the real name.
  function copy(e: ClipboardEvent) {
    if (!e.clipboardData) return;
    e.clipboardData.setData("text/plain", full);
    e.preventDefault();
  }
</script>

<span class="mbf-segs mbf-segs-{size} {quiet ? 'mbf-segs-quiet' : ''} {cls}" oncopy={copy} role="img" aria-label={full}
  use:dataMenu={{ entries: () => [{ heading: full }, ...copyBranchEntries(name, remote)], hint: () => t.common.copyBranchHint }}>
  {#if lead}<span class="mbf-seg mbf-seg-lead" aria-hidden="true"><span class="min-w-0 truncate" use:fullText={full}>{lead}</span></span>{/if}
  {#if parts.prefix}
    <span class="mbf-seg mbf-seg-color" style="--seg: {prefixColor(parts.prefix)}" aria-hidden="true"><span class="min-w-0 truncate" use:fullText={full}>{parts.prefix}</span></span>
  {/if}
  <span class="mbf-seg mbf-seg-rest" aria-hidden="true">
    {#if tail}<span class="flex min-w-0"><span class="min-w-[1ch] shrink-[1000] truncate" use:fullText={full}>{head}</span><span class="min-w-0 truncate" use:fullText={full}>{tail}</span></span>
    {:else}<span class="min-w-0 truncate" use:fullText={full}>{parts.rest}</span>{/if}
  </span>
</span>
