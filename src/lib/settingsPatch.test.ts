import { describe, expect, it } from "vitest";
import { config } from "../test/backend";
import { settingsPatch } from "./settingsPatch";

describe("settings patch", () => {
  it("holds only what the dialog changed, applied over what changed elsewhere meanwhile", () => {
    const opened = config();
    const edited = { ...config(), scanDepth: 6, alerts: { ...opened.alerts, enabled: false } };
    // While the dialog was open: a dropped root, notifications off in the tray, a new theme.
    const current = { ...config(), roots: ["C:/ws", "D:/dropped"], theme: "Light" as const, alerts: { ...opened.alerts, notify: false } };
    const patch = settingsPatch(opened, edited, current);
    expect(Object.keys(patch).sort()).toEqual(["alerts", "scanDepth"]);
    expect({ ...current, ...patch }).toMatchObject({ roots: ["C:/ws", "D:/dropped"], theme: "Light", scanDepth: 6, alerts: { enabled: false, notify: false } });
  });

  it("is empty when nothing was changed in the dialog, and takes only the watcher gap of the layout", () => {
    const opened = config();
    expect(settingsPatch(opened, config(), { ...config(), ui: { ...opened.ui, sidebarWidth: 400 } })).toEqual({});
    const patch = settingsPatch(opened, { ...config(), ui: { ...opened.ui, refsGapSeconds: 90, sidebarWidth: 1 } }, { ...config(), ui: { ...opened.ui, sidebarWidth: 400 } });
    expect(patch.ui).toMatchObject({ refsGapSeconds: 90, sidebarWidth: 400 });
  });
});
