import { describe, expect, it } from "vitest";
import { filterCommits, span } from "./commitFilter";

const at = (day: string, hour = 12) => new Date(`${day}T${String(hour).padStart(2, "0")}:00:00`).getTime() / 1000;
const list = [
  { sha: "a1b2c3d4", subject: "Fix report export", authorEmail: "anna@example.com", authoredAt: at("2026-05-01") },
  { sha: "e5f6a7b8", subject: "Grid columns", authorEmail: "jonas@example.com", authoredAt: at("2026-05-08", 23) },
  { sha: "c9d0e1f2", subject: "Merge release", authorEmail: "anna@example.com", authoredAt: at("2026-05-20") },
];

describe("commit filter", () => {
  it("searches subject, author and SHA prefix without case", () => {
    expect(filterCommits(list, "REPORT").map((c) => c.sha)).toEqual(["a1b2c3d4"]);
    expect(filterCommits(list, "anna").length).toBe(2);
    expect(filterCommits(list, "e5f6").map((c) => c.subject)).toEqual(["Grid columns"]);
    expect(filterCommits(list, "b2c3"), "a SHA matches from its start").toEqual([]);
    expect(filterCommits(list, "  ")).toHaveLength(3);
  });

  it("keeps whole calendar days at both ends of a date range", () => {
    expect(filterCommits(list, "", "2026-05-08", "2026-05-08").map((c) => c.sha), "late in the day still counts").toEqual(["e5f6a7b8"]);
    expect(filterCommits(list, "", "2026-05-02").length).toBe(2);
    expect(filterCommits(list, "", "", "2026-05-01").length).toBe(1);
    expect(filterCommits(list, "anna", "2026-05-10").map((c) => c.subject)).toEqual(["Merge release"]);
  });

  it("names the oldest and newest commit", () => {
    expect(span(list)).toEqual({ first: at("2026-05-01"), last: at("2026-05-20") });
    expect(span([])).toBeNull();
  });
});
