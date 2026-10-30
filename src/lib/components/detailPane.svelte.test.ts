// @vitest-environment jsdom
// The detail of a branch: findings, commits, stashes, worktree files, its pull request and actions, the
// note editor, and the commit lists it opens.
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/svelte";
import { tick } from "svelte";
import { store } from "$lib/store.svelte";
import { branch, commit, logEntry, pullRequest, result } from "../../test/backend";
import { A, backend, start, startApp } from "../../test/views";
import { waitFor } from "../../test/wait";
import AnnotationEditor from "./AnnotationEditor.svelte";
import CommitsFlyout from "./CommitsFlyout.svelte";
import DetailPane from "./DetailPane.svelte";
import OnlineDetail from "./OnlineDetail.svelte";
import PrCard from "./PrCard.svelte";

vi.mock("@lucide/svelte", async () => (await import("../../test/icons")).iconModule());

it("detail pane: findings, commits, stashes, worktree files, PR and actions", async () => {
  await start({ stash_stat: () => " f.txt | 1 +" });
  await store.setLock(A.path, null, false);
  store.selectKey(`${A.path}::x`);
  render(DetailPane);
  await tick();
  expect(screen.getByText("PR 5 · PR five")).toBeTruthy();
  await fireEvent.click(screen.getByRole("button", { name: "Show changed files" }));
  expect(await screen.findByText(/f.txt \| 1 \+/)).toBeTruthy();
  // Checked out in a linked worktree: no delete button, the steps that free it instead, in git's order.
  expect(screen.queryByRole("button", { name: "Force Delete …" })).toBeNull();
  expect([...document.querySelectorAll("[data-todo]")].map((e) => e.getAttribute("data-todo"))).toEqual(["commit", "stash", "pr", "worktree"]);
  await fireEvent.click(screen.getByRole("button", { name: "Open PR" }));
  await waitFor(() => expect(backend.called("open_url")[0]).toEqual({ url: "https://x/5" }));
  await fireEvent.click(screen.getByRole("button", { name: "Remove …" }));
  expect(store.ask?.detail).toBe("C:/wt");
  store.ask = null;
  // With steps to do, the checks are their reasons: folded until asked for.
  await fireEvent.click(screen.getByRole("button", { name: "Checks" }));
  // The passed check folds into one line until it is asked for.
  expect(screen.queryByText("Everything pushed")).toBeNull();
  await fireEvent.click(screen.getByRole("button", { name: "1 of 2 OK" }));
  expect(screen.getByText("Everything pushed")).toBeTruthy();
  // A stash applies to the worktree the branch is checked out in, by its commit; dropping asks first.
  await fireEvent.click(screen.getByRole("button", { name: "Apply" }));
  await waitFor(() => expect(backend.called("git_stash_apply")[0]).toEqual({ path: "C:/wt", sha: "st" }));
  await fireEvent.click(screen.getByRole("button", { name: "Drop …" }));
  expect(backend.called("git_stash_drop")).toHaveLength(0);
  await store.ask!.run();
  expect(backend.called("git_stash_drop")[0]).toEqual({ path: A.path, sha: "st" });
  store.ask = null;
  // Ignored shows as a pressed toggle; pressing it again stops ignoring.
  await fireEvent.click(screen.getByRole("button", { name: "Ignore", pressed: true }));
  await fireEvent.click(screen.getByRole("button", { name: "Folder" }));
  await fireEvent.click(screen.getByRole("button", { name: "Terminal" }));
  await fireEvent.click(screen.getByRole("button", { name: "GitHub Desktop" }));
  await fireEvent.click(screen.getByRole("button", { name: "Open in Git" }));
  await waitFor(() => expect(backend.called("open_folder")).toHaveLength(1));
  store.selectKey(`${A.path}::blocked`);
  await tick();
  expect(screen.getByRole("button", { name: /Checkout main & delete/ })).toBeTruthy();
});

it("online detail: copies, verdict, delete and provider link", async () => {
  await start();
  store.setScope("Online");
  store.selectKey(`${A.path}::online::old`);
  render(OnlineDetail);
  await tick();
  expect(screen.getAllByText(/old/).length).toBeGreaterThan(0);
  await fireEvent.click(screen.getByRole("button", { name: "Open online" }));
  await waitFor(() => expect(backend.called("open_url")[0]).toEqual({ url: "https://x/a/tree/old" }));
});

describe("AnnotationEditor", () => {
  it("adds tags with Enter and suggestions, removes with Backspace, saves the note on blur", async () => {
    await startApp({ cached_results: () => [result(A, [branch(A.path, "x"), branch(A.path, "y")])] });
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    store.setAnnotation(A.path, "y", { note: "", tags: ["release"] });
    store.setAnnotation(A.path, null, { note: "", tags: ["core"] });
    const view = render(AnnotationEditor, { repoPath: A.path, branch: "x" });
    const input = screen.getByPlaceholderText("Add tag");
    await fireEvent.focus(input);
    // The repo tag shows as inherited; existing tags are offered.
    expect(screen.getByText("core")).toBeTruthy();
    await fireEvent.mouseDown(within(screen.getByLabelText("Existing:")).getByText("release"));
    await fireEvent.input(input, { target: { value: "#QA" } });
    await fireEvent.keyDown(input, { key: "Enter" });
    expect(store.annotationOf(A.path, "x").tags).toEqual(["release", "QA"]);
    await fireEvent.keyDown(input, { key: "Backspace" });
    expect(store.annotationOf(A.path, "x").tags).toEqual(["release"]);
    await fireEvent.input(input, { target: { value: "half" } });
    await fireEvent.blur(input);
    expect(store.annotationOf(A.path, "x").tags).toEqual(["release", "half"]);
    const note = screen.getByLabelText("Note & tags");
    await fireEvent.input(note, { target: { value: "wait for QA" } });
    await fireEvent.blur(note);
    expect(store.annotationOf(A.path, "x").note).toBe("wait for QA");
    // Switching the subject saves what was typed for the previous one.
    await fireEvent.input(note, { target: { value: "unsaved" } });
    await view.rerender({ repoPath: A.path, branch: "y" });
    expect(store.annotationOf(A.path, "x").note).toBe("unsaved");
    view.unmount();
    vi.advanceTimersByTime(400);
    vi.useRealTimers();
  });
});

