import { settings } from "$lib/stores/settings.svelte";
import { repoSelection } from "$lib/stores/repoSelection.svelte";

/** A worktree is a full working copy: the Git perspective works on it like on any repo. */
export function openInGit(path: string) {
  repoSelection.gitRepo = path;
  if (settings.config?.ui.perspective !== "Git") settings.setUi({ perspective: "Git" });
}
