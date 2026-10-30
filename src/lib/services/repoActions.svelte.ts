// What the user does to a repo outside the Git view: push or fast-forward a branch, apply or drop a stash,
// switch to the default branch, remove worktrees, manage the root folders and repo groups. Each claims its
// repo while git runs and reassesses it afterwards.
import { api, isFailure } from "$lib/api";
import type { BranchReport } from "$lib/bindings/BranchReport";
import type { RepoGroup } from "$lib/bindings/RepoGroup";
import { planRootRemoval } from "$lib/configEdits";
import { t } from "$lib/i18n/index.svelte";
import { isWithin, moveRoot, planRootAdds } from "$lib/roots";
import { dialogs } from "$lib/stores/dialogs.svelte";
import { gitClaims } from "$lib/stores/gitClaims.svelte";
import { gitStatus } from "$lib/stores/gitStatus.svelte";
import { repoSelection } from "$lib/stores/repoSelection.svelte";
import { rules } from "$lib/stores/rules.svelte";
import { scanResults } from "$lib/stores/scanResults.svelte";
import { settings } from "$lib/stores/settings.svelte";
import { toasts } from "$lib/stores/toasts.svelte";
import { scanner } from "./scanner.svelte";

/** Runs one git operation on a repo, its failure named; whether it ran (the repo was free). */
function claimed(paths: string[], what: string, run: () => Promise<unknown>) {
  return gitClaims.withClaim(paths, what, () => toasts.safely(run));
}

class RepoActions {
  /** Pushes one branch, the first time with -u; the assessment follows with the rescan. */
  async push(b: BranchReport) {
    const ran = await claimed([b.repoPath], t.git.op.Push.label, async () => {
      await api.gitRemote(b.repoPath, "Push", `push:${b.repoPath}:${b.name}`, b.name);
      toasts.toast("success", t.todo.pushed(b.name));
    });
    if (ran) await scanner.rescan(b.repoPath);
  }

  /** Up to the server's state as the last fetch saw it; the assessment follows with the rescan. */
  async fastForward(b: BranchReport) {
    const ran = await claimed([b.repoPath], t.git.op.FastForward.label, async () => {
      await api.gitFastForward(b.repoPath, b.name);
      toasts.toast("success", t.cleanup.fastForwarded(b.name));
    });
    if (ran) await scanner.rescan(b.repoPath);
  }

  /** Into the worktree the branch is checked out in; the stash stays. Elsewhere it would land on another branch. */
  async stashApply(b: BranchReport, sha: string) {
    if (!b.worktree) return;
    const where = b.worktree.path;
    const ran = await claimed([...new Set([b.repoPath, where])], t.git.op.StashApply.label, async () => {
      await api.gitStashApply(where, sha);
      toasts.toast("success", t.stash.applied, { detail: where });
    });
    if (!ran) return;
    await gitStatus.refreshStatus(where);
    await scanner.rescan(b.repoPath);
  }

  /** After a question; the commit stays reachable through a backup ref. */
  stashDrop(b: BranchReport, stash: { sha: string; message: string }) {
    dialogs.ask = {
      title: t.stash.dropTitle,
      text: t.stash.dropText,
      detail: stash.message,
      action: t.stash.drop,
      danger: true,
      run: async () => {
        const ran = await claimed([b.repoPath], t.git.op.StashDrop.label, async () => {
          const r = await api.gitStashDrop(b.repoPath, stash.sha);
          toasts.toast("success", t.stash.dropped, { detail: r.summary ?? undefined });
        });
        if (!ran) return;
        await gitStatus.refreshStatus(b.repoPath);
        await scanner.rescan(b.repoPath);
      },
    };
  }

  /** Switches to the default branch; whether it did. */
  async checkoutDefault(repoPath: string): Promise<boolean> {
    let switched = false;
    await claimed([repoPath], t.git.op.Switch.label, async () => {
      const b = await api.checkoutDefault(repoPath);
      toasts.toast("success", t.deleted.switched(b));
      switched = true;
    });
    if (switched) await scanner.rescan(repoPath);
    return switched;
  }

  /** Without force first; changes in the worktree lead to a second question before anything is lost. */
  removeWorktree(repoPath: string, worktree: string) {
    const go = async (force: boolean) => {
      let askAgain = false;
      const ran = await gitClaims.withClaim([repoPath], t.git.op.RemoveWorktree.label, async () => {
        try {
          const r = await api.removeWorktree(repoPath, worktree, force);
          // The folder always moves to the backups; a warning means its entry in the journal is missing.
          toasts.toast(r.warning ? "info" : "success", r.warning ? t.copies.removedNoJournal : t.copies.removed, { detail: r.backupDir ?? undefined });
        } catch (e) {
          if (!force && isFailure<{ kind: string }>(e) && e.kind === "LocalChanges") askAgain = true;
          else toasts.fail(e);
        }
      });
      if (!ran) return;
      if (askAgain) {
        dialogs.ask = { title: t.copies.removeForceTitle, text: t.copies.removeForceText, detail: worktree, detailIsPath: true, action: t.copies.removeForce, danger: true, run: () => go(true) };
        return;
      }
      await gitStatus.refreshStatus(repoPath);
      await scanner.rescan(repoPath);
    };
    dialogs.ask = { title: t.copies.removeTitle, text: t.copies.removeText, detail: worktree, detailIsPath: true, action: t.copies.remove, danger: true, run: () => go(false) };
  }

