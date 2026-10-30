// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { emit } from "@tauri-apps/api/event";
import { clearMocks, flush, installBackend, type Backend } from "../../test/backend";
import { until } from "../../test/store";
import { waitFor } from "../../test/wait";

type Git = (typeof import("./gitStore.svelte"))["gitStore"];
type Store = (typeof import("../store.svelte"))["store"];

const R = "C:/ws/a";
const ok = (over = {}) => ({ sha: null, backupDir: null, stashed: false, warning: null, summary: null, ...over });
const entry = (sha: string) => ({ sha, parents: [], author: "me", email: "me@x", time: 1, subject: `s ${sha}`, refs: [] });
const diff = (path: string) => ({ path, binary: false, truncated: false, added: 1, removed: 0, hunks: [], conflict: false });
const fail = (kind: string, op: string, over = {}) => ({ kind, op, detail: "why", path: null, changed: false, ...over });

let backend: Backend;
let git: Git;
let store: Store;
let gitStatus: (typeof import("../stores/gitStatus.svelte"))["gitStatus"];
let gitClaims: (typeof import("../stores/gitClaims.svelte"))["gitClaims"];
let probe: (typeof import("../probe"))["probe"];
/** Every command answered, also once what was already queued ran. */
const quiet = () => until(() => probe.invokes === 0);

beforeEach(async () => {
  backend = installBackend({
    git_log: (a) => (a.skip === 0 ? Array.from({ length: 200 }, (_, i) => entry(`c${i}`)) : [entry("last")]),
    commit_detail: (a) => ({ entry: entry(a.sha as string), body: a.sha === "HEAD" ? "body" : "", files: [{ path: "f.txt" }] }),
    commit_diff: (a) => diff(a.file as string),
    working_diff: (a) => diff(a.file as string),
    branch_list: () => ({ local: [], remote: [] }),
    git_stage: () => ok(),
    git_unstage: () => ok(),
    git_discard: () => ok(),
    git_commit: () => ok({ sha: "new" }),
    git_switch: () => ok({ warning: "LocalChanges" }),
    git_create_branch: () => ok(),
    git_remote: () => ok({ summary: "2 new" }),
  });
  vi.resetModules();
  const { i18n } = await import("../i18n/index.svelte");
  await i18n.set("En");
  store = (await import("../store.svelte")).store;
  gitStatus = (await import("../stores/gitStatus.svelte")).gitStatus;
  gitClaims = (await import("../stores/gitClaims.svelte")).gitClaims;
  git = (await import("./gitStore.svelte")).gitStore;
  probe = (await import("../probe")).probe;
  git.attach();
  git.attach();
});

afterEach(() => clearMocks());

