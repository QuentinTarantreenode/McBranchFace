// Every timer the stores start goes through one set: ending the app (or a test) ends all of them at once,
// and whether work still waits for a timer is one question. Intervals are kept apart: they always wait.
import { probe, PROBED } from "./probe";

export type TimerHandle = number;

interface Once {
  handle: ReturnType<typeof setTimeout>;
  /** Only tidies the screen (a toast leaving): no work waits for it. */
  cosmetic: boolean;
}

export class TimerSet {
  private next = 1;
  private once = new Map<TimerHandle, Once>();
  private repeating = new Map<TimerHandle, ReturnType<typeof setInterval>>();

  /** Runs `fn` once after `ms`. */
  after(ms: number, fn: () => void, opts: { cosmetic?: boolean } = {}): TimerHandle {
    const id = this.next++;
    const handle = setTimeout(() => {
      this.once.delete(id);
      try {
        fn();
      } finally {
        if (PROBED) probe.changed();
      }
    }, ms);
    this.once.set(id, { handle, cosmetic: !!opts.cosmetic });
    if (PROBED) probe.changed();
    return id;
  }

  /** Runs `fn` every `ms` until cancelled or cleared. */
  every(ms: number, fn: () => void): TimerHandle {
    const id = this.next++;
    this.repeating.set(id, setInterval(fn, ms));
    return id;
  }

  /** Ends one timer; an ended or unknown one is no error. */
  cancel(id: TimerHandle | null | undefined) {
    if (id === null || id === undefined) return;
    const once = this.once.get(id);
    if (once) {
      clearTimeout(once.handle);
      this.once.delete(id);
      if (PROBED) probe.changed();
    }
    const repeating = this.repeating.get(id);
    if (repeating !== undefined) {
      clearInterval(repeating);
      this.repeating.delete(id);
    }
  }

  /** Whether a timer still waits (a one-shot that has not run, an interval not ended). */
  alive(id: TimerHandle): boolean {
    return this.once.has(id) || this.repeating.has(id);
  }

  /** Ends every timer: what the app started stops with it. */
  clearAll() {
    for (const id of [...this.once.keys(), ...this.repeating.keys()]) this.cancel(id);
  }

  /** One-shot timers some work waits for: a save, a batch of results, a reassessment. */
  get pending(): number {
    let n = 0;
    for (const o of this.once.values()) if (!o.cosmetic) n++;
    return n;
  }
}

/** The one set the stores share. */
export const timers = new TimerSet();
