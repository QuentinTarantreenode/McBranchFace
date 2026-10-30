/** Interface zoom: the steps offered, and what a step means for the window. Pure. */

/** Same steps as the backend keeps (config.rs `SCALES`). */
export const SCALES = [100, 115, 130] as const;
export type Scale = (typeof SCALES)[number];
export const DEFAULT_SCALE: Scale = 115;

/** The smallest window the layout is designed for, in CSS pixels (tauri.conf.json minWidth/minHeight). */
const MIN_WINDOW = { width: 1100, height: 620 };

export function nearestScale(v: number): Scale {
  return SCALES.reduce((best, s) => (Math.abs(s - v) < Math.abs(best - v) ? s : best), DEFAULT_SCALE);
}

/** One step up or down, staying at the ends. */
export function stepScale(current: number, dir: 1 | -1): Scale {
  const i = SCALES.indexOf(nearestScale(current));
  return SCALES[Math.max(0, Math.min(SCALES.length - 1, i + dir))];
}

/**
 * The window's minimum size at a zoom: the layout needs its CSS pixels, so a larger zoom needs a
 * larger window. Never more than the screen offers, or the window could not be placed at all.
 */
export function minWindow(scale: number, screen: { width: number; height: number }) {
  const f = scale / 100;
  const cap = (want: number, have: number) => Math.round(have > 0 ? Math.min(want, have * 0.9) : want);
  return { width: cap(MIN_WINDOW.width * f, screen.width), height: cap(MIN_WINDOW.height * f, screen.height) };
}
