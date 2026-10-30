// What the sidebar has open on top of its list, reachable from every menu of it.
import type { RepoEntry } from "./scanResults.svelte";

export const sidebarUi = $state({
  /** Repo whose note and tags are being edited. */
  annotating: null as RepoEntry | null,
});
