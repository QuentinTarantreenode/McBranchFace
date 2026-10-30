// Deleting and restoring: the dialog's job from confirm to result. Loaded on the first delete, so the
// start page does not carry it. What follows a delete (reassessing the repos) is handed in by the caller.
import { api, isFailure } from "./api";
import { branchKey, onlineKey } from "./filter";
import { t } from "./i18n/index.svelte";
import { cleanupView } from "./stores/cleanupView.svelte";
import { gitClaims } from "./stores/gitClaims.svelte";
import { scanResults } from "./stores/scanResults.svelte";
import { toasts } from "./stores/toasts.svelte";
import { DeleteJob } from "./deleteJob.svelte";
import { isStashEntry, isWorktreeEntry } from "./deleted";
import type { BranchReport } from "./bindings/BranchReport";
import type { DeletedEntry } from "./bindings/DeletedEntry";
import type { DeleteRequest } from "./bindings/DeleteRequest";
import type { RemoteBranchReport } from "./bindings/RemoteBranchReport";
import type { RemoteDeleteRequest } from "./bindings/RemoteDeleteRequest";

export type LocalJob = DeleteJob<BranchReport, DeleteRequest>;
export type OnlineJob = DeleteJob<RemoteBranchReport, RemoteDeleteRequest>;

/** What follows a delete or a restore: the app around the flow reassesses and reloads. */
export interface Followers {
  /** Reassesses a repo after its branches changed. */
  rescan(path: string): Promise<void>;
  /** Reassesses a repo's server branches. */
  refreshOnline(path: string): Promise<void>;
  /** Reads the journal of deleted branches again. */
  loadDeleted(): Promise<void>;
}

/** The plain request for a local branch: no force, nothing dropped or removed along with it. */
export const deleteRequest = (b: BranchReport): DeleteRequest => ({
  repoPath: b.repoPath,
  branch: b.name,
  expectedSha: b.sha,
  force: false,
  dropStashes: [],
  removeWorktree: false,
});

/** Every delete goes through the dialog: confirm, progress, result. Locked branches never enter it. */
export function localJob(branches: BranchReport[], force: boolean): LocalJob | null {
  const list = branches.filter((b) => !b.locked);
  return list.length ? new DeleteJob(list, force, deleteRequest, branchKey, "local") : null;
}

export function onlineJob(branches: RemoteBranchReport[], force: boolean): OnlineJob | null {
  const list = branches.filter((b) => !b.locked);
  if (!list.length) return null;
  const req = (b: RemoteBranchReport): RemoteDeleteRequest => ({
    repoPath: b.repoPath,
    remote: b.remote,
    branch: b.name,
    expectedSha: b.sha,
    force,
  });
  const job = new DeleteJob(list, force, req, onlineKey, "online");
  // Deleting on the server affects others: in a bulk delete their branches are listed but unticked.
  // A single branch the user picked explicitly stays selected.
  if (list.length > 1) for (const b of list) if (!b.isMine) job.exclude(onlineKey(b));
  job.alsoLocal = !force;
  return job;
}

/** Local branches that tracked a server branch just deleted: prune the stale tracking ref, then
 *  delete them through the normal local pipeline, which skips anything not Safe. */
async function deleteLocalCopies(job: OnlineJob, then: Followers) {
  // A retry must not handle the copies of earlier successes again.
  const fresh = job.succeeded.filter((i) => !job.followedUp.has(i.key));
  fresh.forEach((i) => job.followedUp.add(i.key));
  const deleted = fresh.map((i) => i.branch);
  const copies = deleted.flatMap((b) => scanResults.localCopiesOf(b).map((c) => ({ ...c, remote: b.remote, server: b.name })));
  for (const c of copies) await toasts.safely(() => api.pruneTracking(c.repoPath, c.remote, c.server));
  await Promise.all([...new Set(copies.map((c) => c.repoPath))].map((p) => then.rescan(p)));
  for (const c of copies) {
    const b = scanResults.allBranches.find((x) => x.repoPath === c.repoPath && x.name === c.branch);
    const entry = { repoPath: c.repoPath, branch: c.branch };
    if (!b) job.followUps.push({ ...entry, status: "skipped", reason: t.failure.NoLongerCandidate.title, entryId: null });
    else if (b.locked) job.followUps.push({ ...entry, status: "skipped", reason: t.cleanup.lockedSection, entryId: null });
    else if (b.verdict !== "Safe") job.followUps.push({ ...entry, status: "skipped", reason: t.verdict[b.verdict].hint, entryId: null });
    else {
      try {
        const out = await api.deleteBranch(deleteRequest(b));
        job.followUps.push({ ...entry, status: "ok", reason: null, entryId: out.entry.id });
      } catch (e) {
        const kind = isFailure<{ kind: keyof typeof t.failure }>(e) ? e.kind : "Other";
        job.followUps.push({ ...entry, status: "failed", reason: t.failure[kind].title, entryId: null });
      }
    }
  }
  if (copies.length) await Promise.all([...new Set(copies.map((c) => c.repoPath))].map((p) => then.rescan(p)));
}

export async function runDelete(job: LocalJob | OnlineJob, then: Followers) {
  // The repos stay claimed while their branches go: the Git view waits, a group action does not run beside it.
  const paths = [...new Set(job.items.filter((i) => i.status === "pending").map((i) => i.branch.repoPath))];
  const ran = await gitClaims.withClaim(paths, "", async () => {
    const marked = job.items.filter((i) => i.status === "pending").map((i) => i.key);
    for (const k of marked) cleanupView.busy.add(k);
    try {
      if (job.mode === "online") {
        await (job as OnlineJob).runAll((reqs) => api.deleteRemoteBranches(reqs));
        if (job.alsoLocal && job.succeeded.length) await deleteLocalCopies(job as OnlineJob, then);
      } else {
        await (job as LocalJob).run((req) => api.deleteBranch(req));
      }
    } finally {
      // Rows marked as working must not stay so when the run broke off unexpectedly.
      for (const k of marked) cleanupView.busy.delete(k);
    }
  });
  if (!ran) return;
  for (const i of job.items) if (i.status === "ok") cleanupView.checked.delete(i.key);
  const repos = new Set(job.items.filter((i) => i.status !== "skipped").map((i) => i.branch.repoPath));
  if (job.mode === "online") {
    const gone = new Set(job.succeeded.map((i) => i.key));
    for (const path of new Set(job.succeeded.map((i) => i.branch.repoPath))) {
      scanResults.updateResult(path, (r) => (r.online ? { ...r, online: r.online.filter((b) => !gone.has(onlineKey(b))) } : r));
    }
  }
  await Promise.all([...repos].map((r) => then.rescan(r)));
  await then.loadDeleted();
}

export async function restore(ids: string[], then: Followers) {
  const restored: DeletedEntry[] = [];
  for (const id of ids) {
    try {
      restored.push(await api.restoreBranch(id));
    } catch (e) {
      toasts.fail(e);
    }
  }
  await Promise.all([...new Set(restored.map((e) => e.repoPath))].map((r) => then.rescan(r)));
  await Promise.all([...new Set(restored.filter((e) => e.remote).map((e) => e.repoPath))].map((r) => then.refreshOnline(r)));
  await then.loadDeleted();
  // What came back, not what was asked for: a restore that failed was named already.
  const [one] = restored;
  if (restored.length > 1) toasts.toast("success", t.deleted.restoredMany(restored.length));
  else if (one) toasts.toast("success", isStashEntry(one) ? t.deleted.restoredStash : isWorktreeEntry(one) ? t.deleted.restoredWorktree : t.deleted.restoredOne);
}
