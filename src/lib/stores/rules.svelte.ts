// The user's rules about branches and repos: locks keep branches from ever being deleted, ignores take them
// out of the bell, notes and tags annotate them, and large repos can be left out of the server assessment.
// All of them live in the settings and hold for every working copy; a change re-flags the loaded results at
// once instead of waiting for the next scan.
import { allTags, annotationKey, emptyAnnotation } from "$lib/annotations";
import type { Annotation } from "$lib/bindings/Annotation";
import type { Ignore } from "$lib/bindings/Ignore";
import { withAnnotation, withLock } from "$lib/configEdits";
import { isLocked, withIgnore, withoutIgnore } from "$lib/ignores";
import { scanResults } from "./scanResults.svelte";
import { settings } from "./settings.svelte";

class Rules {
  /** Every tag in use, for the tag filter and the suggestions of the editor. */
  tags = $derived(settings.config ? allTags(settings.config.annotations) : []);
  /** Working copies whose server branches are not assessed. */
  excludedRepos = $derived(scanResults.repos.filter((r) => settings.config?.onlineExcluded.includes(r.info.identity)).map((r) => r.info));

  /** Note and tags of a branch together with those of its repository. */
  annotate = (b: { repoPath: string; name: string }) => {
    const id = scanResults.identityOf(b.repoPath);
    const c = settings.config;
    if (!id || !c) return { tags: [], note: "" };
    const repo = c.annotations[annotationKey(id)];
    const own = c.annotations[annotationKey(id, b.name)];
    return { tags: [...(own?.tags ?? []), ...(repo?.tags ?? [])], note: [own?.note, repo?.note].filter(Boolean).join("\n") };
  };

  isRepoLocked(path: string) {
    const id = scanResults.identityOf(path);
    return !!id && !!settings.config && isLocked(settings.config.locks, id, null);
  }

  /** Locks apply to every working copy of the repository; the flags update without a rescan. */
  async setLock(repoPath: string, branch: string | null, locked: boolean) {
    const id = scanResults.identityOf(repoPath);
    if (!settings.config || !id) return;
    if (!(await settings.saveWith({ locks: withLock(settings.config.locks, id, branch, locked) }))) return;
    scanResults.reflag(id);
  }

  /** Ignored branches leave the bell and the notification, not the list; days = null means until removed. */
  async setIgnore(repoPath: string, branch: string, online: boolean, days: number | null) {
    const id = scanResults.identityOf(repoPath);
    if (!settings.config || !id) return;
    const now = Math.floor(Date.now() / 1000);
    const until = days === null ? null : now + days * 86_400;
    await this.applyIgnores(id, withIgnore(settings.config.ignores, id, branch, online, until, now));
  }

  async clearIgnore(repoPath: string, branch: string, online: boolean) {
    const id = scanResults.identityOf(repoPath);
    if (!settings.config || !id) return;
    await this.applyIgnores(id, withoutIgnore(settings.config.ignores, id, branch, online));
  }

  /** Settings: removes the whole entry, whichever sides it covers. */
  async removeIgnore(entry: Ignore) {
    if (!settings.config) return;
    const rest = settings.config.ignores.filter((i) => !(i.identity === entry.identity && i.branch === entry.branch));
    await this.applyIgnores(entry.identity, rest);
  }

  private async applyIgnores(id: string, ignores: Ignore[]) {
    if (!(await settings.saveWith({ ignores }))) return;
    scanResults.reflag(id);
  }

  ignoreOf(repoPath: string, branch: string) {
    const id = scanResults.identityOf(repoPath);
    return settings.config?.ignores.find((i) => i.identity === id && i.branch === branch) ?? null;
  }

  annotationOf(repoPath: string, branch: string | null): Annotation {
    const id = scanResults.identityOf(repoPath);
    return (id && settings.config?.annotations[annotationKey(id, branch)]) || emptyAnnotation();
  }

  /** Notes and tags are saved quietly and coalesced, like layout changes. */
  setAnnotation(repoPath: string, branch: string | null, a: Annotation) {
    const id = scanResults.identityOf(repoPath);
    if (!settings.config || !id) return;
    settings.config.annotations = withAnnotation(settings.config.annotations, annotationKey(id, branch), a);
    settings.persist();
  }

  /**
   * Large repositories can be left out of the server assessment, for all their copies; their server branches
   * go at once. Whether it was saved: assessing a repo taken back in is the caller's step.
   */
  async setOnlineExcluded(repoPath: string, excluded: boolean): Promise<boolean> {
    const id = scanResults.identityOf(repoPath);
    if (!settings.config || !id) return false;
    const list = settings.config.onlineExcluded.filter((x) => x !== id);
    if (!(await settings.saveWith({ onlineExcluded: excluded ? [...list, id] : list }))) return false;
    if (excluded) scanResults.dropOnline(id);
    return true;
  }
}

export const rules = new Rules();
