// Running what the delete dialog and "Recently deleted" ask for: the delete itself, a retry, the way back,
// and purging backups. Every repo a delete or restore touched is reassessed afterwards.
import { api } from "$lib/api";
import type { BranchReport } from "$lib/bindings/BranchReport";
import type { Followers } from "$lib/deleteFlow";
import { branchKey, needsForce } from "$lib/filter";
import { t } from "$lib/i18n/index.svelte";
import { deletes } from "$lib/stores/deletes.svelte";
import { scanResults } from "$lib/stores/scanResults.svelte";
import { toasts } from "$lib/stores/toasts.svelte";
import { repoActions } from "./repoActions.svelte";
import { scanner } from "./scanner.svelte";

// The flow loads on first use; the dialog appears once it is there.
const flow = () => import("$lib/deleteFlow");
const followers: Followers = {
  rescan: (path) => scanner.rescan(path),
  refreshOnline: (path) => scanner.refreshOnline(path),
  loadDeleted: () => deletes.loadDeleted(),
};

class Deleting {
  async runDelete() {
    const job = deletes.deleteJob;
    if (job) await (await flow()).runDelete(job, followers);
  }

  async retryDelete() {
    deletes.deleteJob?.requeueUnfinished();
    await this.runDelete();
  }

  /** Back to before the delete; local copies deleted along with their server branch come back too. */
  async undoDelete() {
    const job = deletes.deleteJob;
    const ids = [
      ...(job?.succeeded.map((i) => i.outcome!.entry.id) ?? []),
      ...(job?.followUps.map((f) => f.entryId).filter((x): x is string => !!x) ?? []),
    ];
    deletes.deleteJob = null;
    await this.restore(ids);
  }

  async restore(ids: string[]) {
    await (await flow()).restore(ids, followers);
  }

  async purge(ids: string[]) {
    try {
      const n = await api.purgeBackups(ids);
      await deletes.loadDeleted();
      toasts.toast("info", t.deleted.purged(n));
      if (n < ids.length) toasts.toast("error", t.deleted.purgeKept(ids.length - n));
    } catch (e) {
      toasts.fail(e);
    }
  }

  /** The two steps a checked-out, otherwise clean branch always needs: switch away, then delete. */
  async checkoutAndDelete(b: BranchReport) {
    const key = branchKey(b);
    if (!(await repoActions.checkoutDefault(b.repoPath))) return;
    const fresh = scanResults.allBranches.find((x) => branchKey(x) === key);
    if (fresh) await deletes.openDelete([fresh], needsForce(fresh));
  }
}

export const deleting = new Deleting();
