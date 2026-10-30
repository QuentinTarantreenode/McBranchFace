// The scan's results: every repo with its last assessment. This store is the only writer of `repos`; every
// list of branches, every lookup by path or identity and the working-copy groups derive from it.
import { untrack } from "svelte";
import { SvelteMap } from "svelte/reactivity";
import { explainError } from "$lib/api";
import type { OnlineScanned } from "$lib/bindings/OnlineScanned";
import type { RemoteBranchReport } from "$lib/bindings/RemoteBranchReport";
import type { RepoInfo } from "$lib/bindings/RepoInfo";
import type { RepoResult } from "$lib/bindings/RepoResult";
import type { RepoWarning } from "$lib/bindings/RepoWarning";
import { repoName } from "$lib/filter";
import { copyGroups, localCopies, type LocalCopy } from "$lib/identity";
import { OnlineReclassifier } from "$lib/onlineReclassifier";
import { flagsFor, mergeBatch, mergeOnlineWarnings, type RepoEntry } from "$lib/scanMerge";
import { clock } from "./clock.svelte";
import { settings } from "./settings.svelte";

export type { RepoEntry };

/** Work the app starts on its own, without a click: a failure shows at the repo, not as a toast. */
export type BackgroundWork = "rescan" | "fetch";

type Beside = { folder?: string | null; badge?: string | null };

class ScanResults {
  /** Keeps the server list's identity while nothing changed; plain, nothing reactive reads it. */
  private reclassifier = new OnlineReclassifier();
  // Raw: an entry and its result are replaced, never written in place (see updateResult).
  repos = $state.raw<RepoEntry[]>([]);
  /** Repos the running scan still owes an answer for; replaced as a whole, empty between scans. */
  private pending = $state.raw<ReadonlySet<string>>(new Set());
  /** False until the first data (cache or scan) arrived: views show their skeleton meanwhile. */
  loaded = $state(false);
  /** Per repo, the background work whose last run failed and why; it ends with the next run that succeeds. */
  backgroundFailures = new SvelteMap<string, Partial<Record<BackgroundWork, string>>>();
  /** What the last server answer added to a result's warnings, so the next answer replaces it. */
  private onlineWarnings = new WeakMap<RepoResult, RepoWarning[]>();

  resetForTests(entries: RepoEntry[] = []) {
    this.repos = entries;
    this.pending = new Set();
    this.loaded = false;
    this.backgroundFailures.clear();
    this.onlineWarnings = new WeakMap();
  }

  results = $derived(this.repos.map((r) => r.result).filter((r): r is RepoResult => r !== null));
  /** Repo entry by path, for lookups in loops instead of `repos.find`. */
  private entryByPath = $derived(new Map(this.repos.map((r) => [r.info.path, r])));
  /** The scan's result for a scanned repo; null for a worktree or a repo not assessed yet. */
  resultOf = (path: string) => this.entryByPath.get(path)?.result ?? null;
  /** Whether the scan lists the repo. */
  has = (path: string) => this.entryByPath.has(path);

  /**
   * The repo infos as one comparable value. Lookups built from it stay the same object while it does:
   * a new Map with every scan result would re-run every card and row that reads one.
   */
  private infoKey = $derived(JSON.stringify(this.repos.map((r) => r.info)));
  /** Repo info by path, instead of `repos.find` in per-row code. */
  repoByPath = $derived.by(() => {
    void this.infoKey;
    return untrack(() => new Map(this.repos.map((r) => [r.info.path, r.info])));
  });
  groups = $derived.by(() => copyGroups([...this.repoByPath.values()]));
  private identities = $derived.by(() => new Map([...this.repoByPath.values()].map((i) => [i.path, i.identity])));
  identityOf = (path: string) => this.identities.get(path);
  groupOf = (path: string) => {
    const id = this.identityOf(path);
    return id ? this.groups.get(id) : undefined;
  };
  /** The label of a working copy, or null where it would only repeat the folder name shown as repo name. */
  copyLabel = (path: string) => {
    const label = this.groupOf(path)?.labels[path];
    return label && label !== repoName(path) ? label : null;
  };
  /**
   * The copy label where it says more than what is shown beside it: the folder a list groups the repo
   * under, or the name on the folder's badge.
   */
  copyLabelBeside = (path: string, beside: Beside = {}) => {
    const label = this.copyLabel(path);
    if (!label || (beside.folder && label === repoName(beside.folder)) || label === beside.badge) return null;
    return label;
  };
  /** A repo as one text, in menus and summaries: its folder name, and the copy label where it says more. */
  repoLabel = (path: string, beside: Beside = {}) => [repoName(path), this.copyLabelBeside(path, beside)].filter(Boolean).join(" · ");

  allBranches = $derived(this.repos.flatMap((r) => r.result?.branches ?? []));

