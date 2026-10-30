<script lang="ts">
  import { RotateCcw, TriangleAlert } from "@lucide/svelte";
  import type { Snippet } from "svelte";
  import { errorText } from "$lib/api";
  import { t } from "$lib/i18n/index.svelte";
  import Button from "./Button.svelte";
  import EmptyState from "./EmptyState.svelte";

  let { children }: { children: Snippet } = $props();
</script>

<!-- A rendering error stays inside its view: the rest of the app keeps working. -->
<svelte:boundary onerror={(e) => console.error(e)}>
  {@render children()}
  {#snippet failed(error, reset)}
    <div class="flex min-w-0 flex-1 flex-col">
      <EmptyState icon={TriangleAlert} title={t.startup.viewFailed} text={t.startup.viewFailedHint}>
        <Button icon={RotateCcw} onclick={reset}>{t.startup.reload}</Button>
      </EmptyState>
      <p class="selectable mx-auto -mt-6 max-w-md px-6 pb-6 text-center font-mono text-xs [overflow-wrap:break-word] text-faint">{errorText(error)}</p>
    </div>
  {/snippet}
</svelte:boundary>
