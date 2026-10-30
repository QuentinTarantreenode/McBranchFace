import type { Dict } from "$lib/i18n/de";
import { SHORTCUTS } from "$lib/shortcuts";
import type { HelpDict, HelpGroup, HelpSection, HelpTopic, HelpTopicId } from "./types";

/** Where in the app each topic lives: the start page groups by it, so a reader finds a topic by the area in front of them. */
export const TOPIC_GROUP: Record<HelpTopicId, HelpGroup> = {
  overview: "start",
  local: "cleanup",
  online: "cleanup",
  protect: "cleanup",
  alerts: "cleanup",
  git: "git",
  copies: "git",
  settings: "setup",
  commands: "setup",
  legend: "reference",
  keys: "reference",
  errors: "reference",
};

/** Shortcuts and error texts come from their own sources, so the help can never contradict them. */
export function buildTopics(help: HelpDict, t: Dict): HelpTopic[] {
  return help.topics.map((topic) => {
    if (topic.id === "keys") {
      return { ...topic, sections: [{ id: "all", title: topic.title, body: [SHORTCUTS.map((s) => `- ${s.keys} – ${t.shortcuts[s.id]}`).join("\n")] }] };
    }
    if (topic.id === "errors") {
      const seen = new Set<string>();
      const sections: HelpSection[] = [];
      const add = (id: string, m: { title: string; hint: string }) => {
        if (seen.has(m.title)) return;
        seen.add(m.title);
        sections.push({ id, title: m.title, body: [m.hint] });
      };
      for (const [k, m] of Object.entries(t.failure)) add(`failure-${k}`, m);
      for (const [k, m] of Object.entries(t.errors)) add(`error-${k}`, m);
      for (const [k, m] of Object.entries(t.settings.importFailure)) add(`import-${k}`, m);
      return { ...topic, sections };
    }
    return topic;
  });
}

export interface HelpHit {
  topic: HelpTopic;
  section: HelpSection;
}

/** Every word of the query must appear somewhere; section-title hits rank before topic-title and text hits. */
export function searchHelp(topics: HelpTopic[], query: string): HelpHit[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const hits: (HelpHit & { rank: number })[] = [];
  for (const topic of topics) {
    for (const section of topic.sections) {
      const own = section.title.toLowerCase();
      const titles = `${topic.title.toLowerCase()} ${own}`;
      const legend = section.legend ? Object.values(section.legend.items).join(" ") : "";
      const text = `${titles} ${section.body.join(" ")} ${legend}`.toLowerCase();
      if (!words.every((w) => text.includes(w))) continue;
      const rank = words.every((w) => own.includes(w)) ? 0 : words.every((w) => titles.includes(w)) ? 1 : 2;
      hits.push({ topic, section, rank });
    }
  }
  return hits.sort((a, b) => a.rank - b.rank).map(({ topic, section }) => ({ topic, section }));
}

/** The topic that explains what is on screen right now. */
export function contextTopic(s: { settingsOpen: boolean; perspective: "Dashboard" | "Cleanup" | "Git"; scope: "Local" | "Online" }): HelpTopicId {
  if (s.settingsOpen) return "settings";
  if (s.perspective === "Git") return "git";
  if (s.perspective === "Dashboard") return "overview";
  return s.scope === "Online" ? "online" : "local";
}

/** A paragraph whose lines all start with "- " is a list. */
export function paragraphKind(p: string): "list" | "text" {
  const lines = p.split("\n");
  return lines.every((l) => l.startsWith("- ")) ? "list" : "text";
}
