import { describe, expect, it } from "vitest";
import type { RepoStatus } from "$lib/bindings/RepoStatus";
import { headSums } from "./headSums";

const st = (files: number, ahead: number, behind: number) => ({ head: { ahead, behind }, entries: Array.from({ length: files }) }) as unknown as RepoStatus;

describe("headSums", () => {
  it("counts working copies, each once, and skips those without a status", () => {
    const statuses = { a: st(2, 1, 0), b: st(0, 0, 3), c: st(1, 0, 1) };
    expect(headSums(["a", "b", "c", "a", "missing"], new Map(Object.entries(statuses)))).toEqual({ dirty: 2, ahead: 1, behind: 2 });
  });
});
