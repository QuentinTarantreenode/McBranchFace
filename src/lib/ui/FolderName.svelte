<script lang="ts">
  import { repoName } from "$lib/filter";
  import { displayPath } from "$lib/paths";
  import { tooltip } from "./tooltip";

  /** A folder named in a sentence or a list: its own name, the whole path in the tooltip. */
  let { path, class: cls = "font-medium text-fg" }: { path: string; class?: string } = $props();
  const name = $derived(repoName(displayPath(path)) || path);
</script>

<span class={cls} use:tooltip={{ path }}>{name}</span>
