<script lang="ts">
  import { gitStatus } from "$lib/stores/gitStatus.svelte";
  import { t } from "$lib/i18n/index.svelte";
  import { tooltip } from "$lib/ui/tooltip";
  import { scanResults } from "$lib/stores/scanResults.svelte";

  /** Where a repo lives: only here, or on a server, and which service. */
  let { path, size = "sm" }: { path: string; size?: "xs" | "sm" } = $props();

  const info = $derived(scanResults.repoByPath.get(gitStatus.ownerOf(path)) ?? scanResults.repoByPath.get(path));
  const kind = $derived(!info ? null : info.provider === "Azure" ? "azure" : info.provider === "GitHub" ? "github" : info.remoteUrl ? "other" : "local");
  const LOOK = $derived({
    azure: { text: "Azure", short: "AZ", cls: "text-[#0063b1] ring-[#0078d4]/45 dark:text-[#5aa9ff]" },
    github: { text: "GitHub", short: "GH", cls: "text-fg ring-line-strong" },
    other: { text: "Remote", short: "Remote", cls: "text-muted ring-line-strong" },
    local: { text: t.provider.localShort, short: t.provider.localShort, cls: "text-muted ring-line-strong" },
  });
  const hostedTitle = $derived(kind === "azure" ? t.provider.azure : kind === "github" ? t.provider.github : t.provider.otherTitle);
  // The remote URL breaks after its slashes like a path, not as one long word.
  const tip = $derived(
    kind === "local"
      ? { title: t.provider.localTitle, text: t.provider.localText }
      : kind
        ? info?.remoteUrl
          ? { title: hostedTitle, rows: [{ value: info.remoteUrl, kind: "url" as const }] }
          : { title: hostedTitle, text: t.provider.hostedText }
        : null,
  );
</script>

<!-- A word, not an icon: the service by name, or that the repo is only here. -->
{#if kind}
  {@const look = LOOK[kind]}
  <span
    class="inline-flex shrink-0 items-center gap-1 rounded px-1 font-medium ring-1 {size === 'xs' ? 'h-4 text-[10px]' : 'h-5 text-[11px]'} {look.cls}"
    use:tooltip={tip}
  >
    {size === "xs" ? look.short : look.text}
  </span>
{/if}
