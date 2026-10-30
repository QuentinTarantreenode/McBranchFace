import { describe, expect, it } from "vitest";
import type { BranchReport } from "./bindings/BranchReport";
import type { DeleteRequest } from "./bindings/DeleteRequest";
import { DeleteJob } from "./deleteJob.svelte";
import { branchKey } from "./filter";

const branch = (name: string) => ({ repoPath: "C:/r", name, sha: name.padEnd(40, "0") }) as BranchReport;
const request = (b: BranchReport): DeleteRequest => ({
  repoPath: b.repoPath,
  branch: b.name,
  expectedSha: b.sha,
  force: false,
  dropStashes: [],
  removeWorktree: false,
});
const outcome = { entry: { id: "x" }, usedForceFlag: false, warnings: [] } as never;
const lock = { kind: "Lock", step: "Preflight", detail: "x.lock exists", path: "x.lock", changed: false };

describe("DeleteJob", () => {
  it("lets the user untick items before the start, and only then", async () => {
    const job = new DeleteJob([branch("a"), branch("b")], false, request, branchKey);
    job.exclude("C:/r::b");
    expect(job.selected.map((i) => i.branch.name)).toEqual(["a"]);
    expect(job.items.filter((i) => i.status === "excluded").map((i) => i.branch.name)).toEqual(["b"]);
    job.include("C:/r::b");
    job.exclude("C:/r::a");
    const sent: string[][] = [];
    await job.runAll(async (reqs) => {
      sent.push(reqs.map((r) => r.branch));
      return reqs.map(() => ({ outcome, failure: null }));
    });
    expect(sent).toEqual([["b"]]);
    expect(job.succeeded.map((i) => i.branch.name)).toEqual(["b"]);
    job.include("C:/r::a");
    expect(job.items.find((i) => i.branch.name === "a")?.status).toBe("excluded");
  });

  it("maps bulk results to their items, and a failed call fails all", async () => {
    const job = new DeleteJob([branch("a"), branch("b")], false, request, branchKey);
    await job.runAll(async () => [{ outcome, failure: null }, { outcome: null, failure: lock as never }]);
    expect(job.succeeded.map((i) => i.branch.name)).toEqual(["a"]);
    expect(job.failed[0].failure?.kind).toBe("Lock");
    const broken = new DeleteJob([branch("a")], false, request, branchKey);
    await broken.runAll(async () => {
      throw "offline";
    });
    expect(broken.failed[0].failure).toMatchObject({ kind: "Other", detail: "offline" });
  });

  it("runs sequentially and keeps structured failures", async () => {
    const job = new DeleteJob([branch("a"), branch("b"), branch("c")], false, request, branchKey);
    const seen: string[] = [];
    await job.run(async (req) => {
      seen.push(req.branch);
      if (req.branch === "b") throw lock;
      return outcome;
    });
    expect(seen).toEqual(["a", "b", "c"]);
    expect(job.phase).toBe("done");
    expect(job.succeeded.map((i) => i.branch.name)).toEqual(["a", "c"]);
    expect(job.failed[0].failure?.kind).toBe("Lock");
  });

  it("wraps plain errors and skips the rest after a stop request", async () => {
    const job = new DeleteJob([branch("a"), branch("b")], false, request, branchKey);
    await job.run(async () => {
      job.stopRequested = true;
      throw "boom";
    });
    expect(job.failed[0].failure).toMatchObject({ kind: "Other", detail: "boom" });
    expect(job.skipped.map((i) => i.branch.name)).toEqual(["b"]);
  });

  it("retries only what did not succeed, with the force overrides", async () => {
    const job = new DeleteJob([branch("a"), branch("b")], true, request, branchKey);
    job.overrides = { force: true, removeWorktree: true };
    let fail = true;
    await job.run(async (req) => {
      if (req.branch === "b" && fail) throw lock;
      return outcome;
    });
    fail = false;
    job.requeueUnfinished();
    const retried: DeleteRequest[] = [];
    await job.run(async (req) => {
      retried.push(req);
      return outcome;
    });
    expect(retried.map((r) => r.branch)).toEqual(["b"]);
    expect(retried[0]).toMatchObject({ force: true, removeWorktree: true });
    expect(job.failed).toHaveLength(0);
  });
});
