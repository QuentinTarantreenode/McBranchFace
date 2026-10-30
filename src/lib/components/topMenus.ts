// Menus of the top bar. They load on the first open: nothing here is needed to show the bar.
import { ExternalLink, GitBranch, GitPullRequest, LogIn, SlidersHorizontal } from "@lucide/svelte";
import { api } from "$lib/api";
import { branchUrl } from "$lib/links";
import { t } from "$lib/i18n/index.svelte";
import { LENSES, type Lens } from "$lib/alerts";
import type { ProviderKind } from "$lib/bindings/ProviderKind";
import type { RepoInfo } from "$lib/bindings/RepoInfo";
import type { ToolId } from "$lib/bindings/ToolId";
import type { MenuEntry } from "$lib/ui/menu.svelte";
import { toasts } from "$lib/stores/toasts.svelte";
import { settings } from "$lib/stores/settings.svelte";
import { environment } from "$lib/stores/environment.svelte";
import { dialogs } from "$lib/stores/dialogs.svelte";
import { cleanupView } from "$lib/stores/cleanupView.svelte";
import { lenses } from "$lib/stores/lenses.svelte";

/** `repo`: the one open in Git, else the one of the selected branch; `branch` on it, if any. */
export function providerMenu(p: { tool: ToolId; kind: ProviderKind }, repo: RepoInfo | undefined, branch: string | null | undefined): MenuEntry[] {
  const tool = environment.tool(p.tool);
  if (!tool) return [];
  const name = p.kind === "Azure" ? t.provider.azure : t.provider.github;
  const entries: MenuEntry[] = [{ heading: `${name} · ${t.tool.state[tool.state]}` }];
  for (const c of tool.commands) {
    entries.push({ label: t.tool.action[c.action], icon: LogIn, hint: c.command, run: () => environment.runTool(p.tool, c.action) });
  }
  const links = repo?.provider === p.kind ? repo.links : null;
  if (repo && links) {
    const open = (url: string) => () => toasts.safely(() => api.openUrl(url));
    entries.push("sep", { heading: repo.name });
    entries.push({ label: t.provider.openRepo, icon: ExternalLink, run: open(links.home) });
    entries.push({ label: t.provider.openPrs, icon: GitPullRequest, run: open(links.pullRequests) });
    if (branch) entries.push({ label: t.provider.openBranch, icon: GitBranch, hint: branch, run: open(branchUrl(links, branch)) });
  }
  entries.push("sep");
  if (tool.state === "Ready") {
    entries.push({
      label: t.provider.signInAgain,
      icon: LogIn,
      hint: tool.account ? t.provider.signedInAs(tool.account) : undefined,
      run: () => environment.runTool(p.tool, "Login"),
    });
  }
  entries.push({ label: t.provider.environment, icon: SlidersHorizontal, run: () => dialogs.openSettings("env") });
  return entries;
}

const lensLabel = (l: Lens) =>
  ({
    localSafe: [t.lens.localSafe, t.lens.localSafeHint],
    localReview: [t.lens.localReview, t.lens.localReviewHint],
    localForgotten: [t.lens.localForgotten, t.lens.localForgottenHint],
    onlineMerged: [t.lens.onlineMerged, t.lens.onlineMergedHint],
    onlineInactive: [t.lens.onlineInactive, t.lens.onlineInactiveHint(settings.config?.staleDays ?? 30)],
  })[l.id];

export function bellMenu(): MenuEntry[] {
  const entries: MenuEntry[] = [{ heading: lenses.bellCount ? t.top.alertsCount(lenses.bellCount) : t.top.alertsNone }];
  for (const l of lenses.lenses.length ? lenses.lenses : LENSES) {
    const [label, hint] = lensLabel(l);
    entries.push({ label, hint, count: lenses.lensCounts.get(l.id) ?? 0, run: () => cleanupView.applyLens(l) });
  }
  entries.push("sep", { label: t.settings.alerts, icon: SlidersHorizontal, run: () => dialogs.openSettings("updates") });
  return entries;
}
