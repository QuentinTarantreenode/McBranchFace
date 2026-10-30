<script lang="ts">
  import { t } from "$lib/i18n/index.svelte";
  import { SHORTCUTS } from "$lib/shortcuts";
  import Modal from "$lib/ui/Modal.svelte";
  import { dialogs } from "$lib/stores/dialogs.svelte";

  // "Shift ↑ ↓  Shift Click": two spaces part alternatives, one space parts the keys of one; "/" and "…"
  // stand between keys. Each key a cap of its own, so "n p  Alt ↓ ↑" reads as two ways, not five keys.
  const ways = (keys: string) => keys.split(/\s{2,}/).map((w) => w.split(" ").filter(Boolean));
  const plain = (k: string) => k === "/" || k === "…";
</script>

<Modal open={dialogs.shortcutsOpen} title={t.shortcuts.title} width="480px" onclose={() => (dialogs.shortcutsOpen = false)}>
  <ul class="zebra flex flex-col">
    {#each SHORTCUTS as s (s.id)}
      <li class="grid grid-cols-[minmax(0,13rem)_minmax(0,1fr)] items-center gap-3 rounded-md px-2 py-1.5 text-base">
        <span class="flex flex-wrap items-center gap-x-2 gap-y-1">
          {#each ways(s.keys) as way, i (i)}
            {#if i > 0}<span class="text-xs text-faint">{t.shortcuts.or}</span>{/if}
            <span class="inline-flex items-center gap-1">
              {#each way as k, j (j)}
                {#if plain(k)}<span class="text-xs text-faint">{k}</span>{:else}<kbd class="mbf-kbd">{k}</kbd>{/if}
              {/each}
            </span>
          {/each}
        </span>
        <span class="min-w-0">{t.shortcuts[s.id]}</span>
      </li>
    {/each}
  </ul>
</Modal>
