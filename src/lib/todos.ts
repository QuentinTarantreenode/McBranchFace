import type { BranchReport } from "./bindings/BranchReport";
import type { Check } from "./bindings/Check";

/**
 * The git steps between a branch and its cleanup, in the order they are done: save the work, get it
 * onto the server, finish the review, then free the branch. Derived from the facts alone, so the
 * detail and the tests see the same list.
 */
export type Todo =
  | { kind: "commit"; count: number; path: string }
  | { kind: "stash"; count: number }
  | { kind: "push"; count: number; first: boolean; ready: boolean; gone: boolean }
  | { kind: "fastForward"; count: number }
  | { kind: "pr"; id: number; url: string }
  | { kind: "review"; count: number }
  | { kind: "worktree"; path: string }
  | { kind: "checkout"; clean: boolean; andDelete: boolean };

const open = (c: Check) => c.outcome === "Fail" || c.outcome === "Warn";

export function todos(b: BranchReport): Todo[] {
  if (b.locked || b.verdict === "Safe") return [];
  const out: Todo[] = [];
  const failing = b.checks.filter(open);
  const has = (code: Check["code"]["code"]) => failing.find((c) => c.code.code === code);
  const files = b.worktree?.files.length ?? 0;

  if (b.worktree && files) out.push({ kind: "commit", count: files, path: b.worktree.path });
  if (b.stashes.length) out.push({ kind: "stash", count: b.stashes.length });

  const after = has("CommitsAfterPush");
  const never = has("NeverPushed");
  const unmerged =
    (after?.code.code === "CommitsAfterPush" && !after.code.p.merged) || (never?.code.code === "NeverPushed" && !never.code.p.merged);
  if (unmerged) {
    // Git pushes a branch without upstream with -u, and one with a live upstream onto it. A branch that
    // tracks the integration line or a deleted server branch would be refused or recreated there.
    const first = b.upstream === "";
    out.push({ kind: "push", count: b.unpushedCommitCount, first, ready: first || b.upstreamState === "Live", gone: b.upstreamState === "Gone" });
  }
  if (b.behind > 0) out.push({ kind: "fastForward", count: b.behind });

  if (b.pullRequest?.state === "Open") out.push({ kind: "pr", id: b.pullRequest.id, url: b.pullRequest.url });
  else if (has("NoMergeEvidence") && !unmerged) out.push({ kind: "review", count: b.ownCommitCount });

  if (b.worktree && !b.worktree.isMain) out.push({ kind: "worktree", path: b.worktree.path });
  if (b.worktree?.isMain) {
    const clean = files === 0;
    // Switching away is the last obstacle when the work is merged and nothing is left in the worktree.
    out.push({ kind: "checkout", clean, andDelete: clean && !b.stashes.length && !!b.mergeEvidence });
  }
  return out;
}
