// Why the app refreshed: each trigger as it fired, what it named and what followed from it. Held for this
// run only, never written: it answers "why does it reload so often?" while the app runs.
export type TriggerKind = "start" | "manual" | "autoFetch" | "serverCheck" | "watchFiles" | "watchRefs" | "afterScan";
/** What followed: read a status, reassess the repo, a scan, a fetch, nothing, or held back. */
export type TriggerEffect = "status" | "rescan" | "scan" | "fetch" | "none" | "throttled" | "off" | "busy";

export interface TriggerEntry {
  id: number;
  at: number;
  kind: TriggerKind;
  path: string | null;
  /** The files that fired it (watcher), at most a few. */
  files: string[];
  effect: TriggerEffect;
}

const KEEP = 300;

class Triggers {
  /** Newest first; replaced as a whole, so nothing tracks into it. */
  entries = $state.raw<TriggerEntry[]>([]);
  private next = 1;

  resetForTests() {
    this.entries = [];
  }

  add(kind: TriggerKind, effect: TriggerEffect, path: string | null = null, files: string[] = []) {
    this.entries = [{ id: this.next++, at: Date.now(), kind, path, files, effect }, ...this.entries].slice(0, KEEP);
  }

  clear() {
    this.entries = [];
  }
}

export const triggers = new Triggers();
