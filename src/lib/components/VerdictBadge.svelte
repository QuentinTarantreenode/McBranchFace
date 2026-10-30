<script lang="ts">
  import type { OnlineVerdict } from "$lib/bindings/OnlineVerdict";
  import type { Verdict } from "$lib/bindings/Verdict";
  import { t } from "$lib/i18n/index.svelte";
  import { ONLINE_TONE, VERDICT_TONE } from "$lib/verdict";
  import { tooltip } from "$lib/ui/tooltip";

  /** count: how many carry this verdict, for a summary such as a group header. */
  let { verdict, online, size = "sm", count }: { verdict?: Verdict; online?: OnlineVerdict; size?: "sm" | "md" | "lg"; count?: number } = $props();

  const tone = $derived(online ? ONLINE_TONE[online] : VERDICT_TONE[verdict ?? "Review"]);
  const text = $derived(online ? t.onlineVerdict[online] : t.verdict[verdict ?? "Review"]);
</script>

<span
  use:tooltip={size !== "sm" ? { title: text.hint, text: text.summary } : text.hint}
  class="inline-flex items-center gap-1.5 {size === 'md' ? 'rounded-md' : 'rounded-full'} font-medium whitespace-nowrap ring-1 ring-inset {tone.badge}
    {size === 'lg' ? 'px-3 py-1 text-base' : size === 'md' ? 'h-6 px-2.5 text-sm' : 'px-2 py-0.5 text-xs'}"
>
  <span class="size-1.5 rounded-full {tone.dot}"></span>
  {text.label}
  {#if count !== undefined}<span class="tabular-nums">{count}</span>{/if}
</span>
