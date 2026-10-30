// Menus of the repo groups. They load on the first open: nothing here is needed to show the groups.
import { Palette, Pencil, Trash2 } from "@lucide/svelte";
import type { RepoGroup } from "$lib/bindings/RepoGroup";
import { t } from "$lib/i18n/index.svelte";
import { withoutGroup } from "$lib/repoGroups";
import type { SwitchMode } from "./repoGroupDrop.svelte";
import type { MenuEntry } from "$lib/ui/menu.svelte";
import { foldEntry } from "./selectMenu";
import { setEntries } from "./setMenu";
import { identities } from "$lib/stores/identities.svelte";
import { fold } from "$lib/stores/fold.svelte";
import { settings } from "$lib/stores/settings.svelte";
import { repoActions } from "$lib/services/repoActions.svelte";

export interface RepoGroupMenuContext {
  openSwitch: (g: RepoGroup, mode: SwitchMode) => void;
  rename: (g: RepoGroup) => void;
  /** The groups shown, for folding them all. */
  ids: string[];
}

export function groupMenu(ctx: RepoGroupMenuContext, g: RepoGroup): MenuEntry[] {
  return [
    { heading: g.name },
    ...setEntries({ name: g.name, paths: g.paths, openSwitch: (mode) => ctx.openSwitch(g, mode) }),
    "sep",
    foldEntry(ctx.ids.some((id) => fold.isOpen("repoGroups", id)), (open) => fold.setAll("repoGroups", ctx.ids, open), { fold: t.repoGroups.foldAll, unfold: t.repoGroups.unfoldAll }),
    { label: t.repoGroups.rename, icon: Pencil, keys: "F2", run: () => ctx.rename(g) },
    { label: t.identity.menu, icon: Palette, hint: t.identity.groupHint, run: () => identities.openIdentity("group", g.id, g.name) },
    {
      label: t.repoGroups.remove,
      icon: Trash2,
      hint: t.repoGroups.removeHint,
      danger: true,
      run: () => repoActions.setRepoGroups(withoutGroup(settings.config?.repoGroups ?? [], g.id), t.repoGroups.deleted(g.name)),
    },
  ];
}
