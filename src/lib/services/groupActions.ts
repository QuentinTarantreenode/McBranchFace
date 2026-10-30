// One action across several repositories: a branch name of a "Branch name" group (fast-forward it,
// check it out, push it, create it where it is missing), or the repos of a repo group (fetch, pull,
// push). Each repo on its own, with progress and a way to stop, one summary at the end, then every
// touched repo is reassessed.
import { api, explainError } from "$lib/api";
import type { BranchReport } from "$lib/bindings/BranchReport";
import { t } from "$lib/i18n/index.svelte";
import { gitClaims } from "$lib/stores/gitClaims.svelte";
import { gitStatus } from "$lib/stores/gitStatus.svelte";
import { activity } from "$lib/stores/activity.svelte";
import { repoLabel } from "$lib/repoLabel";
import { toasts } from "$lib/stores/toasts.svelte";
import { scanResults } from "$lib/stores/scanResults.svelte";
import { scanner } from "./scanner.svelte";

export { repoLabel };

/**
 * `run` gets the id that cancels its git command. `skipped`: repos left out before the start, with why;
 * the summary names them.
 */
async function each(label: string, paths: string[], run: (path: string, opId: string) => Promise<unknown>, skipped: string[] = []) {
  const failed: string[] = [];
  let stopped = false;
  let reached = 0;
  // Claimed for the git commands only; the reassessment afterwards blocks nothing.
  const ran = await gitClaims.withClaim(paths, label, async () => {
    let current: string | null = null;
    const act = activity.begin(label, null, {
      own: true,
      total: paths.length,
      cancel: () => {
        stopped = true;
        if (current) void api.gitCancel(current).catch(() => {});
      },
    });
    try {
      // One after the other: several git processes at once would fight over the same credentials prompt.
      for (const p of paths) {
        if (stopped) break;
        activity.step(act, reached, t.activity.step(label, repoLabel(p)));
        current = `group:${crypto.randomUUID()}`;
        const one = activity.begin(label, p);
        try {
          await run(p, current);
          activity.end(one);
        } catch (e) {
          if (stopped) {
            activity.end(one, "cancelled");
            break;
          }
          const why = explainError(e).text;
          activity.end(one, "failed", why);
          failed.push(`${repoLabel(p)}: ${why}`);
        }
        reached++;
      }
    } finally {
      current = null;
      activity.end(act, stopped ? "cancelled" : failed.length ? "failed" : "ok");
    }
  });
  if (!ran) return;
  const done = reached - failed.length;
  const left = skipped.length ? t.repoGroups.skipped(skipped.join(" · ")) : undefined;
  if (stopped) toasts.toast("info", t.groupOps.stopped(label, reached, paths.length), { detail: [failed.join(" · "), left].filter(Boolean).join("\n") || undefined });
  else if (failed.length) toasts.toast("error", t.groupOps.partly(label, done, paths.length), { detail: [failed.join(" · "), left].filter(Boolean).join("\n") });
  else toasts.toast(skipped.length ? "info" : "success", t.groupOps.done(label, done), { detail: left });
  const repos = new Set(paths.map((p) => gitStatus.ownerOf(p)));
  for (const p of paths) if (!repos.has(p)) void gitStatus.refreshStatus(p, { quiet: true });
  await Promise.all([...repos].filter((p) => scanResults.repoByPath.has(p)).map((p) => scanner.rescan(p)));
}

/** What each action would touch in this group, so the menu can say how many before anything runs. */
export function groupTargets(items: BranchReport[]) {
  const here = new Set(items.map((b) => b.repoPath));
  return {
    behind: items.filter((b) => b.behind > 0),
    // A branch already checked out somewhere is left where it is; git would refuse a second checkout.
    notCheckedOut: items.filter((b) => !b.worktree),
    unpushed: items.filter((b) => b.unpushedCommitCount > 0),
    missing: scanResults.repos.filter((r) => r.result && !r.result.error && !here.has(r.info.path)).map((r) => r.info.path),
  };
}

export const fastForwardAll = (name: string, items: BranchReport[]) =>
  each(t.git.op.FastForward.label, items.map((b) => b.repoPath), (p) => api.gitFastForward(p, name));

export const switchAll = (name: string, items: BranchReport[]) =>
  each(t.git.op.Switch.label, items.map((b) => b.repoPath), (p) => api.gitSwitch(p, name, false, "Keep"));

export const pushAll = (name: string, items: BranchReport[]) =>
  each(t.git.op.Push.label, items.map((b) => b.repoPath), (p, id) => api.gitRemote(p, "Push", id, name));

/** From each repo's own default branch, without switching to it. */
export const createIn = (name: string, paths: string[]) => createMissing(name, paths, "default");

/**
 * The branch in the repos that lack it, without switching; from their HEAD or their own default branch.
 * The default branch is taken as a commit, not the remote-tracking ref: git would make `origin/main`
 * its upstream, and a push would then refuse to write the feature onto main. The first push sets the
 * right upstream.
 */
export const createMissing = (name: string, paths: string[], base: "head" | "default") =>
  each(
    t.git.op.CreateBranch.label,
    paths,
    (p) => api.gitCreateBranch(p, name, base === "default" ? `${scanResults.repoByPath.get(p)?.defaultBranch ?? "HEAD"}^{commit}` : "HEAD", false),
  );

export type Skip = { path: string; why: keyof typeof t.repoGroups.why };
const named = (list: Skip[]) => list.map((x) => `${repoLabel(x.path)} (${t.repoGroups.why[x.why]})`);

export const fetchIn = (paths: string[], skipped: Skip[]) =>
  each(t.git.op.Fetch.label, paths, (p, id) => api.gitRemote(p, "Fetch", id), named(skipped));

/** Each repo pulls the branch it stands on. */
export const pullIn = (paths: string[], skipped: Skip[]) =>
  each(t.git.op.Pull.label, paths, (p, id) => api.gitRemote(p, "Pull", id), named(skipped));

/** Each repo pushes the branch it stands on; a branch the server does not know yet gets its upstream. */
export const pushIn = (targets: { path: string; branch: string }[], skipped: Skip[]) => {
  const branchOf = new Map(targets.map((x) => [x.path, x.branch]));
  return each(t.git.op.Push.label, [...branchOf.keys()], (p, id) => api.gitRemote(p, "Push", id, branchOf.get(p)!), named(skipped));
};