  /** Several worktrees after one question; one with changes stays and is named, nothing is forced. */
  removeWorktrees(repoPath: string, worktrees: string[]) {
    if (!worktrees.length) return;
    dialogs.ask = {
      title: t.copies.removeManyTitle(worktrees.length),
      text: t.copies.removeManyText,
      detail: worktrees.join("\n"),
      detailIsPath: true,
      action: t.copies.remove,
      danger: true,
      run: async () => {
        const kept: string[] = [];
        const unjournaled: string[] = [];
        let removed = 0;
        const ran = await gitClaims.withClaim([repoPath], t.git.op.RemoveWorktree.label, async () => {
          for (const w of worktrees) {
            try {
              const r = await api.removeWorktree(repoPath, w, false);
              removed++;
              if (r.warning) unjournaled.push(r.backupDir ?? w);
            } catch (e) {
              if (isFailure<{ kind: string }>(e) && e.kind === "LocalChanges") kept.push(w);
              else toasts.fail(e);
            }
          }
        });
        if (!ran) return;
        if (removed) toasts.toast("success", t.copies.removedMany(removed));
        if (kept.length) toasts.toast("info", t.copies.keptWithChanges(kept.length), { detail: kept.join("\n") });
        if (unjournaled.length) toasts.toast("info", t.copies.removedNoJournal, { detail: unjournaled.join("\n") });
        await gitStatus.refreshStatus(repoPath);
        await scanner.rescan(repoPath);
      },
    };
  }

  // ---- folders and groups --------------------------------------------------------------------

  /** The folder is below one of the roots, so the next scan finds a clone there. */
  underRoots(path: string) {
    return (settings.config?.roots ?? []).some((r) => isWithin(path, r));
  }

  addRoot(folder: string) {
    return this.addRoots([folder]);
  }

  /**
   * Picked or dropped paths become roots and are scanned. Files, folders already listed and folders
   * inside a listed one change nothing; a toast says so, so a drop never seems to be swallowed.
   */
  async addRoots(paths: string[]) {
    const config = settings.config;
    if (!config || !paths.length) return;
    let kinds: boolean[];
    try {
      kinds = await api.folderKinds(paths);
    } catch (e) {
      toasts.fail(e);
      return;
    }
    const plan = planRootAdds(config.roots, paths.map((path, i) => ({ path, dir: kinds[i] ?? false })));
    for (const s of plan.skipped) {
      const text = s.reason === "file" ? t.sidebar.dropFile : s.reason === "present" ? t.sidebar.dropPresent : t.sidebar.dropInside;
      toasts.toast("info", text, { detail: s.reason === "inside" ? `${s.path} → ${s.root}` : s.path });
    }
    if (!plan.add.length) return;
    if (!(await settings.saveWith({ roots: [...config.roots, ...plan.add] }))) return;
    toasts.toast("success", t.sidebar.rootsAdded(plan.add.length), { detail: plan.add.join("\n") });
    await scanner.scan(false);
  }

  /** Only the list changes: the folder and its repos stay on disk as they are. */
  removeRoot(root: string) {
    if (!settings.config) return;
    dialogs.ask = {
      title: t.sidebar.removeRootTitle,
      text: t.sidebar.removeRootText,
      detail: root,
      detailIsPath: true,
      action: t.sidebar.removeRoot,
      run: async () => {
        if (!settings.config) return;
        const { patch, gone } = planRootRemoval(settings.config, root, scanResults.repos.map((r) => r.info), (p) => gitStatus.ownerOf(p));
        if (!(await settings.saveWith(patch))) return;
        repoSelection.repos = repoSelection.repos.filter((p) => !gone.has(p));
        if (repoSelection.focusRepo && gone.has(gitStatus.ownerOf(repoSelection.focusRepo))) repoSelection.focusRepo = null;
        toasts.toast("success", t.sidebar.rootRemoved, { detail: root });
        await scanner.scan(false);
      },
    };
  }

  /** The sidebar shows the groups in the order of the roots: moving a group reorders the roots. */
  async moveRoot(root: string, over: string, after: boolean) {
    if (!settings.config) return;
    const roots = moveRoot(settings.config.roots, root, over, after);
    if (roots !== settings.config.roots) await settings.saveWith({ roots });
  }

  /**
   * The repo groups as a whole; the edits themselves are pure (repoGroups.ts). With a message, the
   * toast offers the way back to the groups as they were.
   */
  async setRepoGroups(repoGroups: RepoGroup[], message?: string) {
    if (!settings.config) return;
    const before = $state.snapshot(settings.config.repoGroups) as RepoGroup[];
    if (!(await settings.saveWith({ repoGroups }))) return;
    if (message) toasts.toast("success", message, { action: { label: t.repoGroups.undo, run: () => this.setRepoGroups(before) } });
  }

  /** Large repositories can be left out of the online assessment; one taken back in is assessed at once. */
  async setOnlineExcluded(repoPath: string, excluded: boolean) {
    if (!(await rules.setOnlineExcluded(repoPath, excluded))) return;
    if (!excluded) void scanner.refreshOnline(repoPath, true, true);
  }
}

export const repoActions = new RepoActions();
