// Answers arrive in any order: only the one asked for last may land. One place for that rule, for a single
// kind of request (Latest) and per key (Tickets). Plain, without runes.

/** Requests of one kind: a ticket is current until a newer one is drawn. */
export class Latest {
  private drawn = 0;

  /** A new request: every earlier ticket is old from now on. The check says whether this one still is the newest. */
  next(): () => boolean {
    const mine = ++this.drawn;
    return () => mine === this.drawn;
  }

  /** A check for the ticket as it is now, without drawing one: still true while no newer one was drawn. */
  now(): () => boolean {
    const mine = this.drawn;
    return () => mine === this.drawn;
  }
}

/** Requests per key (a repo's status, its result): each key has its own line of tickets. */
export class Tickets<K = string> {
  private drawn = new Map<K, number>();

  next(key: K): () => boolean {
    const mine = (this.drawn.get(key) ?? 0) + 1;
    this.drawn.set(key, mine);
    return () => this.drawn.get(key) === mine;
  }
}

/** Where waiting runs are scheduled: plain timers, or a set its owner can end as a whole. */
export interface Scheduler {
  after(ms: number, run: () => void): unknown;
  cancel(handle: unknown): void;
  /** Whether the run still waits: a set ended as a whole drops it without the throttle knowing. */
  alive(handle: unknown): boolean;
}

const plainTimers: Scheduler = { after: (ms, run) => setTimeout(run, ms), cancel: (h) => clearTimeout(h as ReturnType<typeof setTimeout>), alive: () => true };

/**
 * Per key at most once per gap: the first call after a quiet spell runs at once; calls within the gap wait
 * and run once at its end, so the last change is never lost.
 */
export class Throttle {
  private last = new Map<string, number>();
  private timers = new Map<string, unknown>();

  constructor(private schedule: Scheduler = plainTimers) {}

  /** True when `work` ran at once; false when it waits for the end of the gap (or already did). */
  run(key: string, gap: number, work: () => void): boolean {
    if (this.timers.has(key) && this.schedule.alive(this.timers.get(key))) return false;
    const go = () => {
      this.timers.delete(key);
      this.last.set(key, Date.now());
      work();
    };
    const wait = Math.max(0, (this.last.get(key) ?? 0) + gap - Date.now());
    if (!wait) {
      go();
      return true;
    }
    this.timers.set(key, this.schedule.after(wait, go));
    return false;
  }

  /** Forgets the keys `keep` turns down: what waits for them would only run into nothing. */
  forget(keep: (key: string) => boolean) {
    for (const [key, h] of this.timers) {
      if (keep(key)) continue;
      this.schedule.cancel(h);
      this.timers.delete(key);
    }
    for (const key of this.last.keys()) if (!keep(key)) this.last.delete(key);
  }
}