describe("git view", () => {
  it("loads history page by page and a commit with its first file", async () => {
    git.setTab("history");
    git.setRepo(R);
    git.setRepo(R);
    await waitFor(() => expect(git.log).toHaveLength(200));
    await git.loadMoreLog();
    expect(git.log).toHaveLength(201);
    expect(git.logDone).toBe(true);
    await git.loadMoreLog();
    expect(backend.called("git_log")).toHaveLength(2);
    await git.selectCommit("c1");
    await waitFor(() => expect(git.commitFileDiff?.path).toBe("f.txt"));
    expect(git.detail?.entry.sha).toBe("c1");
    // Commits never change: the second visit comes from the cache.
    await git.selectCommit("c1");
    await git.selectCommitFile("f.txt");
    expect(backend.called("commit_detail")).toHaveLength(1);
    expect(backend.called("commit_diff")).toHaveLength(1);
  });

  it("searches the history from the start", async () => {
    git.setTab("history");
    git.setRepo(R);
    await waitFor(() => expect(git.log).toHaveLength(200));
    git.setLogQuery("fix");
    git.setLogQuery("fix");
    await waitFor(() => expect(backend.called("git_log").at(-1)).toMatchObject({ skip: 0, query: "fix" }));
  });

  it("drops answers for a repo that is no longer selected", async () => {
    const releases: (() => void)[] = [];
    backend.handlers.branch_list = (a) => new Promise((r) => releases.push(() => r({ local: [{ repo: a.path }], remote: [] })));
    git.setTab("branches");
    git.setRepo(R);
    git.setRepo("C:/ws/b");
    await waitFor(() => expect(releases).toHaveLength(2));
    releases[0]();
    await flush();
    expect(git.branches).toBeNull();
    releases[1]();
    await waitFor(() => expect(git.branches?.local).toEqual([{ repo: "C:/ws/b" }]));
  });

  it("shows diffs of the working tree and names a failed load where it is shown, until that load succeeds", async () => {
    git.setRepo(R);
    await git.selectFile({ path: "a.txt", source: "Unstaged" });
    expect(git.diff?.path).toBe("a.txt");
    await git.selectFile(null);
    expect(git.diff).toBeNull();
    const working = backend.handlers.working_diff;
    backend.handlers.working_diff = () => {
      throw { code: "PathMissing", detail: "" };
    };
    await git.selectFile({ path: "b.txt", source: "Staged" });
    expect(git.errors.diff).toContain("Folder does not exist");
    const branches = backend.handlers.branch_list;
    backend.handlers.branch_list = () => {
      throw "broken";
    };
    await git.loadBranches();
    expect(git.errors.branches).toBe("broken");
    // Each resource keeps its own: a diff that loads again ends the diff's error, not the branches'.
    backend.handlers.working_diff = working;
    await git.selectFile({ path: "b.txt", source: "Staged" });
    expect(git.errors.diff).toBeUndefined();
    expect(git.errors.branches).toBe("broken");
    backend.handlers.branch_list = branches;
    await git.loadBranches();
    expect(git.errors.branches).toBeUndefined();
  });

  it("an error of the history ends with the next page that loads, and the commit's with its next detail", async () => {
    git.setTab("history");
    git.setRepo(R);
    await waitFor(() => expect(git.log).toHaveLength(200));
    const log = backend.handlers.git_log;
    backend.handlers.git_log = () => {
      throw "log broken";
    };
    await git.loadMoreLog();
    expect(git.errors.log).toBe("log broken");
    backend.handlers.git_log = log;
    await git.loadMoreLog();
    expect(git.errors.log).toBeUndefined();
    const detail = backend.handlers.commit_detail;
    backend.handlers.commit_detail = () => {
      throw "detail broken";
    };
    await git.selectCommit("c5");
    expect(git.errors.detail).toBe("detail broken");
    backend.handlers.commit_detail = detail;
    await git.selectCommit("c6");
    expect(git.errors.detail).toBeUndefined();
    git.setRepo("C:/ws/b");
    expect(git.errors).toEqual({});
  });

  it("a page still loading when the refs change does not end up as the whole list", async () => {
    git.setTab("history");
    git.setRepo(R);
    await waitFor(() => expect(git.log).toHaveLength(200));
    let release: (v: unknown) => void = () => {};
    backend.handlers.git_log = (a) => (a.skip === 0 ? Array.from({ length: 200 }, (_, i) => entry(`n${i}`)) : new Promise((r) => (release = r)));
    const second = git.loadMoreLog();
    await emit("repo-changed", { path: R, scopes: ["Refs"] });
    await waitFor(() => expect(git.log[0]?.sha).toBe("n0"));
    release([entry("stale")]);
    await second;
    await flush();
    expect(git.log.map((e) => e.sha).slice(0, 2)).toEqual(["n0", "n1"]);
    expect(git.log.some((e) => e.sha === "stale")).toBe(false);
    expect(git.logLoading).toBe(false);
  });

  it("a refs change reloads as much history as was loaded, so a commit further down stays listed", async () => {
    const all = Array.from({ length: 450 }, (_, i) => entry(`h${i}`));
    backend.handlers.git_log = (a) => all.slice(Number(a.skip), Number(a.skip) + Number(a.limit));
    git.setTab("history");
    git.setRepo(R);
    await waitFor(() => expect(git.log).toHaveLength(200));
    await git.loadMoreLog();
    expect(git.log).toHaveLength(400);
    await git.selectCommit("h300");
    const asked = backend.called("git_log").length;
    await emit("repo-changed", { path: R, scopes: ["Refs"] });
    // Loaded again: the list below is the new one, not the one from before the change.
    await waitFor(() => expect(backend.called("git_log").length).toBeGreaterThan(asked));
    await quiet();
    expect(git.log.length).toBeGreaterThanOrEqual(400);
    expect(git.log.some((e) => e.sha === "h300")).toBe(true);
    expect(git.selectedSha).toBe("h300");
  });

  it("follows watcher events of the selected repo only", async () => {
    git.setRepo(R);
    await git.selectFile({ path: "a.txt", source: "Unstaged" });
    git.setTab("branches");
    await waitFor(() => expect(git.branches).not.toBeNull());
    const before = backend.called("working_diff").length;
    await emit("repo-changed", { path: "C:/other", scopes: ["Files", "Refs"] });
    await emit("repo-changed", { path: R, scopes: ["Files", "Refs"] });
    await waitFor(() => expect(backend.called("branch_list").length).toBeGreaterThanOrEqual(2));
    await quiet();
    expect(backend.called("working_diff").length).toBe(before + 1);
  });

  it("gives a linked worktree opened in Git its own status, and follows changes the watcher reports for its repo", async () => {
    const WT = "C:/ws/a-agent";
    const wt = { path: WT, branch: "agent", head: "abc", isMain: false, detached: false, foreign: false, unreferenced: 0 };
    const main = { ...wt, path: R, branch: "main", isMain: true };
    gitStatus.statuses.set(R, { path: R, head: { branch: "main", oid: "x", upstream: null, ahead: 0, behind: 0, unreferenced: 0 }, entries: [], worktrees: [main, wt], stashes: 0 });
    git.setRepo(WT);
    await waitFor(() => expect(backend.called("repo_status").map((a) => a.path)).toContain(WT));
    await git.selectFile({ path: "a.txt", source: "Unstaged" });
    const diffs = backend.called("working_diff").length;
    const statuses = backend.called("repo_status").filter((a) => a.path === WT).length;
    // The watcher names the repo whose git directory changed, not the worktree.
    await emit("repo-changed", { path: R, scopes: ["Files"] });
    await waitFor(() => {
      expect(backend.called("working_diff").length).toBe(diffs + 1);
      expect(backend.called("repo_status").filter((a) => a.path === WT).length).toBe(statuses + 1);
    });
  });
});

