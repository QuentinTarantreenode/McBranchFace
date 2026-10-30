/** A table of the branches currently shown, as Markdown for the clipboard or CSV for a file. */
export interface Report {
  headers: string[];
  rows: string[][];
}

const md = (v: string) => v.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");

export function toMarkdown(r: Report): string {
  const line = (cells: string[]) => `| ${cells.map(md).join(" | ")} |`;
  return [line(r.headers), line(r.headers.map(() => "---")), ...r.rows.map(line)].join("\n") + "\n";
}

/** Semicolon-separated with a BOM: opens correctly in Excel with a German locale, where comma is decimal. */
export function toCsv(r: Report): string {
  const cell = (v: string) => (/[";\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const line = (cells: string[]) => cells.map(cell).join(";");
  return "﻿" + [line(r.headers), ...r.rows.map(line)].join("\r\n") + "\r\n";
}

export const isoDate = (unixSeconds: number) => new Date(unixSeconds * 1000).toISOString().slice(0, 10);
