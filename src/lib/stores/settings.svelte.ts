// The user's settings. Quiet changes (layout, folds, notes) are written coalesced a moment later; an
// explicit save (the settings dialog, a lock) waits for the backend and takes over its sanitized answer.
// Writes run one after the other, so the backend keeps what the user did last.
import { api } from "$lib/api";
import { appWindow } from "$lib/appWindow";
import { applyMotion, applyScale, applyTheme, followSystemTheme } from "$lib/appearance";
import type { Config } from "$lib/bindings/Config";
import type { Language } from "$lib/bindings/Language";
import type { Theme } from "$lib/bindings/Theme";
import type { UiPrefs } from "$lib/bindings/UiPrefs";
import { withDialogSize } from "$lib/configEdits";
import { i18n, t } from "$lib/i18n/index.svelte";
import { nearestScale } from "$lib/scale";
import { timers, type TimerHandle } from "$lib/timers";
import { toasts } from "./toasts.svelte";

/** Quiet saves (layout, notes) within this time are written once. */
const PERSIST_DELAY_MS = 400;

class Settings {
  config = $state<Config | null>(null);
  /** What the page shows: the chosen theme, or the system's when it follows the system. */
  resolvedTheme = $state<"dark" | "light">("dark");
  /** Counts local config changes; a backend answer only counts if none came after its request. */
  private revision = 0;
  /** Config writes run one after the other: the backend keeps what arrives last. */
  private writes: Promise<unknown> = Promise.resolve();
  private persistTimer: TimerHandle | undefined;

  resetForTests() {
    timers.cancel(this.persistTimer);
    this.persistTimer = undefined;
    this.config = null;
    this.resolvedTheme = "dark";
    this.revision = 0;
    this.writes = Promise.resolve();
  }

  /** The config the app starts with: shown and applied, not written back. */
  load(config: Config) {
    this.config = config;
    this.showTheme(config.theme);
    void applyScale(config.ui.scale).then((failed) => failed && toasts.fail(failed));
  }

  private showTheme(theme: Theme) {
    this.resolvedTheme = applyTheme(theme, this.config?.ui.motion);
    followSystemTheme(() => this.config?.theme === "System" && this.showTheme("System"));
  }

  /** Layout and theme changes are saved quietly and coalesced; the settings dialog saves explicitly. */
  persist() {
    this.revision++;
    timers.cancel(this.persistTimer);
    // The snapshot is taken when the write's turn comes, so it carries every change queued before it.
    this.persistTimer = timers.after(PERSIST_DELAY_MS, () => {
      this.persistTimer = undefined;
      void this.enqueue(() => (this.config ? api.saveConfig($state.snapshot(this.config) as Config) : Promise.resolve(null))).catch((e) => toasts.fail(e));
    });
  }

  private enqueue<T>(write: () => Promise<T>): Promise<T> {
    const next = this.writes.then(write, write);
    this.writes = next.catch(() => {});
    return next;
  }

  /**
   * Applies the config at once, so every later change and write builds on it; the backend's
   * (sanitized) answer replaces it only if nothing changed locally meanwhile.
   */
  async saveConfig(config: Config, quiet = false) {
    const before = this.config;
    this.config = config;
    const rev = ++this.revision;
    try {
      const saved = await this.enqueue(() => api.saveConfig(config));
      if (rev === this.revision) this.config = saved;
      await i18n.set(config.language);
      if (!quiet) toasts.toast("success", t.settings.saved);
      return true;
    } catch (e) {
      // Not saved: back to what was there, unless newer changes already build on it.
      if (rev === this.revision) this.config = before;
      toasts.fail(e);
      return false;
    }
  }

  /** Saves the current config with `patch` applied, quietly unless asked; every write builds on a plain copy. */
  saveWith(patch: Partial<Config>, quiet = true) {
    if (!this.config) return Promise.resolve(false);
    return this.saveConfig({ ...($state.snapshot(this.config) as Config), ...patch }, quiet);
  }

  setUi(patch: Partial<UiPrefs>) {
    if (!this.config) return;
    Object.assign(this.config.ui, patch);
    if (patch.motion !== undefined) applyMotion(patch.motion);
    this.persist();
  }

  setAlerts(patch: Partial<Config["alerts"]>) {
    if (!this.config) return;
    Object.assign(this.config.alerts, patch);
    this.persist();
  }

  setTheme(theme: Theme) {
    if (!this.config) return;
    this.config.theme = theme;
    this.showTheme(theme);
    this.persist();
  }

  setLanguage(language: Language) {
    if (!this.config) return;
    this.config.language = language;
    void i18n.set(language);
    this.persist();
  }

  async setScale(scale: number) {
    if (!this.config) return;
    const s = nearestScale(scale);
    if (s === this.config.ui.scale) return;
    this.setUi({ scale: s });
    const failed = await applyScale(s);
    if (failed) toasts.fail(failed);
    else toasts.toast("info", t.settings.scaleNow(s));
  }

  setAlwaysOnTop(on: boolean) {
    this.setUi({ alwaysOnTop: on });
    appWindow.setAlwaysOnTop(on).catch((e) => toasts.fail(e));
  }

  /** Props for a resizable Modal: the saved size of dialog `id` and where a new one goes. */
  dialogSize(id: string) {
    return {
      savedSize: this.config?.ui.dialogSizes[id] ?? null,
      onsize: (size: { width: number; height: number } | null) => this.setUi({ dialogSizes: withDialogSize(this.config?.ui.dialogSizes ?? {}, id, size) }),
    };
  }
}

export const settings = new Settings();
