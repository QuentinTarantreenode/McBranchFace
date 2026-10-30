// Which dialog or panel is open and what it was opened for. Every value is replaced as a whole.
import type { CommitInfo } from "$lib/bindings/CommitInfo";
import { contextTopic } from "$lib/help/content";
import type { HelpTopicId } from "$lib/help/types";
import type { SettingsPage } from "$lib/settingsPages";
import { settings } from "./settings.svelte";

/** A question before an action, answered in one generic dialog. */
export interface Ask {
  title: string;
  text: string;
  detail?: string;
  /** The detail is a path: shown in one separator style, wrapping after separators. */
  detailIsPath?: boolean;
  action: string;
  /** The action destroys something; the button says so. */
  danger?: boolean;
  run: () => unknown;
}

export interface CommitsView {
  title: string;
  /** The branch the list belongs to, shown as segments. */
  branch?: string;
  repoPath: string;
  commits: CommitInfo[];
  /** More than the list holds (the scan caps it); `range` loads the rest. */
  total?: number;
  /** What git log shows for these commits, e.g. `sha..tip`; also where "open in history" goes. */
  range?: string;
  /** Loaded on opening, e.g. the commits of a PR or of a branch not read yet. `total` where the list is capped. */
  load?: () => Promise<{ commits: CommitInfo[]; fromProvider: boolean; total?: number }>;
}

type HelpAt = { topic: HelpTopicId | null; section: string | null };
const HELP_OVERVIEW: HelpAt = { topic: null, section: null };

class Dialogs {
  settingsOpen = $state(false);
  settingsTab = $state<SettingsPage>("appearance");
  helpOpen = $state(false);
  /** Drill-down position; null topic = overview. */
  helpAt = $state.raw<HelpAt>(HELP_OVERVIEW);
  shortcutsOpen = $state(false);
  deletedOpen = $state(false);
  commitSearchOpen = $state(false);
  /** Repo (and optionally branch) the "create working copies" dialog is open for. */
  copiesFor = $state.raw<{ repoPath: string; branch: string | null } | null>(null);
  /** The clone dialog is open; `parent` is the folder it starts with. */
  cloneOpen = $state.raw<{ parent: string | null } | null>(null);
  /** The commit list in its own window: after the last push, own commits, the commits of a PR. */
  commitsView = $state.raw<CommitsView | null>(null);
  ask = $state.raw<Ask | null>(null);

  resetForTests() {
    this.settingsOpen = false;
    this.settingsTab = "appearance";
    this.helpOpen = false;
    this.helpAt = HELP_OVERVIEW;
    this.shortcutsOpen = false;
    this.deletedOpen = false;
    this.commitSearchOpen = false;
    this.copiesFor = null;
    this.cloneOpen = null;
    this.commitsView = null;
    this.ask = null;
  }

  openSettings(tab: SettingsPage = "appearance") {
    this.settingsTab = tab;
    this.settingsOpen = true;
  }

  /** F1: opens on the topic of what is on screen; a second press closes. */
  toggleHelp() {
    if (this.helpOpen) {
      this.helpOpen = false;
      return;
    }
    const ui = settings.config?.ui;
    const topic = contextTopic({ settingsOpen: this.settingsOpen, perspective: ui?.perspective ?? "Dashboard", scope: ui?.cleanupScope ?? "Local" });
    this.helpAt = { topic, section: null };
    this.helpOpen = true;
  }

  openCopies(repoPath: string, branch: string | null = null) {
    this.copiesFor = { repoPath, branch };
  }
}

export const dialogs = new Dialogs();
