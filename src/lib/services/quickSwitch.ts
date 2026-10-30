// Switching repos from the sidebar dropdown. Loaded with the dropdown, so the start page stays small.
import { api, explainError, isFailure } from "$lib/api";
import { repoName } from "$lib/filter";
import { t } from "$lib/i18n/index.svelte";
import { runnable, type SwitchStep } from "$lib/switchPlan";
import type { CarryMode } from "$lib/bindings/CarryMode";
import type { OpFailure } from "$lib/bindings/OpFailure";
import { gitStatus } from "$lib/stores/gitStatus.svelte";
import { gitClaims } from "$lib/stores/gitClaims.svelte";
import { toasts } from "$lib/stores/toasts.svelte";
import { dialogs } from "$lib/stores/dialogs.svelte";
import { scanResults } from "$lib/stores/scanResults.svelte";
import { scanner } from "./scanner.svelte";

/** The repo of a path; a linked worktree belongs to the repo that lists it. */
export function infoFor(path: string) {
  return scanResults.repoByPath.get(gitStatus.ownerOf(path));
}

/**
 * Switches every step's repo to its branch, one after the other: git cannot switch several repos at
 * once, so a failure leaves the others switched and the toast offers the way back. `branch` names
 * the target in the toast; without it, this is the way back.
 */
export async function switchRepos(branch: string | null, steps: SwitchStep[], carry: CarryMode, base: "head" | "default") {
  const todo = steps.filter(runnable);
  const paths = todo.map((s) => s.path);
  if (!todo.length) return;
  const done: { path: string; before: string | null }[] = [];
  const failed: string[] = [];
  let conflicts = false;
  const ran = await gitClaims.withClaim(paths, t.git.op.Switch.label, async () => {
    for (const s of todo) {
      // Asked fresh: what the store holds may be the last run's or behind the watcher, and changes must
      // never be overlooked. Only if git cannot say, what the store has.
      const status = await api.repoStatus(s.path).catch(() => gitStatus.statuses.get(s.path) ?? null);
      const dirty = (status?.entries.length ?? 0) > 0;
      const before = status?.head.branch ?? null;
      const mode: CarryMode = dirty ? carry : "Keep";
      const start = base === "default" ? (infoFor(s.path)?.defaultBranch ?? "HEAD") : "HEAD";
      try {
        const r = s.kind === "create" ? await api.gitSwitchNew(s.path, s.ref, start, mode) : await api.gitSwitch(s.path, s.ref, s.kind === "remote", mode);
        conflicts ||= r.warning === "LocalChanges";
        done.push({ path: s.path, before });
      } catch (e) {
        const why = isFailure<OpFailure>(e) ? t.failure[e.kind].title : explainError(e).text;
        failed.push(`${repoName(s.path)}: ${why}`);
      }
    }
  });
  if (!ran) return;
  await Promise.all(todo.map((s) => gitStatus.refreshStatus(s.path)));
  // Back only where the repo stood on a branch; a detached start has no name to return to.
  const back = done.filter((d) => d.before);
  const offerBack = branch !== null && back.length > 0 && (failed.length > 0 || done.length > 1);
  const action = offerBack ? { label: t.quick.undo, run: () => switchBack(back) } : undefined;
  if (failed.length) toasts.toast("error", t.quick.partial(done.length, todo.length), { detail: failed.join("\n"), action });
  else {
    const text = branch === null ? t.quick.undone : t.quick.done(branch, done.length);
    toasts.toast(conflicts ? "info" : "success", text, { detail: conflicts ? t.git.switchedWithConflicts : undefined, action });
  }
  // A worktree's branch belongs to its repo: the repo is reassessed, once however many of its copies moved.
  const repos = new Set(done.map((d) => gitStatus.ownerOf(d.path)));
  for (const p of repos) if (scanResults.repoByPath.has(p)) void scanner.rescan(p);
}

function switchBack(list: { path: string; before: string | null }[]) {
  const steps: SwitchStep[] = list.map((d) => ({ path: d.path, kind: "local", ref: d.before!, elsewhere: null }));
  return switchRepos(null, steps, "Bring", "head");
}

/** A worktree registration copied along with the repo folder; its worktree belongs elsewhere. */
export function forgetForeignWorktree(repoPath: string, worktree: string) {
  dialogs.ask = {
    title: t.quick.foreignTitle,
    text: t.quick.foreignText,
    detail: worktree,
    detailIsPath: true,
    action: t.quick.foreignForget,
    danger: false,
    run: async () => {
      try {
        const r = await api.forgetForeignWorktree(repoPath, worktree);
        toasts.toast("success", t.quick.foreignForgotten, { detail: r.backupDir ?? undefined });
      } catch (e) {
        toasts.fail(e);
      }
      await gitStatus.refreshStatus(repoPath);
    },
  };
}