describe("git operations", () => {
  it("a late amend prefill does not overwrite typing, a switched-off amend or another repo", async () => {
    git.setRepo(R);
    const waiting: (() => void)[] = [];
    backend.handlers.commit_detail = () => new Promise((r) => waiting.push(() => r({ entry: entry("HEAD"), body: "old body", files: [] })));
    const typed = git.setAmend(true);
    git.commitMessage = "typed meanwhile";
    waiting[0]();
    await typed;
    expect(git.commitMessage).toBe("typed meanwhile");

    git.commitMessage = "";
    const off = git.setAmend(true);
    await git.setAmend(false);
    waiting[1]();
    await off;
    expect(git.commitMessage).toBe("");

    const moved = git.setAmend(true);
    git.setRepo("C:/ws/other");
    waiting[2]();
    await moved;
    expect(git.commitMessage).toBe("");
  });

  it("stages, unstages and discards after confirmation", async () => {
    git.setRepo(R);
    await git.stage(["a"]);
    await git.unstage(["a"]);
    git.requestDiscard(["a"], []);
    expect(git.confirm?.danger).toBe(true);
    git.requestDiscard(["a"], ["b"]);
    await git.confirm!.run();
    expect(backend.called("git_discard")).toEqual([{ path: R, tracked: ["a"], untracked: ["b"] }]);
    expect(store.toasts.at(-1)?.kind).toBe("success");
    expect(gitClaims.gitBusy).toBe(false);
  });

  it("blocks a second operation only in the repo that is busy, and says why", async () => {
    // Another part of the app (a group push) runs in this repo.
    expect(gitClaims.gitStart([R], "Pull")).toBe(true);
    // A control of that repo says what it waits for; another repo is free.
    expect(gitClaims.gitRunning(R)).toBe("Running: Pull.");
    expect(gitClaims.gitRunning("C:/ws/b")).toBeNull();
    git.setRepo(R);
    // The Git view waits too and says for what, though it did not start it.
    expect(git.locked).toBe(true);
    expect(git.elsewhere).toBe("Running: Pull.");
    expect(await git.stage(["a"])).toBeNull();
    expect(backend.called("git_stage")).toEqual([]);
    expect(store.toasts.at(-1)?.kind).toBe("info");
    // Another repo is free.
    expect(gitClaims.gitStart(["C:/ws/b"])).toBe(true);
    expect(gitClaims.gitStart(["C:/ws/b", "C:/ws/c"])).toBe(false);
    gitClaims.gitEnd(["C:/ws/b"]);
    gitClaims.gitEnd([R]);
    expect(git.locked).toBe(false);
    expect(git.elsewhere).toBeNull();
    await git.stage(["a"]);
    expect(backend.called("git_stage")).toHaveLength(1);
    expect(gitClaims.gitBusy).toBe(false);
  });

  it("commits, prefills amend and asks before amending a pushed commit", async () => {
    git.setRepo(R);
    await git.setAmend(true);
    expect(git.commitMessage).toBe("s HEAD\n\nbody");
    await git.setAmend(false);
    git.commitMessage = "msg";
    await git.commit();
    expect(git.commitMessage).toBe("");
    backend.handlers.git_commit = (a) => {
      if (!a.allowPushed) throw fail("AlreadyPushed", "Commit");
      return ok();
    };
    git.commitMessage = "again";
    await git.commit();
    expect(git.confirm?.action).toBeTruthy();
    await git.confirm!.run();
    expect(backend.called("git_commit").at(-1)).toMatchObject({ allowPushed: true });
    backend.handlers.commit_detail = () => {
      throw "no HEAD";
    };
    git.commitMessage = "";
    await git.setAmend(true);
    expect(git.commitMessage).toBe("");
  });

  it("switches with local changes: asks to bring or stash them", async () => {
    git.setRepo(R);
    backend.handlers.git_switch = (a) => {
      if (a.carry === "Keep") throw fail("LocalChanges", "Switch");
      return ok({ warning: "LocalChanges" });
    };
    await git.switchTo("dev", false);
    expect(git.confirm?.alt).toBeDefined();
    await git.confirm!.alt!.run();
    expect(backend.called("git_switch").at(-1)).toMatchObject({ carry: "Stash" });
    await git.confirm!.run();
    expect(backend.called("git_switch").at(-1)).toMatchObject({ carry: "Bring" });
    expect(store.toasts.some((x) => x.kind === "info")).toBe(true);
  });

  it("creates a branch and closes the dialog", async () => {
    git.setRepo(R);
    git.createOpen = true;
    await git.createBranch("x", null, true);
    expect(git.createOpen).toBe(false);
  });

  it("runs remote operations with progress, can cancel, explains failures with a way out", async () => {
    git.setRepo(R);
    let release!: () => void;
    backend.handlers.git_remote = (a) =>
      new Promise((r) => {
        release = () => r(ok({ backupDir: "C:/bak" }));
        void emit("op-progress", { id: a.id, op: "Fetch", phase: "Receiving", percent: 40 });
        void emit("op-progress", { id: "other", op: "Fetch", phase: "x", percent: 1 });
      });
    const running = git.remote("Fetch");
    await waitFor(() => expect(git.progress).toEqual({ phase: "Receiving", percent: 40 }));
    expect(await git.stage(["a"])).toBeNull();
    git.cancel();
    expect(backend.called("git_cancel")).toHaveLength(1);
    release();
    await running;
    expect(git.progress).toBeNull();
    expect(store.toasts.at(-1)?.detail).toContain("C:/bak");

    backend.handlers.git_remote = () => {
      throw fail("AuthRequired", "Push", { changed: true });
    };
    await git.remote("Push");
    const t = store.toasts.at(-1)!;
    expect(t.kind).toBe("error");
    expect(t.action).toBeDefined();
    t.action!.run();
    await waitFor(() => expect(backend.called("open_terminal")).toEqual([{ path: R }]));

    backend.handlers.git_remote = () => {
      throw "plain";
    };
    await git.remote("Pull");
    expect(store.toasts.at(-1)?.text).toBe("plain");
    git.cancel();
    expect(backend.called("git_cancel")).toHaveLength(1);
  });

  it("names a kept stash when an operation only partly succeeded", async () => {
    git.setRepo(R);
    backend.handlers.git_remote = () => ok({ warning: "Diverged" });
    await git.remote("Pull");
    expect(store.toasts.at(-1)?.kind).toBe("info");
  });

  it("keeps the commit draft per repo: another repo starts empty, the first gets its draft back", async () => {
    git.setRepo(R);
    await git.setAmend(true);
    git.commitMessage = "draft in a";
    git.setRepo("C:/ws/b");
    expect(git.amend).toBe(false);
    expect(git.commitMessage).toBe("");
    git.commitMessage = "draft in b";
    git.setRepo(R);
    expect(git.amend).toBe(true);
    expect(git.commitMessage).toBe("draft in a");
    git.setRepo("C:/ws/b");
    expect(git.commitMessage).toBe("draft in b");
    expect(git.amend).toBe(false);
  });

  it("a commit that lands after a repo switch clears the draft of its own repo, not the open one", async () => {
    let land: () => void = () => {};
    backend.handlers.git_commit = () => new Promise((r) => (land = () => r(ok({ sha: "new" }))));
    git.setRepo(R);
    git.commitMessage = "for a";
    const committing = git.commit();
    git.setRepo("C:/ws/b");
    git.commitMessage = "for b";
    land();
    await committing;
    expect(backend.called("git_commit")).toMatchObject([{ path: R, message: "for a", amend: false }]);
    expect(git.commitMessage).toBe("for b");
    git.setRepo(R);
    expect(git.commitMessage).toBe("");
  });

  it("acts on hunks only of the diff shown for the selected file, never of one still shown from before", async () => {
    git.setRepo(R);
    await git.selectFile({ path: "a.txt", source: "Unstaged" });
    let answer: () => void = () => {};
    backend.handlers.working_diff = (a) => new Promise((r) => (answer = () => r(diff(a.file as string))));
    const pick = { hunk: 0, header: "@@ -1 +1 @@", lines: null };
    const loading = git.selectFile({ path: "b.txt", source: "Staged" });
    // The pane still shows a.txt while b.txt loads: its hunks must not be applied under b's selection.
    expect(git.diff?.path).toBe("a.txt");
    expect(git.diffFor).toEqual({ path: "a.txt", source: "Unstaged" });
    git.applySelection([pick], "Stage");
    await flush();
    expect(backend.called("git_apply_selection")).toEqual([]);
    answer();
    await loading;
    expect(git.diffFor).toEqual({ path: "b.txt", source: "Staged" });
    git.applySelection([pick], "Unstage");
    await waitFor(() => expect(backend.called("git_apply_selection")).toMatchObject([{ path: R, file: "b.txt", source: "Staged", action: "Unstage" }]));
  });

  it("does nothing without a repo", async () => {
    git.setRepo(null);
    expect(await git.stage(["a"])).toBeNull();
    await git.loadMoreLog();
    await git.selectCommit("x");
    await git.selectCommitFile("x");
    await git.loadBranches();
    await git.setAmend(true);
    expect(backend.called("git_stage")).toEqual([]);
  });
});