describe("commit lists and pull requests", () => {
  const c = (sha: string, subject: string, day: string, author = "me@example.com") => commit(sha, { subject, authorEmail: author, authoredAt: new Date(`${day}T12:00:00`).getTime() / 1000 });
  const COMMITS = [c("a1b2c3d4e5", "Fix report export", "2026-05-01"), c("f6a7b8c9d0", "Grid columns", "2026-05-08", "anna@example.com"), c("0a1b2c3d4e", "Merge release", "2026-05-20")];

  it("shows a commit list with search and dates, loads the rest by its range and opens a commit in the history", async () => {
    await start({ git_log: () => [logEntry("x9", { subject: "one more" })] });
    store.commitsView = { title: "Own commits", branch: "feature/x", repoPath: A.path, commits: COMMITS, total: 4, range: "origin/main..abc" };
    render(CommitsFlyout);
    await tick();
    expect(screen.getByText("3 of 4 commits")).toBeTruthy();
    await fireEvent.input(screen.getByPlaceholderText("Subject, author or SHA"), { target: { value: "anna" } });
    await tick();
    expect(screen.getByText("1 of 4 commits")).toBeTruthy();
    expect(screen.getByText("Grid columns")).toBeTruthy();
    await fireEvent.input(screen.getByPlaceholderText("Subject, author or SHA"), { target: { value: "" } });
    await fireEvent.input(screen.getByLabelText("From"), { target: { value: "2026-05-10" } });
    await tick();
    expect(screen.getByText("Merge release")).toBeTruthy();
    expect(screen.queryByText("Fix report export")).toBeNull();
    await fireEvent.click(screen.getByRole("button", { name: "Reset filter" }));
    await fireEvent.click(screen.getByRole("button", { name: "Load all" }));
    expect(await screen.findByText("one more")).toBeTruthy();
    expect(backend.called("git_log").at(-1)).toMatchObject({ path: A.path, rev: "origin/main..abc" });
    await fireEvent.click(screen.getAllByRole("button", { name: "Open in the Git history" })[0]);
    await waitFor(() => expect(store.commitsView).toBeNull());
    await waitFor(() => expect(store.config?.ui.perspective).toBe("Git"));
    expect(store.gitRepo).toBe(A.path);
  });

  it("a pull request shows its branches as segments, its dates, and loads its commits on request", async () => {
    await start({ pr_commits: () => ({ commits: COMMITS, fromProvider: true }) });
    const pr = pullRequest(42, {
      title: "Better export",
      state: "Merged",
      author: "anna",
      sourceRef: "refs/heads/bugfix/1042_2",
      targetRef: "refs/heads/team/main",
      sourceSha: "e06e2da8aa",
      createdAt: store.now - 5 * 86400,
      closedAt: store.now - 2 * 86400,
      targetSha: "t1",
    });
    render(PrCard, { pr, repoPath: A.path });
    await tick();
    expect(screen.getByRole("img", { name: "bugfix/1042_2" })).toBeTruthy();
    expect(screen.getByRole("img", { name: "team/main" })).toBeTruthy();
    expect(screen.getByText(/created 5 days ago/)).toBeTruthy();
    expect(screen.getByText(/completed 2 days ago/)).toBeTruthy();
    await fireEvent.click(screen.getByRole("button", { name: "Show commits" }));
    expect(store.commitsView?.title).toBe("Commits of PR 42");
    const loaded = await store.commitsView!.load!();
    expect(loaded.fromProvider).toBe(true);
    expect(backend.called("pr_commits")[0]).toMatchObject({ path: A.path, pr: { id: 42 } });
  });

  it("the check 'commits after the last push' opens exactly those commits", async () => {
    await start({
      cached_results: () => [
        result(A, [branch(A.path, "wip", { verdict: "Unsafe", unpushedCommits: COMMITS.slice(0, 2), unpushedCommitCount: 7, pushState: { sha: "p1", source: "Snapshot" }, sha: "tip1",
          checks: [{ kind: "Pushed", outcome: "Fail", code: { code: "CommitsAfterPush", p: { count: 7, upstream: "refs/remotes/origin/wip", merged: false } } }] })]),
      ],
    });
    store.selectKey(`${A.path}::wip`);
    render(DetailPane);
    await tick();
    // The upstream in the sentence is a segment, not text.
    expect(screen.getAllByRole("img", { name: "origin/wip" }).length).toBeGreaterThan(0);
    await fireEvent.click(screen.getAllByRole("button", { name: "Show 7 commits" })[0]);
    expect(store.commitsView).toMatchObject({ repoPath: A.path, total: 7, range: "p1..tip1" });
  });
});
