// @vitest-environment jsdom
// The sidebar: repo cards, folders and groups, worktrees, selection, menus and dropped folders.
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/svelte";
import { tick } from "svelte";
import { emit } from "@tauri-apps/api/event";
import { store } from "$lib/store.svelte";
import { identities } from "$lib/stores/identities.svelte";
import { pullRequests } from "$lib/stores/pullRequests.svelte";
import { sidebarSelection } from "$lib/stores/sidebarSelection.svelte";
import { sidebarUi } from "$lib/stores/sidebarUi.svelte";
import { gitStatus } from "$lib/stores/gitStatus.svelte";
import { menu } from "$lib/ui/menu.svelte";
import { config, flush, opResult, repo, result, tool } from "../../test/backend";
import { A, A2, backend, CMD, menuWith, start, STATUS } from "../../test/views";
import { waitFor } from "../../test/wait";
import PrBadge from "./PrBadge.svelte";
import Sidebar from "./Sidebar.svelte";

vi.mock("@lucide/svelte", async () => (await import("../../test/icons")).iconModule());

/** The sidebar card of a repo. */
const card = (path: string) => document.querySelector<HTMLElement>(`[role=option][data-sel-path="${path}"]`)!;

it("sidebar: working copies, tags, filter by repo, menu and repo note", async () => {
  await start();
  render(Sidebar);
  await tick();
  expect(screen.getAllByText("core").length).toBeGreaterThan(0);
  // The select button of the card; the branch line is a dropdown of its own.
  const row = screen.getAllByRole("button", { name: "Branch of a" })[0].closest("[role=presentation]")!.querySelector("button")!;
  await fireEvent.click(row);
  expect(store.filters.repos).toEqual([A.path]);
  // The same card is the one open in Git.
  expect(store.gitRepo).toBe(A.path);
  menu.close(false);
  await fireEvent.contextMenu(row);
  // The sidebar menus load their code on first open.
  await menuWith("Unlock repo");
  const labels = menu.current!.entries.filter((e) => typeof e === "object" && "run" in e).map((e) => (e as { label: string }).label);
  expect(labels).toEqual(expect.arrayContaining(["Unlock repo", "Note & tags …"]));
  for (const e of menu.current!.entries) if (typeof e === "object" && "run" in e && e.label === "Note & tags …") e.run();
  await tick();
  expect(await screen.findByText(/Note & tags · a/)).toBeTruthy();
  await fireEvent.input(screen.getByPlaceholderText("Search repos"), { target: { value: "zzz" } });
  await tick();
  expect(screen.getByText("No matches.")).toBeTruthy();
  sidebarUi.annotating = null;
});

it("pull request badge says when the list could not be loaded, and asks once per path", async () => {
  await start({ open_pull_requests: () => Promise.reject({ code: "Other", detail: "provider down" }) });
  store.tools = [tool("GitHubCli")];
  // The lists live beyond a test: an earlier one may have loaded this repo's already.
  pullRequests.byRepo.clear();
  render(PrBadge, { path: A.path });
  await waitFor(() => expect(screen.getByRole("button", { name: "The pull requests could not be loaded." })).toBeTruthy());
  expect(backend.called("open_pull_requests")).toHaveLength(1);
});

