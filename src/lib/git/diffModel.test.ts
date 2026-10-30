// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import type { DiffLine } from "$lib/bindings/DiffLine";
import type { FileDiff } from "$lib/bindings/FileDiff";
import { choiceScope, columns, hits, hunkRows,lineKey, markers, partialBlock, patchText, picksFor, splitRows, step, styled, unifiedRows, widest } from "./diffModel";
import { languageOf, toLines } from "./diffHighlight";

const l = (kind: DiffLine["kind"], text: string, changed: [number, number][] = []): DiffLine => ({ kind, oldNo: null, newNo: null, text, changed, eol: false });
const hunk = (header: string, lines: DiffLine[], start = 1) => ({ header, section: "", oldStart: start, oldLines: 3, newStart: start, newLines: 3, lines });
const file = (hunks: ReturnType<typeof hunk>[]): FileDiff => ({
  path: "a.ts",
  oldPath: null,
  similarity: null,
  oldMode: null,
  newMode: null,
  binary: false,
  truncated: false,
  added: 0,
  removed: 0,
  hunks,
  conflict: false,
});
const D = file([
  hunk("@@ -1,3 +1,4 @@", [l("Context", "a"), l("Del", "b"), l("Del", "c"), l("Add", "B"), l("Context", "d")]),
  hunk("@@ -20,2 +21,3 @@", [l("Context", "x"), l("Add", "new"), l("Context", "y")], 20),
]);

describe("diff model", () => {
  it("lays out side by side: deletions next to the additions that follow, padded where one run is shorter", () => {
    const rows = splitRows(D);
    const pairs = rows.filter((r) => r.kind === "pair").map((r) => (r.kind === "pair" ? [r.left?.line.text ?? "", r.right?.line.text ?? ""] : []));
    expect(pairs).toEqual([
      ["a", "a"],
      ["b", "B"],
      ["c", ""],
      ["d", "d"],
      ["x", "x"],
      ["", "new"],
      ["y", "y"],
    ]);
    expect(unifiedRows(D).length).toBe(2 + 5 + 3);
  });

  it("finds the widest line per side, tabs to the next stop, and whether a side shows a line-ending mark", () => {
    expect(columns("a\tb")).toBe(9);
    expect(columns("\t\t", 4)).toBe(8);
    const eol = { ...l("Add", "x"), eol: true };
    const W = file([hunk("@@ -1,2 +1,2 @@", [l("Context", "ab"), l("Del", "\tlong"), l("Add", "a much longer line"), eol])]);
    expect(widest(splitRows(W))).toEqual([
      { text: "\tlong", eol: false },
      { text: "a much longer line", eol: true },
    ]);
  });

  it("cuts a line into syntax pieces and changed words, the pieces only where they fit the text", () => {
    const line = l("Add", "let x = 42;", [[8, 10]]);
    expect(styled(line).map((s) => [s.text, s.changed])).toEqual([["let x = ", false], ["42", true], [";", false]]);
    const pieces = [
      { text: "let", cls: "syn-kw" },
      { text: " x = 42;", cls: "" },
    ];
    expect(styled(line, pieces).map((s) => [s.text, s.cls, s.changed])).toEqual([
      ["let", "syn-kw", false],
      [" x = ", "", false],
      ["42", "", true],
      [";", "", false],
    ]);
    expect(styled(line, [{ text: "other", cls: "syn-kw" }]).map((s) => s.cls)).toEqual(["", "", ""]);
  });

  it("turns chosen lines into picks: indexes per hunk, the whole hunk when all its changes are chosen", () => {
    expect(picksFor(D, new Set([lineKey(0, 1), lineKey(1, 1)]))).toEqual([
      { hunk: 0, header: "@@ -1,3 +1,4 @@", lines: [1] },
      { hunk: 1, header: "@@ -20,2 +21,3 @@", lines: null },
    ]);
    expect(picksFor(D, new Set())).toEqual([]);
  });

  it("says why lines cannot be staged one by one", () => {
    expect(partialBlock(D, "Unstaged", "Keep")).toBeNull();
    expect(partialBlock(D, null, "Keep")).toBe("source");
    expect(partialBlock(D, "Untracked", "Keep")).toBe("source");
    expect(partialBlock(D, "Staged", "IgnoreAll")).toBe("whitespace");
    expect(partialBlock({ ...D, truncated: true }, "Unstaged", "Keep")).toBe("truncated");
    const added = file([{ ...hunk("@@ -0,0 +1,2 @@", [l("Add", "x")]), oldStart: 0, oldLines: 0 }]);
    expect(partialBlock(added, "Unstaged", "Keep")).toBe("wholeFile");
  });

  it("finds hunks and hits, and steps between them", () => {
    const rows = unifiedRows(D);
    const starts = hunkRows(rows);
    expect(starts).toEqual([0, 6]);
    expect([step(starts, 0, 1), step(starts, 6, 1), step(starts, 6, -1), step(starts, 0, -1)]).toEqual([6, null, 0, null]);
    expect(hits(rows, "NEW")).toEqual([8]);
    expect(hits(rows, "  ")).toEqual([]);
  });

  it("marks where changes are, one mark per slot, a deletion over an addition", () => {
    const m = markers(unifiedRows(D));
    expect(m.map((x) => x.kind)).toEqual(["Del", "Del", "Add", "Add"]);
    expect(m.every((x) => x.at >= 0 && x.at < 1)).toBe(true);
  });

  it("copies a hunk or its chosen lines as patch text", () => {
    expect(patchText(D, 1)).toBe("@@ -20,2 +21,3 @@\n x\n+new\n y\n");
    // An unchosen deletion stays as context, an unchosen addition is left out.
    expect(patchText(D, 0, new Set([lineKey(0, 3)]))).toBe("@@ -1,3 +1,4 @@\n a\n b\n c\n+B\n d\n");
  });

  it("keeps the choice over a refresh that brings the same diff, not over a changed one", () => {
    const again = structuredClone(D);
    expect(choiceScope(again, "Unstaged")).toBe(choiceScope(D, "Unstaged"));
    expect(choiceScope(D, "Staged")).not.toBe(choiceScope(D, "Unstaged"));
    again.hunks[1].lines[1].text = "newer";
    expect(choiceScope(again, "Unstaged")).not.toBe(choiceScope(D, "Unstaged"));
  });
});

describe("diff highlighting", () => {
  it("knows languages by extension and cuts highlighted HTML into lines, spans carried across", () => {
    expect([languageOf("src/a.svelte"), languageOf("x.RS"), languageOf("README")]).toEqual(["xml", "rust", null]);
    const lines = toLines('<span class="hljs-keyword">const</span> a = <span class="hljs-comment">/* one\ntwo */</span>');
    expect(lines).toEqual([
      [
        { text: "const", cls: "syn-kw" },
        { text: " a = ", cls: "" },
        { text: "/* one", cls: "syn-com" },
      ],
      [{ text: "two */", cls: "syn-com" }],
    ]);
  });
});
