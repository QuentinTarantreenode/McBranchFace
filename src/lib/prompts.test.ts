import { describe, expect, it } from "vitest";
import { branch, remote, repo } from "../test/backend";
import { availablePrompts, buildPrompt, defaultBody, describe as describeVar, PROMPT_VARIABLES, promptVars, type PromptContext, type PromptKind } from "./prompts";

const R = repo("C:/ws/core", {
  name: "Core",
  provider: "GitHub",
  remoteUrl: "https://github.com/x/core.git",
  defaultBranch: "refs/remotes/origin/main",
  links: { home: "https://github.com/x/core", pullRequests: "https://github.com/x/core/pulls", branch: "https://github.com/x/core/tree/{branch}" },
});
const commits = (n: number) => Array.from({ length: n }, (_, i) => ({ sha: `c${i}abcdef`, subject: `step ${i}`, authorEmail: "me@x", authoredAt: 1 }));
const ctx = (b: PromptContext["branch"], over: Partial<PromptContext> = {}): PromptContext => ({
  branch: b,
  repo: R,
  lang: "en",
  assessment: "Review: clean, no evidence",
  checks: [],
  ...over,
});
const FENCE = "```";
/** Every command line of the prompt's code blocks. */
const blocks = (md: string) =>
  md
    .split(`${FENCE}sh\n`)
    .slice(1)
    .flatMap((part) => part.split(`\n${FENCE}`)[0].split("\n"));

describe("prompts", () => {
  // A built-in prompt as it is copied: its shipped text in the language of the context.
  const built = (kind: PromptKind, c: PromptContext) => buildPrompt(defaultBody(kind, c.lang), c).text;
  const local = branch(R.path, "feature/x", { upstream: "origin/feature/x", ownCommitCount: 3, unpushedCommitCount: 1 });

  it("offers only what makes sense: nothing to merge without own commits, no second pull request", () => {
    expect(availablePrompts(local)).toEqual(["merge", "pr", "cleanup", "rebase"]);
    expect(availablePrompts(branch(R.path, "empty", { ownCommitCount: 0 }))).toEqual(["cleanup"]);
    const pr = { id: 7, title: "X", state: "Open" as const, url: "u", author: "a", authorName: null, sourceRef: "s", targetRef: "t", sourceSha: null, createdAt: null, closedAt: null, targetSha: null , reviewers: [], isDraft: false, hasConflicts: false};
    expect(availablePrompts({ ...local, pullRequest: pr })).toEqual(["merge", "cleanup", "rebase"]);
  });

  it("states goal, situation, exact commands and the rules for a merge", () => {
    const md = built("merge", ctx(local));
    expect(md).toContain("Merge `feature/x` into `origin/main` in the repo `Core`.");
    expect(md).toContain("Folder `C:/ws/core`");
    expect(md).toContain("`origin/feature/x` (deleted on the server)");
    expect(md).toContain("Not pushed yet: 1 commit");
    expect(blocks(md)).toEqual([
      "git status",
      "git fetch --prune origin",
      "git switch main",
      "git merge --ff-only origin/main",
      "git merge --no-ff feature/x",
      "git log --oneline origin/main..main",
      "git push origin main",
    ]);
    expect(md).toContain("Do not push, force-push or delete anything without asking me first.");
    expect(md).toContain(`at \`${local.sha}\` now`);
  });

  it("caps the commit list and counts the rest", () => {
    const md = built("rebase", ctx({ ...local, ownCommitCount: 75 }, { ownCommits: commits(60) }));
    expect(md.split("\n").filter((l) => /^- `c\d+a/.test(l)).length).toBe(50);
    expect(md).toContain("… and 25 more");
    expect(blocks(md)).toContain("git push --force-with-lease origin feature/x");
  });

  it("opens the pull request with the provider's tool and deletes a server branch only in the online view", () => {
    const pr = built("pr", ctx(local));
    expect(blocks(pr)).toContain("git push -u origin feature/x");
    expect(blocks(pr).some((l) => l.startsWith("gh pr create --base main --head feature/x --title 'work on feature/x'"))).toBe(true);
    expect(pr).toContain("https://github.com/x/core/pulls");
    expect(blocks(built("cleanup", ctx(local)))).not.toContain("git push origin --delete feature/x");
    const online = blocks(built("cleanup", ctx(remote(R.path, "feature/y", { ownCommitCount: 0 }))));
    expect(online).toContain("git push origin --delete feature/y");
    expect(online).toContain("git log --oneline origin/main..origin/feature/y");
    expect(online.some((l) => l.startsWith("git branch -d"))).toBe(false);
  });

  it("quotes a name with shell characters and follows the UI language", () => {
    const odd = branch(R.path, "fix/$(x)", { ownCommitCount: 1 });
    expect(blocks(built("rebase", ctx(odd)))).toContain("git switch 'fix/$(x)'");
    const de = built("cleanup", ctx(local, { lang: "de" }));
    expect(de).toContain("## Ausgangslage");
    expect(de).toContain("Nichts pushen, force-pushen oder löschen, ohne mich vorher zu fragen.");
  });

  it("renders a template of one's own: values, blocks and quoted names; unknown names stay and are named", () => {
    const own = ctx(local, { note: "ask QA first", tags: ["qa", "core"], verdict: "Review", ownCommits: commits(3) });
    const r = buildPrompt("Use the skill git-merge for {{branch}} ({{verdict}}, {{tags}}): {{note}}\n\n{{commits}}\n{{branch.q}} {{ nope }}", own);
    expect(r.text).toContain("Use the skill git-merge for feature/x (Review, qa, core): ask QA first");
    expect(r.text).toContain("- `c0abcde` step 0");
    expect(r.text).toContain("{{ nope }}");
    expect(r.unknown).toEqual(["nope"]);
    // Online there are no stashes and no worktree: both render empty.
    expect(buildPrompt("{{stashCount}}|{{worktreePath}}", ctx(remote(R.path, "y"))).text).toBe("|");
  });

  it("the default text of a built-in prompt is a template whose every name is known", () => {
    for (const kind of ["merge", "pr", "cleanup", "rebase"] as const) {
      const body = defaultBody(kind, "en");
      expect(body).toContain(`{{steps.${kind}}}`);
      expect(buildPrompt(body, ctx(local)).unknown).toEqual([]);
    }
  });

  it("describes every variable in both languages and knows each one when rendering", () => {
    const vars = promptVars(ctx(local));
    for (const v of PROMPT_VARIABLES) {
      expect(v.name in vars, v.name).toBe(true);
      for (const lang of ["de", "en"] as const) expect(describeVar(v.name, lang), `${v.name} ${lang}`).toBeTruthy();
    }
  });
});
