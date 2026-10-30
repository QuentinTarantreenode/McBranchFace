import { Eye, EyeOff } from "@lucide/svelte";
import { dateOnly } from "$lib/format";
import { t } from "$lib/i18n/index.svelte";
import type { MenuEntry, MenuItem } from "$lib/ui/menu.svelte";
import { rules } from "$lib/stores/rules.svelte";

export const untilText = (until: number | null) =>
  until === null ? t.cleanup.ignoredForever : t.cleanup.ignoredUntil(dateOnly(until));

/** The choices of how long to ignore; shared by the context menu and the detail action bar. */
export function ignoreChoices(repoPath: string, branch: string, online: boolean): MenuEntry[] {
  const set = (days: number | null) => () => rules.setIgnore(repoPath, branch, online, days);
  return [
    { heading: t.detail.ignoreHint },
    { label: t.detail.ignore30, run: set(30) },
    { label: t.detail.ignore90, run: set(90) },
    { label: t.detail.ignoreForever, run: set(null) },
  ];
}

export function ignoreItem(b: { repoPath: string; name: string; ignored: boolean }, online: boolean): MenuItem {
  if (b.ignored) {
    return {
      label: t.detail.unignore,
      icon: Eye,
      hint: untilText(rules.ignoreOf(b.repoPath, b.name)?.until ?? null),
      run: () => rules.clearIgnore(b.repoPath, b.name, online),
    };
  }
  return { label: t.detail.ignore, icon: EyeOff, submenu: ignoreChoices(b.repoPath, b.name, online), run: () => {} };
}
