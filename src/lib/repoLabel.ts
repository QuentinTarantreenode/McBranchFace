import { scanResults } from "$lib/stores/scanResults.svelte";

// One rule for "repo name and copy label" (scanResults.copyLabelBeside); components import it from here.

/** The repo as text names it: its folder, and the copy label where it says more. */
export const repoLabel = (path: string) => scanResults.repoLabel(path);

/** The copy label of a working copy, unless it only repeats the folder it is listed under. */
export const copyLabelIn = (path: string, inFolder: string | null = null): string | null => scanResults.copyLabelBeside(path, { folder: inFolder });
