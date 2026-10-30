// "Copy as prompt": the menu entries and the glue to the store. Loaded with the menus that offer it.
import { Bot, Broom, FileText, GitCommitHorizontal, GitMerge, GitPullRequestCreate } from "@lucide/svelte";
import { i18n, t } from "$lib/i18n/index.svelte";
import { checkText } from "$lib/checks";
import { plain } from "$lib/rich";
import { availablePrompts, buildPrompt, defaultBody, type PromptContext, type PromptKind } from "$lib/prompts";
import type { BranchReport } from "$lib/bindings/BranchReport";
import type { CommitInfo } from "$lib/bindings/CommitInfo";
import { BUILTIN_OF } from "$lib/promptKinds";
import type { PromptTemplate } from "$lib/bindings/PromptTemplate";
import type { RemoteBranchReport } from "$lib/bindings/RemoteBranchReport";
import type { MenuEntry, MenuItem } from "$lib/ui/menu.svelte";
import { toasts } from "$lib/stores/toasts.svelte";
import { settings } from "$lib/stores/settings.svelte";
import { scanResults } from "$lib/stores/scanResults.svelte";
import { rules } from "$lib/stores/rules.svelte";
import { branchCommits } from "$lib/stores/branchCommits.svelte";

const ICONS = { merge: GitMerge, pr: GitPullRequestCreate, cleanup: Broom, rebase: GitCommitHorizontal };

/**
 * What a template sees of a branch: the branch itself plus the wording the UI gives it. `ownCommits`: the
 * branch's own commits; without them the ones read already, else only their count.
 */
export function promptContext(b: BranchReport | RemoteBranchReport, ownCommits?: CommitInfo[]): PromptContext {
  const online = "remote" in b;
  const v = online ? t.onlineVerdict[b.verdict] : t.verdict[b.verdict];
  // Passed checks say nothing the assistant has to act on.
  const checks = online ? [] : b.checks.filter((c) => c.outcome === "Warn" || c.outcome === "Fail").map((c) => plain(checkText(c.code).title));
  const a = rules.annotationOf(b.repoPath, b.name);
  const own = online ? undefined : (ownCommits ?? branchCommits.of(b)?.own);
  return { branch: b, repo: scanResults.repoByPath.get(b.repoPath), lang: i18n.lang, assessment: `${v.label}: ${v.hint}`, verdict: v.label, checks, note: a.note, tags: a.tags, ownCommits: own };
}

/** The body of a built-in prompt: the user's edited one, else the shipped text in the UI language. */
export const builtinBody = (kind: PromptKind) => settings.config?.prompts.find((p) => p.builtin === BUILTIN_OF[kind])?.body ?? defaultBody(kind, i18n.lang);

/** A template of the user's own fits a row by its scope and, if it asks for them, own commits. */
export const fits = (p: PromptTemplate, b: BranchReport | RemoteBranchReport) =>
  (p.scope === "Both" || (p.scope === "Online") === "remote" in b) && (!p.needsOwnCommits || b.ownCommitCount > 0);

const copy = (body: string, b: BranchReport | RemoteBranchReport) =>
  toasts.safely(async () => {
    // The prompt lists the own commits: read them first where the scan result has only their count. Should
    // that fail, the prompt says how many there are, as for a server branch.
    const own = "remote" in b || !b.ownCommitCount ? undefined : (await branchCommits.load(b).catch(() => null))?.own;
    await navigator.clipboard.writeText(buildPrompt(body, promptContext(b, own)).text);
    toasts.toast("success", t.prompt.copied);
  });

export function promptEntries(b: BranchReport | RemoteBranchReport): MenuEntry[] {
  const builtins: MenuEntry[] = availablePrompts(b).map((kind) => ({ label: t.prompt[kind], icon: ICONS[kind], run: () => copy(builtinBody(kind), b) }));
  const own = (settings.config?.prompts ?? []).filter((p) => !p.builtin && fits(p, b));
  if (!own.length) return builtins;
  return [...builtins, "sep", ...own.map((p): MenuEntry => ({ label: p.name, icon: FileText, run: () => copy(p.body, b) }))];
}

export const promptItem = (b: BranchReport | RemoteBranchReport): MenuItem => ({ label: t.prompt.menu, icon: Bot, hint: t.prompt.hint, submenu: promptEntries(b), run: () => {} });
