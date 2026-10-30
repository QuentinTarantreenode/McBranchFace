/** The pages of the settings dialog, in the order of its navigation. */
export const SETTINGS_PAGES = ["appearance", "repos", "updates", "window", "rules", "online", "commands", "prompts", "env", "config", "about"] as const;
export type SettingsPage = (typeof SETTINGS_PAGES)[number];
