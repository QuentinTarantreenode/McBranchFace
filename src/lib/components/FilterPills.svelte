<script lang="ts">
  import { prefixColor } from "$lib/branchName";
  import type { Facet } from "$lib/filter";
  import { repoName } from "$lib/filter";
  import { t } from "$lib/i18n/index.svelte";
  import { identities } from "$lib/stores/identities.svelte";
  import Button from "$lib/ui/Button.svelte";
  import TagPill from "$lib/ui/TagPill.svelte";
  import { identityKey } from "./identityKey";
  import { facetLabel } from "./tableLabels";
  import { settings } from "$lib/stores/settings.svelte";
  import { repoSelection } from "$lib/stores/repoSelection.svelte";
  import { cleanupView } from "$lib/stores/cleanupView.svelte";

  /** What filters the table, as removable pills; prefixes and tags keep their own colours. */
  let {
    online,
    pills,
    visible,
    total,
    onreset,
  }: { online: boolean; pills: { facet: Facet; value: string; column: string }[]; visible: number; total: number; onreset: () => void } = $props();

  const clearRepos = () => ((repoSelection.repos = []), (repoSelection.focusRepo = null));
  // A selected repo group or folder: one pill for the set, in its colour and with its sign.
  const set = $derived.by(() => {
    const g = identities.activeRepoGroup;
    if (g) {
      const own = settings.config?.identities[identityKey("group", g.id)];
      return { tag: `${t.repoGroups.pill}: ${own?.short ? `${own.short} · ` : ""}${g.name}`, color: own?.color ? `var(--${own.color})` : "var(--accent)", removeLabel: t.repoGroups.removePill(g.name) };
    }
    const root = identities.activeFolder;
    if (!root) return null;
    const badge = identities.rootBadges.get(root);
    return { tag: `${t.sidebar.folderPill}: ${badge ? `${badge.text} · ` : ""}${repoName(root)}`, color: badge?.color ?? "var(--accent)", removeLabel: t.sidebar.removeFolderPill(repoName(root)) };
  });
</script>

<div class="mx-3 mb-2 flex h-8 shrink-0 items-center gap-3 overflow-hidden rounded-lg border border-line bg-panel px-3 t-meta">
  <span class="shrink-0">{t.common.visibleOf(visible, total)}</span>
  {#if cleanupView.filters.focus}
    <TagPill tag={t.cleanup.focusPill(cleanupView.filters.focus.label)} color="var(--accent)" onremove={() => (cleanupView.filters.focus = null)} removeLabel={t.cleanup.removeFocus} removeHint={t.cleanup.removeFilterTip} />
  {/if}
  {#if !online}
    {#each cleanupView.filters.upstreams as u (u)}
      <TagPill tag={t.cleanup.upstreamFilter[u]} color="var(--accent)" onremove={() => (cleanupView.filters.upstreams = cleanupView.filters.upstreams.filter((x) => x !== u))} removeLabel={t.cleanup.removeUpstreamFilter} removeHint={t.cleanup.removeFilterTip} />
    {/each}
  {/if}
  {#each cleanupView.filters.prefixes as p (p)}
    <TagPill tag={p || t.cleanup.noPrefix} color={p ? prefixColor(p) : "var(--faint)"} onremove={() => cleanupView.togglePrefixFilter(p || null)} removeLabel={t.cleanup.removePrefix(p || t.cleanup.noPrefix)} removeHint={t.cleanup.removeFilterTip} />
  {/each}
  {#if set}
    <TagPill tag={set.tag} color={set.color} onremove={clearRepos} removeLabel={set.removeLabel} removeHint={t.cleanup.removeFilterTip} />
  {/if}
  {#each pills as f (`${f.facet}\u0000${f.value}`)}
    <TagPill
      tag={`${f.column}: ${facetLabel(f.facet, f.value)}`}
      color="var(--accent)"
      onremove={() => cleanupView.toggleFacet(f.facet, f.value)}
      removeLabel={t.cleanup.removeFilter(f.column, facetLabel(f.facet, f.value))}
      removeHint={t.cleanup.removeFilterTip}
    />
  {/each}
  {#each cleanupView.filters.tags as tag (tag)}
    <TagPill {tag} onremove={() => cleanupView.toggleTagFilter(tag)} removeLabel={t.detail.removeTag(tag)} removeHint={t.cleanup.removeFilterTip} />
  {/each}
  <Button size="sm" variant="ghost" onclick={onreset}>{t.common.resetFilter}</Button>
</div>
