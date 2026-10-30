import { describe, expect, it } from "vitest";
import { de as deCore } from "./de";
import { deMore } from "./de.more";
import { en as enCore } from "./en";
import { enMore } from "./en.more";
import { i18n, resolveLang, t } from "./index.svelte";
import { plain } from "$lib/rich";

// Both parts of each dictionary, as `t` offers them.
const de = { ...deCore, ...deMore };
const en = { ...enCore, ...enMore };

type Tree = { [k: string]: unknown };

/** Every key path with the kind of its leaf, and for functions their arity. */
function shape(o: Tree, prefix = ""): string[] {
  return Object.entries(o).flatMap(([k, v]) => {
    const path = `${prefix}${k}`;
    if (typeof v === "function") return [`${path}:fn${v.length}`];
    if (v && typeof v === "object") return shape(v as Tree, `${path}.`);
    return [`${path}:${typeof v}`];
  });
}

describe("dictionaries", () => {
  it("have the same keys, leaf kinds and parameter counts", () => {
    expect(shape(en as unknown as Tree).sort()).toEqual(shape(de as unknown as Tree).sort());
  });

  it("have no empty texts", () => {
    const empty = (o: Tree, p = ""): string[] =>
      Object.entries(o).flatMap(([k, v]) =>
        typeof v === "string" ? (v.trim() ? [] : [`${p}${k}`]) : v && typeof v === "object" ? empty(v as Tree, `${p}${k}.`) : [],
      );
    expect(empty(de as unknown as Tree)).toEqual([]);
    expect(empty(en as unknown as Tree)).toEqual([]);
  });

  it("pluralise", () => {
    expect(de.cleanup.stashes(1)).toBe("1 Stash");
    expect(de.cleanup.stashes(2)).toBe("2 Stashes");
    expect(plain(en.check.noEvidenceDetail(1, "main"))).toContain("1 own commit is");
  });
});

describe("language", () => {
  it("follows the system unless set", () => {
    expect(resolveLang("Auto", "de-AT")).toBe("de");
    expect(resolveLang("Auto", "en-US")).toBe("en");
    expect(resolveLang("Auto", "fr-FR")).toBe("en");
    expect(resolveLang("De", "en-US")).toBe("de");
    expect(resolveLang("En", "de-DE")).toBe("en");
  });

  it("keeps the two parts apart and answers with empty text until the second part is there", async () => {
    expect(Object.keys(deCore).filter((k) => k in deMore)).toEqual([]);
    await i18n.set("En");
    expect(t.copies.title).toBe(enMore.copies.title);
    i18n.more = null;
    expect(`${t.copies.title}`).toBe("");
    expect(t.commands.runAll(3)).toBe("");
    expect(t.common.close).toBe(enCore.common.close);
    await i18n.set("En");
    expect(t.copies.title).toBe(enMore.copies.title);
  });

  it("leaves the dictionaries as they are when the language does not change", async () => {
    await i18n.set("De");
    const [dict, more] = [i18n.dict, i18n.more];
    // Saving any setting sets the language again: every text reading `t` would otherwise run again.
    await i18n.set("De");
    expect(i18n.dict).toBe(dict);
    expect(i18n.more).toBe(more);
  });
});

/** Variants straight from the generated bindings, so a new backend variant without text fails here. */
const bindings = import.meta.glob<string>("../bindings/*.ts", { query: "?raw", import: "default", eager: true });
function variants(binding: string): string[] {
  const src = bindings[`../bindings/${binding}.ts`];
  const body = src.slice(src.indexOf("=") + 1);
  return [...body.matchAll(/"code": "(\w+)"|"(\w+)"/g)].map((m) => m[1] ?? m[2]).filter((v) => v !== "code" && v !== "p");
}

describe("error texts", () => {
  const cases: [string, (d: typeof de) => Record<string, unknown>][] = [
    ["ErrorCode", (d) => d.errors],
    ["FailureKind", (d) => d.failure],
    ["ImportFailureKind", (d) => d.settings.importFailure],
  ];
  for (const [binding, pick] of cases) {
    it(`give every ${binding} a title and a way out in both languages`, () => {
      const kinds = variants(binding);
      expect(kinds.length).toBeGreaterThan(3);
      for (const d of [de, en as unknown as typeof de]) {
        for (const k of kinds) {
          const m = pick(d)[k] as { title?: string; hint?: string } | undefined;
          expect(m?.title?.trim(), `${binding}.${k} title`).toBeTruthy();
          expect(m?.hint?.trim(), `${binding}.${k} hint`).toBeTruthy();
        }
      }
    });
  }

  it("name every repo warning in both languages", () => {
    for (const k of variants("RepoWarning")) {
      expect(de.repoWarning[k as keyof typeof de.repoWarning], k).toBeTruthy();
      expect(en.repoWarning[k as keyof typeof en.repoWarning], k).toBeTruthy();
    }
  });

  it("say why a PR query failed for every kind in both languages", () => {
    for (const k of variants("ProviderFailure")) {
      expect(de.repoWarning.PrQueryFailed[k as keyof typeof de.repoWarning.PrQueryFailed]?.trim(), k).toBeTruthy();
      expect(en.repoWarning.PrQueryFailed[k as keyof typeof en.repoWarning.PrQueryFailed]?.trim(), k).toBeTruthy();
    }
  });
});
