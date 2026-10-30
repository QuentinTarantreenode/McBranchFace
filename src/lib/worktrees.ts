// Rules about worktrees that the sidebar, the tips and the dashboard share.
import type { BranchReport } from "./bindings/BranchReport";
import type { RepoResult } from "./bindings/RepoResult";

const isDone = (b: BranchReport) => b.verdict === "Safe" && !!b.mergeEvidence;

/** The branch a worktree has checked out is merged, with evidence: the worktree has done its job. */
export const isMergedBranch = (result: Pick<RepoResult, "branches"> | null | undefined, name: string | null | undefined) =>
  !!name && !!result?.branches.some((b) => b.name === name && isDone(b));

/** The names `isMergedBranch` accepts, so a list of worktrees asks without walking the scan per line. */
export const mergedBranches = (result: Pick<RepoResult, "branches"> | null | undefined) => new Set((result?.branches ?? []).filter(isDone).map((b) => b.name));
