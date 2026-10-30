<script lang="ts">
  import type { RootBadge } from "$lib/rootBadges";
  import { t } from "$lib/i18n/index.svelte";
  import { tooltip, type TooltipInput } from "./tooltip";

  /**
   * A root folder as its short sign: the same letters and colour at the sidebar group, on each repo card
   * and wherever a repo is named, so the folder need not be written out. `tip`: false where the
   * element around it explains the folder already.
   */
  let { badge, root, tip = true }: { badge: RootBadge; root: string; tip?: boolean | TooltipInput } = $props();
</script>

<span
  class="mbf-root-badge"
  style="--root: {badge.color}"
  role="img"
  aria-label={t.sidebar.rootBadge(badge.name)}
  use:tooltip={tip === true ? { title: badge.name, path: root, text: t.sidebar.rootBadgeTip } : tip || null}>{badge.text}</span
>
