<script lang="ts">
  import { ChevronRight, FoldVertical, UnfoldVertical } from "@lucide/svelte";
  import type { Snippet } from "svelte";
  import { t } from "$lib/i18n/index.svelte";
  import { contextmenu, type MenuEntries, type MenuEntry } from "./menu.svelte";
  import { foldKeys } from "./foldKeys";
  import { fullText, tooltip } from "./tooltip";

  let {
    level = 2,
    open,
    ontoggle,
    onopen,
    foldAll,
    label,
    title,
    count,
    actions,
    tools,
    menu,
    tone = "",
    class: extra = "",
    style = "",
    guide = true,
    body = "",
    children,
  }: {
    /** 1 a folder or list group, 2 a repo or block inside it, 3 a status or directory inside that. */
    level?: 1 | 2 | 3;
    open: boolean;
    ontoggle: () => void;
    /** A click on the label does this instead of folding (open the repo); the chevron still folds. */
    onopen?: () => void;
    /** The groups of this level, folded and unfolded at once: whether any is open, and how. */
    foldAll?: { anyOpen: boolean; run: (open: boolean) => void };
    label?: Snippet;
    /** Plain label text, when no snippet is given; also the accessible name. */
    title: string;
    count?: number;
    actions?: Snippet;
    /** Controls that stay visible: the main action of the group, its menu button. */
    tools?: Snippet;
    menu?: () => MenuEntries;
    tone?: string;
    class?: string;
    style?: string;
    /** Children one step in along a guide line; off where the body is a block of its own (a detail panel). */
    guide?: boolean;
    body?: string;
    children?: Snippet;
  } = $props();

  const LOOK = {
    1: "h-8 rounded-md border border-group-line bg-group text-sm font-semibold text-fg",
    2: "h-7 rounded-md text-sm font-medium text-fg hover:bg-hover/60",
    3: "h-6 rounded-md text-xs font-medium text-muted hover:bg-hover/50",
  } as const;

  function key(e: KeyboardEvent) {
    if (foldKeys(e, { open, toggle: ontoggle, all: foldAll?.run })) e.stopPropagation();
  }

  function chevron(e: MouseEvent) {
    e.stopPropagation();
    if (e.altKey && foldAll) foldAll.run(!open);
    else ontoggle();
  }

  // Every group head offers folding all of its level, also where the head has no menu of its own.
  function entries(): MenuEntries {
    const own = menu?.() ?? [];
    if (!foldAll) return own;
    const fa = foldAll;
    const extra: MenuEntry[] = [
      fa.anyOpen ? { label: t.common.foldAll, icon: FoldVertical, keys: "Alt+←", run: () => fa.run(false) } : { label: t.common.unfoldAll, icon: UnfoldVertical, keys: "Alt+→", run: () => fa.run(true) },
    ];
    return Array.isArray(own) ? [...own, "sep", ...extra] : own.then((l) => [...l, "sep", ...extra]);
  }
</script>

<!-- A group is its head and, while open, everything under it; folding the head hides every subgroup too.
     The children sit one step in, along a guide line under the chevron, so the depth shows at a glance. -->
<div class="min-w-0" role="group" aria-label={title}>
  <div class="group/gh flex min-w-0 items-center gap-1 pr-1 pl-0.5 {LOOK[level]} {extra}" {style} use:contextmenu={entries}>
    <button
      type="button"
      class="grid size-5 shrink-0 place-items-center rounded text-faint hover:bg-hover hover:text-fg"
      aria-expanded={open}
      aria-label={open ? t.common.fold : t.common.unfold}
      use:tooltip={{ title: open ? t.common.fold : t.common.unfold, text: foldAll ? t.common.foldAllHint : undefined, keys: "← →" }}
      onclick={chevron}
      onkeydown={key}
    >
      <ChevronRight size={14} class="transition-transform {open ? 'rotate-90' : ''}" />
    </button>
    <button
      type="button"
      class="flex min-w-0 flex-1 items-center gap-1.5 self-stretch text-left {tone}"
      aria-expanded={onopen ? undefined : open}
      onclick={() => (onopen ? onopen() : ontoggle())}
      onkeydown={key}
    >
      {#if label}{@render label()}{:else}<span class="truncate" use:fullText={title}>{title}</span>{/if}
      {#if count !== undefined}<span class="mbf-count shrink-0 font-normal">{count}</span>{/if}
    </button>
    {#if actions}
      <div class="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-focus-within/gh:opacity-100 group-hover/gh:opacity-100">
        {@render actions()}
      </div>
    {/if}
    {@render tools?.()}
    {#if foldAll}
          {@const fa = foldAll}
          <button
            type="button"
            class="grid size-6 shrink-0 place-items-center rounded text-faint hover:bg-hover hover:text-fg {level === 1 ? '' : 'opacity-0 group-focus-within/gh:opacity-100 group-hover/gh:opacity-100'}"
            aria-label={fa.anyOpen ? t.common.foldAll : t.common.unfoldAll}
            use:tooltip={{ title: fa.anyOpen ? t.common.foldAll : t.common.unfoldAll, keys: "Alt+← →" }}
            onclick={(e) => {
              e.stopPropagation();
              fa.run(!fa.anyOpen);
            }}
          >
            {#if fa.anyOpen}<FoldVertical size={14} />{:else}<UnfoldVertical size={14} />{/if}
          </button>
    {/if}
  </div>
  {#if open && children}
    <div class="{guide ? 'mbf-guide' : ''} {body}">{@render children()}</div>
  {/if}
</div>
