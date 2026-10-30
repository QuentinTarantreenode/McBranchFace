<script lang="ts">
  import { CheckCheck, FoldVertical, UnfoldVertical, SquareDashed } from "@lucide/svelte";
  import { t } from "$lib/i18n/index.svelte";
  import IconButton from "$lib/ui/IconButton.svelte";
  import ToolGroup from "$lib/ui/ToolGroup.svelte";

  let {
    anyOpen,
    onfold,
    onselect,
    anySelected,
  }: {
    anyOpen: boolean;
    onfold: (open: boolean) => void;
    /** All of the section's rows, or none. */
    onselect: (all: boolean) => void;
    anySelected: boolean;
  } = $props();
</script>

<!-- The four things every grouped section offers, always in the same place: unfold, fold, all, none. -->
<ToolGroup label={t.select.group} class="!rounded-lg">
  <IconButton icon={UnfoldVertical} size="sm" class="!size-6 !border-transparent" label={t.select.unfoldAll} keys="Alt+→" onclick={() => onfold(true)} />
  <IconButton icon={FoldVertical} size="sm" class="!size-6 !border-transparent" label={t.select.foldAll} keys="Alt+←" disabled={!anyOpen} onclick={() => onfold(false)} />
  <IconButton icon={CheckCheck} size="sm" class="!size-6 !border-transparent" label={t.select.allHere} keys="Ctrl+A" onclick={() => onselect(true)} />
  <IconButton icon={SquareDashed} size="sm" class="!size-6 !border-transparent" label={t.select.none} keys="Esc" disabled={!anySelected} onclick={() => onselect(false)} />
</ToolGroup>
