// Deleting: the job of the delete dialog and the journal of what was deleted ("Recently deleted"). The
// dialog's flow loads on the first delete (deleteFlow.ts), so the start page does not carry it.
import { api } from "$lib/api";
import type { BranchReport } from "$lib/bindings/BranchReport";
import type { DeletedEntry } from "$lib/bindings/DeletedEntry";
import type { RemoteBranchReport } from "$lib/bindings/RemoteBranchReport";
import type { LocalJob, OnlineJob } from "$lib/deleteFlow";
import { toasts } from "./toasts.svelte";

export type { LocalJob };

const flow = () => import("$lib/deleteFlow");

class Deletes {
  /** The journal, newest first; replaced as a whole. */
  deleted = $state.raw<DeletedEntry[]>([]);
  /** The delete dialog's job; one at a time. */
  deleteJob = $state.raw<LocalJob | OnlineJob | null>(null);

  resetForTests() {
    this.deleted = [];
    this.deleteJob = null;
  }

  get running() {
    return this.deleteJob?.phase === "running";
  }

  async loadDeleted() {
    try {
      this.deleted = await api.deletedEntries();
    } catch (e) {
      toasts.fail(e);
    }
  }

  /** Every delete goes through the dialog; nothing opens while one runs. */
  async openDelete(branches: BranchReport[], force = false) {
    const job = (await flow()).localJob(branches, force);
    if (job && !this.running) this.deleteJob = job;
  }

  async openOnlineDelete(branches: RemoteBranchReport[], force = false) {
    const job = (await flow()).onlineJob(branches, force);
    if (job && !this.running) this.deleteJob = job;
  }

  closeDelete() {
    if (!this.running) this.deleteJob = null;
  }
}

export const deletes = new Deletes();
