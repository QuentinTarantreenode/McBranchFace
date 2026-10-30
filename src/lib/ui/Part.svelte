<script lang="ts">
  import type { Snippet } from "svelte";
  import Skeleton from "./Skeleton.svelte";

  /**
   * One part of an element that arrives on its own (a count, a status): its content once there, until
   * then a placeholder of its size. Only this part waits; the rest of the element is there and usable.
   */
  let { ready, shape = "h-5 w-10 rounded-md", children }: { ready: boolean; shape?: string; children: Snippet } = $props();
</script>

{#if ready}{@render children()}{:else}<span class="contents" aria-busy="true"><Skeleton class={shape} /></span>{/if}
