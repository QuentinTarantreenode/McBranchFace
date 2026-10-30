import type { RepoWarning } from "./bindings/RepoWarning";
import { relativeTime } from "./format";
import { displayPath } from "./paths";
import { t } from "./i18n/index.svelte";

/** Wording of repository warnings; separate from the check texts, which only the detail pane needs. */
export function warningText(w: RepoWarning): { text: string; detail?: string } {
  const k = t.repoWarning;
  switch (w.code) {
    case "NoDefaultBranch":
      return { text: k.NoDefaultBranch };
    case "PrListCapped":
      return { text: k.PrListCapped(w.p.limit) };
    case "PrQueryFailed": {
      // What failed, then what the assessment stood on instead: a failed query is never "no PRs".
      const instead = w.p.fallbackAt === null ? k.prNoFallback : k.prFallback(relativeTime(w.p.fallbackAt));
      return { text: `${k.PrQueryFailed[w.p.kind]} ${instead}`, detail: w.p.detail };
    }
    case "PrUnreadable":
      return { text: k.PrUnreadable(w.p.id), detail: w.p.detail };
    case "BranchFailed":
      return { text: k.BranchFailed(w.p.branch), detail: w.p.detail };
    case "OnlineFailed":
      return { text: k.OnlineFailed, detail: w.p.detail };
    case "NotWatched":
      return { text: k.NotWatched(displayPath(w.p.root)), detail: w.p.detail };
    case "OtherRemotesFailed":
      return { text: k.OtherRemotesFailed(w.p.remotes.join(", ")), detail: w.p.detail };
  }
}
