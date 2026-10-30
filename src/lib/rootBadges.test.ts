import { describe, expect, it } from "vitest";
import { rootBadges } from "./rootBadges";

const texts = (roots: string[]) => [...rootBadges(roots).values()].map((b) => b.text);

describe("rootBadges", () => {
  it("reads a folder name as its initials", () => {
    expect(texts(["C:/Projects/Acme_Platform", "C:/Projects/Acme26", "C:/dev/Tools", "C:/ws"])).toEqual(["AP", "A26", "TO", "WS"]);
  });

  it("keeps every badge unique, however alike the folders are", () => {
    const roots = ["C:/a/Acme26", "C:/b/Acme26", "C:/c/Acme26", "C:/d/Acme26", "C:/e/Acme26"];
    const all = texts(roots);
    expect(new Set(all).size).toBe(roots.length);
    expect(all[0]).toBe("A26");
  });

  it("gives each root its own colour in the order of the list", () => {
    const b = [...rootBadges(["C:/x", "C:/y"]).values()];
    expect(b.map((x) => x.color)).toEqual(["var(--id-0)", "var(--id-4)"]);
    expect(b[0].name).toBe("x");
  });

  it("takes the user's sign and colour first, and the computed signs keep clear of a chosen one", () => {
    const own = (r: string) => (r === "C:/dev/Tools" ? { short: "A26", color: "id-9" } : r === "C:/ws" ? { color: "id-11" } : undefined);
    const b = rootBadges(["C:/x/Acme26", "C:/dev/Tools", "C:/ws"], own);
    expect(b.get("C:/dev/Tools")).toEqual({ text: "A26", color: "var(--id-9)", name: "Tools" });
    // "A26" is taken by the choice: the Acme26 folder gets its next form.
    expect(b.get("C:/x/Acme26")?.text).not.toBe("A26");
    // A colour alone keeps the computed sign.
    expect(b.get("C:/ws")).toEqual({ text: "WS", color: "var(--id-11)", name: "ws" });
  });
});
