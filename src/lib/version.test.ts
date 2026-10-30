// One version for the app: package.json holds it, everything else points to it or carries a copy
// that scripts/release.mjs writes. A copy edited by hand fails here.
import { describe, expect, it } from "vitest";
import { VERSION_FILES, versionMismatches, withVersion } from "../../scripts/versions.mjs";

const raw = import.meta.glob<string>(["/package.json", "/package-lock.json", "/src-tauri/tauri.conf.json", "/src-tauri/Cargo.toml", "/src-tauri/Cargo.lock"], {
  query: "?raw",
  import: "default",
  eager: true,
});
const text: Record<string, string> = Object.fromEntries(VERSION_FILES.map((f) => [f, raw[`/${f}`]]));

// The lock files have thousands of lines: each side is split once, not once per line.
function changedLines(a: string, b: string) {
  const after = b.split("\n");
  return a.split("\n").filter((line, i) => line !== after[i]).length;
}

describe("version", () => {
  it("is the same in every file", () => {
    expect(VERSION_FILES.every((f) => typeof text[f] === "string")).toBe(true);
    expect(versionMismatches(text)).toEqual([]);
  });

  it("is set by a release in every copy, and only there", () => {
    const next = withVersion(text, "99.1.0");
    expect(Object.keys(next).sort()).toEqual(["package-lock.json", "package.json", "src-tauri/Cargo.lock", "src-tauri/Cargo.toml"]);
    const after = { ...text, ...next };
    expect(versionMismatches(after)).toEqual([]);
    expect(JSON.parse(after["package.json"]).version).toBe("99.1.0");
    expect(changedLines(text["package.json"], after["package.json"])).toBe(1);
    expect(changedLines(text["package-lock.json"], after["package-lock.json"])).toBe(2);
    expect(changedLines(text["src-tauri/Cargo.toml"], after["src-tauri/Cargo.toml"])).toBe(1);
    expect(changedLines(text["src-tauri/Cargo.lock"], after["src-tauri/Cargo.lock"])).toBe(1);
  });

  it("names a copy that differs", () => {
    const stale = { ...text, "src-tauri/Cargo.toml": text["src-tauri/Cargo.toml"].replace(/^version = ".*"$/m, 'version = "0.0.1"') };
    expect(versionMismatches(stale)).toEqual([expect.stringContaining("src-tauri/Cargo.toml: 0.0.1")]);
    const literal = { ...text, "src-tauri/tauri.conf.json": text["src-tauri/tauri.conf.json"].replace('"../package.json"', '"1.0.0"') };
    expect(versionMismatches(literal)).toEqual([expect.stringContaining("tauri.conf.json")]);
  });
});
