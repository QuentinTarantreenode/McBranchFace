import { describe, expect, it } from "vitest";
import rules from "../../src-tauri/tests/fixtures/online-rules.json";
import { classifyOnline } from "./filter";

describe("online rule", () => {
  it.each(rules)("$why", (c) => {
    expect(classifyOnline(c.merged, c.openPr, c.ageDays * 86_400, c.staleDays)).toBe(c.verdict);
  });
});