describe("folders and groups", () => {
  it("sidebar folder groups fold, count and offer group actions", async () => {
    await start({ get_config: () => config({ language: "En", commands: [CMD as never] }), rescan_repo: (a) => result(repo(a.path as string)) });
    render(Sidebar);
    await tick();
    const header = screen.getByRole("button", { name: /ws/, expanded: true });
    await fireEvent.contextMenu(header);
    await menuWith("Reassess every repo");
    const items = menu.current!.entries.filter((e) => typeof e === "object" && "run" in e) as { label: string; run: () => void; submenu?: unknown[] }[];
    expect(items.map((i) => i.label)).toEqual(expect.arrayContaining(["Reassess every repo", "Commands", "Collapse all folders"]));
    items.find((i) => i.label === "Reassess every repo")!.run();
    await waitFor(() => expect(backend.called("rescan_repo").length).toBe(2));
    menu.current = null;
    await fireEvent.click(header);
    await tick();
    expect(store.config?.ui.collapsedRoots).toEqual(["C:/ws"]);
    expect(screen.getByRole("button", { name: /ws/, expanded: false })).toBeTruthy();
    await fireEvent.keyDown(screen.getByRole("button", { name: /ws/, expanded: false }), { key: "ArrowRight" });
    expect(store.config?.ui.collapsedRoots).toEqual([]);
    // The name selects the folder's repos, like a group head; again: none.
    const name = screen.getByRole("button", { name: /ws/, pressed: false });
    await fireEvent.click(name, { detail: 1 });
    expect(store.filters.repos.length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: /ws/, pressed: true })).toBeTruthy();
    await fireEvent.click(name, { detail: 1 });
    expect(store.filters.repos).toEqual([]);
  });

  it("worktree sub-rows open in the Git view and removal asks twice when there are changes", async () => {
    let force: boolean[] = [];
    await start({
      remove_worktree: (a) => {
        force.push(a.force as boolean);
        if (!a.force) throw { kind: "LocalChanges", op: "RemoveWorktree", detail: "contains modified or untracked files", path: null, changed: false };
        return opResult({ backupDir: "C:/app/backups/1" });
      },
      rescan_repo: (a) => result(repo(a.path as string)),
    });
    render(Sidebar);
    // Its menu opens it in the Git perspective, like any repo.
    const row = (await screen.findAllByRole("option", { name: "wt" }))[0];
    await fireEvent.contextMenu(row);
    await menuWith("In Git");
    const tiles = menu.current!.entries.find((e) => typeof e === "object" && "tiles" in e) as { tiles: { label: string; run: () => void }[] };
    tiles.tiles.find((x) => x.label === "In Git")!.run();
    expect(store.gitRepo).toBe("C:/wt");
    expect(store.config?.ui.perspective).toBe("Git");
    const remove = menu.current!.entries.find((e) => typeof e === "object" && "run" in e && e.label === "Remove worktree …") as { run: () => void };
    remove.run();
    expect(store.ask?.danger).toBe(true);
    await store.ask!.run();
    await waitFor(() => expect(store.ask?.title).toBe("Worktree has changes"));
    await store.ask!.run();
    await waitFor(() =>
      expect(store.toasts.find((x) => x.text.startsWith("Worktree removed."))).toMatchObject({
        text: "Worktree removed. Its folder is now in the backups; under “Recently deleted” you bring it back or remove it for good.",
        detail: "C:/app/backups/1",
      }),
    );
    expect(force).toEqual([false, true]);
    // The journal could not be written: the folder is in the backups all the same, the list does not show it.
    backend.handlers.remove_worktree = () => opResult({ backupDir: "C:/app/backups/2", warning: "Other" });
    store.removeWorktree(A.path, "C:/wt");
    await store.ask!.run();
    await waitFor(() => expect(store.toasts.at(-1)).toMatchObject({ kind: "info", detail: "C:/app/backups/2" }));
    expect(store.toasts.at(-1)?.text).toContain("the entry under “Recently deleted” is missing");
    force = [];
  });
});

describe("sidebar double click", () => {
  it("opens the folder of a repo card, a worktree and a group once, and keeps the selection", async () => {
    await start({ repo_status: () => STATUS });
    render(Sidebar);
    const card = (await screen.findAllByRole("button", { name: "Branch of a" }))[0].closest("[role=presentation]")!;
    const select = card.querySelector("button")!;
    // A double click is two clicks with a rising detail count, then dblclick.
    await fireEvent.click(select, { detail: 1 });
    await fireEvent.click(select, { detail: 2 });
    await fireEvent.dblClick(select);
    await waitFor(() => expect(backend.called("open_folder")).toHaveLength(1));
    await flush();
    expect(store.filters.repos).toEqual([A.path]);
    expect(backend.called("open_folder")).toEqual([{ path: A.path }]);
    await fireEvent.dblClick(screen.getAllByRole("option", { name: "wt" })[0]);
    await fireEvent.dblClick(screen.getByRole("button", { name: /ws/, pressed: false }));
    await waitFor(() => expect(backend.called("open_folder")).toHaveLength(3));
    await flush();
    expect(backend.called("open_folder").map((c) => c.path)).toEqual([A.path, "C:/wt", "C:/ws"]);
  });
});

