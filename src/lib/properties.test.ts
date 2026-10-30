// Properties over generated inputs: the cases that broke by example (a third copy next to two
// same-named ones, branch names with namespaces) are one draw among thousands here.
import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { copyLabels } from "./identity";
import { nameParts, prefixOf } from "./branchName";
import { commonParent, normalizePath, relativeTo } from "./paths";

const segment = fc.stringMatching(/^[A-Za-z0-9._-]{1,8}$/);
const windowsPath = fc.array(segment, { minLength: 1, maxLength: 5 }).map((s) => `C:\\${s.join("\\")}`);

describe("properties", () => {
  it("copy labels are unique and never the full path while a shorter part tells the copies apart", () => {
    fc.assert(
      fc.property(fc.uniqueArray(windowsPath, { minLength: 2, maxLength: 6, selector: (p) => p.toLowerCase() }), (paths) => {
        const labels = copyLabels(paths);
        const values = paths.map((p) => labels[p]);
        expect(new Set(values).size).toBe(values.length);
        // A full path only appears when the labels could not be told apart otherwise.
        const fullPaths = values.filter((v, i) => v === paths[i]).length;
        if (fullPaths) expect(new Set(paths.map((p) => p.split("\\").pop())).size).toBeLessThan(paths.length);
      }),
      { numRuns: 500 },
    );
  });

  it("name parts put the name back together and never take a namespace for a prefix", () => {
    fc.assert(
      fc.property(fc.array(fc.stringMatching(/^[a-z0-9.]{1,6}$/), { minLength: 1, maxLength: 5 }), (segs) => {
        const name = segs.join("/");
        const p = nameParts(name);
        expect([p.namespace, p.prefix, p.rest].filter(Boolean).join("/")).toBe(name);
        if (p.prefix) expect(p.prefix).toMatch(/\p{L}/u);
        expect(prefixOf(name)).toBe(p.prefix);
      }),
      { numRuns: 500 },
    );
  });

  it("a path is below its common parent, and parent plus relative part give the path again", () => {
    fc.assert(
      fc.property(fc.array(windowsPath, { minLength: 2, maxLength: 5 }), (paths) => {
        const base = commonParent(paths);
        for (const p of paths) {
          const rel = relativeTo(base, p);
          // Windows paths compare case-insensitively; the base keeps the casing of the first path.
          expect((base ? `${base}\\${rel}` : rel).toLowerCase()).toBe(normalizePath(p).toLowerCase());
        }
      }),
      { numRuns: 500 },
    );
  });
});
