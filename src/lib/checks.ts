import type { CheckCode } from "./bindings/CheckCode";
import { shortSha } from "./format";
import { t } from "./i18n/index.svelte";
import { path, ref, type Rich, type RichPart } from "./rich";

/** The merge target as it is shown: a completed PR by its number ("#123"), everything else as a ref. */
export const evidenceTarget = (e: { kind: string; target: string }): RichPart => (e.kind === "PullRequest" ? e.target : ref(e.target));

/**
 * Wording of every check result; the backend only reports what it found. Refs stay refs, so the
 * view shows them as branch segments.
 */
export function checkText(c: CheckCode): { title: Rich | string; detail: Rich | string } {
  const k = t.check;
  switch (c.code) {
    case "Merged": {
      const target = evidenceTarget(c.p);
      return { title: k.merged(target), detail: k.mergeDetail[c.p.kind](target) };
    }
    case "NoDefaultBranch":
      return { title: k.noDefault, detail: k.noDefaultDetail };
    case "NoMergeEvidence":
      return { title: k.noEvidence, detail: k.noEvidenceDetail(c.p.own, ref(c.p.base)) };
    case "PushUnknown":
      return { title: k.pushUnknown, detail: k.pushUnknownDetail };
    case "PushStateMissing":
      return { title: k.pushMissing, detail: k.pushMissingDetail(shortSha(c.p.sha), k.source[c.p.source]) };
    case "AllPushed":
      return { title: k.allPushed, detail: k.allPushedDetail(ref(c.p.upstream), shortSha(c.p.sha), k.source[c.p.source]) };
    case "CommitsAfterPush":
      return { title: k.afterPush(c.p.count), detail: c.p.merged ? k.afterPushMerged : k.afterPushUnmerged(ref(c.p.upstream)) };
    case "NeverPushed":
      return { title: k.neverPushed(c.p.count), detail: k.neverPushedDetail(c.p.count, c.p.merged) };
    case "NotCheckedOut":
      return { title: k.notCheckedOut, detail: k.notCheckedOutDetail };
    case "Dirty":
      return { title: k.dirty(c.p.count), detail: k.dirtyDetail(path(c.p.path)) };
    case "CurrentBranch":
      return { title: k.current, detail: k.currentDetail(path(c.p.path)) };
    case "LinkedWorktree":
      return { title: k.linked, detail: k.linkedDetail(path(c.p.path)) };
    case "NoStashes":
      return { title: k.noStashes, detail: k.noStashesDetail };
    case "Stashes":
      return { title: k.stashes(c.p.count), detail: k.stashesDetail };
    case "Pr":
      return { title: k.pr(c.p.id, k.prState[c.p.state]), detail: [c.p.title, " → ", ref(c.p.target)] };
    case "NoPr":
      return { title: k.noPr, detail: k.noPrDetail(ref(c.p.remote)) };
  }
}