describe("sidebar selection", () => {
  it("selects like a file manager: Shift spans to a worktree, Ctrl adds, Ctrl+A all, Esc none", async () => {
    await start({ repo_status: () => STATUS });
    render(Sidebar);
    await waitFor(() => expect(card(A.path)).not.toBeNull());
    await fireEvent.click(card(A.path).querySelector("button")!, { detail: 1 });
    expect(store.filters.repos).toEqual([A.path]);
    // The worktree of A lies below A: the range holds both, and the table still filters by repo.
    await fireEvent.click(screen.getAllByRole("option", { name: "wt" })[0], { detail: 1, shiftKey: true });
    expect(card(A.path).getAttribute("aria-selected")).toBe("true");
    expect(screen.getAllByRole("option", { name: "wt" })[0].getAttribute("aria-selected")).toBe("true");
    await fireEvent.click(card(A2.path).querySelector("button")!, { detail: 1, ctrlKey: true });
    expect([...store.filters.repos].sort()).toEqual([A.path, A2.path].sort());
    const list = screen.getByRole("listbox", { name: "Repositories" });
    await fireEvent.keyDown(list, { key: "Escape" });
    expect(store.filters.repos).toEqual([]);
    await fireEvent.keyDown(list, { key: "a", ctrlKey: true });
    expect(store.filters.repos.length).toBeGreaterThan(1);
  });

  it("arrow keys move the highlight at once and write the filter only once the keys rest", async () => {
    await start({ repo_status: () => STATUS });
    render(Sidebar);
    await waitFor(() => expect(card(A2.path)).not.toBeNull());
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      // What the roving focus does on each arrow key while the key repeats.
      sidebarSelection.step({ kind: "click", id: A.path });
      sidebarSelection.step({ kind: "click", id: A2.path });
      await tick();
      expect(card(A2.path).getAttribute("aria-selected")).toBe("true");
      expect(card(A.path).getAttribute("aria-selected")).toBe("false");
      expect(store.filters.repos).toEqual([]);
      vi.advanceTimersByTime(200);
      expect(store.filters.repos).toEqual([A2.path]);
      expect(card(A2.path).getAttribute("aria-selected")).toBe("true");
    } finally {
      vi.useRealTimers();
    }
  });

  it("selects several repos in the Git perspective too; the last one clicked is the open one", async () => {
    await start({ repo_status: () => STATUS });
    store.setUi({ perspective: "Git" });
    render(Sidebar);
    await waitFor(() => expect(card(A2.path)).not.toBeNull());
    await fireEvent.click(card(A.path).querySelector("button")!, { detail: 1 });
    await fireEvent.click(card(A2.path).querySelector("button")!, { detail: 1, ctrlKey: true });
    expect([...store.filters.repos].sort()).toEqual([A.path, A2.path].sort());
    expect(store.gitRepo).toBe(A2.path);
    expect(card(A.path).getAttribute("aria-selected")).toBe("true");
    // Esc goes back to the open repo alone; Git always has one.
    await fireEvent.keyDown(screen.getByRole("listbox", { name: "Repositories" }), { key: "Escape" });
    expect(store.filters.repos).toEqual([A2.path]);
  });

  it("selects single members of a repo group, and the head selects them all", async () => {
    await start({
      repo_status: () => STATUS,
      get_config: () => config({ language: "En", repoGroups: [{ id: "g1", name: "Both", paths: [A.path, A2.path] }] }),
    });
    render(Sidebar);
    await waitFor(() => expect(document.querySelectorAll("[data-rg-id] [role=option]").length).toBe(2));
    const members = () => [...document.querySelectorAll<HTMLElement>("[data-rg-id] [role=option]")];
    await fireEvent.click(members()[1], { detail: 1 });
    expect(store.filters.repos).toEqual([A2.path]);
    expect(members()[1].getAttribute("aria-selected")).toBe("true");
    expect(members()[0].getAttribute("aria-selected")).toBe("false");
    await fireEvent.click(members()[0], { detail: 1, ctrlKey: true });
    expect([...store.filters.repos].sort()).toEqual([A.path, A2.path].sort());
    await fireEvent.click(screen.getByRole("button", { name: /Both/, pressed: true }), { detail: 1 });
    expect(store.filters.repos).toEqual([]);
  });
});

