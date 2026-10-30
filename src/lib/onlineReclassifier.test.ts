import { describe, expect, it } from "vitest";
import { remote } from "../test/backend";
import { OnlineReclassifier } from "./onlineReclassifier";

const DAY = 86_400;
const NOW = 100 * DAY;

describe("server branches against the threshold", () => {
  it("keeps the list and its objects while nothing changed, and only the changed branch otherwise", () => {
    const r = new OnlineReclassifier();
    const old = remote("C:/a", "old", { merged: false, lastCommitAt: NOW - 40 * DAY });
    const fresh = remote("C:/a", "fresh", { merged: false, lastCommitAt: NOW - DAY });
    const first = r.run([[old, fresh]], NOW, 30)!;
    expect(first.map((b) => b.verdict)).toEqual(["Inactive", "Active"]);
    // The clock ticks: the same list.
    expect(r.run([[old, fresh]], NOW + 30, 30)).toBe(first);
    // A longer threshold makes the old one active: a new list, the other branch keeps its object.
    const second = r.run([[old, fresh]], NOW, 60)!;
    expect(second).not.toBe(first);
    expect(second[0].verdict).toBe("Active");
    expect(second[1]).toBe(first[1]);
    // A branch replaced by the store (locked now) is a new object.
    const locked = { ...fresh, locked: true };
    const third = r.run([[old, locked]], NOW, 60)!;
    expect(third[1].locked).toBe(true);
    expect(third[0]).toBe(second[0]);
  });

  it("is empty without lists or before the threshold is known", () => {
    const r = new OnlineReclassifier();
    expect(r.run([], NOW, 30)).toBeNull();
    expect(r.run([[remote("C:/a", "x")]], NOW, undefined)).toBeNull();
  });
});
