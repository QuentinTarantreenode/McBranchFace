<script lang="ts" module>
  import { Archive, ArrowDownToLine, ArrowUpFromLine, CloudOff, FilePen } from "@lucide/svelte";

  export type StatusKind = "ahead" | "behind" | "dirty" | "stash" | "gone";

  // One sign per fact, the same on the card, in the table, in Git and in the legend: an arrow alone
  // meant nothing to a new user, a framed icon with its count reads as "n of this".
  const kinds = {
    ahead: { icon: ArrowUpFromLine, tone: "border-accent/30 bg-accent/8 text-accent-ink" },
    behind: { icon: ArrowDownToLine, tone: "border-blocked/30 bg-blocked/8 text-blocked-ink" },
    dirty: { icon: FilePen, tone: "border-review/30 bg-review/8 text-review-ink" },
    stash: { icon: Archive, tone: "border-line-strong text-muted" },
    gone: { icon: CloudOff, tone: "border-line-strong text-muted" },
  };
</script>

<script lang="ts">
  import { tooltip, type TooltipSource } from "./tooltip";

  let { kind, count, tip, alert = false }: { kind: StatusKind; count: number; tip?: TooltipSource; alert?: boolean } = $props();
  const k = $derived(kinds[kind]);
</script>

<span
  class="inline-flex h-5 shrink-0 items-center gap-1 rounded-md border px-1.5 text-xs font-medium tabular-nums {alert ? 'border-unsafe/50 text-unsafe-ink' : k.tone}"
  data-status={kind}
  use:tooltip={tip ?? null}
>
  <k.icon size={12} class="shrink-0" />{count}
</span>
