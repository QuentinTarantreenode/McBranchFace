// The external calls the backend reports while the activity display is on, as activities: each with its
// source and operation, on the working copy it runs in. Loaded with the setting, not with the start.
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { describeProcess } from "$lib/activityText";
import type { ProcessEnded } from "$lib/bindings/ProcessEnded";
import type { ProcessStarted } from "$lib/bindings/ProcessStarted";
import { t } from "$lib/i18n/index.svelte";
import { probe, PROBED } from "$lib/probe";
import { hostOf } from "$lib/providerMeta";
import { folderKey } from "$lib/roots";
import { activity } from "./activity.svelte";
import { gitStatus } from "./gitStatus.svelte";
import { scanResults } from "./scanResults.svelte";

let off: UnlistenFn[] = [];
/** The backend's calls still running, by its id: each with the activity that shows it. */
const ids = new Map<number, number>();

/** External calls the backend reported as started and not yet as ended. */
export const openProcesses = () => ids.size;

/** The working copy a folder belongs to: itself, or the nearest known one above it. */
function copyOf(dir: string | null): string | null {
  if (!dir) return null;
  const known = new Map<string, string>();
  for (const p of scanResults.repoByPath.keys()) known.set(folderKey(p), p);
  for (const p of gitStatus.statuses.keys()) known.set(folderKey(p), p);
  for (let k = folderKey(dir); k.includes("/"); k = k.slice(0, k.lastIndexOf("/"))) if (known.has(k)) return known.get(k)!;
  return null;
}

function provider(path: string | null) {
  return hostOf(path ? scanResults.repoByPath.get(gitStatus.ownerOf(path))?.provider : null);
}

function started(e: ProcessStarted) {
  const d = describeProcess(e.program, e.args, e.cwd, (p) => provider(copyOf(p)), t.activityOps);
  const path = copyOf(d.where);
  const repo = !path && d.repo ? [...scanResults.repoByPath.values()].find((r) => r.name.toLowerCase() === d.repo!.toLowerCase())?.path ?? null : null;
  // The backend writes these calls to the diagnostics log itself.
  const id = activity.begin(d.text, path ?? repo, { noLog: true });
  if (id) ids.set(e.id, id);
  if (PROBED) probe.changed();
}

function ended(e: ProcessEnded) {
  const id = ids.get(e.id);
  if (!id) return;
  ids.delete(e.id);
  if (PROBED) probe.changed();
  // git answers 1 for "no" (is-ancestor, diff --quiet): only a code above that, or no code, failed.
  const failed = !/^[01]$/.test(e.outcome);
  activity.end(id, failed ? "failed" : "ok", failed ? t.activityOps.exit(e.outcome) : undefined);
}

/** Counts the calls: listeners that arrive after a newer call (switched off meanwhile) are removed at once. */
let generation = 0;

export async function watch(on: boolean) {
  const mine = ++generation;
  for (const u of off) u();
  off = [];
  if (!on) {
    for (const id of ids.values()) activity.end(id, "cancelled");
    ids.clear();
    if (PROBED) probe.changed();
    return;
  }
  const added = await Promise.all([listen<ProcessStarted>("process-started", (e) => started(e.payload)), listen<ProcessEnded>("process-ended", (e) => ended(e.payload))]);
  if (mine === generation) off = added;
  else for (const u of added) u();
}
