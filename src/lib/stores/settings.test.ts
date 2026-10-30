// @vitest-environment jsdom
// Preferences and feedback: theme, language and layout saved quietly, explicit saves, messages and their
// ways back, the clipboard, tools and help.
import { describe, expect, it, vi } from "vitest";
import { config } from "../../test/backend";
import { backend, savedConfigs, start, store, storeTests } from "../../test/store";
import { waitFor } from "../../test/wait";

// Only the menu helpers need icons; loading the whole icon package would dominate the run time.
vi.mock("@lucide/svelte", () => ({ Eye: {}, EyeOff: {} }));


storeTests();

describe("preferences and feedback", () => {
  it("applies theme, language and layout at once and saves them coalesced", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    await start();
    store.setTheme("Light");
    store.setLanguage("En");
    store.setUi({ sidebarWidth: 300 });
    store.setAlwaysOnTop(true);
    expect(document.documentElement.dataset.theme).toBe("light");
    // Following the system: the page takes the system's side, the top bar's toggle knows which one.
    store.setTheme("System");
    expect(store.resolvedTheme).toBe(document.documentElement.dataset.theme);
    store.setTheme("Light");
    // The write waits for its turn in the queue: one more microtask after the timer.
    await vi.advanceTimersByTimeAsync(400);
    const saved = savedConfigs();
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ theme: "Light", language: "En", ui: { sidebarWidth: 300, alwaysOnTop: true } });
  });

  it("confirms an explicit save and reports a failed one", async () => {
    await start();
    expect(await store.saveConfig(config())).toBe(true);
    expect(store.toasts.at(-1)?.kind).toBe("success");
    backend.handlers.save_config = () => {
      throw { code: "Other", detail: "read-only" };
    };
    expect(await store.saveConfig(config())).toBe(false);
    expect(store.toasts.at(-1)?.text).toBe("read-only");
  });

  it("shows a message once, then removes it", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    await start();
    store.toast("info", "hello");
    store.toast("info", "hello");
    expect(store.toasts).toHaveLength(1);
    vi.advanceTimersByTime(4000);
    expect(store.toasts).toHaveLength(0);
  });

  it("a message with a way back replaces the same one before it: the newest way back, its full time", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    await start();
    const first = vi.fn();
    const second = vi.fn();
    store.toast("success", "saved", { action: { label: "Undo", run: first } });
    vi.advanceTimersByTime(10_000);
    store.toast("success", "saved", { action: { label: "Undo", run: second } });
    expect(store.toasts).toHaveLength(1);
    store.toasts[0].action!.run();
    expect(second).toHaveBeenCalled();
    expect(first).not.toHaveBeenCalled();
    // The first one's timer must not end the second early.
    vi.advanceTimersByTime(10_000);
    expect(store.toasts).toHaveLength(1);
    vi.advanceTimersByTime(5_000);
    expect(store.toasts).toHaveLength(0);
  });

  it("undo after two group changes goes back one step, to the groups before the last change", async () => {
    await start();
    const group = (name: string) => ({ id: name, name, paths: [] });
    await store.setRepoGroups([group("one")], "changed");
    await store.setRepoGroups([group("one"), group("two")], "changed");
    expect(store.toasts.filter((t) => t.text === "changed")).toHaveLength(1);
    await store.toasts.find((t) => t.text === "changed")!.action!.run();
    await waitFor(() => expect(store.config?.repoGroups.map((g) => g.name)).toEqual(["one"]));
  });

  it("copies to the clipboard and runs tools", async () => {
    await start({ run_tool_command: () => null });
    store.copy("feature/x");
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith("feature/x"));
    await store.runTool("Git", "Install");
    expect(store.toasts.at(-1)?.kind).toBe("info");
    backend.handlers.run_tool_command = () => {
      throw "no terminal";
    };
    await store.runTool("Git", "Install");
    expect(store.toasts.at(-1)?.text).toBe("no terminal");
  });

  it("opens help on the current view and shows what a section explains", async () => {
    await start();
    // The app starts on the dashboard: help opens on the overview there, on the list in Cleanup.
    store.toggleHelp();
    expect(store.helpAt.topic).toBe("overview");
    store.toggleHelp();
    store.setUi({ perspective: "Cleanup" });
    store.toggleHelp();
    expect(store.helpAt.topic).toBe("local");
    store.toggleHelp();
    expect(store.helpOpen).toBe(false);
    await store.show({ settings: "rules" });
    expect(store.settingsTab).toBe("rules");
    await store.show({ perspective: "Cleanup", scope: "Online" });
    expect(store.settingsOpen).toBe(false);
    expect(store.scope).toBe("Online");
    await store.show({ perspective: "Git", gitTab: "history" });
    const { gitStore } = await import("$lib/git/gitStore.svelte");
    expect(gitStore.tab).toBe("history");
  });
});
