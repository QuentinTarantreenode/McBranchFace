// The dashboard's state: its inputs gathered from the stores (narrowed to the repos selected in the
// sidebar) and who the user is at each provider. What its steps do when run is in steps.ts.
import { LENSES, type LensId } from "$lib/alerts";
import { api } from "$lib/api";
import { repoOfKey } from "$lib/filter";
import { hostOf, PROVIDERS } from "$lib/providerMeta";
import { folderKey } from "$lib/roots";
import { gitStatus } from "$lib/stores/gitStatus.svelte";
import { pullRequests } from "$lib/stores/pullRequests.svelte";
import { isMergedBranch } from "$lib/worktrees";
import { branchIndex, branchSteps, prSteps, prsOf, shownSteps, sortSteps, statusSteps, type DashRepo, type DashStep, type Host } from "./model";
import { settings } from "$lib/stores/settings.svelte";
import { clock } from "$lib/stores/clock.svelte";
import { environment } from "$lib/stores/environment.svelte";
import { scanResults } from "$lib/stores/scanResults.svelte";
import { repoSelection } from "$lib/stores/repoSelection.svelte";
import { lenses } from "$lib/stores/lenses.svelte";
import { PROBED } from "$lib/probe";

class Dashboard {
  me = $state<Partial<Record<Host, string>>>({});
  private asked = new Set<Host>();

  resetForTests() {
    this.me = {};
    this.asked.clear();
  }

  /** The repos in view: those selected in the sidebar, else all. */
  private scope = $derived.by(() => {
    const chosen = new Set(repoSelection.repos.map(folderKey));
    return chosen.size ? scanResults.repos.filter((r) => chosen.has(folderKey(r.info.path))) : scanResults.repos;
  });
  /** Narrowed to the sidebar's selection. */
  narrowed = $derived(repoSelection.repos.length > 0);

  // Each part of the input on its own: a status written by the watcher rebuilds what the working copies
  // say, not the steps of pull requests or branches.
  repos: DashRepo[] = $derived(this.scope.map((r) => ({ path: r.info.path, name: r.info.name, host: hostOf(r.info.provider), defaultBranch: r.info.defaultBranch })));
  private inScope = $derived(new Set(this.repos.map((r) => r.path)));
  private local = $derived(scanResults.allBranches.filter((b) => this.inScope.has(b.repoPath)));
  private online = $derived((scanResults.allOnline ?? []).filter((b) => this.inScope.has(b.repoPath)));
  /** The branches in view by name, built once per scan result: every pull request looks its branch up. */
  branches = $derived(branchIndex(this.local, this.online));
  private prsByRepo = $derived(Object.fromEntries(this.repos.map((r) => [r.path, pullRequests.list(r.path)])));
  /** Working copies in view by path, worktrees included. */
  statuses = $derived(Object.fromEntries([...gitStatus.statuses].filter(([p]) => this.inScope.has(gitStatus.ownerOf(p)))));
  mergedWorktrees = $derived(
    this.scope.map((r) => {
      const merged = (gitStatus.statuses.get(r.info.path)?.worktrees ?? []).filter((w) => !w.isMain && !w.foreign && isMergedBranch(r.result, w.branch));
      return { repo: r.info.path, paths: merged.map((w) => w.path), branches: merged.map((w) => w.branch!) };
    }),
  );
  // The store counts each lens once over every repo; here only the repos in view.
  private lensKeys = $derived(
    Object.fromEntries(
      LENSES.map((l) => {
        const keys = lenses.lensKeysById.get(l.id) ?? [];
        return [l.id, this.narrowed ? keys.filter((k) => this.inScope.has(repoOfKey(k))) : keys];
      }),
    ) as Record<LensId, string[]>,
  );

  private prSteps = $derived(prSteps({ repos: this.repos, prs: this.prsByRepo, me: this.me, branches: this.branches, now: clock.hourClock }));
  private branchSteps = $derived(branchSteps({ local: this.local, lensKeys: this.lensKeys }));
  private statusSteps = $derived(statusSteps({ repos: this.repos, statuses: this.statuses, mergedWorktrees: this.mergedWorktrees }));
  steps: DashStep[] = $derived(shownSteps(sortSteps([...this.prSteps, ...this.branchSteps, ...this.statusSteps]), settings.config?.ui.dashboardDismissed ?? {}));
  mode = $derived<"mine" | "all">(settings.config?.ui.dashboardPrs === "all" ? "all" : "mine");
  prs = $derived(prsOf({ repos: this.repos, prs: this.prsByRepo, me: this.me }, this.mode));
  /** Per lens, how many branches it would show: the cleanup tile. */
  lenses = $derived(LENSES.map((l) => ({ lens: l, count: this.lensKeys[l.id].length })));
  /** Whether "mine" can work: some provider told who the user is. */
  knowsMe = $derived(Object.keys(this.me).length > 0);

  /** Asks the providers in use who the user is, and loads each repo's pull requests from what the scans brought. */
  load() {
    for (const r of scanResults.repos) {
      const host = hostOf(r.info.provider);
      if (!host) continue;
      void pullRequests.load(r.info.path);
      if (this.asked.has(host) || environment.tool(PROVIDERS[host].tool)?.state !== "Ready") continue;
      this.asked.add(host);
      void api
        .providerIdentity(host)
        .then((id) => {
          if (id) this.me = { ...this.me, [host]: id };
          else this.asked.delete(host);
        })
        .catch(() => this.asked.delete(host));
    }
  }

  dismiss(step: DashStep) {
    settings.setUi({ dashboardDismissed: { ...(settings.config?.ui.dashboardDismissed ?? {}), [step.key]: step.fingerprint } });
  }

  /** Forgets what was put aside: everything shows again. */
  restore() {
    settings.setUi({ dashboardDismissed: {} });
  }
}

export const dashboard = new Dashboard();
if (PROBED) (globalThis as Record<string, unknown>).__mbfDashboard = dashboard;
