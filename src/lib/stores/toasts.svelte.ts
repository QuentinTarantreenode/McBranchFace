// What the user is told after an action or a failure: one line per message, gone after a while, with
// an action where there is one.
import { explainError } from "$lib/api";
import { t } from "$lib/i18n/index.svelte";
import { probe, PROBED } from "$lib/probe";
import { timers, type TimerHandle } from "$lib/timers";

export interface Toast {
  id: number;
  kind: "info" | "success" | "error";
  text: string;
  detail?: string;
  action?: { label: string; run: () => void };
}

/** How long a toast stays: one with an action longest, so there is time to use it. */
const TOAST_MS = { action: 15_000, error: 9_000, other: 4_000 };

class Toasts {
  /** Replaced as a whole on every change. */
  list = $state.raw<Toast[]>([]);
  private nextId = 0;
  private timers = new Map<number, TimerHandle>();

  resetForTests() {
    for (const h of this.timers.values()) timers.cancel(h);
    this.timers.clear();
    this.list = [];
  }

  toast(kind: Toast["kind"], text: string, extra: { detail?: string; action?: Toast["action"] } = {}) {
    if (PROBED) probe.record?.({ kind: "toast", level: kind, text, detail: extra.detail });
    const same = this.list.find((x) => x.text === text && x.kind === kind);
    // The same message twice in a row (e.g. several repos failing alike) is shown once. One with an action
    // replaces it instead: its action (an undo, the output of this run) belongs to the latest event.
    if (same && !extra.action) return;
    const id = same?.id ?? ++this.nextId;
    const toast: Toast = { id, kind, text, ...extra };
    this.list = same ? this.list.map((x) => (x.id === id ? toast : x)) : [...this.list, toast];
    timers.cancel(this.timers.get(id));
    const ms = extra.action ? TOAST_MS.action : kind === "error" ? TOAST_MS.error : TOAST_MS.other;
    this.timers.set(id, timers.after(ms, () => this.dismiss(id), { cosmetic: true }));
  }

  dismiss(id: number) {
    timers.cancel(this.timers.get(id));
    this.timers.delete(id);
    this.list = this.list.filter((x) => x.id !== id);
  }

  fail(e: unknown) {
    const x = explainError(e);
    this.toast("error", x.text, { detail: x.detail });
  }

  async safely(fn: () => Promise<unknown>) {
    try {
      await fn();
    } catch (e) {
      this.fail(e);
    }
  }

  copy(text: string) {
    void this.safely(async () => {
      await navigator.clipboard.writeText(text);
      this.toast("success", t.common.copied);
    });
  }
}

export const toasts = new Toasts();
