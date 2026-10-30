<script lang="ts">
  import { refParts } from "$lib/branchName";
  import BranchName from "./BranchName.svelte";

  /** Any ref – `refs/heads/x`, `refs/remotes/origin/x`, `origin/x`, `x` – as branch segments. */
  let { ref }: { ref: string } = $props();

  const parts = $derived(refParts(ref));
</script>

<BranchName name={parts.name} remote={parts.remote} size="xs" />
