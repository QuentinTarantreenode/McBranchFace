import { beforeAll, describe, expect, it } from "vitest";
import type { CheckCode } from "./bindings/CheckCode";
import type { ProviderFailure } from "./bindings/ProviderFailure";
import type { RepoWarning } from "./bindings/RepoWarning";
import { checkText } from "./checks";
import { plain } from "./rich";
import { warningText } from "./warnings";
import { absoluteTime, dateOnly, relativeTime, shortRef, shortSha } from "./format";
import { i18n } from "./i18n/index.svelte";
import { ONLINE_TONE, TOOL_TONE, VERDICT_TONE } from "./verdict";

beforeAll(() => i18n.set("En"));

const CODES: CheckCode[] = [
  ...(["Ancestor", "PatchEquivalent", "Squash", "ContainedInRemote", "PullRequest"] as const).map(
    // As the backend reports them: a completed PR by its number, every other kind by a ref.
    (kind): CheckCode => ({ code: "Merged", p: { kind, target: kind === "PullRequest" ? "#12" : "refs/remotes/origin/main" } }),
  ),
  { code: "NoDefaultBranch" },
  { code: "NoMergeEvidence", p: { own: 2, base: "refs/remotes/origin/main" } },
  { code: "PushUnknown" },
  { code: "PushStateMissing", p: { sha: "a".repeat(40), source: "PullRequest" } },
  { code: "AllPushed", p: { upstream: "refs/remotes/origin/x", sha: "b".repeat(40), source: "Snapshot" } },
  { code: "CommitsAfterPush", p: { count: 1, upstream: "refs/remotes/origin/x", merged: true } },
  { code: "CommitsAfterPush", p: { count: 3, upstream: "refs/remotes/origin/x", merged: false } },
  { code: "NotCheckedOut" },
  { code: "Dirty", p: { count: 2, path: "C:/w" } },
  { code: "CurrentBranch", p: { path: "C:/w" } },
  { code: "LinkedWorktree", p: { path: "C:/w2" } },
  { code: "NoStashes" },
  { code: "Stashes", p: { count: 1 } },
  { code: "Pr", p: { id: 7, state: "Merged", title: "Fix", target: "refs/heads/main" } },
  { code: "NoPr", p: { remote: "refs/remotes/origin/x" } },
];

describe("check texts", () => {
  it("word every check with title and detail, refs as ref parts, never inside the prose", () => {
    for (const c of CODES) {
      const x = checkText(c);
      expect(plain(x.title).trim(), c.code).toBeTruthy();
      expect(plain(x.detail).trim(), c.code).toBeTruthy();
      const prose = [x.title, x.detail].flatMap((r) => (typeof r === "string" ? [r] : r.filter((p): p is string => typeof p === "string")));
      expect(prose.join(" "), c.code).not.toContain("refs/");
    }
    // A completed PR is named by its number, not shown as a branch.
    const pr = checkText({ code: "Merged", p: { kind: "PullRequest", target: "#12" } });
    expect(plain(pr.title)).toContain("#12");
    expect(JSON.stringify(pr.detail)).not.toContain("\"ref\"");
  });

  it("word every repo warning", () => {
    const all: RepoWarning[] = [
      { code: "NoDefaultBranch" },
      { code: "PrListCapped", p: { limit: 500 } },
      { code: "PrQueryFailed", p: { kind: "LoggedOut", detail: "401", fallbackAt: null } },
      { code: "BranchFailed", p: { branch: "x", detail: "bad" } },
      { code: "OnlineFailed", p: { detail: "offline" } },
      { code: "PrUnreadable", p: { id: 7, detail: "null" } },
    ];
    expect(all.map((w) => warningText(w).text.length > 0)).toEqual([true, true, true, true, true, true]);
    expect(warningText(all[3])).toEqual({ text: expect.stringContaining("x"), detail: "bad" });
    expect(warningText(all[5]).text).toContain("#7");
  });

  it("say why the PR query failed and what the assessment used instead", async () => {
    await i18n.set("En");
    const failed = (kind: ProviderFailure, fallbackAt: number | null) => warningText({ code: "PrQueryFailed", p: { kind, detail: "raw", fallbackAt } });
    const kinds: ProviderFailure[] = ["LoggedOut", "RateLimited", "ToolMissing", "Timeout", "Parse", "Other"];
    expect(new Set(kinds.map((k) => failed(k, null).text)).size).toBe(kinds.length);
    expect(failed("RateLimited", null).text).toContain("no earlier PR list");
    const twoHoursAgo = Math.floor(Date.now() / 1000) - 2 * 3600;
    expect(failed("RateLimited", twoHoursAgo)).toEqual({ text: expect.stringContaining("2 hours ago"), detail: "raw" });
  });
});

describe("format", () => {
  it("shortens refs and SHAs", () => {
    expect(shortRef("refs/remotes/origin/main")).toBe("origin/main");
    expect(shortRef("refs/heads/x")).toBe("x");
    expect(shortSha("0123456789abcdef")).toBe("01234567");
  });

  it("writes times relative and absolute", () => {
    expect(relativeTime(1000, 1000)).toBe("just now");
    expect(relativeTime(1000 - 7200, 1000)).toContain("2 hours");
    expect(relativeTime(1000 - 400 * 86400, 1000)).toContain("year");
    // In the middle of a year: the same year in every time zone, unlike the first second of 1970.
    expect(absoluteTime(180 * 86400)).toMatch(/1970/);
    expect(dateOnly(180 * 86400)).toMatch(/1970/);
  });
});

describe("tones", () => {
  it("have a tone for every state", () => {
    for (const tone of [...Object.values(VERDICT_TONE), ...Object.values(ONLINE_TONE), ...Object.values(TOOL_TONE)]) {
      expect(tone.text && tone.dot && tone.badge).toBeTruthy();
    }
  });
});
