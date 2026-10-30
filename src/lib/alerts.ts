import type { AlertPrefs } from "./bindings/AlertPrefs";
import type { BranchReport } from "./bindings/BranchReport";
import type { CleanupScope } from "./bindings/CleanupScope";
import type { OnlineVerdict } from "./bindings/OnlineVerdict";
import type { RemoteBranchReport } from "./bindings/RemoteBranchReport";
import type { UpstreamState } from "./bindings/UpstreamState";
import type { Verdict } from "./bindings/Verdict";
import { branchKey, emptyFilters, filterBranches, filterOnline, onlineKey, type AgeBucket, type Filters } from "./filter";

export type LensId = "localSafe" | "localReview" | "localForgotten" | "onlineMerged" | "onlineInactive";

/** A saved view of the cleanup table; the bell counts them and opens them. */
export interface Lens {
  id: LensId;
  scope: CleanupScope;
  verdicts: Verdict[];
  onlineVerdicts: OnlineVerdict[];
  onlyMine: boolean;
  /** Local lenses: where the branch stands on the server. The table shows it with the switch set to match. */
  upstream?: UpstreamState;
  /** Age of the last commit, as the table's age filter has it, so the opened table shows exactly these. */
  ages?: AgeBucket[];
  pref: keyof AlertPrefs;
}

export const LENSES: Lens[] = [
  { id: "localSafe", scope: "Local", verdicts: ["Safe"], onlineVerdicts: [], onlyMine: false, upstream: "Gone", pref: "localSafe" },
  { id: "localReview", scope: "Local", verdicts: ["Review"], onlineVerdicts: [], onlyMine: false, upstream: "Gone", pref: "localReview" },
  { id: "localForgotten", scope: "Local", verdicts: ["Unsafe"], onlineVerdicts: [], onlyMine: false, upstream: "None", ages: ["quarter", "older"], pref: "localForgotten" },
  { id: "onlineMerged", scope: "Online", verdicts: [], onlineVerdicts: ["Merged"], onlyMine: false, pref: "onlineMerged" },
  { id: "onlineInactive", scope: "Online", verdicts: [], onlineVerdicts: ["Inactive"], onlyMine: true, pref: "onlineInactive" },
];

/** The table's filters for a lens: opened with them, the table lists exactly what the lens counts. */
export function lensFilters(lens: Lens): Filters {
  return {
    ...emptyFilters(),
    verdicts: [...lens.verdicts],
    onlineVerdicts: [...lens.onlineVerdicts],
    onlyMine: lens.onlyMine,
    ages: [...(lens.ages ?? [])],
    upstreams: lens.upstream ? [lens.upstream] : [],
  };
}

/** Keys of the branches a lens shows; locked and ignored branches are never counted as stale. */
export function lensKeys(lens: Lens, local: BranchReport[], online: RemoteBranchReport[], now = Date.now() / 1000): string[] {
  const f = lensFilters(lens);
  const ctx = { now };
  const counted = (b: { locked: boolean; ignored: boolean }) => !b.locked && !b.ignored;
  if (lens.scope === "Local") return filterBranches(local.filter(counted), f, undefined, ctx).map(branchKey);
  return filterOnline(online.filter(counted), f, undefined, ctx).map(onlineKey);
}

export function activeLenses(prefs: AlertPrefs): Lens[] {
  return prefs.enabled ? LENSES.filter((l) => prefs[l.pref]) : [];
}

/** Stale branches not seen after the previous scan; a notification names only these. */
export function newKeys(previous: ReadonlySet<string>, current: string[]): string[] {
  return current.filter((k) => !previous.has(k));
}
