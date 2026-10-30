import type { SettingsPage } from "$lib/settingsPages";

export type HelpTopicId = "overview" | "local" | "online" | "protect" | "alerts" | "copies" | "git" | "settings" | "commands" | "legend" | "keys" | "errors";

/** The part of the app a topic belongs to; the start page lists the topics under it. */
export type HelpGroup = "start" | "cleanup" | "git" | "setup" | "reference";

/** Where "Show" leads: the view, tab or settings page a section explains. */
export interface HelpTarget {
  perspective?: "Dashboard" | "Cleanup" | "Git";
  scope?: "Local" | "Online";
  gitTab?: "changes" | "history" | "branches";
  settings?: SettingsPage;
}

export type LegendVisual = "verdicts" | "segments" | "sidebar" | "worktree" | "table" | "topbar";

/** Elements of one area as they look; `items` maps each element the legend knows to its explanation. */
export interface HelpLegend {
  visual: LegendVisual;
  items: Record<string, string>;
}

export interface HelpSection {
  id: string;
  title: string;
  /** Paragraphs; a paragraph of lines starting with "- " is a list. */
  body: string[];
  show?: HelpTarget;
  legend?: HelpLegend;
}

export interface HelpTopic {
  id: HelpTopicId;
  title: string;
  summary: string;
  /** Empty for topics built from other sources (shortcuts, error texts). */
  sections: HelpSection[];
}

export interface HelpDict {
  title: string;
  search: string;
  back: string;
  show: string;
  noMatch: string;
  groups: Record<HelpGroup, string>;
  forView: string;
  topics: HelpTopic[];
}
