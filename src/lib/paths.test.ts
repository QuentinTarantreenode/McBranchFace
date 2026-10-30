import { describe, expect, it } from "vitest";
import shared from "../../src-tauri/tests/fixtures/path-keys.json";
import { commonParent, homeRelative, normalizePath, pathKey, pathPieces, relativeTo } from "./paths";

interface KeyCase {
  input: string;
  windows: string;
  other: string;
}

const KEY_CASES: KeyCase[] = [
  { input: "C:\\Repos\\App", windows: "c:/repos/app", other: "C:/Repos/App" },
  { input: "C:/Repos/App/", windows: "c:/repos/app", other: "C:/Repos/App" },
  { input: "C:\\Repos\\App\\\\", windows: "c:/repos/app", other: "C:/Repos/App" },
  { input: "\\\\Server\\Share\\x", windows: "//server/share/x", other: "//Server/Share/x" },
  { input: "/home/Me/src/", windows: "/home/me/src", other: "/home/Me/src" },
  { input: "relative\\Dir", windows: "relative/dir", other: "relative/Dir" },
  { input: "", windows: "", other: "" },
];

describe("paths", () => {
  it("uses one separator style per path", () => {
    expect(normalizePath("C:\\Users\\me/src//app/")).toBe("C:\\Users\\me\\src\\app");
    expect(normalizePath("C:/")).toBe("C:\\");
    expect(normalizePath("\\\\server\\share/x")).toBe("\\\\server\\share\\x");
    expect(normalizePath("/home/me//src/")).toBe("/home/me/src");
    expect(normalizePath("/")).toBe("/");
    expect(normalizePath("")).toBe("");
  });

  it("shows the home folder as ~, case-insensitive on Windows only", () => {
    expect(homeRelative("C:/Users/Me/src/app", "C:\\users\\me")).toBe("~\\src\\app");
    expect(homeRelative("C:\\Users\\Me", "C:\\Users\\Me")).toBe("~");
    expect(homeRelative("C:\\Users\\Meyer\\x", "C:\\Users\\Me")).toBe("C:\\Users\\Meyer\\x");
    expect(homeRelative("/home/me/src", "/home/me")).toBe("~/src");
    expect(homeRelative("/home/Me/src", "/home/me")).toBe("/home/Me/src");
    expect(homeRelative("/x", null)).toBe("/x");
  });

  it("finds the folder all paths are below", () => {
    expect(commonParent(["C:\\dev\\a\\repo", "C:/dev/b/repo"])).toBe("C:\\dev");
    expect(commonParent(["C:\\dev\\a", "C:\\DEV\\b"])).toBe("C:\\dev");
    expect(commonParent(["C:\\dev\\a", "C:\\dev\\a\\sub"])).toBe("C:\\dev");
    expect(commonParent(["C:\\a", "D:\\a"])).toBe("");
    expect(commonParent(["C:\\a", "C:\\b"])).toBe("");
    expect(commonParent(["/home/me/a", "/home/me/b"])).toBe("/home/me");
    expect(commonParent([])).toBe("");
  });

  it("makes paths relative to a folder they are below", () => {
    expect(relativeTo("C:\\dev", "C:/dev/a/repo")).toBe("a\\repo");
    expect(relativeTo("c:\\DEV", "C:\\dev\\a")).toBe("a");
    expect(relativeTo("C:\\dev", "C:\\devel\\a")).toBe("C:\\devel\\a");
    expect(relativeTo("", "/x/y")).toBe("/x/y");
    expect(relativeTo("/x", "/x/y")).toBe("y");
  });

  it("cuts a path into pieces that end with their separator", () => {
    expect(pathPieces("C:\\dev\\a.b\\repo")).toEqual(["C:\\", "dev\\", "a.b\\", "repo"]);
    expect(pathPieces("/home/me/")).toEqual(["/", "home/", "me/"]);
    expect(pathPieces("~")).toEqual(["~"]);
  });

  // The backend reads the same table: both sides key paths alike.
  it("shares the backend's table of path keys", () => expect(shared.length).toBeGreaterThan(0));

  it.each([...KEY_CASES, ...(shared as KeyCase[])])("keys $input like the backend does", (c) => {
    expect(pathKey(c.input, true)).toBe(c.windows);
    expect(pathKey(c.input, false)).toBe(c.other);
  });

  it("takes the platform from the shape of the path when none is given", () => {
    expect(pathKey("C:\\Repos\\App")).toBe("c:/repos/app");
    expect(pathKey("/home/Me")).toBe("/home/Me");
  });
});
