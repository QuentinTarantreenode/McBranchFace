// The bell: how many stale branches each chosen lens counts over every repo, and the system notification
// for those that are new since the last look.
import { activeLenses, LENSES, lensKeys, newKeys, type LensId } from "$lib/alerts";
import type { TrayStatus } from "$lib/bindings/TrayStatus";
import { t } from "$lib/i18n/index.svelte";
import { loadSeen, saveSeen, trayStatus } from "$lib/notify";
import { clock } from "./clock.svelte";
import { scanResults } from "./scanResults.svelte";
import { settings } from "./settings.svelte";

// A build that is not installed has no app id of its own: Windows would name the sender "Windows PowerShell".
// Test and development runs keep their notifications to the bell.
const osNotifications = !import.meta.env.DEV || import.meta.env.MODE === "test";

class Lenses {
  lenses = $derived(settings.config ? activeLenses(settings.config.alerts) : []);
  /** The branches each lens counts, over every repo: bell, notification and dashboard read these lists. */
  lensKeysById = $derived(new Map<LensId, string[]>(LENSES.map((l) => [l.id, lensKeys(l, scanResults.allBranches, scanResults.allOnline ?? [], clock.hourClock)])));
  lensCounts = $derived(new Map(this.lenses.map((l) => [l.id, this.lensKeysById.get(l.id)?.length ?? 0])));
  bellCount = $derived([...this.lensCounts.values()].reduce((a, b) => a + b, 0));

  /** Tray tooltip and menu in the current language, with the number the bell shows. */
  trayStatus(): TrayStatus {
    return trayStatus(this.bellCount, !!settings.config?.alerts.notify, t.tray);
  }

  /** A system notification only for stale branches that were not there after the previous look. */
  async notifyNewStale() {
    const prefs = settings.config?.alerts;
    if (!prefs?.enabled) return;
    const current = this.lenses.flatMap((l) => this.lensKeysById.get(l.id) ?? []);
    const fresh = newKeys(loadSeen() ?? new Set(), current);
    saveSeen(current);
    if (!prefs.notify || fresh.length === 0 || !osNotifications) return;
    try {
      const n = await import("@tauri-apps/plugin-notification");
      let granted = await n.isPermissionGranted();
      if (!granted) granted = (await n.requestPermission()) === "granted";
      if (granted) n.sendNotification({ title: t.lens.notifyTitle, body: t.lens.notifyBody(fresh.length) });
    } catch {
      /* notifications unavailable on this system: the bell still shows the count */
    }
  }

  /** The first close to the tray says once that the app keeps running; a toast would not be seen. */
  async announceTray() {
    if (!osNotifications) return;
    try {
      const n = await import("@tauri-apps/plugin-notification");
      if (await n.isPermissionGranted()) n.sendNotification({ title: t.tray.hiddenTitle, body: t.tray.hiddenBody });
    } catch {
      /* no notifications: the tray icon itself is the hint */
    }
  }
}

export const lenses = new Lenses();
