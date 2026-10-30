// What the app does right now and did a moment ago: reading a status, reassessing a repo, loading pull
// requests, a fetch across a group. The user's own runs always show in the top bar with progress and a
// way to stop them. The background work shows there only when the setting asks for it, and is written to
// the diagnostics log when that is on; with both off, it records nothing and costs nothing.
import { SvelteMap } from "svelte/reactivity";
import { api, explainError } from "$lib/api";
import { PROBED } from "$lib/probe";
import { timers, type TimerHandle } from "$lib/timers";
import { settings } from "./settings.svelte";

export type Outcome = "ok" | "failed" | "cancelled";

export interface Activity {
  id: number;
  text: string;
  path: string | null;
  started: number;
  ended?: number;
  outcome?: Outcome;
  detail?: string;
  /** Started by the user: shown in any case, with progress and stop. */
  own: boolean;
  progress?: { done: number; total: number };
  cancel?: () => void;
  /** Written by the backend already (its external calls). */
  noLog?: boolean;
}

const KEEP = 100;

class ActivityLog {
  running = new SvelteMap<number, Activity>();
  /** Newest first; replaced as a whole, never mutated, so no deep tracking. */
  recent = $state.raw<Activity[]>([]);
  private next = 1;
  private lines: string[] = [];
  private flushing: TimerHandle | null = null;

  resetForTests() {
    timers.cancel(this.flushing);
    this.flushing = null;
    this.lines = [];
    this.running.clear();
    this.recent = [];
  }

  get shown() {
    return !!settings.config?.ui.activityShown;
  }
  private get logged() {
    return !!settings.config?.diagnostics;
  }

  /** The newest running one the top bar names: the user's own first. */
  get front(): Activity | null {
    let own: Activity | null = null;
    let any: Activity | null = null;
    for (const a of this.running.values()) {
      if (a.own) own = a;
      any = a;
    }
    return own ?? (this.shown ? any : null);
  }

  /** 0 when nothing would show or log it: background work then costs nothing. */
  begin(text: string, path: string | null = null, opts: { own?: boolean; total?: number; cancel?: () => void; noLog?: boolean } = {}): number {
    const own = !!opts.own;
    if (!own && !this.shown && !this.logged) return 0;
    const a: Activity = { id: this.next++, text, path, started: Date.now(), own, cancel: opts.cancel, noLog: opts.noLog, progress: opts.total ? { done: 0, total: opts.total } : undefined };
    this.running.set(a.id, a);
    return a.id;
  }

  step(id: number, done: number, text?: string) {
    const a = this.running.get(id);
    if (!a?.progress) return;
    this.running.set(id, { ...a, progress: { ...a.progress, done }, text: text ?? a.text });
  }

  end(id: number, outcome: Outcome = "ok", detail?: string) {
    const a = this.running.get(id);
    if (!a) return;
    this.running.delete(id);
    const done: Activity = { ...a, ended: Date.now(), outcome, detail, cancel: undefined };
    // The list is for the panel, which only the setting opens; own runs land there too.
    if (this.shown || a.own) this.recent = [done, ...this.recent].slice(0, KEEP);
    if (this.logged && !a.noLog) this.log(done);
  }

  /** Runs `work` as one activity; its failure is recorded and passed on. */
  async track<T>(text: string, path: string | null, work: () => Promise<T>, own = false): Promise<T> {
    const id = this.begin(text, path, { own });
    try {
      const r = await work();
      this.end(id);
      return r;
    } catch (e) {
      this.end(id, "failed", explainError(e).text);
      throw e;
    }
  }

  clear() {
    this.recent = [];
  }

  // One write per second at most: a burst of status reads must not become a burst of file writes.
  private log(a: Activity) {
    const took = (a.ended ?? a.started) - a.started;
    this.lines.push(`activity ${String(took).padStart(6)}ms ${(a.outcome ?? "").padEnd(9)} ${a.text}${a.path ? ` [${a.path}]` : ""}${a.detail ? ` – ${a.detail}` : ""}`);
    this.flushing ??= timers.after(1000, () => {
      this.flushing = null;
      const lines = this.lines.splice(0);
      if (lines.length) api.diagnosticsNote(lines).catch(() => {});
    });
  }
}

export const activity = new ActivityLog();
if (PROBED) (globalThis as Record<string, unknown>).__mbfActivity = activity;
