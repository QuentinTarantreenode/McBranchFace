// @vitest-environment jsdom
// The start views render with the core dictionary alone. The second part loads beside it and may arrive
// after the first paint: a start view must not read any of it.
import { beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";
import { render } from "@testing-library/svelte";
import { tick } from "svelte";
import DashboardView from "$lib/dashboard/DashboardView.svelte";
import { earlyReads, i18n, t } from "$lib/i18n/index.svelte";
import { probe } from "$lib/probe";
import { store } from "$lib/store.svelte";
import { branch, commit, config, entry, flush, installBackend, pullRequest, remote, repo, repoStatus, result, statusEntry, tool, worktree } from "../../test/backend";
import { until } from "../../test/store";
import Sidebar from "./Sidebar.svelte";
import Toasts from "./Toasts.svelte";
import TopBar from "./TopBar.svelte";

vi.mock("@lucide/svelte", async () => (await import("../../test/icons")).iconModule());
// The second part of the dictionary never arrives in this test.
vi.mock("$lib/i18n/de.more", () => new Promise(() => {}));
vi.mock("$lib/i18n/en.more", () => new Promise(() => {}));

const A = repo("C:/ws/a", { provider: "GitHub", links: { home: "https://x/a", pullRequests: "https://x/a/pulls", branch: "https://x/a/tree/{branch}" } });
const B = repo("C:/ws/b");
// A repo the scan could not read: its card says why.
const C = repo("C:/ws/c");
const pr = pullRequest(5, { title: "PR five", sourceRef: "refs/heads/x", reviewers: [{ id: "bob", state: "Changes", required: false }] });
const status = (path: string, files: number) =>
  repoStatus(path, {
    head: { oid: "abc", upstream: "origin/main", ahead: 1, behind: 2 },
    entries: Array.from({ length: files }, (_, i) => statusEntry(`f${i}.txt`)),
    worktrees: [worktree(path, { head: "abc", isMain: true }), worktree(`${path}-agent`, { branch: "agent/1", head: "def" })],
    stashes: 1,
  });

/** Everything the app asked for has its answer, but the scan, which this test holds back. */
const answeredButTheScan = () => until(() => probe.invokes === 1);

beforeEach(() => {
  Object.assign(globalThis, {
    Notification: class { static permission = "denied"; },
    ResizeObserver: class { observe() {} unobserve() {} disconnect() {} },
  });
  Element.prototype.scrollIntoView ??= () => {};
});

describe("start views", () => {
  for (const language of ["De", "En"] as const) {
    it(`render in ${language} with the core dictionary alone`, async () => {
      installBackend({
        get_config: () => config({ language, roots: ["C:/ws"] }),
        cached_results: () => [
          result(A, [branch(A.path, "x", { unpushedCommits: [commit("u", { subject: "s" })], upstreamState: "None", pullRequest: pr }), branch(A.path, "safe")], [remote(A.path, "merged")], { warnings: [{ code: "PrListCapped", p: { limit: 1000 } }], fetchError: "unable to access", fetchErrorKind: "Network" }),
          result(B, [branch(B.path, "y", { verdict: "Unsafe" })]),
          result(C, [], null, { error: "not a git repository", errorKind: "Other" }),
        ],
        cached_status: () => ({ statuses: [status(A.path, 2), status(B.path, 0)], scannedAt: 1 }),
        repo_status: (a) => status(String(a.path), 1),
        open_pull_requests: () => [pr],
        provider_identity: () => "me",
        // What the dashboard's tile of recently deleted names: a branch, a dropped stash, a removed worktree.
        deleted_entries: () => [
          entry({ repoPath: A.path, name: "old" }),
          entry({ repoPath: A.path, name: "" }, { id: "s", droppedStashes: [{ sha: "st", message: "wip" }] as never }),
          entry({ repoPath: A.path, name: "" }, { id: "w", removedWorktree: `${A.path}-agent`, worktreeBranch: "agent/1" }),
        ],
        environment_status: () => [tool("Git", { required: true, version: "2.50" })],
        // The scan does not end while the test runs: the views stay as the start shows them. Once the test is
        // over it ends as stopped, so nothing of this test is still on its way in the next.
        scan: () => new Promise((r) => onTestFinished(() => r({ durationMs: 1, repoCount: 0, cancelled: true }))),
      });
      // One module instance for the whole file: a component and Testing Library share one Svelte runtime.
      earlyReads.clear();
      await store.init();
      await answeredButTheScan();
      expect(i18n.more).toBeNull();
      render(TopBar, { detailAvailable: false });
      render(Sidebar);
      render(DashboardView);
      render(Toasts);
      await tick();
      // What the views ask for on their first paint.
      await answeredButTheScan();
      // The tile of recently deleted names each entry by what it was.
      const tile = document.body.textContent ?? "";
      expect([t.journal.stashEntry("wip"), t.journal.worktreeEntry("a-agent"), "old"].filter((name) => !tile.includes(name))).toEqual([]);
      // Every tip of the start views, as a hover builds it.
      for (const el of document.querySelectorAll<HTMLElement>("[data-tip]")) {
        el.dispatchEvent(new Event("pointerenter"));
        el.dispatchEvent(new Event("pointerleave"));
      }
      await answeredButTheScan();
      await flush();
      expect([...earlyReads].sort()).toEqual([]);
      store.dispose();
    });
  }
});
