import { Play, Plus, SquareTerminal, TerminalSquare } from "@lucide/svelte";
import { t } from "$lib/i18n/index.svelte";
import type { MenuEntry, MenuItem } from "$lib/ui/menu.svelte";
import { commandRuns } from "$lib/stores/commandRuns.svelte";
import { dialogs } from "$lib/stores/dialogs.svelte";

const create = (): MenuItem => ({ label: t.commands.create, icon: Plus, run: () => dialogs.openSettings("commands") });

/**
 * "Commands ▸" for one repository or branch, or for several repositories at once (a folder, a group).
 * Several repos list only the commands meant for every one of them: a command limited to some repos must
 * not run in the others. Without a fitting command it offers to create one.
 */
export function commandsItem(repoPaths: string[], branch: string | null = null): MenuItem {
  const [first, ...rest] = repoPaths;
  const list = first ? commandRuns.commandsFor(first, branch).filter((c) => rest.every((p) => commandRuns.commandsFor(p, branch).includes(c))) : [];
  const entries: MenuEntry[] = list.map((c) => ({
    label: repoPaths.length > 1 ? `${c.name} – ${t.commands.runAll(repoPaths.length)}` : c.name,
    icon: c.mode === "Terminal" ? SquareTerminal : Play,
    hint: c.script.split("\n")[0].slice(0, 60),
    run: () => repoPaths.forEach((p) => commandRuns.runCommand(c, p, branch)),
  }));
  entries.push(...(list.length ? (["sep"] as MenuEntry[]) : []), create());
  return { label: t.commands.menu, icon: TerminalSquare, submenu: entries, run: () => {} };
}
