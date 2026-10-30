import type { OnlineVerdict } from "./bindings/OnlineVerdict";
import type { PrState } from "./bindings/PrState";
import type { ToolState } from "./bindings/ToolState";
import type { Verdict } from "./bindings/Verdict";

/** Colour of a status — the single place to change it. Wording lives in the dictionaries. */
export interface Tone {
  text: string;
  dot: string;
  badge: string;
}

// Written out, because Tailwind only generates classes it finds literally in the source.
export const VERDICT_TONE: Record<Verdict, Tone> = {
  // The calm outcome is outlined; filled badges are the ones that need a look.
  Safe: { text: "text-safe", dot: "bg-safe", badge: "text-safe-ink ring-safe/30" },
  Review: { text: "text-review", dot: "bg-review", badge: "text-review-ink bg-review/12 ring-review/25" },
  Blocked: { text: "text-blocked", dot: "bg-blocked", badge: "text-blocked-ink bg-blocked/12 ring-blocked/25" },
  Unsafe: { text: "text-unsafe", dot: "bg-unsafe", badge: "text-unsafe-ink bg-unsafe/12 ring-unsafe/25" },
};

export const ONLINE_TONE: Record<OnlineVerdict, Tone> = {
  Merged: VERDICT_TONE.Safe,
  Inactive: VERDICT_TONE.Review,
  Active: VERDICT_TONE.Blocked,
};

/** A pull request's state as a tinted chip: merged is the goal, closed needs a look, open is in the way. */
/** A merged PR is the normal end and stays neutral; open and closed-unmerged ones are worth a look. */
export const PR_TONE: Record<PrState, string> = {
  Merged: "text-muted ring-1 ring-inset ring-line-strong",
  Closed: "bg-review/12 text-review-ink",
  Open: "bg-blocked/12 text-blocked-ink",
};

export const TOOL_TONE: Record<ToolState, Tone> = {
  Ready: VERDICT_TONE.Safe,
  Missing: { text: "text-faint", dot: "bg-faint", badge: "text-faint bg-panel-2 ring-line" },
  Outdated: VERDICT_TONE.Review,
  NotLoggedIn: VERDICT_TONE.Review,
  ExtensionMissing: VERDICT_TONE.Review,
  Unknown: VERDICT_TONE.Review,
};

