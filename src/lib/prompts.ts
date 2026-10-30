// Git work as a Markdown prompt for an LLM assistant: goal, situation, exact commands and the rules
// that keep the assistant from doing anything irreversible on its own. Every prompt is a template
// with {{variables}}: the built-in ones ship here, the user edits them or writes their own in the
// settings. Loaded with the row menu, the detail pane or the settings page; the texts live here, not
// in the dictionaries, so the start page does not carry them.
import { refParts } from "./branchName";
import { branchUrl } from "./links";
import type { Lang } from "./i18n/index.svelte";
import type { BranchReport } from "./bindings/BranchReport";
import type { CommitInfo } from "./bindings/CommitInfo";
import type { RemoteBranchReport } from "./bindings/RemoteBranchReport";
import type { RepoInfo } from "./bindings/RepoInfo";

import type { PromptKind } from "./promptKinds";

export type { PromptKind };

export interface PromptContext {
  branch: BranchReport | RemoteBranchReport;
  repo: RepoInfo | undefined;
  lang: Lang;
  /** The verdict and its reason as the UI states them. */
  assessment: string | null;
  /** The open checks as plain sentences. */
  checks: string[];
  /** The verdict's label alone, for templates that want it without the reason. */
  verdict?: string;
  note?: string;
  tags?: string[];
  /** The own commits of a local branch, read for the prompt (the scan result has only their count). */
  ownCommits?: CommitInfo[];
}

/** More would drown the actual task; the count says how many there are. */
const MAX_COMMITS = 50;
const MAX_FILES = 30;

const isRemote = (b: BranchReport | RemoteBranchReport): b is RemoteBranchReport => "remote" in b;
const openPr = (b: BranchReport | RemoteBranchReport) => b.pullRequest?.state === "Open";

/** The prompts that make sense for this branch: nothing to merge or rebase without own commits, no second PR. */
export function availablePrompts(b: BranchReport | RemoteBranchReport): PromptKind[] {
  const own = b.ownCommitCount > 0;
  const out: PromptKind[] = [];
  if (own) out.push("merge");
  if (own && !openPr(b)) out.push("pr");
  out.push("cleanup");
  if (own) out.push("rebase");
  return out;
}

