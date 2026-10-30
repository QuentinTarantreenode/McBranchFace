import { describe, expect, it } from "vitest";
import { de as deCore } from "$lib/i18n/de";
import { deMore } from "$lib/i18n/de.more";
import { en as enCore } from "$lib/i18n/en";
import { enMore } from "$lib/i18n/en.more";
import { SHORTCUTS } from "$lib/shortcuts";
import { buildTopics, contextTopic, paragraphKind, searchHelp } from "./content";
import { help as helpDe } from "./de";
import { help as helpEn } from "./en";

// Both parts of each dictionary, as `t` offers them.
const de = { ...deCore, ...deMore };
const en = { ...enCore, ...enMore };

const ids = (h: typeof helpDe) => h.topics.map((tp) => `${tp.id}:${tp.sections.map((s) => `${s.id}${s.show ? "+show" : ""}`).join(",")}`);

describe("help texts", () => {
  it("have the same topics, sections and show targets in both languages", () => {
    expect(ids(helpEn)).toEqual(ids(helpDe));
  });

  it("have no empty title, summary or paragraph", () => {
    for (const h of [helpDe, helpEn]) {
      for (const tp of h.topics) {
        expect(tp.title.trim() && tp.summary.trim(), tp.id).toBeTruthy();
        for (const s of tp.sections) {
          expect(s.title.trim(), `${tp.id}.${s.id}`).toBeTruthy();
          expect(s.body.length && s.body.every((p) => p.trim()), `${tp.id}.${s.id}`).toBeTruthy();
        }
      }
    }
  });

  // A reference to a settings page that was renamed or merged sends the reader looking for nothing.
  it("name only settings pages that exist", () => {
    for (const [h, dict] of [[helpDe, de], [helpEn, en]] as const) {
      const pages = Object.values(dict.settings.pages).map((p) => p.label);
      const named = h.topics.flatMap((tp) => tp.sections.flatMap((s) => s.body.join(" ").match(/Settings → [^).,;:“„]+/g) ?? []));
      expect(named.length).toBeGreaterThan(3);
      for (const ref of named) expect(pages.some((p) => ref.slice("Settings → ".length).startsWith(p)), ref).toBe(true);
    }
  });

  it("fill shortcuts and error texts from their own sources", () => {
    const topics = buildTopics(helpDe, de);
    const keys = topics.find((tp) => tp.id === "keys")!;
    expect(keys.sections[0].body[0].split("\n")).toHaveLength(SHORTCUTS.length);
    const errors = topics.find((tp) => tp.id === "errors")!;
    expect(errors.sections.length).toBeGreaterThan(20);
    expect(errors.sections.every((s) => s.body[0].trim())).toBe(true);
    expect(new Set(errors.sections.map((s) => s.title)).size).toBe(errors.sections.length);
    expect(buildTopics(helpEn, en).find((tp) => tp.id === "keys")!.sections[0].body[0]).toContain("Ctrl 1");
  });

  it("search every word, title hits first", () => {
    const topics = buildTopics(helpDe, de);
    const hits = searchHelp(topics, "ignorieren");
    expect(hits[0].section.id).toBe("ignore");
    expect(searchHelp(topics, "backup rückgängig").map((h) => h.section.id)).toContain("restore");
    expect(searchHelp(topics, "   ")).toEqual([]);
    expect(searchHelp(topics, "xyzzy")).toEqual([]);
  });

  it("open on the topic of the current view", () => {
    expect(contextTopic({ settingsOpen: true, perspective: "Git", scope: "Online" })).toBe("settings");
    expect(contextTopic({ settingsOpen: false, perspective: "Git", scope: "Online" })).toBe("git");
    expect(contextTopic({ settingsOpen: false, perspective: "Cleanup", scope: "Online" })).toBe("online");
    expect(contextTopic({ settingsOpen: false, perspective: "Cleanup", scope: "Local" })).toBe("local");
  });

  it("render lists only when every line is an item", () => {
    expect(paragraphKind("- a\n- b")).toBe("list");
    expect(paragraphKind("text\n- b")).toBe("text");
  });

  it("have a shortcut label for every shortcut", () => {
    for (const s of SHORTCUTS) {
      expect(de.shortcuts[s.id]).toBeTruthy();
      expect(en.shortcuts[s.id]).toBeTruthy();
    }
  });
});
