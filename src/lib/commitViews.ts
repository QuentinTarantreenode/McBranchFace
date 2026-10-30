// Which commits a list shows and where the rest comes from: one definition for the detail pane,
// the table flags and the delete dialog.
import type { BranchCommits } from "$lib/bindings/BranchCommits";
import type { BranchReport } from "$lib/bindings/BranchReport";
import type { CommitsView } from "$lib/stores/dialogs.svelte";
import { branchCommits } from "$lib/stores/branchCommits.svelte";
import { t } from "$lib/i18n/index.svelte";

/** The window starts with the lists read already, and reads them where there are none yet. */
function listed(b: BranchReport, pick: (l: BranchCommits) => CommitsView["commits"], total: number): Pick<CommitsView, "commits" | "load"> {
  const known = branchCommits.of(b);
  if (known) return { commits: pick(known) };
  return { commits: [], load: () => branchCommits.load(b).then((l) => ({ commits: pick(l), fromProvider: false, total })) };
}

/** Commits after the last known push: from that commit to the tip. */
export const unpushedView = (b: BranchReport): CommitsView => ({
  title: t.detail.unpushed,
  branch: b.name,
  repoPath: b.repoPath,
  ...listed(b, (l) => l.unpushed, b.unpushedCommitCount),
  total: b.unpushedCommitCount,
  range: b.pushState ? `${b.pushState.sha}..${b.sha}` : undefined,
});

/** The branch's own commits: those not on the default branch. */
export const ownView = (b: BranchReport, defaultBranch: string | null | undefined): CommitsView => ({
  title: t.detail.ownCommits,
  branch: b.name,
  repoPath: b.repoPath,
  ...listed(b, (l) => l.own, b.ownCommitCount),
  total: b.ownCommitCount,
  range: defaultBranch ? `${defaultBranch}..${b.sha}` : undefined,
});
