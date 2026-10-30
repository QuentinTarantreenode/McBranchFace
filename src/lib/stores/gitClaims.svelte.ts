// Which repos a git operation runs in right now, and what it is: one operation per repo at a time,
// other repos stay free, and a control that has to wait can say for what.
import { SvelteMap } from "svelte/reactivity";
import { t } from "$lib/i18n/index.svelte";
import { PROBED } from "$lib/probe";
import { toasts } from "./toasts.svelte";

class GitClaims {
  /**
   * Repos a git operation runs in right now. One operation per repo at a time; other repos stay free.
   * Background scans wait while any runs. Per repo: what runs, so a control waiting for it can say so.
   */
  gitRepos = new SvelteMap<string, string>();

  resetForTests() {
    this.gitRepos.clear();
  }
  get gitBusy() {
    return this.gitRepos.size > 0;
  }

  /** Claims the repos for one operation; false, and nothing claimed, when one of them is busy. */
  gitStart(paths: string[], what = ""): boolean {
    if (paths.some((p) => this.gitRepos.has(p))) return false;
    for (const p of paths) this.gitRepos.set(p, what);
    return true;
  }

  /** What a control of this repo waits for, or null while the repo is free. */
  gitRunning(path: string): string | null {
    const what = this.gitRepos.get(path);
    return what === undefined ? null : what ? t.common.gitRunning(what) : t.common.gitBusy;
  }

  gitEnd(paths: string[]) {
    for (const p of paths) this.gitRepos.delete(p);
  }

  /**
   * Runs `fn` with the repos claimed and frees them afterwards, whatever happens. False, and `fn` not run,
   * when one of them is busy; the click then says what it waits for, unless `quiet` (background work).
   */
  async withClaim(paths: string[], what: string, fn: () => Promise<unknown>, opts: { quiet?: boolean } = {}): Promise<boolean> {
    if (!this.gitStart(paths, what)) {
      if (!opts.quiet) this.gitWait();
      return false;
    }
    try {
      await fn();
      return true;
    } finally {
      this.gitEnd(paths);
    }
  }

  /** A blocked click says what it waits for instead of doing nothing. */
  gitWait() {
    toasts.toast("info", t.common.gitBusy);
  }
}

export const gitClaims = new GitClaims();
if (PROBED) (globalThis as Record<string, unknown>).__mbfGitClaims = gitClaims;
