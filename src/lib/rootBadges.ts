import { repoName } from "./filter";

/** A root folder as a short sign: its initials in a colour of its own, used wherever the full path would be long. */
export interface RootBadge {
  text: string;
  color: string;
  /** The folder's own name, for tooltips and labels. */
  name: string;
}

// The identity colours away from the hues of a status (red, orange, amber, green): a folder badge in red
// read as a warning. Blue, violet, cyan, fuchsia, indigo, then teal and pink.
const COLORS = [0, 4, 5, 7, 11, 2, 1];
const colorAt = (i: number) => `var(--id-${COLORS[i % COLORS.length]})`;

/** Words of a folder name: separators, camel humps and the step from letters to digits split it. */
function words(name: string): string[] {
  return name
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/([A-Za-z])(\d)/g, "$1 $2")
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean);
}

/**
 * Shortest first: the initials of the lettered words ("Acme_Platform" → "AP"); a single word
 * takes its digits ("Acme26" → "A26") or its first two letters ("Tools" → "TO"). Longer forms follow,
 * for when two folders would otherwise read the same.
 */
function candidates(name: string): string[] {
  const all = words(name);
  const lettered = all.filter((w) => /[A-Za-z]/.test(w));
  const digits = all.filter((w) => /^\d+$/.test(w)).join("");
  const initials = lettered.map((w) => w[0]).join("");
  const flat = name.replace(/[^A-Za-z0-9]/g, "");
  const out = [
    lettered.length > 1 ? initials.slice(0, 3) : lettered.length ? lettered[0][0] + (digits || lettered[0].slice(1, 2)) : flat.slice(0, 2),
    initials + digits,
    flat.slice(0, 3),
    flat.slice(0, 4),
  ];
  return [...new Set(out.map((c) => c.toUpperCase()).filter(Boolean))];
}

/** What the user chose for a folder; either part may be missing. */
export type OwnIdentity = { short?: string | null; color?: string | null } | undefined;

/**
 * A badge per root, unique among them; the colour follows the order of the roots, as the sidebar lists
 * them. A sign or colour the user gave a folder wins, and the computed signs keep clear of the chosen ones.
 */
export function rootBadges(roots: string[], own: (root: string) => OwnIdentity = () => undefined): Map<string, RootBadge> {
  const used = new Set(roots.map((r) => own(r)?.short?.toUpperCase()).filter((x): x is string => !!x));
  const out = new Map<string, RootBadge>();
  roots.forEach((root, i) => {
    const name = repoName(root);
    const chosen = own(root);
    if (chosen?.short) {
      out.set(root, { text: chosen.short, color: chosen.color ? `var(--${chosen.color})` : colorAt(i), name });
      return;
    }
    const options = candidates(name);
    let text = options.find((c) => !used.has(c));
    // Every form taken: the shortest one with a number, still unique.
    for (let n = 2; !text; n++) if (!used.has(`${options[0]}${n}`)) text = `${options[0]}${n}`;
    used.add(text);
    out.set(root, { text, color: chosen?.color ? `var(--${chosen.color})` : colorAt(i), name });
  });
  return out;
}
