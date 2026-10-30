// What the appearance settings do to the page and the window: theme, motion and zoom. Side effects only;
// the settings store decides when they apply.
import { appWindow } from "./appWindow";
import type { Theme } from "./bindings/Theme";
import { minWindow, nearestScale } from "./scale";

const systemDark = typeof matchMedia === "function" ? matchMedia("(prefers-color-scheme: dark)") : null;
let followingSystem = false;

/** Puts the theme on the page and the window frame; returns what the page shows. */
export function applyTheme(theme: Theme, motion: string | undefined): "dark" | "light" {
  const th = theme === "System" ? (systemDark?.matches === false ? "light" : "dark") : theme === "Dark" ? "dark" : "light";
  document.documentElement.dataset.theme = th;
  applyMotion(motion);
  appWindow.setTheme(theme === "System" ? null : th).catch(() => {});
  return th;
}

/** The system can switch while the app runs (night mode, a schedule): `changed` hears it, once per run. */
export function followSystemTheme(changed: () => void) {
  if (followingSystem || !systemDark) return;
  followingSystem = true;
  systemDark.addEventListener("change", changed);
}

/** Whether the page animates: the CSS reads the attribute (see app.css, "motion"). */
export function applyMotion(motion: string | undefined) {
  document.documentElement.dataset.motion = motion === "system" || motion === "off" ? motion : "on";
}

/**
 * The whole interface zooms; the minimum window grows along, so the layout keeps its CSS pixels.
 * The failure, if any, for the caller to name.
 */
export async function applyScale(scale: number): Promise<unknown> {
  const s = nearestScale(scale);
  const min = minWindow(s, { width: screen.availWidth, height: screen.availHeight });
  try {
    await Promise.all([appWindow.setZoom(s / 100), appWindow.setMinSize(min.width, min.height)]);
    return null;
  } catch (e) {
    return e;
  }
}