describe("folders in the sidebar", () => {
  const roots = () => (backend.called("save_config").at(-1)!.config as { roots: string[] }).roots;

  it("lists roots in their order, empty ones too, and removes one only after asking", async () => {
    await start({ get_config: () => config({ language: "En", roots: ["C:/empty", "C:/ws"] }) });
    render(Sidebar);
    expect(await screen.findByText("No repos were found in this folder.")).toBeTruthy();
    const heads = screen.getAllByRole("button", { expanded: true }).map((b) => b.getAttribute("aria-label") ?? "");
    expect(heads[0]).toContain("empty");
    expect(heads[1]).toContain("ws");

    await fireEvent.click(screen.getAllByRole("button", { name: "Folder actions" })[0]);
    await menuWith("Remove folder from list …");
    (menu.current!.entries.find((e) => typeof e === "object" && "label" in e && e.label === "Remove folder from list …") as { run: () => void }).run();
    expect(store.ask?.title).toBe("Remove folder from the list?");
    expect(backend.called("save_config")).toHaveLength(0);
    await store.ask!.run();
    await waitFor(() => expect(roots()).toEqual(["C:/ws"]));
  });

  it("adds dropped folders once and says why the others change nothing", async () => {
    await start({ folder_kinds: ({ paths }) => (paths as string[]).map((p) => !p.endsWith(".txt")) });
    render(Sidebar);
    // The sidebar takes drops once it listens to the window, a moment after it showed.
    await waitFor(() => expect(backend.listens("tauri://drag-drop")).toBe(true));
    await emit("tauri://drag-drop", { paths: ["C:/ws/a", "D:/new", "D:/notes.txt", "d:/NEW/"], position: { x: 1, y: 1 } });
    await waitFor(() =>
      expect(store.toasts.map((x) => x.text)).toEqual(expect.arrayContaining([
        "This folder is inside a folder of the list and is searched already.",
        "Not a folder: files are not added.",
        "This folder is already in the list.",
        "Folder added",
      ])),
    );
    expect(roots()).toEqual(["C:/ws", "D:/new"]);
  });

  it("saves a new group order and a repo colour for every working copy", async () => {
    await start({ get_config: () => config({ language: "En", roots: ["C:/ws", "D:/b"] }) });
    render(Sidebar);
    await store.moveRoot("D:/b", "C:/ws", false);
    expect(roots()).toEqual(["D:/b", "C:/ws"]);
    await identities.setRepoColor(A2.path, "id-3");
    // The colour is part of the repo's identity, shared by all its working copies.
    await waitFor(() =>
      expect((backend.called("save_config").at(-1)!.config as { identities: Record<string, unknown> }).identities).toEqual({ [`repo:${A.identity}`]: { short: null, color: "id-3" } }),
    );
    const card = (await screen.findAllByRole("button", { name: "Branch of a" }))[0].closest<HTMLElement>("[role=presentation]")!;
    await waitFor(() => expect(card.getAttribute("style")).toContain("var(--id-3)"));
    // A sign of its own replaces the folder's wherever the repo is named, in every working copy.
    await identities.setIdentity(`repo:${A.identity}`, { short: "CORE", color: "id-3" });
    await waitFor(() => expect(identities.markOf(A2.path)).toMatchObject({ own: true, badge: { text: "CORE", color: "var(--id-3)" } }));
    await waitFor(() => expect(screen.getAllByText("CORE").length).toBeGreaterThan(0));
    await identities.setIdentity(`repo:${A.identity}`, null);
    await waitFor(() => expect(identities.markOf(A.path)?.own).toBe(false));
  });
});

describe("many worktrees", () => {
  it("fold into one line that opens and closes again", async () => {
    const wts = Array.from({ length: 6 }, (_, i) => ({ path: `C:/wt-${i}`, branch: `agent/task-${i}`, head: "def", isMain: false, detached: false, foreign: false, unreferenced: 0 }));
    await start({ repo_status: (a) => ({ ...STATUS, path: a.path, worktrees: [{ path: A.path, branch: "feature/x", head: "abc", isMain: true, detached: false }, ...wts] }) });
    await gitStatus.refreshStatus(A.path);
    render(Sidebar);
    // Every copy of the repo lists them; the first head stands for all.
    const head = (await screen.findAllByRole("button", { name: /6 worktrees/i }))[0];
    expect(head.getAttribute("aria-expanded")).toBe("false");
    await fireEvent.click(head);
    await waitFor(() => expect(head.getAttribute("aria-expanded")).toBe("true"));
    await fireEvent.click(head);
    await waitFor(() => expect(head.getAttribute("aria-expanded")).toBe("false"));
  });
});
