import { describe, expect, it } from "vitest";
import { isoDate, toCsv, toMarkdown } from "./report";

const report = { headers: ["Branch", "Note"], rows: [["feature/a", "pipe | in text"], ["b", 'quote " and ; semi']] };

describe("report", () => {
  it("renders a Markdown table with escaped pipes", () => {
    expect(toMarkdown(report)).toBe("| Branch | Note |\n| --- | --- |\n| feature/a | pipe \\| in text |\n| b | quote \" and ; semi |\n");
  });

  it("renders CSV for Excel: BOM, semicolons, quoted cells where needed", () => {
    const csv = toCsv(report);
    expect(csv.startsWith("﻿")).toBe(true);
    expect(csv.slice(1).split("\r\n")).toEqual(["Branch;Note", "feature/a;pipe | in text", 'b;"quote "" and ; semi"', ""]);
  });

  it("formats dates as ISO days", () => {
    expect(isoDate(0)).toBe("1970-01-01");
  });
});
