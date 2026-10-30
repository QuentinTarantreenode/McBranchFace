// What a step of the dashboard does when it is run: open a page, a focused table, Git, a delete or the
// removal of worktrees. Loaded with the dashboard view.
import { api } from "$lib/api";
import { branchKey, onlineKey } from "$lib/filter";
import { navigation } from "$lib/services/navigation";
import { cleanupView } from "$lib/stores/cleanupView.svelte";
import { scanResults } from "$lib/stores/scanResults.svelte";
import { toasts } from "$lib/stores/toasts.svelte";
import type { TodoAction } from "./model";
import { deletes } from "$lib/stores/deletes.svelte";
import { repoActions } from "$lib/services/repoActions.svelte";

/** Runs a step's action; `label` names the reason a focused list shows in its chip. */
export async function runStep(a: TodoAction, label = "") {
  switch (a.kind) {
    case "url":
      return toasts.safely(() => api.openUrl(a.url));
    case "focus":
      return cleanupView.focusBranches(label, a.keys, a.scope);
    case "git":
      return (await import("$lib/components/copyMenu")).openInGit(a.path);
    case "changes":
      return navigation.openChanges(a.path);
    case "history":
      return navigation.openHistory(a.path, { rev: a.rev });
    case "pull":
      return (await import("$lib/components/setMenu")).pull([a.path], []);
    case "delete": {
      // The list of what is deleted, as the dialog shows it: the branches as they are now.
      const keys = new Set(a.keys);
      if (a.scope === "Online") return deletes.openOnlineDelete((scanResults.allOnline ?? []).filter((b) => keys.has(onlineKey(b))));
      return deletes.openDelete(scanResults.allBranches.filter((b) => keys.has(branchKey(b))));
    }
    case "removeWorktrees":
      return repoActions.removeWorktrees(a.repo, a.paths);
  }
}
