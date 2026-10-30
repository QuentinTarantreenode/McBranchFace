import { describe, expect, it } from "vitest";
import { addTag, allTags, annotationKey, tagColor } from "./annotations";
import { due } from "./schedule";

describe("annotations", () => {
  it("use the backend keys", () => {
    expect(annotationKey("github.com/o/r")).toBe("github.com/o/r");
    expect(annotationKey("github.com/o/r", "feature/x")).toBe("github.com/o/r::feature/x");
  });

  it("normalise tags on input", () => {
    expect(addTag([], "  #release  ")).toEqual(["release"]);
    expect(addTag(["Release"], "release")).toEqual(["Release"]);
    expect(addTag(["a"], "   ")).toEqual(["a"]);
    expect(addTag([], "x".repeat(50))[0]).toHaveLength(40);
  });

  it("give a tag the same colour everywhere, case-insensitive", () => {
    expect(tagColor("QA")).toBe(tagColor("qa"));
    expect(tagColor("QA")).toMatch(/^var\(--id-[0-7]\)$/);
  });

  it("collect every tag once, sorted", () => {
    expect(allTags({ a: { note: "", tags: ["QA", "release"] }, b: { note: "", tags: ["qa", "Alpha"] } })).toEqual(["Alpha", "QA", "release"]);
  });
});

describe("schedule", () => {
  it("runs a job when due and idle only", () => {
    expect(due(10 * 60_000, 0, 5, false)).toBe(true);
    expect(due(4 * 60_000, 0, 5, false)).toBe(false);
    expect(due(10 * 60_000, 0, 5, true)).toBe(false);
    expect(due(10 * 60_000, 0, 0, false)).toBe(false);
  });
});
