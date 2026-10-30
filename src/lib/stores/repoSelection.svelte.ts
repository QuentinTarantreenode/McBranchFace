// The repos selected in the sidebar. Both perspectives share the one selection: cleanup shows all of it,
// Git the repo clicked last as long as it belongs to the selection.
import { gitStatus } from "./gitStatus.svelte";

class RepoSelection {
  /** The selected repos by path; empty means all. A linked worktree stands for its repo. Replaced as a whole. */
  repos = $state.raw<string[]>([]);
  /** The repo (or worktree) clicked last. */
  focusRepo = $state<string | null>(null);

  resetForTests() {
    this.repos = [];
    this.focusRepo = null;
  }

  /** The repo open in the Git perspective, derived from the shared selection. */
  get gitRepo(): string | null {
    const picked = this.repos;
    if (!picked.length) return this.focusRepo;
    return this.focusRepo && picked.includes(gitStatus.ownerOf(this.focusRepo)) ? this.focusRepo : picked[0];
  }
  /** Opening a repo in Git selects it, unless it is part of the selection already. */
  set gitRepo(path: string | null) {
    this.focusRepo = path;
    if (!path) return;
    const owner = gitStatus.ownerOf(path);
    if (this.repos.length && !this.repos.includes(owner)) this.repos = [owner];
  }
}

export const repoSelection = new RepoSelection();
