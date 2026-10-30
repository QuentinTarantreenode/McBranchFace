<script lang="ts">
  import type { Snippet } from "svelte";
  import GroupHead from "./GroupHead.svelte";

  let {
    title,
    count,
    open = $bindable(true),
    tone = "",
    children,
  }: { title: string; count?: number; open?: boolean; tone?: string; children: Snippet } = $props();
</script>

<section class="mt-3">
  <GroupHead level={3} {title} {count} {open} {tone} guide={false} body="mt-1" ontoggle={() => (open = !open)}>
    {@render children()}
  </GroupHead>
</section>
