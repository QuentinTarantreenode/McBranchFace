<script lang="ts">
  import type { Rich } from "$lib/rich";
  import RefName from "./RefName.svelte";
  import FolderName from "./FolderName.svelte";

  /** A sentence with data: refs as small segments inline, key facts bold, SHAs monospace, folders by name. */
  let { text }: { text: Rich | string } = $props();
</script>

{#if typeof text === "string"}{text}{:else}{#each text as p, i (i)}{#if typeof p === "string"}{p}{:else if "ref" in p}<span class="mx-0.5 inline-flex max-w-full align-middle"><RefName ref={p.ref} /></span>{:else if "strong" in p}<strong class="font-semibold text-fg">{p.strong}</strong>{:else if "mono" in p}<code class="font-mono">{p.mono}</code>{:else}<FolderName path={p.path} />{/if}{/each}{/if}
