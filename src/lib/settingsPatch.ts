// What "Save" in the settings dialog writes. Pure; the dialog keeps its edits in a copy of the config
// taken when it opened.
import type { Config } from "./bindings/Config";
import { sameValue as same } from "./same";

/**
 * The fields the dialog edits and saves with "Save": whole, or key by key. Everything else (theme,
 * language, layout, locks, ignores, notes, colours, repo groups, roots dropped on the sidebar) applies at
 * once wherever it is changed, also while the dialog is open. Key by key, a key changed elsewhere
 * meanwhile (notifications switched in the tray) survives a save that did not touch it.
 */
const OWNED = {
  roots: "whole",
  scanDepth: "whole",
  protectedPatterns: "whole",
  defaultBranchCandidates: "whole",
  defaultBranchOverrides: "whole",
  myEmails: "whole",
  fetchOnScan: "whole",
  useProviders: "whole",
  concurrency: "whole",
  autoFetchMinutes: "whole",
  serverCheckMinutes: "whole",
  staleDays: "whole",
  scanOnline: "whole",
  commands: "whole",
  prompts: "whole",
  diagnostics: "whole",
  alerts: "keys",
  window: "keys",
  ui: ["refsGapSeconds"],
} as const satisfies Partial<Record<keyof Config, "whole" | "keys" | readonly string[]>>;

/**
 * What the dialog changed since it opened (`opened` → `edited`), as a patch for the config as it is now
 * (`current`): a field nobody touched in the dialog keeps what it has now.
 */
export function settingsPatch(opened: Config, edited: Config, current: Config): Partial<Config> {
  const patch: Record<string, unknown> = {};
  const [was, now, base] = [opened, edited, current] as unknown as Record<string, Record<string, unknown>>[];
  for (const [field, how] of Object.entries(OWNED)) {
    if (how === "whole") {
      if (!same(was[field], now[field])) patch[field] = now[field];
      continue;
    }
    const keys = how === "keys" ? Object.keys(now[field]) : how;
    const changed = keys.filter((k) => !same(was[field][k], now[field][k]));
    if (changed.length) patch[field] = { ...base[field], ...Object.fromEntries(changed.map((k) => [k, now[field][k]])) };
  }
  return patch as Partial<Config>;
}
