<script lang="ts">
  import { currentHome, homeRelative, pathPieces } from "$lib/paths";

  /** A path in one separator style that wraps after separators only, never at a hyphen inside a folder name. */
  let { path, class: cls = "" }: { path: string; class?: string } = $props();
  const pieces = $derived(pathPieces(homeRelative(path, currentHome())));
</script>

<span class="font-mono [overflow-wrap:break-word] {cls}">{#each pieces as p, i (i)}<span class="whitespace-nowrap">{p}</span><wbr />{/each}</span>
