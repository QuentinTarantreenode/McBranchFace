// What the dev, audit and e2e builds let a test watch that is no reactive state: the commands in flight and
// the timers waiting, and a log of what the user was told and how commands ended. The release build never
// attaches to it (PROBED is false there and the calls fall away).
/** The builds that carry test hooks: every handle a script reads is put on the page only under this. */
export const PROBED = import.meta.env.DEV || import.meta.env.MODE === "audit" || import.meta.env.MODE === "e2e";

/** A message the user got, or a command and how it ended (its answer, or what it failed with). */
export type ProbeEvent =
  | { kind: "toast"; level: "info" | "success" | "error"; text: string; detail?: string }
  | { kind: "command"; command: string; ok: boolean; value: unknown };

/** One command sent to the backend, for the report of a failed test: what was asked, how long, how it ended. */
export interface InvokeRecord {
  id: number;
  command: string;
  /** The arguments as sent, as JSON cut to a readable length. */
  args: string;
  at: number;
  /** Null while it runs. */
  ms: number | null;
  ok: boolean | null;
  /** What it failed with, as JSON cut to a readable length. */
  error?: string;
}

/** How many of the last commands a report shows. */
const RECENT = 50;
const TEXT_MAX = 2000;

function clip(value: unknown): string {
  let text: string;
  try {
    text = JSON.stringify(value) ?? "";
  } catch {
    text = String(value);
  }
  return text.length > TEXT_MAX ? `${text.slice(0, TEXT_MAX)}…` : text;
}

class Probe {
  /** Commands sent to the backend and not answered yet. */
  invokes = 0;
  /** Where events go once a test hook attached; nothing is kept before. */
  record: ((e: ProbeEvent) => void) | null = null;
  /** The last commands, oldest first; a long one may have left this list while it still runs. */
  recent: InvokeRecord[] = [];
  /** The commands still running, however old. */
  running = new Map<number, InvokeRecord>();
  private next = 1;
  private listeners = new Set<() => void>();

  /** Called whenever something non-reactive changed: a command was sent or ended, a timer was set or ran. */
  listen(listener: () => void) {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  }

  changed() {
    for (const l of this.listeners) l();
  }

  /** Counts a command while it runs, and records how it ended. */
  track<T>(command: string, answer: Promise<T>, args?: unknown): Promise<T> {
    this.invokes++;
    const entry: InvokeRecord = { id: this.next++, command, args: args === undefined ? "" : clip(args), at: Date.now(), ms: null, ok: null };
    this.running.set(entry.id, entry);
    this.recent.push(entry);
    if (this.recent.length > RECENT) this.recent.splice(0, this.recent.length - RECENT);
    this.changed();
    const settle = (ok: boolean, value: unknown) => {
      this.invokes--;
      this.running.delete(entry.id);
      entry.ms = Date.now() - entry.at;
      entry.ok = ok;
      if (!ok) entry.error = clip(value);
      this.record?.({ kind: "command", command, ok, value });
      this.changed();
    };
    answer.then(
      (v) => settle(true, v),
      (e) => settle(false, e),
    );
    return answer;
  }
}

export const probe = new Probe();
