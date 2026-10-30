import { describe, expect, it } from "vitest";
import { gridTemplate, layoutFor, minTableWidth, moveColumn, moveColumnBeside, resizeColumn, shiftColumn, toggleColumn, withoutGrouped } from "./columns";

const ids = (l: { id: string }[]) => l.map((c) => c.id);

describe("table columns", () => {
  it("steps the grouped column aside while grouped, never the branch, and changes nothing saved", () => {
    const l = layoutFor("Local", []);
    const visible = (g: Parameters<typeof withoutGrouped>[1]) => ids(withoutGrouped(l, g).filter((c) => c.visible));
    expect(visible("Repo")).toEqual(["status", "branch", "author", "commit", "pr"]);
    expect(visible("Author")).toEqual(["status", "branch", "repo", "commit", "pr"]);
    expect(visible("Verdict")).toEqual(["branch", "repo", "author", "commit", "pr"]);
    expect(visible("Prefix")).toContain("branch");
    expect(visible("None")).toEqual(ids(l));
    expect(l.every((c) => c.visible)).toBe(true);
  });

  it("gives every scope its columns in the default order, author shown, local only online", () => {
    expect(ids(layoutFor("Local", []))).toEqual(["status", "branch", "repo", "author", "commit", "pr"]);
    expect(ids(layoutFor("Online", []))).toEqual(["status", "branch", "repo", "author", "commit", "pr", "local", "source"]);
    expect(layoutFor("Online", []).find((c) => c.id === "source")?.visible).toBe(false);
    expect(layoutFor("Local", []).find((c) => c.id === "author")?.visible).toBe(true);
  });

  it("keeps a saved order, drops unknown and doubled columns, adds new ones where they belong", () => {
    const saved = [
      { id: "repo", width: 200, visible: true },
      { id: "gone-column", width: 90, visible: true },
      { id: "branch", width: 300, visible: false },
      { id: "repo", width: 90, visible: true },
      { id: "status", width: 10, visible: true },
    ];
    const l = layoutFor("Online", saved);
    // New columns sit next to their default neighbour: author after repo, the rest after it.
    expect(ids(l)).toEqual(["repo", "author", "commit", "pr", "local", "source", "branch", "status"]);
    // A layout saved before a column existed gets it at its usual place.
    const old = ["status", "branch", "repo", "commit", "pr"].map((id) => ({ id, width: 100, visible: true }));
    expect(ids(layoutFor("Local", old))).toEqual(["status", "branch", "repo", "author", "commit", "pr"]);
    // A layout saved while the upstream column existed loads without it.
    expect(ids(layoutFor("Local", [{ id: "upstream", width: 130, visible: true }, ...old]))).not.toContain("upstream");
    expect(l.find((c) => c.id === "branch")!.visible).toBe(true);
    expect(l.find((c) => c.id === "status")!.width).toBeGreaterThanOrEqual(60);
  });

  it("builds one grid template for header, rows and skeleton, with fixed mark and action columns", () => {
    const t = gridTemplate(layoutFor("Local", []));
    expect(t.startsWith("16px ")).toBe(true);
    expect(t.endsWith(" 28px")).toBe(true);
    expect(t).toContain("minmax(");
    expect(t.split(" ").length).toBeGreaterThan(5);
  });

  it("moves, resizes within limits and hides columns, but the branch column always stays", () => {
    let l = layoutFor("Local", []);
    l = moveColumn(l, "commit", 0);
    expect(ids(l)[0]).toBe("commit");
    l = moveColumn(l, "commit", 99);
    expect(ids(l).at(-1)).toBe("commit");
    l = moveColumnBeside(l, "commit", "branch", false);
    expect(ids(l)[ids(l).indexOf("branch") - 1]).toBe("commit");
    l = moveColumnBeside(l, "commit", "branch", true);
    expect(ids(l)[ids(l).indexOf("branch") + 1]).toBe("commit");
    l = resizeColumn(l, "repo", 5);
    expect(l.find((c) => c.id === "repo")!.width).toBeGreaterThanOrEqual(80);
    l = resizeColumn(l, "repo", 9000);
    expect(l.find((c) => c.id === "repo")!.width).toBe(4000);
    l = resizeColumn(l, "repo", 1400);
    expect(l.find((c) => c.id === "repo")!.width).toBe(1400);
    l = toggleColumn(l, "branch");
    expect(l.find((c) => c.id === "branch")!.visible).toBe(true);
    const narrow = minTableWidth(toggleColumn(l, "repo"));
    expect(narrow).toBeLessThan(minTableWidth(l));
  });

  it("shifts a column past its next visible neighbour and stops at the edges", () => {
    const l = toggleColumn(layoutFor("Local", []), "author");
    // author is hidden between repo and commit: moving commit left jumps over it.
    expect(ids(shiftColumn(l, "commit", -1))).toEqual(["status", "branch", "commit", "repo", "author", "pr"]);
    expect(ids(shiftColumn(l, "status", -1))).toEqual(ids(l));
    expect(ids(shiftColumn(l, "pr", 1))).toEqual(ids(l));
  });
});
