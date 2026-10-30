import type { Language } from "$lib/bindings/Language";
import type { CoreDict, Dict } from "./de";
import type { MoreDict } from "./de.more";

export type Lang = "de" | "en";

// Only the active dictionary is loaded: the other one never reaches the start bundle.
const LOADERS: Record<Lang, () => Promise<CoreDict>> = {
  de: () => import("./de").then((m) => m.de),
  en: () => import("./en").then((m) => m.en),
};
// Texts no start view needs (Git, settings, dialogs): they load beside the core and arrive right after it.
const MORE: Record<Lang, () => Promise<MoreDict>> = {
  de: () => import("./de.more").then((m) => m.deMore),
  en: () => import("./en.more").then((m) => m.enMore),
};

export function resolveLang(setting: Language | undefined, system = typeof navigator === "undefined" ? "de" : navigator.language): Lang {
  if (setting === "De") return "de";
  if (setting === "En") return "en";
  return system.toLowerCase().startsWith("de") ? "de" : "en";
}

/**
 * Stands in for a text of the second part while it is still loading: every property and every call
 * gives it back, and as text it is empty. The reactive read of `i18n.more` fills it in a moment later.
 */
const pending: unknown = new Proxy(() => {}, {
  get: (_, key) => (key === Symbol.toPrimitive || key === "toString" ? () => "" : pending),
  apply: () => "",
});

class I18n {
  lang = $state<Lang>(resolveLang("Auto"));
  // Raw: the dictionaries are never written in place, and a deep proxy would be a new object on every
  // assignment, re-running every text that reads one.
  dict = $state.raw<CoreDict | null>(null);
  more = $state.raw<MoreDict | null>(null);
  #request = 0;
  /** The request whose two parts are both in place. */
  #complete = 0;

  /**
   * Loads the dictionary of the setting; the UI renders once the core is there. `all: false` returns
   * without waiting for the second part, so the start does not wait for texts it does not show.
   */
  async set(setting: Language | undefined, all = true) {
    const lang = resolveLang(setting);
    // Every saved setting passes here: the language it already shows, completely, needs nothing.
    if (lang === this.lang && this.#complete === this.#request && this.dict && this.more) return;
    const request = ++this.#request;
    // A later switch of the language wins, whichever part arrives first.
    const more = MORE[lang]().then((m) => {
      if (request === this.#request) this.more = m;
    });
    const dict = await LOADERS[lang]();
    if (request !== this.#request) return;
    this.lang = lang;
    this.dict = dict;
    if (typeof document !== "undefined") document.documentElement.lang = lang;
    const done = more.then(() => {
      if (request === this.#request) this.#complete = request;
    });
    if (all) await done;
    else done.catch(() => {});
  }

  get locale() {
    return this.lang === "de" ? "de-DE" : "en-GB";
  }
}

export const i18n = new I18n();

/**
 * The current dictionary. Reading a property reads the reactive state, so templates and $derived
 * values update when the language changes; module-level constants would not.
 */
export const t: Dict = new Proxy({} as Dict, {
  get: (_, key: string) => {
    if (!i18n.dict) throw new Error(`dictionary not loaded (t.${key})`);
    if (key in i18n.dict) return i18n.dict[key as keyof CoreDict];
    if (i18n.more) return i18n.more[key as keyof MoreDict];
    if (import.meta.env.MODE === "test") earlyReads.add(key);
    return pending;
  },
});

/**
 * Tests only: the sections of the second part read before it was there. A start view reading one shows an
 * empty text in its first frames; the start test fails on any.
 */
export const earlyReads = new Set<string>();
