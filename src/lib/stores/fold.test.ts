// @vitest-environment jsdom
// Folds of every list in one saved place.
import { describe, expect, it, vi } from "vitest";
import { branch, repo, result } from "../../test/backend";
import { start, store, storeTests } from "../../test/store";

// Only the menu helpers need icons; loading the whole icon package would dominate the run time.
vi.mock("@lucide/svelte", () => ({ Eye: {}, EyeOff: {} }));

const A = repo("C:/ws/a");

storeTests();

describe("folds", () => {
  it("keeps the folds of every list in one saved place; fold all touches only the named groups", async () => {
    await start({ cached_results: () => [result(A)] });
    const { fold } = await import("$lib/stores/fold.svelte");
    fold.toggle("changesRepos", "r1");
    expect(fold.isOpen("changesRepos", "r1")).toBe(false);
    fold.setAll("changesRepos", ["r1", "r2", "r3"], false);
    expect(fold.folded("changesRepos")).toEqual(["r1", "r2", "r3"]);
    fold.setAll("changesRepos", ["r2"], true);
    expect(fold.folded("changesRepos")).toEqual(["r1", "r3"]);
    // The lists with a field of their own keep using it.
    fold.set("roots", "C:/ws", false);
    expect(store.config?.ui.collapsedRoots).toEqual(["C:/ws"]);
    fold.setAll("changesRepos", ["r1", "r3"], true);
    expect(store.config?.ui.collapsed.changesRepos).toBeUndefined();
  });

  it("answers fold lookups from a set that follows every change, and forgets folds of table groups that are gone", async () => {
    await start({ cached_results: () => [result(A, [branch(A.path, "feature/x")])] });
    const { fold } = await import("$lib/stores/fold.svelte");
    fold.toggle("changesRepos", "r1");
    expect(fold.foldedSet("changesRepos").has("r1")).toBe(true);
    fold.toggle("changesRepos", "r1");
    expect(fold.foldedSet("changesRepos").has("r1")).toBe(false);
    fold.setAll("tableGroups", ["Name:feature/x", "Name:gone/y", `Repo:${A.identity}`, "Repo:id:old", "Author:me@example.com"], false);
    await store.scan(false);
    expect(store.config?.ui.collapsedGroups).toEqual(["Name:feature/x", `Repo:${A.identity}`, "Author:me@example.com"]);
  });
});
