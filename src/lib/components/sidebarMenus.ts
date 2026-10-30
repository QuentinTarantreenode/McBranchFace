// Menus of the sidebar's folders. They load on the first open: nothing here is needed to show the list.
import { Boxes, Copy, Download, FolderMinus, FolderOpen, FolderPlus, Palette, SlidersHorizontal, SquareTerminal } from "@lucide/svelte";
import { newGroupId, withGroup } from "$lib/repoGroups";
import { api } from "$lib/api";
import type { RepoEntry } from "$lib/stores/scanResults.svelte";
import { repoName } from "$lib/filter";
import { t } from "$lib/i18n/index.svelte";
import { NO_ROOT, type SidebarGroup } from "$lib/groups";
import type { MenuEntry } from "$lib/ui/menu.svelte";
import { fold } from "$lib/stores/fold.svelte";
import { identities } from "$lib/stores/identities.svelte";
import { openSwitch } from "./repoGroupDrop.svelte";
import { foldEntry } from "./selectMenu";
import { setEntries } from "./setMenu";
import { toasts } from "$lib/stores/toasts.svelte";
import { settings } from "$lib/stores/settings.svelte";
import { dialogs } from "$lib/stores/dialogs.svelte";
import { repoActions } from "$lib/services/repoActions.svelte";

export interface SidebarMenuContext {
  /** The folders shown, for folding them all. */
  roots: string[];
  pickRoots: () => unknown;
}

export function folderMenu(ctx: SidebarMenuContext, g: SidebarGroup<RepoEntry>, paths: string[]): MenuEntry[] {
  const real = g.root !== NO_ROOT;
  const name = repoName(g.root) || g.root;
  const head = () => document.querySelector<HTMLElement>(`[data-folder-head="${CSS.escape(g.root)}"]`);
  const anyOpen = ctx.roots.some((r) => fold.isOpen("roots", r));
  return [
    { heading: g.root },
    ...(real
      ? [{ tiles: [
          { label: t.common.openFolder, icon: FolderOpen, run: () => toasts.safely(() => api.openFolder(g.root)) },
          { label: t.common.openTerminal, icon: SquareTerminal, run: () => toasts.safely(() => api.openTerminal(g.root)) },
          { label: t.menu.copyPath, icon: Copy, run: () => toasts.copy(g.root) },
        ] }]
      : []),
    ...setEntries({ name, paths, openSwitch: (mode, live) => openSwitch({ name, paths: live }, mode, head()) }),
    "sep",
    foldEntry(anyOpen, (open) => fold.setAll("roots", ctx.roots, open), { fold: t.sidebar.collapseAll, unfold: t.sidebar.expandAll }),
    ...(real ? [{ label: t.identity.menu, icon: Palette, hint: t.identity.folderHint, run: () => identities.openIdentity("folder", g.root, name) }] : []),
    {
      label: t.groupFromFolder.label,
      icon: Boxes,
      hint: t.groupFromFolder.hint,
      disabled: g.repos.length ? undefined : t.repoGroups.nothing,
      run: () => repoActions.setRepoGroups(withGroup(settings.config?.repoGroups ?? [], { id: newGroupId(), name, paths: g.repos.map((r) => r.info.path) }), t.repoGroups.created(name)),
    },
    ...(real ? [{ label: t.clone.menu, icon: Download, hint: t.clone.menuTip, run: () => (dialogs.cloneOpen = { parent: g.root }) }] : []),
    { label: t.sidebar.addRoot, icon: FolderPlus, run: ctx.pickRoots },
    { label: t.sidebar.manageRoots, icon: SlidersHorizontal, run: () => dialogs.openSettings("repos") },
    ...(real ? ["sep" as const, { label: t.sidebar.removeRootMenu, icon: FolderMinus, danger: true, run: () => repoActions.removeRoot(g.root) }] : []),
  ];
}
