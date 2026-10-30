/** Which part of the history the log shows: the choices the history view offers for a repo. Pure. */

export type LogScopeKind = "head" | "branch" | "new" | "range";

export interface LogScope {
  kind: LogScopeKind;
  /** What goes to `git log`. */
  rev: string;
  /** The branch the scope is about, for labels. */
  branch?: string;
}

const LOCAL = "refs/heads/";
const REMOTE = "refs/remotes/";

/** "refs/heads/feat/x" → "feat/x", "refs/remotes/origin/x" → "origin/x"; anything else as it is. */
export function refLabel(rev: string): string {
  if (rev.startsWith(LOCAL)) return rev.slice(LOCAL.length);
  if (rev.startsWith(REMOTE)) return rev.slice(REMOTE.length);
  return rev;
}

const isRange = (rev: string) => rev.includes("..");

/**
 * The scopes for a log opened at `rev`:
 * - HEAD, always;
 * - the branch the log was opened for, also when it is the one checked out: it was asked for by name;
 * - that branch's commits that the default branch does not have yet ("default..branch");
 * - a range the log was opened with (e.g. "commits after the push"), which none of the above is.
 */
export function logScopes(rev: string, headBranch: string | null, defaultBranch: string | null): LogScope[] {
  const out: LogScope[] = [{ kind: "head", rev: "HEAD", branch: headBranch ?? undefined }];
  const named = !isRange(rev) && rev !== "HEAD";
  const focus = named ? rev : headBranch ? LOCAL + headBranch : null;
  const focusName = focus ? refLabel(focus) : null;
  if (named) out.push({ kind: "branch", rev, branch: focusName! });
  if (focus && defaultBranch && focusName !== defaultBranch && focusName !== refLabel(defaultBranch)) {
    out.push({ kind: "new", rev: `${defaultBranch}..${focus}`, branch: focusName! });
  }
  if (!out.some((s) => s.rev === rev)) out.push({ kind: "range", rev });
  return out;
}
