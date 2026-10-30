// Where a link in the app leads: a view the help explains, the Git history of a repo or branch, the changes
// of a worktree. The Git view's state loads with it, on the first visit.
import type { HelpTarget } from "$lib/help/types";
import { cleanupView } from "$lib/stores/cleanupView.svelte";
import { dialogs } from "$lib/stores/dialogs.svelte";
import { repoSelection } from "$lib/stores/repoSelection.svelte";
import { settings } from "$lib/stores/settings.svelte";

const git = async () => (await import("$lib/git/gitStore.svelte")).gitStore;

class Navigation {
  /** "Show" in the help: brings up the view a section explains. */
  async show(target: HelpTarget) {
    if (target.settings) return dialogs.openSettings(target.settings);
    dialogs.settingsOpen = false;
    if (target.perspective) settings.setUi({ perspective: target.perspective });
    if (target.scope) cleanupView.setScope(target.scope);
    if (target.gitTab) (await git()).setTab(target.gitTab);
  }

  /** The Git history of a repo, optionally of one branch or range, optionally at one commit. */
  async openHistory(repoPath: string, opts: { rev?: string; sha?: string } = {}) {
    const gitStore = await git();
    repoSelection.gitRepo = repoPath;
    settings.setUi({ perspective: "Git" });
    gitStore.setRepo(repoPath);
    gitStore.setRev(opts.rev ?? "HEAD");
    gitStore.setTab("history");
    if (opts.sha) await gitStore.selectCommit(opts.sha);
  }

  /** The changes of one worktree in Git: where they are committed, stashed or discarded. */
  async openChanges(worktree: string) {
    const gitStore = await git();
    repoSelection.gitRepo = worktree;
    settings.setUi({ perspective: "Git" });
    gitStore.setRepo(worktree);
    gitStore.setTab("changes");
  }
}

export const navigation = new Navigation();
