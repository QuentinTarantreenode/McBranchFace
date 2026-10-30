export interface FoldTarget {
  open: boolean;
  toggle: () => void;
  /** Every group of the same level; without it Alt folds just this one. */
  all?: (open: boolean) => void;
}

/** ← folds a group head, → opens it, Alt with either does it for all of its level. True when the key was one of them. */
export function foldKeys(e: KeyboardEvent, target: FoldTarget): boolean {
  if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return false;
  const want = e.key === "ArrowRight";
  e.preventDefault();
  if (e.altKey && target.all) target.all(want);
  else if (want !== target.open) target.toggle();
  return true;
}
