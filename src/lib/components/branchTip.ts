import type { BranchReport } from "$lib/bindings/BranchReport";
import type { CommitInfo } from "$lib/bindings/CommitInfo";
import type { RemoteBranchReport } from "$lib/bindings/RemoteBranchReport";
import { t } from "$lib/i18n/index.svelte";
import { isOrphaned, repoName } from "$lib/filter";
import { shortSha } from "$lib/format";
import type { TooltipContent, TooltipInput, TooltipRow, TooltipSection } from "$lib/ui/tooltip";
import { copyPill } from "./repoTip";
import { scanResults } from "$lib/stores/scanResults.svelte";
import { branchCommits } from "$lib/stores/branchCommits.svelte";

/** Entries of a list shown by name in the tip; the rest is counted. */
const LIST = 4;
/** How long the pointer rests on a row before the tip reads its commits from git. */
const READ_AFTER_MS = 150;

/**
 * What the row does not say: why it is (not) safe, where it stands on the server, the evidence, and
 * behind each flag the things themselves. Name, repo, subject, author and tags are in the row already.
 * The commits after the push are not in the scan result: read once the pointer rests (see `wanted`).
 */
export function branchTip(b: BranchReport | RemoteBranchReport, wanted: () => boolean = () => true): TooltipContent | Promise<TooltipContent> {
  if ("remote" in b || !b.unpushedCommitCount) return content(b, undefined);
  const known = branchCommits.of(b);
  if (known) return content(b, known.unpushed);
  return (async () => {
    await new Promise((rest) => setTimeout(rest, READ_AFTER_MS));
    if (!wanted()) return content(b, undefined);
    const lists = await branchCommits.load(b).catch(() => null);
    return content(b, lists ? lists.unpushed : null);
  })();
}

/** `unpushed`: undefined while not read, null when reading failed. */
function content(b: BranchReport | RemoteBranchReport, unpushed: CommitInfo[] | null | undefined): TooltipContent {
  const online = "remote" in b;
  const verdict = online ? t.onlineVerdict[b.verdict] : t.verdict[b.verdict];

  let server: TooltipRow[];
  if (online) {
    const copies = scanResults.localCopiesOf(b);
    server = copies.length ? copyRows(copies, b.repoPath) : [{ label: t.branchTip.copies, value: t.cleanup.noLocalCopy, tone: "muted" }];
  } else if (b.upstreamState === "None") {
    server = [{ label: t.branchTip.upstream, value: t.branchTip.localOnly, tone: "muted" }];
  } else {
    // The ref once, with its state: deleted on the server, or still there.
    const push: TooltipRow = b.pushState
      ? { label: t.branchTip.lastPush, value: `${shortSha(b.pushState.sha)} · ${t.branchTip.pushSource[b.pushState.source]}`, kind: "mono" }
      : { label: t.branchTip.lastPush, value: t.branchTip.unknownPush, tone: "unsafe" };
    server = [
      isOrphaned(b)
        ? { label: t.branchTip.gone, value: b.upstream, kind: "branch", tone: "review" }
        : { label: t.branchTip.upstream, value: b.upstream, kind: "branch" },
      push,
    ];
  }

  const proof: TooltipRow[] = [];
  const e = b.mergeEvidence;
  const pr = b.pullRequest;
  // A pull request that is itself the evidence is one fact, not two rows naming the same number.
  if (e?.kind === "PullRequest" && pr) proof.push({ label: t.mergeKind.PullRequest, value: `PR ${pr.id} · ${t.prState[pr.state]}`, tone: "safe" });
  else {
    if (e) proof.push({ label: t.mergeKind[e.kind], value: e.target, kind: e.kind === "PullRequest" ? "text" : "branch", tone: "safe" });
    if (pr) proof.push({ label: t.detail.pullRequest, value: `PR ${pr.id} · ${t.prState[pr.state]}` });
  }

  // The flags in the row say that something is open; here is what.
  const open: TooltipSection[] = [];
  if (!online) {
    const more = (all: number) => (all > LIST ? [{ value: t.sidebar.moreFiles(all - LIST), tone: "muted" as const }] : []);
    if (b.unpushedCommitCount) {
      const listed = (list: CommitInfo[]) => [...list.slice(0, LIST).map((c) => ({ value: `${shortSha(c.sha)} ${c.subject}` })), ...more(b.unpushedCommitCount)];
      const rows = unpushed === undefined ? [] : unpushed === null ? [{ value: t.commits.readFailed, tone: "muted" as const }] : listed(unpushed);
      open.push({ title: t.cleanup.unpushed(b.unpushedCommitCount), rows });
    }
    if (b.worktree?.files.length)
      open.push({
        title: t.cleanup.dirtyFiles(b.worktree.files.length),
        rows: [...b.worktree.files.slice(0, LIST).map((f) => ({ value: f.path, kind: "path" as const })), ...more(b.worktree.files.length)],
      });
    if (b.stashes.length)
      open.push({ title: t.cleanup.stashes(b.stashes.length), rows: [...b.stashes.slice(0, LIST).map((s) => ({ value: s.message })), ...more(b.stashes.length)] });
  }

  const sections: TooltipSection[] = [
    { title: online ? t.branchTip.copies : t.branchTip.server, rows: server },
    { title: t.branchTip.proof, rows: proof },
    ...open,
  ];
  return { title: verdict.hint, sections, gestures: true, wide: true };
}

/** One row per working copy with the branch; the copy the row was assessed in is named, not repeated as a pill. */
function copyRows(copies: { repoPath: string; branch: string }[], here: string): TooltipRow[] {
  // The copy the row was assessed in first: the others are read against it.
  const ordered = [...copies].sort((a, b) => Number(b.repoPath === here) - Number(a.repoPath === here));
  return ordered.map((c) => {
    const pill = c.repoPath === here ? null : copyPill(c.repoPath);
    const label = c.repoPath === here ? t.branchTip.thisCopy : repoName(c.repoPath);
    return pill ? { pill, value: c.branch, kind: "branch" } : { label, value: c.branch, kind: "branch" };
  });
}

/** The working copies that have a server branch locally, for the Local cell of the online table. */
export function localCopiesTip(copies: { repoPath: string; branch: string }[], here: string): TooltipInput {
  if (!copies.length) return t.cleanup.noLocalCopy;
  return { title: t.branchTip.copies, rows: copyRows(copies, here) };
}
