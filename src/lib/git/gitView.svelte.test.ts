// @vitest-environment jsdom
// The Git view: changes, history and branches with their diffs and dialogs, staging a chosen line, and
// the changes of all repos at once.
import { describe, expect, it, onTestFinished, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/svelte";
import { tick } from "svelte";
import { store } from "$lib/store.svelte";
import { gitStatus } from "$lib/stores/gitStatus.svelte";
import { config, flush, opResult, repoStatus, statusEntry } from "../../test/backend";
import { A, A2, backend, menuWith, start, STATUS } from "../../test/views";
import { waitFor } from "../../test/wait";
import GitView from "./GitView.svelte";
import { gitStore } from "./gitStore.svelte";

vi.mock("@lucide/svelte", async () => (await import("../../test/icons")).iconModule());

describe("git views", () => {
  it("changes, history and branches with diffs and dialogs", async () => {
    await start();
    store.gitRepo = A.path;
    await gitStatus.refreshStatus(A.path);
    // The Git store outlives a test: this one starts on Changes.
    gitStore.setTab("changes");
    render(GitView);
    expect(screen.getAllByText("b.txt").length).toBeGreaterThan(0);
    // The first file opens with its diff.
    await waitFor(() => expect(screen.getAllByText("new").length).toBeGreaterThan(0));
    await fireEvent.click(screen.getAllByRole("button", { name: "Stage all" })[0]);
    await waitFor(() => expect(backend.called("git_stage").length).toBe(1));
    await fireEvent.click(screen.getAllByRole("button", { name: /Discard/ })[0]);
    await tick();
    expect(gitStore.confirm).not.toBeNull();
    gitStore.confirm = null;
    await fireEvent.click(screen.getByRole("tab", { name: /History/ }));
    expect((await screen.findAllByText("first")).length).toBeGreaterThan(0);
    await fireEvent.click(screen.getByRole("tab", { name: /Branches/ }));
    expect((await screen.findAllByText("old")).length).toBeGreaterThan(0);
    gitStore.createOpen = true;
    await tick();
    expect(screen.getAllByRole("dialog").length).toBeGreaterThan(0);
    // git's rule decides whether a name is valid, asked in the backend while typing.
    backend.handlers.check_copy_targets = (a) => (a.targets as { branch: string }[]).map((x) => ({ pathTaken: false, nameInvalid: x.branch.includes(".."), branchExists: false, checkedOutAt: null }));
    const field = screen.getByRole("textbox", { name: /name/i });
    await fireEvent.input(field, { target: { value: "bad..name" } });
    await waitFor(() => expect(screen.getAllByText(/Not a valid branch name/).length).toBeGreaterThan(0));
    expect(backend.called("check_copy_targets").at(-1)).toMatchObject({ path: A.path, targets: [{ branch: "bad..name", create: true }] });
    gitStore.createOpen = false;
  });

  it("stages a chosen line, shows the diff side by side and refuses parts while whitespace is ignored", async () => {
    await start({ git_apply_selection: () => opResult() });
    store.gitRepo = A.path;
    await gitStatus.refreshStatus(A.path);
    render(GitView);
    // The store outlives a test; an earlier one may have left another tab open.
    gitStore.setTab("changes");
    await gitStore.selectFile({ path: "b.txt", source: "Unstaged" });
    // Del and Add each have a handle in the gutter; the last one is the added line.
    const handles = await screen.findAllByRole("button", { name: "Choose line" });
    await fireEvent.pointerDown(handles.at(-1)!);
    await tick();
    const bar = screen.getByText("1 line chosen").parentElement!;
    const stage = [...bar.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Stage")!;
    await fireEvent.click(stage);
    await waitFor(() =>
      expect(backend.called("git_apply_selection")).toEqual([
        { path: A.path, file: "b.txt", source: "Unstaged", context: 3, picks: [{ hunk: 0, header: "@@ -1,2 +1,2 @@", lines: [1] }], action: "Stage" },
      ]),
    );
    await fireEvent.click(screen.getByRole("button", { name: "Side by side" }));
    await waitFor(() => expect(store.config?.ui.diffSplit).toBe(true));
    gitStore.setDiffOptions({ whitespace: "IgnoreAll" });
    // The diff without whitespace is loaded again: no line to choose, the hunk button disabled.
    await waitFor(() => {
      expect(screen.queryAllByRole("button", { name: "Choose line" })).toEqual([]);
      const hunkButton = screen.getAllByRole("button").find((b) => /hunk/.test(b.textContent ?? ""));
      expect((hunkButton as HTMLButtonElement | undefined)?.disabled).toBe(true);
    });
    gitStore.setDiffOptions({ whitespace: "Keep" });
  });
});

describe("batch actions in changes", () => {
  it("a folder stages in every repo of it, one after the other", async () => {
    const st = (path: string, file: string) => repoStatus(path, { entries: [statusEntry(file)] });
    await start({
      get_config: () => config({ language: "En", ui: { ...config().ui, gitChangesAll: true, gitChangesByFolder: true } }),
      repo_status: (a) => (a.path === A2.path ? st(A2.path, "z.txt") : st(A.path, "a.txt")),
      git_stage: () => opResult(),
    });
    await gitStatus.refreshStatus(A.path);
    await gitStatus.refreshStatus(A2.path);
    store.gitRepo = A.path;
    gitStore.setTab("changes");
    render(GitView);
    await fireEvent.click((await screen.findAllByRole("button", { name: "Actions of this folder" }))[0]);
    const entries = await menuWith("Stage in 2 repos");
    const tiles = entries.find((e): e is { tiles: { label: string; run: () => unknown }[] } => typeof e === "object" && "tiles" in e)!.tiles;
    await tiles.find((x) => x.label === "Stage in 2 repos")!.run();
    await waitFor(() => expect(backend.called("git_stage").map((c) => [c.path, c.paths])).toEqual([[A.path, ["a.txt"]], [A2.path, ["z.txt"]]]));
  });
});

describe("changes of all repos", () => {
  // The linked worktree's status is held back for the whole test and answered once it is over, so no
  // command of this test is still on its way when the next one starts.
  const heldUntilTheEnd = () => new Promise((r) => onTestFinished(() => r(repoStatus("C:/wt"))));

  it("asks once for a status that is on its way, however many other statuses arrive meanwhile", async () => {
    let ticks = 0;
    await start({
      get_config: () => config({ language: "En", ui: { ...config().ui, gitChangesAll: true } }),
      // The linked worktree of A never answers; A's own status arrives again and again, a little different each time.
      repo_status: (a) => (a.path === "C:/wt" ? heldUntilTheEnd() : a.path === A.path ? { ...STATUS, head: { ...STATUS.head, behind: ++ticks } } : { ...STATUS, path: a.path, worktrees: [] }),
    });
    gitStatus.statuses.delete("C:/wt");
    gitStatus.statusFailed.clear();
    store.gitRepo = A.path;
    await gitStatus.refreshStatus(A.path);
    gitStore.setTab("changes");
    render(GitView);
    const asked = () => backend.called("repo_status").filter((a) => a.path === "C:/wt").length;
    await waitFor(() => expect(asked()).toBe(1));
    await gitStatus.refreshStatus(A.path);
    await flush();
    await gitStatus.refreshStatus(A.path);
    await flush();
    expect(asked()).toBe(1);
  });

  it("one block per repo, a placeholder while a status is on its way; a click and staging act in the row's repo", async () => {
    const other = repoStatus(A2.path, { entries: [statusEntry("z.txt")] });
    await start({
      get_config: () => config({ language: "En", ui: { ...config().ui, gitChangesAll: true } }),
      // The linked worktree of A answers late: its block is a placeholder until then.
      repo_status: (a) => (a.path === A2.path ? other : a.path === "C:/wt" ? heldUntilTheEnd() : STATUS),
      git_stage: () => opResult(),
    });
    // The store outlives a test: the worktree must not have a status left from an earlier one.
    gitStatus.statuses.delete("C:/wt");
    gitStatus.statusFailed.clear();
    store.gitRepo = A.path;
    await gitStatus.refreshStatus(A.path);
    await gitStatus.refreshStatus(A2.path);
    gitStore.setTab("changes");
    render(GitView);
    await waitFor(() => {
      expect(screen.getAllByText("b.txt").length).toBeGreaterThan(0);
      expect(screen.getAllByText("z.txt").length).toBeGreaterThan(0);
      expect(document.querySelector('[role=listbox] [aria-busy="true"]')).not.toBeNull();
    });
    // The commit box names the repo it commits in.
    expect(screen.getByText("Commit in")).toBeTruthy();

    // A file of the second repo opens that repo, its diff included.
    await fireEvent.click(screen.getAllByText("z.txt")[0]);
    await waitFor(() => expect(gitStore.selectedFile?.path).toBe("z.txt"));
    expect(gitStore.repo).toBe(A2.path);
    // Staging in its row acts there, whichever repo was open before.
    store.gitRepo = A.path;
    gitStore.setRepo(A.path);
    await tick();
    const row = screen.getAllByText("z.txt")[0].closest("[role=option]")!;
    await fireEvent.click(row.querySelector('button[aria-label="Stage"]')!);
    await waitFor(() => expect(backend.called("git_stage").at(-1)?.path).toBe(A2.path));

    // Back to one repo: the one staging opened, without the files of the others.
    await fireEvent.click(screen.getByRole("tab", { name: /This repo/ }));
    await waitFor(() => {
      expect(store.config?.ui.gitChangesAll).toBe(false);
      const list = screen.getByRole("listbox", { name: "Changed files" });
      expect(list.textContent).toContain("z.txt");
      expect(list.textContent).not.toContain("b.txt");
    });
    expect(gitStore.repo).toBe(A2.path);
  });
});