  /**
   * null while no working copy has been assessed online yet. The verdict is re-applied with the
   * current threshold, so changing "inactive after" takes effect without a new scan.
   */
  allOnline = $derived(
    this.reclassifier.run(
      this.repos.map((r) => r.result?.online).filter((l): l is RemoteBranchReport[] => !!l),
      clock.now,
      settings.config?.staleDays,
    ),
  );
  /** Oldest assessment among the working copies that have one, and whether any fetch failed. */
  onlineState = $derived.by(() => {
    // A result without a time (an older cache) would read as 1970: only real times count.
    const assessed = this.results.filter((r) => r.online !== null && !!r.onlineAt);
    if (!assessed.length) return null;
    return { at: Math.min(...assessed.map((r) => r.onlineAt!)), offline: assessed.filter((r) => !r.onlineFetched).map((r) => r.repo.name) };
  });

  /** Local branches, in any working copy of its repository, that track a server branch. */
  localCopiesOf = (b: RemoteBranchReport): LocalCopy[] => {
    const id = this.identityOf(b.repoPath);
    // The lookup is indexed once per result list (see localCopies): every row of the server list asks.
    return id ? localCopies(b, this.results, id) : [];
  };
  /** Server branches with a local branch tracking them, for the Local column and its filter. */
  localCountOf = (b: RemoteBranchReport) => this.localCopiesOf(b).length;

  /** The running scan has not answered for this repo yet. */
  isPending(path: string) {
    return this.pending.has(path);
  }
  get pendingCount() {
    return this.pending.size;
  }

  // ---- writing: every change replaces entries, never a result in place ------------------------------

  /** The result with the lock and ignore flags of the current config (see flagsFor). */
  private flagged(r: RepoResult): RepoResult {
    const c = settings.config;
    return c ? flagsFor(r, c, Math.floor(Date.now() / 1000)) : r;
  }

  /** The last run's results, shown at once until the scan replaces them. */
  seed(cached: RepoResult[]) {
    this.repos = cached.map((result) => ({ info: result.repo, result: this.flagged(result) }));
  }

  /** A scan starts: its repos are listed, each with its previous result until the fresh one arrives. */
  beginScan(infos: RepoInfo[]) {
    const previous = new Map(this.repos.map((r) => [r.info.path, r.result]));
    this.repos = infos.map((info) => ({ info, result: previous.get(info.path) ?? null }));
    this.pending = new Set(infos.map((r) => r.path));
  }

  /** The scan is over: nothing is pending any more, whether it answered for every repo or not. */
  endScan() {
    this.pending = new Set();
  }

  markLoaded() {
    this.loaded = true;
  }

  /** One write for many results: every list, count and card re-runs once per batch, not per repo. */
  applyBatch(batch: RepoResult[]) {
    const merged = mergeBatch(this.repos, batch, this.pending, (r) => this.flagged(r));
    this.repos = merged.entries;
    this.pending = merged.pending;
    this.loaded = true;
  }

  applyOnline(e: OnlineScanned) {
    this.updateResult(e.path, (r) => {
      const { result, added } = mergeOnlineWarnings(r, e, this.onlineWarnings.get(r) ?? [], (x) => this.flagged(x));
      this.onlineWarnings.set(result, added);
      return result;
    });
  }

  /**
   * The one way a loaded result changes: `fn` returns a new result, or the same one for no change, and the
   * entry is replaced. Nothing writes into a result in place, so every list built from one sees the change
   * and an unchanged branch keeps its object.
   */
  updateResult(path: string, fn: (r: RepoResult) => RepoResult) {
    this.updateWhere((e) => e.info.path === path, fn);
  }

  /** The lock and ignore flags of every working copy of a repository again, after the config changed them. */
  reflag(identity: string) {
    this.updateWhere((e) => e.info.identity === identity, (r) => this.flagged(r));
  }

  /** Forgets the server branches of every working copy of a repository. */
  dropOnline(identity: string) {
    this.updateWhere((e) => e.info.identity === identity, (r) => (r.online ? { ...r, online: null } : r));
  }

  private updateWhere(match: (e: RepoEntry) => boolean, fn: (r: RepoResult) => RepoResult) {
    let changed = false;
    const next = this.repos.map((e) => {
      if (!e.result || !match(e)) return e;
      const result = fn(e.result);
      if (result === e.result) return e;
      changed = true;
      // What the last server answer added stays known for the result that replaces this one.
      const added = this.onlineWarnings.get(e.result);
      if (added && !this.onlineWarnings.has(result)) this.onlineWarnings.set(result, added);
      return { info: e.info, result };
    });
    if (changed) this.repos = next;
  }

  /** Background work that failed shows at its repo; the next run that succeeds clears it (failure null). */
  noteBackground(path: string, work: BackgroundWork, failure: unknown) {
    const had = this.backgroundFailures.get(path);
    if (failure === null) {
      if (!had?.[work]) return;
      const { [work]: _, ...rest } = had;
      if (Object.keys(rest).length) this.backgroundFailures.set(path, rest);
      else this.backgroundFailures.delete(path);
      return;
    }
    this.backgroundFailures.set(path, { ...had, [work]: explainError(failure).text });
  }
}

export const scanResults = new ScanResults();
