// @vitest-environment jsdom
// The commit lists of a branch are not part of the scan result: a view reads them when it shows them, once
// per result of the repo, and keeps its place while they load.
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/svelte";
import { tick } from "svelte";
import { emit } from "@tauri-apps/api/event";
import type { BranchCommits } from "$lib/bindings/BranchCommits";
import { branch, config, flush, installBackend, repo, result, type Backend, type Handler } from "../../test/backend";

vi.mock("@lucide/svelte", async () => (await import("../../test/icons")).iconModule());

const A = repo("C:/ws/a");
const OWN = [1, 2, 3].map((i) => ({ sha: `${i}`.repeat(40), subject: `own ${i}`, authorEmail: "me@example.com", authoredAt: 1 }));
const wip = () => branch(A.path, "wip", { verdict: "Unsafe", ownCommits: OWN, ownCommitCount: 3, unpushedCommits: OWN.slice(0, 1), pushState: { sha: "p1", source: "Snapshot" } });
const LISTS: BranchCommits = { sha: "wip-sha", own: OWN, unpushed: OWN.slice(0, 1) };

let backend: Backend;
let store: (typeof import("../store.svelte"))["store"];

async function start(handlers: Record<string, Handler> = {}) {
  backend = installBackend({ get_config: () => config({ language: "En" }), cached_results: () => [result(A, [wip()])], ...handlers });
  store = (await import("../store.svelte")).store;
  store.resetForTests();
  await store.init();
  await flush();
  store.selectKey(`${A.path}::wip`);
}

/** A backend answer that waits for the test. */
function held() {
  const waiting: ((v: BranchCommits) => void)[] = [];
  return { handler: () => new Promise<BranchCommits>((r) => waiting.push(r)), answer: (v: BranchCommits) => waiting.shift()!(v), get open() { return waiting.length; } };
}

const placeholders = () => document.querySelectorAll("[aria-busy=true] li").length;

describe("commit lists on demand", () => {
  it("the detail reads them once per result of its repo and holds their place while they come", async () => {
    const reads = held();
    await start({ branch_commits: reads.handler });
    render((await import("./DetailPane.svelte")).default);
    await flush();
    // One line after the push, three own commits: as many placeholder rows, and nothing else yet.
    expect(placeholders()).toBe(4);
    expect(screen.queryByText("own 2")).toBeNull();
    reads.answer(LISTS);
    await flush();
    expect(placeholders()).toBe(0);
    expect(screen.getByText("own 2")).toBeTruthy();
    expect(backend.called("branch_commits")).toEqual([{ path: A.path, branch: "wip" }]);

    // Shown again without a new result: nothing is read again.
    store.selectKey(null);
    await tick();
    store.selectKey(`${A.path}::wip`);
    await flush();
    expect(backend.called("branch_commits").length).toBe(1);

    // The repo's next result drops them: read again, the last lists of the same tip standing in meanwhile.
    await emit("scan-repo", result(A, [wip()]));
    await new Promise((r) => setTimeout(r, 150));
    await flush();
    expect(reads.open).toBe(1);
    expect(screen.getByText("own 2")).toBeTruthy();
    expect(placeholders()).toBe(0);
    reads.answer(LISTS);
    await flush();
    expect(backend.called("branch_commits").length).toBe(2);
  });

  it("a read that failed says so and is read again on request", async () => {
    let fail = true;
    await start({
      branch_commits: () => {
        if (fail) throw new Error("git said no");
        return LISTS;
      },
    });
    render((await import("./DetailPane.svelte")).default);
    await flush();
    expect(screen.getAllByText("The commits of this branch could not be read.").length).toBeGreaterThan(0);
    fail = false;
    await fireEvent.click(screen.getAllByRole("button", { name: "Read again" })[0]);
    await flush();
    expect(screen.getByText("own 3")).toBeTruthy();
  });

  it("the row's tip reads them only once the pointer rests", async () => {
    await start();
    const { branchTip } = await import("./branchTip");
    const b = store.allBranches.find((x) => x.name === "wip")!;
    // The pointer passed on: nothing read.
    await branchTip(b, () => false);
    expect(backend.called("branch_commits")).toEqual([]);
    const tip = await branchTip(b, () => true);
    expect(tip.sections!.find((s) => s.title === "1 commit after the last push")!.rows!.map((r) => ("value" in r ? r.value : ""))).toEqual(["11111111 own 1"]);
    // Read once: the next hover answers at once.
    expect("sections" in branchTip(b)).toBe(true);
    expect(backend.called("branch_commits").length).toBe(1);
  });
});
