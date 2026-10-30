import { Copy } from "@lucide/svelte";
import { t } from "$lib/i18n/index.svelte";
import type { MenuEntry } from "$lib/ui/menu.svelte";
import { toasts } from "$lib/stores/toasts.svelte";

/** Copy entries for a branch: the name as git takes it, and with its remote where it has one. */
export function copyBranchEntries(name: string, remote: string | null = null): MenuEntry[] {
  const entries: MenuEntry[] = [{ label: t.common.copyBranch, icon: Copy, run: () => toasts.copy(name) }];
  if (remote) entries.push({ label: t.common.copyWithRemote(`${remote}/${name}`), icon: Copy, run: () => toasts.copy(`${remote}/${name}`) });
  return entries;
}
