// @vitest-environment jsdom
// The branch switcher of a sidebar card, and the same panel for a whole group of repos.
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/svelte";
import { tick } from "svelte";
import type { StatusEntry } from "$lib/bindings/StatusEntry";
import type { WorktreeInfo } from "$lib/bindings/WorktreeInfo";
import { store } from "$lib/store.svelte";
import { gitStatus } from "$lib/stores/gitStatus.svelte";
import { branchRow, opResult, repo, repoStatus, result, statusEntry, worktree } from "../../test/backend";
import { A, A2, backend, menuWith, start, switchOptions } from "../../test/views";
import { waitFor } from "../../test/wait";
import QuickSwitchPanel from "./QuickSwitchPanel.svelte";
import Sidebar from "./Sidebar.svelte";

vi.mock("@lucide/svelte", async () => (await import("../../test/icons")).iconModule());

describe("quick switch in the sidebar", () => {
  const B = repo("C:/ws/b");
  const head = (path: string, entries: StatusEntry[] = [], worktrees: WorktreeInfo[] = []) =>
    repoStatus(path, { head: { oid: "0123456789", upstream: "origin/main" }, entries, worktrees: [worktree(path, { head: "0123456789", isMain: true }), ...worktrees] });
  const lists: Record<string, unknown> = {
    [A.path]: { local: [branchRow("main", { isHead: true }), branchRow("feature/a", { isMine: true })], remote: [branchRow("origin/feature/srv")] },
    [B.path]: { local: [branchRow("main", { isHead: true }), branchRow("feature/a")], remote: [] },
  };
  const DIRTY = [statusEntry("b.txt")];

  async function open(status: (p: string) => unknown = (p) => head(p)) {
    await start({
      cached_results: () => [result(A, []), result(B, [])],
      repo_status: (a) => status(a.path as string),
      branch_list: (a) => lists[a.path as string],
      git_switch: () => opResult({ sha: "s" }),
      git_switch_new: () => opResult({ sha: "s", stashed: true }),
      forget_foreign_worktree: () => opResult({ backupDir: "C:/app/backups/1" }),
      rescan_repo: (a) => result(repo(a.path as string)),
    });
    await gitStatus.refreshStatus(A.path);
    await gitStatus.refreshStatus(B.path);
    render(Sidebar);
    await tick();
    await fireEvent.click(screen.getByRole("button", { name: "Branch of a" }));
    // The dropdown loads its code on the first opening.
    await waitFor(() => expect(switchOptions().length).toBeGreaterThan(0));
  }
  const choose = (text: RegExp) =>
    fireEvent.click(switchOptions().map((o) => o.querySelector("button")!).find((b) => text.test(b.textContent ?? "") || !!b.querySelector(`[aria-label]`)?.getAttribute("aria-label")?.match(text))!);

  it("switches one repo at once when nothing else is to decide, a server branch as tracking branch", async () => {
    await open();
    await choose(/feature\/srv/);
    await waitFor(() => expect(backend.called("git_switch")).toEqual([{ path: A.path, target: "origin/feature/srv", remote: true, carry: "Keep" }]));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("filters the list to server or own branches and heads the two kinds when both are shown", async () => {
    await open();
    const shown = () => switchOptions().map((o) => o.querySelector("[aria-label]")?.getAttribute("aria-label"));
    const headings = () => [...document.querySelectorAll("li[role=presentation]")].map((h) => h.textContent);
    expect(headings()).toEqual(["Local", "Only on the server"]);
    expect(screen.getByRole("tab", { name: /^Mine/ }).textContent).toContain("1");
    await fireEvent.click(screen.getByRole("tab", { name: /^Mine/ }));
    expect(shown()).toEqual(["feature/a"]);
    await fireEvent.click(screen.getByRole("tab", { name: /^Server/ }));
    expect(shown()).toEqual(["origin/feature/srv"]);
    expect(headings()).toEqual([]);
    // The choice outlives the dropdown; back to all for the tests that follow.
    await fireEvent.click(screen.getByRole("tab", { name: /^All/ }));
  });

  it("offers other repos with the same branch and switches the ticked ones", async () => {
    await open();
    await choose(/^feature\/a$/);
    const other = await screen.findByRole("checkbox", { name: "b" });
    expect((other as HTMLInputElement).checked).toBe(false);
    await fireEvent.click(other);
    await fireEvent.click(screen.getByRole("button", { name: "Switch 2 repos" }));
    await waitFor(() => expect(store.toasts.at(-1)?.text).toBe("2 repos switched to feature/a."));
    expect(backend.called("git_switch").map((c) => [c.path, c.target, c.remote])).toEqual([
      [A.path, "feature/a", false],
      [B.path, "feature/a", false],
    ]);
    expect(store.toasts.at(-1)?.action?.label).toBe("Back");
  });

  it("creates a new branch from the default branch and stashes the changes in the way", async () => {
    await open((p) => head(p, p === A.path ? DIRTY : []));
    await fireEvent.input(screen.getByPlaceholderText("Search a branch or type a new name"), { target: { value: "feature/new" } });
    await choose(/New branch “feature\/new”/);
    await fireEvent.click(await screen.findByRole("tab", { name: "main" }));
    await fireEvent.click(screen.getByRole("tab", { name: "Stash" }));
    await fireEvent.click(screen.getByRole("button", { name: "Create and switch" }));
    await waitFor(() => expect(backend.called("git_switch_new")).toEqual([{ path: A.path, name: "feature/new", start: "main", carry: "Stash" }]));
  });

  it("never shows the list of an earlier opening while the fresh one loads", async () => {
    await open();
    await fireEvent.click(screen.getByRole("button", { name: "Branch of a" }));
    let answer: (v: unknown) => void = () => {};
    backend.handlers.branch_list = () => new Promise((r) => (answer = r));
    const asked = backend.called("branch_list").length;
    await fireEvent.click(screen.getByRole("button", { name: "Branch of a" }));
    await waitFor(() => expect(backend.called("branch_list").length).toBe(asked + 1));
    await tick();
    // The old list said main was current; picking from it would act on stale facts.
    expect(switchOptions().filter((o) => o.querySelector("button"))).toHaveLength(0);
    answer(lists[A.path]);
    await waitFor(() => expect(switchOptions().length).toBeGreaterThan(0));
  });

  it("stays open when the table restores its scroll position, closes when the sidebar scrolls", async () => {
    await open();
    const table = document.createElement("div");
    document.body.append(table);
    table.dispatchEvent(new Event("scroll"));
    await tick();
    expect(screen.getByRole("dialog")).toBeTruthy();
    screen.getByRole("button", { name: "Branch of a" }).closest("[role=presentation]")!.dispatchEvent(new Event("scroll"));
    await tick();
    expect(screen.queryByRole("dialog")).toBeNull();
    table.remove();
  });

  it("hides a worktree entry that belongs to another repo and offers to remove it", async () => {
    const foreign = worktree("C:/other/wt", { branch: null, head: "abcdef1", detached: true, foreign: true });
    await open((p) => head(p, [], p === A.path ? [foreign] : []));
    expect(screen.queryByRole("group", { name: "wt" })).toBeNull();
    const card = screen.getByRole("button", { name: "Branch of a" }).closest("[role=presentation]")!.querySelector("button")!;
    await fireEvent.contextMenu(card);
    const entries = await menuWith("Remove foreign worktree entry …");
    const item = entries.find((e) => typeof e === "object" && "run" in e && e.label === "Remove foreign worktree entry …") as { run: () => unknown };
    await item.run();
    await store.ask!.run();
    await waitFor(() => expect(backend.called("forget_foreign_worktree")).toEqual([{ path: A.path, worktree: "C:/other/wt" }]));
  });
});

describe("branches across repos", () => {
  it("taking a branch over suggests what only some repos have and creates it in the rest without switching", async () => {
    await start({
      // A has feature/x, A2 lacks it; both have main.
      branch_list: (a) => ({ local: [branchRow("main", { isHead: true }), ...(a.path === A.path ? [branchRow("feature/x")] : [])], remote: [] }),
      git_create_branch: () => opResult({ sha: "s" }),
    });
    const trigger = document.createElement("button");
    document.body.append(trigger);
    render(QuickSwitchPanel, { path: A.path, branch: "", sha: null, trigger, onclose: () => {}, group: { name: "G", paths: [A.path, A2.path] }, adopt: true });
    // The suggestions: what is not everywhere, once the lists of both repos are in.
    await waitFor(() => {
      const list = screen.getByRole("listbox");
      expect(list.textContent).toContain("feature");
      expect(list.textContent).not.toContain("main");
    });
    await fireEvent.click(screen.getByRole("listbox").querySelector("button")!);
    expect(await screen.findByText("Where it is missing (1 repo), create from")).toBeTruthy();
    await fireEvent.click(screen.getByRole("button", { name: "Only create where missing" }));
    await waitFor(() => expect(backend.called("git_create_branch")).toEqual([{ path: A2.path, name: "feature/x", start: "HEAD", switch: false }]));
    trigger.remove();
  });
});