describe("watcher refreshes", () => {
  it("read a working copy at once, then at most once per interval, and never mark it as refreshing", async () => {
    gitStatus.statuses.set(R, { path: R, head: { branch: "main", oid: "x", upstream: null, ahead: 0, behind: 0, unreferenced: 0 }, entries: [], worktrees: [], stashes: 0 });
    const before = backend.called("repo_status").filter((a) => a.path === R).length;
    vi.useFakeTimers({ toFake: ["setTimeout", "Date"] });
    try {
      for (let i = 0; i < 10; i++) gitStatus.refreshFromWatcher(R);
      expect(gitStatus.refreshing.has(R)).toBe(false);
      expect(backend.called("repo_status").filter((a) => a.path === R).length).toBe(before + 1);
      vi.advanceTimersByTime(2100);
      expect(backend.called("repo_status").filter((a) => a.path === R).length).toBe(before + 2);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("answers per resource", () => {
  it("keeps a diff on its way when the history query or range changes, and ends its loading", async () => {
    let answer: (d: unknown) => void = () => {};
    backend.handlers.working_diff = (a) => new Promise((r) => (answer = () => r(diff(a.file as string))));
    git.setRepo(null);
    git.setRepo(R);
    await quiet();
    const loading = git.selectFile({ path: "a.txt", source: "Unstaged" });
    git.setLogQuery("fix");
    git.setRev("main");
    answer(null);
    await loading;
    expect(git.diff?.path).toBe("a.txt");
    expect(git.diffLoading).toBe(false);
  });

  it("keeps the branch list on its way when the history query changes", async () => {
    let answer: () => void = () => {};
    backend.handlers.branch_list = () => new Promise((r) => (answer = () => r({ local: [{ name: "x" }], remote: [] })));
    git.setRepo(null);
    git.setRepo(R);
    const loading = git.loadBranches();
    git.setLogQuery("q");
    answer();
    await loading;
    expect(git.branches?.local).toHaveLength(1);
  });

  it("loads the history of the next repo while the last one's is still on its way", async () => {
    let hold: (v: unknown) => void = () => {};
    backend.handlers.git_log = (a) => (a.path === R ? new Promise((r) => (hold = r)) : [entry("other")]);
    git.setTab("history");
    git.setRepo(null);
    git.setRepo(R);
    await waitFor(() => expect(backend.called("git_log").map((a) => a.path)).toContain(R));
    git.setRepo("C:/ws/b");
    await waitFor(() => expect(git.log.map((e) => e.sha)).toEqual(["other"]));
    hold([entry("old")]);
    await flush();
    expect(git.log.map((e) => e.sha)).toEqual(["other"]);
    expect(git.logLoading).toBe(false);
  });

  it("leaves no progress behind when the repo is busy elsewhere", async () => {
    git.setRepo(null);
    git.setRepo(R);
    await quiet();
    gitClaims.gitStart([R], "Pull");
    expect(await git.remote("Fetch")).toBeNull();
    expect(git.progress).toBeNull();
    git.cancel();
    expect(backend.called("git_cancel")).toEqual([]);
    gitClaims.gitEnd([R]);
  });
});
