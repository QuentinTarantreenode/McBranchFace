<script lang="ts">
  import type { Snippet } from "svelte";

  /**
   * Controls that belong together, on one slightly raised surface: the eye reads them as one
   * group, the screen reader by its label.
   */
  let { label, children, class: extra = "" }: { label: string; children: Snippet; class?: string } = $props();
</script>

<div role="group" aria-label={label} class="flex shrink-0 items-center gap-0.5 rounded-xl border border-line bg-panel-2/60 p-0.5 {extra}">
  {@render children()}
</div>
