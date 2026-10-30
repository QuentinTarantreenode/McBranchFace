// The open pull requests of a repo as menu entries: in the badge's dropdown, and as "Pull requests ▸"
// in every menu of a repo, folder or repo group.
import { ExternalLink, GitPullRequest, GitPullRequestDraft, RefreshCw } from "@lucide/svelte";
import { api } from "$lib/api";
import { relativeTime } from "$lib/format";
import { repoName } from "$lib/filter";
import { t } from "$lib/i18n/index.svelte";
import { pullRequests } from "$lib/stores/pullRequests.svelte";
import { gitStatus } from "$lib/stores/gitStatus.svelte";
import type { MenuEntry, MenuItem } from "$lib/ui/menu.svelte";
import { toasts } from "$lib/stores/toasts.svelte";

const open = (url: string) => () => toasts.safely(() => api.openUrl(url));
const shortRef = (ref: string) => ref.replace(/^refs\/heads\//, "");

/** What the dropdown lists: each open pull request, then the provider's page and a fresh look. */
export function prEntries(path: string): MenuEntry[] {
  const links = pullRequests.links(path);
  const list = pullRequests.list(path);
  const why = pullRequests.unavailable(path);
  void pullRequests.load(path);
  const entries: MenuEntry[] = [{ heading: list.length ? t.prs.count(list.length) : t.prs.menu }];
  for (const pr of list.slice(0, 15)) {
    entries.push({
      label: `#${pr.id} ${pr.title}`,
      icon: pr.title.toLowerCase().startsWith("draft") ? GitPullRequestDraft : GitPullRequest,
      hint: `${shortRef(pr.sourceRef)} → ${shortRef(pr.targetRef)} · ${t.prs.by(pr.author, pr.createdAt ? relativeTime(pr.createdAt) : "")}`,
      run: open(pr.url),
    });
  }
  if (!list.length) entries.push({ label: t.prs.none, disabled: why ?? true, run: () => {} });
  entries.push("sep");
  if (links) entries.push({ label: t.prs.openAll, icon: ExternalLink, hint: t.prs.openAllHint, run: open(links.pullRequests) });
  entries.push({ label: t.prs.refresh, icon: RefreshCw, disabled: why ?? undefined, keepOpen: true, run: () => pullRequests.load(path, "provider") });
  return entries;
}

/** "Pull requests ▸" for a repo; null where the repo is on no provider. */
export function prItem(path: string): MenuItem | null {
  if (!pullRequests.links(path)) return null;
  const n = pullRequests.count(path);
  return { label: t.prs.menu, icon: GitPullRequest, count: n || undefined, submenu: prEntries(path), run: () => {} };
}

/** For several repos (a folder, a group): each repo's open pull requests under its name, then its provider page. */
export function prItemsOf(paths: string[]): MenuItem | null {
  const on = [...new Set(paths.map((p) => gitStatus.ownerOf(p)))].filter((p) => pullRequests.links(p));
  if (on.length <= 1) return on.length ? prItem(on[0]) : null;
  // Menus open one level deep: the repos are headings in one list, their pull requests the entries.
  const submenu: MenuEntry[] = on.flatMap((p): MenuEntry[] => {
    void pullRequests.load(p);
    const list = pullRequests.list(p);
    return [
      { heading: repoName(p) },
      ...list.slice(0, 10).map((pr) => ({
        label: `#${pr.id} ${pr.title}`,
        icon: GitPullRequest,
        hint: `${shortRef(pr.sourceRef)} → ${shortRef(pr.targetRef)} · ${t.prs.by(pr.author, pr.createdAt ? relativeTime(pr.createdAt) : "")}`,
        run: open(pr.url),
      })),
      { label: list.length ? t.prs.openAllOf(list.length) : t.prs.noneOpenAll, icon: ExternalLink, run: open(pullRequests.links(p)!.pullRequests) },
    ];
  });
  const total = on.reduce((n, p) => n + pullRequests.count(p), 0);
  return { label: t.prs.menu, icon: GitPullRequest, count: total || undefined, submenu, run: () => {} };
}
