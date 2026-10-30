// What the bell tells outside the window: which stale branches are new since the last look, and the tray's
// tooltip and menu.
import type { TrayStatus } from "./bindings/TrayStatus";

const SEEN_KEY = "mbf.seenStale";

/** The stale branches of the last look; null when none was kept. */
export function loadSeen(): Set<string> | null {
  try {
    const raw = localStorage.getItem(SEEN_KEY);
    return raw ? new Set(JSON.parse(raw) as string[]) : null;
  } catch {
    return null;
  }
}

export function saveSeen(keys: string[]) {
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify(keys));
  } catch {
    /* private storage unavailable: the next scan simply notifies again */
  }
}

/** The tray's texts in the current language. */
export interface TrayTexts {
  open: string;
  refresh: string;
  notify: string;
  quit: string;
  tooltip: (count: number) => string;
  tooltipNone: string;
}

/** Tray tooltip and menu with the number the bell shows. */
export function trayStatus(bellCount: number, notifyOn: boolean, texts: TrayTexts): TrayStatus {
  return {
    tooltip: bellCount ? texts.tooltip(bellCount) : texts.tooltipNone,
    open: texts.open,
    refresh: texts.refresh,
    notify: texts.notify,
    notifyOn,
    quit: texts.quit,
  };
}
