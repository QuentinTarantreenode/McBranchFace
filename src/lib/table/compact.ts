/** Compaction levels of the table toolbar, from full labels to icons only. */
export const COMPACT_MAX = 4;

export interface CompactInput {
  level: number;
  max: number;
  /** Width the bar offers for its content. */
  available: number;
  /** Width the content needs at the current level. */
  needed: number;
  /** Content width measured per level; undefined where it is not known (yet). */
  widths: readonly (number | undefined)[];
}

/**
 * The level to try next. Grows while the content overflows; shrinks only when the level above was
 * measured to fit, so a bar that is just too narrow for it does not flip back and forth. An unknown
 * width is probed once: the step back up records it.
 */
export function nextCompactLevel({ level, max, available, needed, widths }: CompactInput): number {
  const current = Math.min(Math.max(Math.round(level), 0), max);
  if (needed > available + 1) return Math.min(current + 1, max);
  if (current === 0) return 0;
  const wider = widths[current - 1];
  if (wider === undefined) return current - 1;
  return wider <= available ? current - 1 : current;
}