// Refnames never contain spaces, but may contain shell characters; quoted, the line stays one command.
const arg = (s: string) => (/^[\w./@+-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`);
const code = (s: string) => `\`${s}\``;
const short = (sha: string) => sha.slice(0, 7);
const block = (lines: string[]) => ["```sh", ...lines, "```"].join("\n");

export const PROMPT_TEXT = {
  de: {
    ui: {
      templates: "Vorlagen",
      add: "Neue Vorlage",
      unnamed: "Neue Vorlage",
      duplicate: "Als eigene Vorlage kopieren",
      remove: "Vorlage entfernen",
      builtin: "Eingebaut",
      own: "Eigene",
      insert: "Variable einfügen …",
      insertTip: "Setzt einen Wert des Branches an der Cursorstelle ein.",
      groups: { branch: "Branch", repo: "Repo", pr: "Pull Request", quoted: "Für Befehle, gequotet", block: "Blöcke" },
      changed: "geändert",
      reset: "Auf Standard zurücksetzen",
      name: "Name",
      scope: "Angeboten für",
      scopeLocal: "Lokal",
      scopeOnline: "Online",
      scopeBoth: "Beide",
      needsOwn: "Nur für Branches mit eigenen Commits",
      body: "Text",
      preview: "Vorschau",
      previewFor: "Vorschau mit",
      noBranch: "Kein Branch für die Vorschau",
      unknown: (names: string) => `Unbekannt, bleibt stehen: ${names}`,
      empty: "Noch keine eigenen Vorlagen.",
    },
    vars: {
      repo: "Name des Repos",
      path: "Ordner des Repos",
      remote: "Remote, meist origin",
      remoteUrl: "Adresse des Remotes",
      provider: "Anbieter: GitHub, Azure oder keiner",
      branch: "Branch-Name ohne Remote",
      ref: "Branch, online mit Remote davor",
      default: "Default-Branch mit Remote",
      defaultName: "Default-Branch ohne Remote",
      sha: "Commit, auf dem der Branch steht",
      shortSha: "Die ersten sieben Zeichen davon",
      upstream: "Upstream, nur lokal",
      lastSubject: "Betreff des letzten Commits",
      lastAuthor: "Autor des letzten Commits",
      verdict: "Bewertung",
      assessment: "Bewertung mit Grund",
      ownCommitCount: "Zahl der eigenen Commits",
      unpushedCount: "Zahl der ungepushten Commits",
      stashCount: "Zahl der Stashes",
      worktreePath: "Worktree mit dem Branch",
      prId: "Nummer des Pull Requests",
      prTitle: "Titel des Pull Requests",
      prState: "Zustand des Pull Requests",
      prUrl: "Adresse des Pull Requests",
      evidence: "Merge-Nachweis",
      prLink: "Seite der Pull Requests",
      branchUrl: "Seite des Branches beim Anbieter",
      note: "Eigene Notiz zum Branch",
      tags: "Tags, mit Komma getrennt",
      lang: "Sprache der Oberfläche",
      quoted: "Wie oben, für Befehle in Anführungszeichen, wo nötig",
      situation: "Ausgangslage als Liste",
      commits: "Eigene Commits, höchstens 50",
      files: "Uncommitted changes",
      stashes: "Stashes",
      checks: "Offene Punkte der Bewertung",
      backup: "Satz mit dem SHA zum Wiederherstellen",
      rules: "Die Regeln für den Assistenten",
      goal: (what: string) => `Ziel in einem Satz: ${what}`,
      steps: (what: string) => `git-Befehle mit Erklärung: ${what}`,
    },
    title: { merge: "Merge", pr: "Pull Request anlegen", cleanup: "Branch aufräumen", rebase: "Rebase auf den Default-Branch" },
    goal: {
      merge: (b: string, target: string, repo: string) => `Merge ${code(b)} in ${code(target)} im Repo ${code(repo)}.`,
      pr: (b: string, target: string, repo: string) => `Leg einen Pull Request von ${code(b)} nach ${code(target)} im Repo ${code(repo)} an.`,
      cleanup: (b: string, _target: string, repo: string) => `Räum den Branch ${code(b)} im Repo ${code(repo)} auf: prüfen, ob etwas verloren ginge, dann löschen.`,
      rebase: (b: string, target: string, repo: string) => `Rebase ${code(b)} auf ${code(target)} im Repo ${code(repo)}.`,
    },
    quote: (s: string) => `„${s}“`,
    situation: "Ausgangslage",
    steps: "Vorgehen",
    rules: "Regeln",
    repo: "Repo",
    folder: "Ordner",
    remote: "Remote",
    defaultBranch: "Default-Branch",
    branch: "Branch",
    upstream: "Upstream",
    upstreamGone: "auf dem Server gelöscht",
    at: "Stand",
    assessment: "Bewertung",
    openChecks: "Offene Punkte",
    evidence: "Merge-Nachweis",
    pr: "Pull Request",
    ownCommits: (c: number) => `Eigene Commits (${c}, nicht im Default-Branch)`,
    moreCommits: (c: number) => `… und ${c} weitere`,
    unpushed: (c: number) => `Noch nicht gepusht: ${c === 1 ? "1 Commit" : `${c} Commits`}`,
    dirty: (c: number, path: string) => `Uncommitted changes (${c === 1 ? "1 Datei" : `${c} Dateien`}) im Worktree ${code(path)}`,
    moreFiles: (c: number) => `… und ${c} weitere`,
    stashes: (c: number) => `Stashes: ${c}`,
    backup: (sha: string) => `Sicherung: Der Branch steht jetzt auf ${code(sha)}. Mit diesem Commit lässt er sich jederzeit wiederherstellen.`,
    checkout: "Arbeite im Ordner oben. Zuerst den Zustand prüfen:",
    mergeSteps: "Dann den Default-Branch aktualisieren und mergen:",
    mergeCheck: "Danach prüfen und berichten, was im Merge kam:",
    push: "Pushen erst nach meiner Freigabe:",
    prPush: "Der Branch muss auf dem Server liegen. Pushen erst nach meiner Freigabe:",
    prCreate: "Dann den Pull Request anlegen:",
    prWeb: (url: string) => `Oder im Browser: ${url}`,
    prTitle: "Titel-Vorschlag",
    prBody: "Beschreibung: fass die Commits oben in zwei, drei Sätzen zusammen und nenn, was Reviewer prüfen sollten.",
    cleanupCheck: "Prüfen, ob der Inhalt im Default-Branch angekommen ist:",
    cleanupLocal: "Erst wenn nichts verloren geht, den lokalen Branch löschen. `-d` verweigert ungemergte Branches; `-D` nur nach meiner Freigabe:",
    cleanupRemote: "Den Branch auf dem Server löschen, nur nach meiner Freigabe:",
    cleanupRestore: "Wiederherstellen, falls nötig:",
    rebaseSteps: "Dann rebasen:",
    rebaseConflict: "Bei Konflikten: anhalten, die Dateien nennen und fragen. Abbrechen geht mit:",
    rebasePush: "Der Rebase schreibt die History neu. Pushen nur nach meiner Freigabe, und nur mit Lease:",
    rule: [
      "Nichts pushen, force-pushen oder löschen, ohne mich vorher zu fragen.",
      "Vor jedem Schritt `git status` prüfen; bei uncommitted changes anhalten und fragen.",
      "Konflikte melden, nicht raten: Dateien und beide Seiten nennen.",
      "Wenn ein Befehl etwas anderes tut als erwartet, anhalten und berichten.",
      "Am Ende kurz berichten: was getan wurde, der neue Stand (SHA) und was noch offen ist.",
    ],
  },
  en: {
    ui: {
      templates: "Templates",
      add: "New template",
      unnamed: "New template",
      duplicate: "Copy as own template",
      remove: "Remove template",
      builtin: "Built in",
      own: "Your own",
      insert: "Insert variable …",
      insertTip: "Inserts a value of the branch at the cursor.",
      groups: { branch: "Branch", repo: "Repo", pr: "Pull request", quoted: "For commands, quoted", block: "Blocks" },
      changed: "changed",
      reset: "Reset to default",
      name: "Name",
      scope: "Offered for",
      scopeLocal: "Local",
      scopeOnline: "Online",
      scopeBoth: "Both",
      needsOwn: "Only for branches with own commits",
      body: "Text",
      preview: "Preview",
      previewFor: "Preview with",
      noBranch: "No branch for the preview",
      unknown: (names: string) => `Unknown, stays as written: ${names}`,
      empty: "No templates of your own yet.",
    },
    vars: {
      repo: "Name of the repo",
      path: "Folder of the repo",
      remote: "Remote, usually origin",
      remoteUrl: "Address of the remote",
      provider: "Provider: GitHub, Azure or none",
      branch: "Branch name without remote",
      ref: "Branch, online with the remote in front",
      default: "Default branch with remote",
      defaultName: "Default branch without remote",
      sha: "Commit the branch is at",
      shortSha: "Its first seven characters",
      upstream: "Upstream, local only",
      lastSubject: "Subject of the last commit",
      lastAuthor: "Author of the last commit",
      verdict: "Verdict",
      assessment: "Verdict with its reason",
      ownCommitCount: "Number of own commits",
      unpushedCount: "Number of unpushed commits",
      stashCount: "Number of stashes",
      worktreePath: "Worktree with the branch",
      prId: "Number of the pull request",
      prTitle: "Title of the pull request",
      prState: "State of the pull request",
      prUrl: "Address of the pull request",
      evidence: "Merge evidence",
      prLink: "Page of the pull requests",
      branchUrl: "Page of the branch at the provider",
      note: "Your note on the branch",
      tags: "Tags, comma separated",
      lang: "Language of the interface",
      quoted: "As above, quoted for commands where needed",
      situation: "Situation as a list",
      commits: "Own commits, at most 50",
      files: "Uncommitted changes",
      stashes: "Stashes",
      checks: "Open points of the verdict",
      backup: "Sentence with the SHA to restore",
      rules: "The rules for the assistant",
      goal: (what: string) => `Goal in one sentence: ${what}`,
      steps: (what: string) => `git commands with explanation: ${what}`,
    },
    title: { merge: "Merge", pr: "Open a pull request", cleanup: "Clean up a branch", rebase: "Rebase onto the default branch" },
    goal: {
      merge: (b: string, target: string, repo: string) => `Merge ${code(b)} into ${code(target)} in the repo ${code(repo)}.`,
      pr: (b: string, target: string, repo: string) => `Open a pull request from ${code(b)} to ${code(target)} in the repo ${code(repo)}.`,
      cleanup: (b: string, _target: string, repo: string) => `Clean up the branch ${code(b)} in the repo ${code(repo)}: check that nothing would be lost, then delete it.`,
      rebase: (b: string, target: string, repo: string) => `Rebase ${code(b)} onto ${code(target)} in the repo ${code(repo)}.`,
    },
    quote: (s: string) => `“${s}”`,
    situation: "Situation",
    steps: "Steps",
    rules: "Rules",
    repo: "Repo",
    folder: "Folder",
    remote: "Remote",
    defaultBranch: "Default branch",
    branch: "Branch",
    upstream: "Upstream",
    upstreamGone: "deleted on the server",
    at: "At",
    assessment: "Assessment",
    openChecks: "Open points",
    evidence: "Merge evidence",
    pr: "Pull request",
    ownCommits: (c: number) => `Own commits (${c}, not in the default branch)`,
    moreCommits: (c: number) => `… and ${c} more`,
    unpushed: (c: number) => `Not pushed yet: ${c === 1 ? "1 commit" : `${c} commits`}`,
    dirty: (c: number, path: string) => `Uncommitted changes (${c === 1 ? "1 file" : `${c} files`}) in the worktree ${code(path)}`,
    moreFiles: (c: number) => `… and ${c} more`,
    stashes: (c: number) => `Stashes: ${c}`,
    backup: (sha: string) => `Backup: the branch is at ${code(sha)} now. With this commit it can be restored at any time.`,
    checkout: "Work in the folder above. First check the state:",
    mergeSteps: "Then update the default branch and merge:",
    mergeCheck: "Afterwards check and report what the merge brought in:",
    push: "Push only after my go-ahead:",
    prPush: "The branch has to be on the server. Push only after my go-ahead:",
    prCreate: "Then open the pull request:",
    prWeb: (url: string) => `Or in the browser: ${url}`,
    prTitle: "Suggested title",
    prBody: "Description: sum up the commits above in two or three sentences and say what reviewers should check.",
    cleanupCheck: "Check that the content arrived in the default branch:",
    cleanupLocal: "Only when nothing gets lost, delete the local branch. `-d` refuses unmerged branches; `-D` only after my go-ahead:",
    cleanupRemote: "Delete the branch on the server, only after my go-ahead:",
    cleanupRestore: "To restore it, if needed:",
    rebaseSteps: "Then rebase:",
    rebaseConflict: "On conflicts: stop, name the files and ask. To abort:",
    rebasePush: "The rebase rewrites history. Push only after my go-ahead, and only with a lease:",
    rule: [
      "Do not push, force-push or delete anything without asking me first.",
      "Check `git status` before every step; stop and ask on uncommitted changes.",
      "Report conflicts, do not guess: name the files and both sides.",
      "If a command does something other than expected, stop and report.",
      "At the end report briefly: what was done, the new state (SHA) and what is still open.",
    ],
  },
};

type Text = (typeof PROMPT_TEXT)["de"];

/** Names the prompt works with: the branch as the commands need it, the default branch, the remote. */
function names(ctx: PromptContext) {
  const b = ctx.branch;
  const def = ctx.repo?.defaultBranch ? refParts(ctx.repo.defaultBranch) : null;
  const remote = isRemote(b) ? b.remote : (refParts(b.upstream || b.remoteRef || "").remote ?? def?.remote ?? "origin");
  return {
    remote,
    local: b.name,
    /** What merge and log refer to: the server branch for an online row, the local one otherwise. */
    ref: isRemote(b) ? `${b.remote}/${b.name}` : b.name,
    target: def?.name ?? "main",
    targetRef: def?.remote ? `${def.remote}/${def.name}` : `${remote}/${def?.name ?? "main"}`,
    repo: ctx.repo?.name ?? b.repoPath,
  };
}

function situation(ctx: PromptContext, x: Text, n: ReturnType<typeof names>): string[] {
  const b = ctx.branch;
  const out: string[] = [];
  out.push(`- ${x.repo}: ${code(n.repo)}, ${x.folder} ${code(b.repoPath)}`);
  if (ctx.repo?.remoteUrl) out.push(`- ${x.remote}: ${code(n.remote)} → ${ctx.repo.remoteUrl}`);
  out.push(`- ${x.defaultBranch}: ${code(n.targetRef)}`);
  out.push(`- ${x.branch}: ${code(n.ref)}, ${x.at} ${code(short(b.sha))}`);
  // Only an upstream of its own; tracking the integration line says nothing about this branch.
  if (!isRemote(b) && b.upstream && b.upstreamState !== "None") {
    const u = refParts(b.upstream);
    const gone = b.upstreamState === "Gone" ? ` (${x.upstreamGone})` : "";
    out.push(`- ${x.upstream}: ${code(u.remote ? `${u.remote}/${u.name}` : u.name)}${gone}`);
  }
  if (ctx.assessment) out.push(`- ${x.assessment}: ${ctx.assessment}`);
  if (ctx.checks.length) out.push(`- ${x.openChecks}:`, ...ctx.checks.map((c) => `  - ${c}`));
  if (b.mergeEvidence) out.push(`- ${x.evidence}: ${b.mergeEvidence.kind} → ${code(b.mergeEvidence.target)}`);
  if (b.pullRequest) out.push(`- ${x.pr}: #${b.pullRequest.id} ${x.quote(b.pullRequest.title)} (${b.pullRequest.state}), ${b.pullRequest.url}`);
  if (!isRemote(b)) {
    if (b.unpushedCommitCount) out.push(`- ${x.unpushed(b.unpushedCommitCount)}`);
    const files = b.worktree?.files ?? [];
    if (files.length && b.worktree) {
      out.push(`- ${x.dirty(files.length, b.worktree.path)}:`);
      out.push(...files.slice(0, MAX_FILES).map((f) => `  - ${f.kind} ${code(f.path)}`));
      if (files.length > MAX_FILES) out.push(`  - ${x.moreFiles(files.length - MAX_FILES)}`);
    }
    if (b.stashes.length) out.push(`- ${x.stashes(b.stashes.length)}`);
    const own = ctx.ownCommits ?? [];
    if (own.length) {
      out.push("", `${x.ownCommits(b.ownCommitCount)}:`, "");
      out.push(...own.slice(0, MAX_COMMITS).map((c) => `- ${code(short(c.sha))} ${c.subject}`));
      const rest = b.ownCommitCount - Math.min(own.length, MAX_COMMITS);
      if (rest > 0) out.push(`- ${x.moreCommits(rest)}`);
    } else if (b.ownCommitCount) out.push(`- ${x.ownCommits(b.ownCommitCount)}`);
  } else if (b.ownCommitCount) out.push(`- ${x.ownCommits(b.ownCommitCount)}`);
  return out;
}

function steps(kind: PromptKind, ctx: PromptContext, x: Text, n: ReturnType<typeof names>): string[] {
  const b = ctx.branch;
  const online = isRemote(b);
  const [ref, local, target, targetRef, remote] = [arg(n.ref), arg(n.local), arg(n.target), arg(n.targetRef), arg(n.remote)];
  const start = [x.checkout, block(["git status", `git fetch --prune ${remote}`])];
  switch (kind) {
    case "merge":
      return [
        ...start,
        x.mergeSteps,
        block([`git switch ${target}`, `git merge --ff-only ${targetRef}`, `git merge --no-ff ${ref}`]),
        x.mergeCheck,
        block([`git log --oneline ${targetRef}..${target}`]),
        x.push,
        block([`git push ${remote} ${target}`]),
      ];
    case "pr": {
      const out = [...start];
      if (!online) out.push(x.prPush, block([`git push -u ${remote} ${local}`]));
      const title = b.lastCommitSubject || n.local;
      const provider = ctx.repo?.provider;
      out.push(`${x.prTitle}: ${code(title)}`, x.prBody, x.prCreate);
      if (provider === "GitHub") out.push(block([`gh pr create --base ${target} --head ${local} --title ${arg(title)} --body "<description>"`]));
      else if (provider === "Azure") out.push(block([`az repos pr create --source-branch ${local} --target-branch ${target} --title ${arg(title)} --description "<description>"`]));
      if (ctx.repo?.links?.pullRequests) out.push(x.prWeb(ctx.repo.links.pullRequests));
      return out;
    }
    case "cleanup": {
      const out = [...start, x.cleanupCheck, block([`git log --oneline ${targetRef}..${ref}`, `git cherry -v ${targetRef} ${ref}`])];
      if (!online) out.push(x.cleanupLocal, block([`git branch -d ${local}`]));
      if (online) out.push(x.cleanupRemote, block([`git push ${remote} --delete ${local}`]));
      out.push(x.cleanupRestore, block([`git branch ${local} ${b.sha}`]));
      return out;
    }
    case "rebase":
      return [
        ...start,
        x.rebaseSteps,
        block([`git switch ${local}`, `git rebase ${targetRef}`]),
        x.rebaseConflict,
        block(["git rebase --abort"]),
        x.rebasePush,
        block([`git push --force-with-lease ${remote} ${local}`]),
      ];
  }
}

export type VariableGroup = "branch" | "repo" | "pr" | "quoted" | "block";

/** One variable of the templates: its name, its group, and whether it stands for a whole block of Markdown. */
export interface PromptVariable {
  name: string;
  group: VariableGroup;
  block: boolean;
}

const KINDS: PromptKind[] = ["merge", "pr", "cleanup", "rebase"];

/** Every variable a template can use: the single source for the editor's chips, the help and the renderer. */
const GROUPS: [VariableGroup, string[]][] = [
  ["branch", ["branch", "ref", "sha", "shortSha", "upstream", "lastSubject", "lastAuthor", "verdict", "assessment", "ownCommitCount", "unpushedCount", "stashCount", "worktreePath", "note", "tags"]],
  ["repo", ["repo", "path", "remote", "remoteUrl", "provider", "default", "defaultName", "branchUrl", "prLink", "lang"]],
  ["pr", ["prId", "prTitle", "prState", "prUrl", "evidence"]],
  ["quoted", ["branch.q", "ref.q", "default.q", "defaultName.q", "remote.q"]],
  ["block", ["situation", "commits", "files", "stashes", "checks", "backup", "rules", ...KINDS.map((k) => `goal.${k}`), ...KINDS.map((k) => `steps.${k}`)]],
];
export const PROMPT_VARIABLES: PromptVariable[] = GROUPS.flatMap(([group, names]) => names.map((name) => ({ name, group, block: group === "block" })));

/** What a variable holds, in the UI language: the tip of its chip in the editor. */
export function describe(name: string, lang: Lang): string {
  const x = PROMPT_TEXT[lang];
  const [base, part] = name.split(".");
  if (part === "q") return x.vars.quoted;
  if (base === "goal" || base === "steps") return x.vars[base](x.title[part as PromptKind]);
  return (x.vars as Record<string, string | ((w: string) => string)>)[base] as string;
}

/** The values of every variable for one branch; empty where the branch has none (online: no worktree). */
export function promptVars(ctx: PromptContext): Record<string, string> {
  const x = PROMPT_TEXT[ctx.lang];
  const n = names(ctx);
  const b = ctx.branch;
  const local = isRemote(b) ? null : b;
  const pr = b.pullRequest;
  const upstream = local?.upstream && local.upstreamState !== "None" ? refParts(local.upstream) : null;
  const list = (items: string[]) => items.join("\n");
  const own = local ? (ctx.ownCommits ?? []) : [];
  const rest = (local?.ownCommitCount ?? 0) - Math.min(own.length, MAX_COMMITS);
  const files = local?.worktree?.files ?? [];
  const vars: Record<string, string> = {
    repo: n.repo,
    path: b.repoPath,
    remote: n.remote,
    remoteUrl: ctx.repo?.remoteUrl ?? "",
    provider: ctx.repo?.provider ?? "",
    branch: n.local,
    ref: n.ref,
    default: n.targetRef,
    defaultName: n.target,
    sha: b.sha,
    shortSha: short(b.sha),
    upstream: upstream ? (upstream.remote ? `${upstream.remote}/${upstream.name}` : upstream.name) : "",
    lastSubject: b.lastCommitSubject,
    lastAuthor: b.lastCommitAuthor,
    verdict: ctx.verdict ?? "",
    assessment: ctx.assessment ?? "",
    ownCommitCount: String(b.ownCommitCount),
    unpushedCount: local ? String(local.unpushedCommitCount) : "",
    stashCount: local ? String(local.stashes.length) : "",
    worktreePath: local?.worktree?.path ?? "",
    prId: pr ? String(pr.id) : "",
    prTitle: pr?.title ?? "",
    prState: pr?.state ?? "",
    prUrl: pr?.url ?? "",
    evidence: b.mergeEvidence ? `${b.mergeEvidence.kind} → ${b.mergeEvidence.target}` : "",
    prLink: ctx.repo?.links?.pullRequests ?? "",
    branchUrl: ctx.repo?.links ? branchUrl(ctx.repo.links, b.name) : "",
    note: ctx.note ?? "",
    tags: (ctx.tags ?? []).join(", "),
    lang: ctx.lang,
    situation: list(situation(ctx, x, n)),
    commits: list([...own.slice(0, MAX_COMMITS).map((c) => `- ${code(short(c.sha))} ${c.subject}`), ...(rest > 0 ? [`- ${x.moreCommits(rest)}`] : [])]),
    files: list([...files.slice(0, MAX_FILES).map((f) => `- ${f.kind} ${code(f.path)}`), ...(files.length > MAX_FILES ? [`- ${x.moreFiles(files.length - MAX_FILES)}`] : [])]),
    stashes: list((local?.stashes ?? []).map((st) => `- ${code(st.selector)} ${st.message}`)),
    checks: list(ctx.checks.map((c) => `- ${c}`)),
    backup: x.backup(b.sha),
    rules: list(x.rule.map((r) => `- ${r}`)),
  };
  for (const k of ["branch", "ref", "default", "defaultName", "remote"]) vars[`${k}.q`] = arg(vars[k]);
  for (const kind of KINDS) {
    const goalRef = kind === "merge" || kind === "cleanup" ? n.ref : n.local;
    const target = kind === "rebase" || kind === "merge" ? n.targetRef : n.target;
    vars[`goal.${kind}`] = x.goal[kind](goalRef, target, n.repo);
    vars[`steps.${kind}`] = steps(kind, ctx, x, n).join("\n\n");
  }
  return vars;
}

/** The text of a built-in prompt, as a template: what "reset to default" brings back. */
export function defaultBody(kind: PromptKind, lang: Lang): string {
  const x = PROMPT_TEXT[lang];
  return `# ${x.title[kind]}: {{ref}}\n\n{{goal.${kind}}}\n\n## ${x.situation}\n\n{{situation}}\n\n{{backup}}\n\n## ${x.steps}\n\n{{steps.${kind}}}\n\n## ${x.rules}\n\n{{rules}}\n`;
}

/**
 * Fills a template. Unknown names stay in the text as written and are reported, so a typo is seen in
 * the preview instead of vanishing; names without a value for this branch become empty.
 */
function renderPrompt(body: string, vars: Record<string, string>): { text: string; unknown: string[] } {
  const unknown = new Set<string>();
  const text = body.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (all, name: string) => {
    if (name in vars) return vars[name];
    unknown.add(name);
    return all;
  });
  return { text, unknown: [...unknown] };
}

/** A template (built-in or the user's own) filled for one branch. */
export const buildPrompt = (body: string, ctx: PromptContext) => renderPrompt(body, promptVars(ctx));
