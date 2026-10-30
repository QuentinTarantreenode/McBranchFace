// The open pull requests of each repo, so a repo can say how many wait for review and lead to them.
// What the scans brought is shown first; the provider is asked again only for the repo in front.
import { SvelteMap, SvelteSet } from "svelte/reactivity";
import { api } from "$lib/api";
import type { PullRequestInfo } from "$lib/bindings/PullRequestInfo";
import { t } from "$lib/i18n/index.svelte";
import { pooled } from "$lib/pool";
import { hostOf, PROVIDERS } from "$lib/providerMeta";
import { gitStatus } from "./gitStatus.svelte";
import { activity } from "./activity.svelte";
import { environment } from "./environment.svelte";
import { scanResults } from "./scanResults.svelte";
import { repoSelection } from "./repoSelection.svelte";

/** Repos asked at the same time in the periodic look: each is a CLI call that may go to the provider. */
const POLL_CONCURRENCY = 4;

class PullRequests {
  byRepo = new SvelteMap<string, PullRequestInfo[]>();
  loading = new SvelteSet<string>();
  /** Repos whose last load failed: the list shown is older than it looks. */
  failed = new SvelteSet<string>();
  /** Repos asked for the provider while another load ran: asked once that one is done. */
  private providerWanted = new Set<string>();

  resetForTests() {
    this.byRepo.clear();
    this.loading.clear();
    this.failed.clear();
    this.providerWanted.clear();
  }

  /** The scanned repo a path belongs to: worktrees share the pull requests of their repo. */
  private repoOf(path: string) {
    const owner = gitStatus.ownerOf(path);
    // By the index: every badge asks on every render.
    const info = scanResults.repoByPath.get(owner) ?? scanResults.repoByPath.get(path);
    return info ? { info } : undefined;
  }

  links(path: string) {
    return this.repoOf(path)?.info.links ?? null;
  }

  list(path: string): PullRequestInfo[] {
    const repo = this.repoOf(path);
    return repo ? (this.byRepo.get(repo.info.path) ?? []) : [];
  }

  /** The provider is being asked for this repo's list right now. */
  refreshingFor(path: string) {
    const repo = this.repoOf(path);
    return !!repo && this.loading.has(repo.info.path);
  }

  /** The last load for this repo failed: what is shown is older than it looks. */
  failedFor(path: string) {
    const repo = this.repoOf(path);
    return !!repo && this.failed.has(repo.info.path);
  }

  count(path: string) {
    return this.list(path).length;
  }

  /** Why the list cannot be asked for, or null: no provider, or its CLI not ready. The plain link still works. */
  unavailable(path: string): string | null {
    const repo = this.repoOf(path);
    const host = hostOf(repo?.info.provider);
    if (!host) return t.prs.noProvider;
    const state = environment.tool(PROVIDERS[host].tool)?.state;
    return state === "Ready" ? null : t.prs.cliNotReady;
  }

  /** "once" loads what is known if nothing is yet, "cache" reads it again, "provider" asks the provider. */
  async load(path: string, mode: "once" | "cache" | "provider" = "once") {
    const repo = this.repoOf(path);
    if (!repo) return;
    const key = repo.info.path;
    if (this.loading.has(key)) {
      // A cache read on its way must not swallow the request to ask the provider.
      if (mode === "provider") this.providerWanted.add(key);
      return;
    }
    if ((mode === "once" && this.byRepo.has(key)) || this.unavailable(path)) return;
    this.loading.add(key);
    try {
      this.byRepo.set(key, (await activity.track(t.activity.prs, key, () => api.openPullRequests(key, mode === "provider"))) ?? []);
      this.failed.delete(key);
    } catch {
      // A provider that does not answer leaves the last list; the badge is a hint, not a promise.
      this.failed.add(key);
    } finally {
      this.loading.delete(key);
    }
    if (this.providerWanted.delete(key) && mode !== "provider") await this.load(key, "provider");
  }

  /** The periodic look: what the scans brought for all repos, the provider itself for the repo in front. */
  async poll() {
    const front = repoSelection.gitRepo ?? repoSelection.focusRepo;
    const known = [...this.byRepo.keys()];
    const own = front ? this.repoOf(front)?.info.path : undefined;
    await pooled(known, POLL_CONCURRENCY, (p) => this.load(p, p === own ? "provider" : "cache"));
  }
}

export const pullRequests = new PullRequests();
