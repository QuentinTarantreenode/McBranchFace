// Entries of the delete journal ("Recently deleted").
import type { DeletedEntry } from "./bindings/DeletedEntry";
import type { OnlineVerdict } from "./bindings/OnlineVerdict";

type Kind = Pick<DeletedEntry, "branch" | "remote"> & Partial<Pick<DeletedEntry, "removedWorktree">>;

/** A worktree removed on its own: no branch went, only its folder moved to the backups. */
export const isWorktreeEntry = (e: Kind) => !e.branch && !e.remote && !!e.removedWorktree;

/** A stash dropped on its own in the Git perspective: the journal keeps it without a branch. */
export const isStashEntry = (e: Kind) => !e.branch && !e.remote && !e.removedWorktree;

/**
 * The badge of a server branch in the journal, which keeps a local verdict for it as well: Safe when it was
 * merged, another one when it went unmerged (with force). Which online verdict an unmerged one had is not
 * kept, so it shows as Inactive, with the force mark beside it. A display mapping only: whether a branch
 * needs force to go is needsForce's decision, made on the branch itself before the delete.
 */
export const onlineVerdictOf = (e: Pick<DeletedEntry, "verdict">): OnlineVerdict => (e.verdict === "Safe" ? "Merged" : "Inactive");
