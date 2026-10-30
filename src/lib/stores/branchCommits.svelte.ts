// The commit lists of branches, read when something shows them: the scan results carry only the counts.
// A branch's lists are read once per result of its repository and dropped with the next one. Until the
// new ones are read, the lists of the same tip stand in, so a view that shows them does not jump.
import { untrack } from "svelte";
import { SvelteMap } from "svelte/reactivity";
import { api } from "$lib/api";
import type { BranchCommits } from "$lib/bindings/BranchCommits";
import type { BranchReport } from "$lib/bindings/BranchReport";
import type { RepoResult } from "$lib/bindings/RepoResult";
import { branchKey } from "$lib/filter";
import { scanResults } from "./scanResults.svelte";

/** Branches whose lists are kept; the one used longest ago goes first. */
const KEPT = 100;

interface Entry {
  /** The result of the repo the lists were read for. */
  result: RepoResult | null;
  lists?: BranchCommits;
  reading?: Promise<BranchCommits>;
  failed?: unknown;
}

class BranchCommitsStore {
  private entries = new SvelteMap<string, Entry>();

  resetForTests() {
    this.entries.clear();
  }

  /** The lists of the branch's tip as last read, or undefined while none were. */
  of(b: BranchReport): BranchCommits | undefined {
    const lists = this.entries.get(branchKey(b))?.lists;
    return lists?.sha === b.sha ? lists : undefined;
  }

  /** Why the read for the repo's current result failed; undefined while it runs or went through. */
  failure(b: BranchReport): unknown {
    const e = this.entries.get(branchKey(b));
    return e && !e.reading && e.result === scanResults.resultOf(b.repoPath) ? e.failed : undefined;
  }

  /** Asked for the repo's current result already: read, being read, or failed (`load` asks again). */
  private asked(b: BranchReport): boolean {
    const e = this.entries.get(branchKey(b));
    return !!e && e.result === scanResults.resultOf(b.repoPath) && (!!e.reading || e.failed !== undefined || e.lists?.sha === b.sha);
  }

  /** The lists of the branch, read once per result of its repository. */
  load(b: BranchReport): Promise<BranchCommits> {
    const key = branchKey(b);
    const result = scanResults.resultOf(b.repoPath);
    const kept = this.entries.get(key);
    if (kept?.result === result && kept.reading) return kept.reading;
    if (kept?.result === result && kept.lists?.sha === b.sha) return Promise.resolve(kept.lists);
    const reading: Promise<BranchCommits> = api.branchCommits(b.repoPath, b.name).then(
      (lists) => {
        this.settle(key, reading, { result, lists });
        return lists;
      },
      (failed: unknown) => {
        this.settle(key, reading, { result, lists: kept?.lists, failed });
        throw failed;
      },
    );
    // Taken out and put back: the map's order is the order of use, for `trim`.
    this.entries.delete(key);
    this.entries.set(key, { result, lists: kept?.lists, reading });
    this.trim();
    return reading;
  }

  /** `load` for a view: once per result of the repo, a failure kept for `failure` instead of thrown. */
  ensure(b: BranchReport) {
    if (!this.asked(b)) this.load(b).catch(() => {});
  }

  /** Only the newest read of a branch lands. */
  private settle(key: string, reading: Promise<BranchCommits>, entry: Entry) {
    if (this.entries.get(key)?.reading === reading) this.entries.set(key, entry);
  }

  /** Untracked: a view that asked for one branch must not run again for every other one. */
  private trim() {
    untrack(() => {
      for (const key of [...this.entries.keys()]) {
        if (this.entries.size <= KEPT) break;
        if (!this.entries.get(key)?.reading) this.entries.delete(key);
      }
    });
  }
}

export const branchCommits = new BranchCommitsStore();
