// @vitest-environment jsdom
// The dialogs: delete (local and on the server), recently deleted, shortcuts and messages, the commit
// search and new working copies.
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/svelte";
import { tick } from "svelte";
import { store } from "$lib/store.svelte";
import { branch, entry, flush, outcome, remote, result } from "../../test/backend";
import { A, A2, backend, start, startApp } from "../../test/views";
import { waitFor } from "../../test/wait";
import CommitSearchDialog from "./CommitSearchDialog.svelte";
import CopiesDialog from "./CopiesDialog.svelte";
import DeleteDialog from "./DeleteDialog.svelte";
import DeletedDialog from "./DeletedDialog.svelte";
import ShortcutsDialog from "./ShortcutsDialog.svelte";
import Toasts from "./Toasts.svelte";

vi.mock("@lucide/svelte", async () => (await import("../../test/icons")).iconModule());

describe("DeleteDialog", () => {
  it("confirms, runs, reports and undoes a local delete", async () => {
    await startApp({
      cached_results: () => [result(A, [branch(A.path, "x"), branch(A.path, "y")])],
      delete_branch: (a) => outcome({ repoPath: A.path, name: (a.request as { branch: string }).branch }),
      rescan_repo: () => result(A, []),
      restore_branch: (a) => ({ ...outcome({ repoPath: A.path, name: "x" }).entry, id: a.id }),
    });
    await store.openDelete(store.allBranches);
    render(DeleteDialog);
    await tick();
    await fireEvent.click(screen.getByRole("button", { name: "Delete 2" }));
    expect(await screen.findByText("Deletion finished")).toBeTruthy();
    expect(backend.called("delete_branch")).toHaveLength(2);
    await fireEvent.click(screen.getByRole("button", { name: /Undo/ }));
    await waitFor(() => expect(backend.called("restore_branch")).toHaveLength(2));
  });

  it("keeps the backup folder of a removed worktree in view when the delete fails after it", async () => {
    const failure = { kind: "Other", step: "Branch", detail: "boom", path: null, changed: true, filesBackup: "C:/backup/x-files" };
    await startApp({
      cached_results: () => [result(A, [branch(A.path, "x")])],
      delete_branch: () => Promise.reject(failure),
    });
    await store.openDelete(store.allBranches);
    render(DeleteDialog);
    await tick();
    await fireEvent.click(screen.getByRole("button", { name: /^Delete( 1)?$/ }));
    expect(await screen.findByText("The worktree's folder is now in")).toBeTruthy();
  });

  it("asks for the branch name before a force delete", async () => {
    await startApp({ cached_results: () => [result(A, [branch(A.path, "risky", { verdict: "Review" })])] });
    await store.openDelete(store.allBranches, true);
    render(DeleteDialog);
    await tick();
    const confirm = screen.getByRole("button", { name: "Force Delete" }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    await fireEvent.input(screen.getByPlaceholderText("risky"), { target: { value: "risky" } });
    expect(confirm.disabled).toBe(false);
    await fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(store.deleteJob).toBeNull();
  });

  it("lists others' server branches unticked and lets the user add them", async () => {
    await startApp({
      cached_results: () => [result(A, [], [remote(A.path, "mine"), remote(A.path, "theirs", { isMine: false, lastCommitAuthor: "colleague@x" })])],
    });
    await store.openOnlineDelete(store.allOnline!);
    render(DeleteDialog);
    await tick();
    const boxes = screen.getAllByRole("checkbox") as HTMLInputElement[];
    expect(boxes.map((b) => b.checked)).toEqual(expect.arrayContaining([true, false]));
    await fireEvent.click(boxes.find((b) => !b.checked)!);
    expect(store.deleteJob!.active).toHaveLength(2);
  });
});

describe("DeleteDialog on the server", () => {
  it("says in words that a branch is gone although the server's answer was lost", async () => {
    await startApp({
      cached_results: () => [result(A, [], [remote(A.path, "lost")])],
      delete_remote_branches: () => [
        {
          repoPath: A.path,
          branch: "lost",
          outcome: { ...outcome({ repoPath: A.path, name: "lost" }, { remote: "origin" }), warnings: [{ kind: "Network", step: "Branch", detail: "connection reset", path: null }] },
          failure: null,
        },
      ],
      rescan_repo: () => result(A, [], []),
    });
    await store.openOnlineDelete(store.allOnline!);
    render(DeleteDialog);
    await tick();
    await fireEvent.click(screen.getByRole("button", { name: /^Delete/ }));
    expect(await screen.findByText("The server's answer was lost. Asking again shows the branch is gone there, so it was deleted. The backup ref keeps its tip.")).toBeTruthy();
  });
});

it("recently deleted, shortcuts and toasts", async () => {
  await start({ restore_branch: () => entry({ repoPath: A.path, name: "gone" }), purge_backups: () => 1 });
  store.deletedOpen = true;
  store.shortcutsOpen = true;
  store.toast("error", "It broke", { detail: "because", action: { label: "Retry", run: () => store.toast("info", "retried") } });
  render(DeletedDialog);
  render(ShortcutsDialog);
  render(Toasts);
  await tick();
  await fireEvent.click(screen.getAllByRole("button", { name: /Restore/ })[0]);
  await waitFor(() => expect(backend.called("restore_branch")).toHaveLength(1));
  // Each key a cap of its own: "Ctrl 1" is two of them.
  expect(screen.getAllByText("Ctrl").length).toBeGreaterThan(0);
  expect(screen.getByText("Dashboard view")).toBeTruthy();
  await fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  expect(store.toasts.some((t) => t.text === "retried")).toBe(true);
});

it("recently deleted names a dropped stash by its message and restores it as a stash", async () => {
  const stash = entry({ repoPath: A.path, name: "" }, { id: "e-stash", verdict: "Review", droppedStashes: [{ sha: "s", message: "On main: half done", backupRef: "refs/mcbranchface/stash/1/dropped/s" }] });
  await start({ deleted_entries: () => [stash], restore_branch: () => stash, purge_backups: () => 1 });
  await store.loadDeleted();
  store.deletedOpen = true;
  render(DeletedDialog);
  await tick();
  expect(screen.getByText("Stash “On main: half done”")).toBeTruthy();
  await fireEvent.click(screen.getByRole("button", { name: /Restore/ }));
  await waitFor(() => expect(store.toasts.some((x) => x.text === "Stash restored.")).toBe(true));
  expect(backend.called("restore_branch")).toEqual([{ id: "e-stash" }]);
});

it("recently deleted names a removed worktree by its folder and says so when it is back", async () => {
  const worktree = entry({ repoPath: A.path, name: "" }, { id: "e-wt", removedWorktree: "C:/ws/a-agent", worktreeBranch: "agent/1", worktreeBackup: "C:/app/backups/3" });
  await start({ deleted_entries: () => [worktree], restore_branch: () => worktree });
  await store.loadDeleted();
  store.deletedOpen = true;
  render(DeletedDialog);
  await tick();
  expect(screen.getByText("Worktree “a-agent”")).toBeTruthy();
  await fireEvent.click(screen.getByRole("button", { name: /Restore/ }));
  await waitFor(() => expect(store.toasts.some((x) => x.text === "Worktree restored: its folder is back and registered with git again.")).toBe(true));
});

it("commit search: waits for three characters, lists hits per repo with their branches, opens one in Git", async () => {
  const fix = { sha: "f".repeat(40), parents: [], author: "me", email: "me@x", time: 1, subject: "Fix the totals", refs: [] };
  await start({
    find_commit: (a) => [
      { repoPath: A.path, hits: [{ commit: fix, local: ["feature/fix", "main", "release/2", "hotfix"], remote: ["origin/main"] }], capped: false, error: null },
      { repoPath: A2.path, hits: [], capped: false, error: null },
    ].filter(() => (a.query as string).length >= 3),
  });
  store.commitSearchOpen = true;
  render(CommitSearchDialog);
  await tick();
  const field = screen.getByRole("textbox", { name: "Subject, author or SHA" }) as HTMLInputElement;
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  try {
    await fireEvent.input(field, { target: { value: "fi" } });
    // Two letters ask nothing, also once the pause after typing has passed.
    vi.advanceTimersByTime(350);
    await flush();
    expect(backend.called("find_commit")).toHaveLength(0);
    await fireEvent.input(field, { target: { value: "fix the" } });
    vi.advanceTimersByTime(350);
  } finally {
    vi.useRealTimers();
  }
  await waitFor(() => expect(screen.getByText("Fix the totals")).toBeTruthy());
  expect(backend.called("find_commit")[0]).toEqual({ paths: [A.path, A2.path], query: "fix the" });
  // Three branches by name, the other two counted; the repo without a hit is left out.
  expect(screen.getByText("+2")).toBeTruthy();
  expect(screen.getByText("1 commit in 1 repo")).toBeTruthy();
  await fireEvent.click(screen.getByRole("button", { name: "Open in the Git history" }));
  expect(store.commitSearchOpen).toBe(false);
  await waitFor(() => expect(store.gitRepo).toBe(A.path));
});

it("working copies dialog suggests folders, checks them and creates the copies", async () => {
  await start({
    free_copy_folders: (a) => Array.from({ length: a.count as number }, (_, i) => `C:/ws/a-agent-${i + 1}`),
    check_copy_targets: (a) => (a.targets as { branch: string }[]).map((t) => ({ pathTaken: false, nameInvalid: t.branch.includes(".."), branchExists: t.branch === "agent/2", checkedOutAt: null })),
    create_working_copies: (a) => (a.targets as { path: string }[]).map((t) => ({ path: t.path, failure: null, warning: null })),
  });
  store.openCopies(A.path);
  const folders = () => (screen.queryAllByRole("textbox", { name: /Folder name/ }) as HTMLInputElement[]).map((f) => f.value);
  const create = () => screen.getByRole("button", { name: "Create 2" }) as HTMLButtonElement;
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  try {
    render(CopiesDialog);
    await fireEvent.click(await waitFor(() => screen.getByRole("tab", { name: "2" })));
    await waitFor(() => expect(folders()).toEqual(["a-agent-1", "a-agent-2"]));
    // The targets are checked once the typing rests.
    vi.advanceTimersByTime(300);
    // agent/2 exists: the second copy is blocked until the name changes.
    await waitFor(() => expect(screen.getByText("Branch exists already")).toBeTruthy());
    // The shared parent once, in one separator style; the rows hold the folder names only.
    expect(document.querySelector("dialog")!.textContent).toContain("in C:\\ws");
    expect(create().disabled).toBe(true);
    await fireEvent.input(screen.getByRole("textbox", { name: /^Name/ }), { target: { value: "agent/x{n}" } });
    vi.advanceTimersByTime(300);
    await waitFor(() => expect(screen.queryByText("Branch exists already")).toBeNull());
  } finally {
    vi.useRealTimers();
  }
  expect(create().disabled).toBe(false);
  await fireEvent.click(create());
  await waitFor(() => expect(screen.getAllByText("2 working copies created").length).toBeGreaterThan(0));
  const call = backend.called("create_working_copies")[0];
  expect(call.kind).toBe("Worktree");
  expect((call.targets as { branch: string }[]).map((t) => t.branch)).toEqual(["agent/x1", "agent/x2"]);
  await fireEvent.click(screen.getAllByRole("button", { name: "Close" }).at(-1)!);
  expect(store.copiesFor).toBeNull();
});
