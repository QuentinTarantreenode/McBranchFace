import { errorText } from "./api";
import type { DeleteFailure } from "./bindings/DeleteFailure";
import type { DeleteOutcome } from "./bindings/DeleteOutcome";

/** "excluded": unticked by the user before the start; never run, never retried. */
export type ItemStatus = "pending" | "running" | "ok" | "failed" | "skipped" | "excluded";
/** Local branches or branches on the server; the dialog words its questions accordingly. */
export type DeleteMode = "local" | "online";

interface Branchlike {
  repoPath: string;
  name: string;
}

export interface JobItem<B extends Branchlike = Branchlike, R = unknown> {
  key: string;
  branch: B;
  request: R;
  status: ItemStatus;
  failure: DeleteFailure | null;
  outcome: DeleteOutcome | null;
}

export type Phase = "confirm" | "running" | "done";

/** A local tracking branch handled after its server branch was deleted. */
export interface FollowUp {
  repoPath: string;
  branch: string;
  status: "ok" | "failed" | "skipped";
  /** Failure title or the reason for skipping, already worded. */
  reason: string | null;
  /** Journal entry of a deleted copy, so "undo" restores it together with the server branch. */
  entryId: string | null;
}

function toFailure(e: unknown): DeleteFailure {
  if (e && typeof e === "object" && "kind" in e && "step" in e) return e as DeleteFailure;
  return { kind: "Other", step: "Verify", detail: errorText(e), path: null, changed: false };
}

/** One confirm → run → result cycle of the delete dialog; runs sequentially so progress is exact. */
export class DeleteJob<B extends Branchlike = Branchlike, R extends object = object> {
  readonly force: boolean;
  readonly mode: DeleteMode;
  items = $state<JobItem<B, R>[]>([]);
  phase = $state<Phase>("confirm");
  stopRequested = $state(false);
  overrides: Partial<R> = {};

  /** Items that take part in this run: everything the user did not untick. */
  active = $derived(this.items.filter((i) => i.status !== "excluded"));
  finished = $derived(this.active.filter((i) => i.status !== "pending" && i.status !== "running").length);
  succeeded = $derived(this.items.filter((i) => i.status === "ok"));
  failed = $derived(this.items.filter((i) => i.status === "failed"));
  skipped = $derived(this.items.filter((i) => i.status === "skipped"));
  current = $derived(this.items.find((i) => i.status === "running") ?? null);
  selected = $derived(this.items.filter((i) => i.status === "pending"));
  /** Online only: also delete the local branches that tracked a deleted server branch. */
  alsoLocal = $state(false);
  followUps = $state<FollowUp[]>([]);
  /** Keys whose local copies were already handled. */
  readonly followedUp = new Set<string>();

  constructor(branches: B[], force: boolean, request: (b: B) => R, key: (b: B) => string, mode: DeleteMode = "local") {
    this.force = force;
    this.mode = mode;
    this.items = branches.map((b) => ({ key: key(b), branch: b, request: request(b), status: "pending", failure: null, outcome: null }));
  }

  exclude(key: string) {
    const i = this.items.find((x) => x.key === key);
    if (i && this.phase === "confirm") i.status = "excluded";
  }

  include(key: string) {
    const i = this.items.find((x) => x.key === key);
    if (i && this.phase === "confirm") i.status = "pending";
  }

  /** All selected items in one call; the backend answers per item, in request order. */
  async runAll(execute: (reqs: R[]) => Promise<{ outcome: DeleteOutcome | null; failure: DeleteFailure | null }[]>) {
    this.phase = "running";
    const items = this.items.filter((i) => i.status === "pending");
    for (const i of items) i.status = "running";
    try {
      const results = await execute(items.map((i) => ({ ...i.request, ...this.overrides })));
      items.forEach((item, n) => {
        const r = results[n];
        item.outcome = r?.outcome ?? null;
        item.failure = r?.failure ?? (r?.outcome ? null : toFailure("no result"));
        item.status = item.outcome ? "ok" : "failed";
      });
    } catch (e) {
      for (const item of items) {
        item.failure = toFailure(e);
        item.status = "failed";
      }
    }
    this.phase = "done";
  }

  async run(execute: (req: R) => Promise<DeleteOutcome>) {
    this.phase = "running";
    this.stopRequested = false;
    for (const item of this.items) {
      if (item.status !== "pending") continue;
      if (this.stopRequested) {
        item.status = "skipped";
        continue;
      }
      item.status = "running";
      try {
        item.outcome = await execute({ ...item.request, ...this.overrides });
        item.status = "ok";
      } catch (e) {
        item.failure = toFailure(e);
        item.status = "failed";
      }
    }
    this.phase = "done";
  }

  requeueUnfinished() {
    for (const item of this.items) {
      if (item.status === "failed" || item.status === "skipped") {
        item.status = "pending";
        item.failure = null;
      }
    }
  }
}
