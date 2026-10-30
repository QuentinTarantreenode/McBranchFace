/** A periodic job is due when its interval has passed and nothing else is running. 0 minutes = off. */
export function due(now: number, last: number, minutes: number, busy: boolean): boolean {
  return minutes > 0 && !busy && now - last >= minutes * 60_000;
}
