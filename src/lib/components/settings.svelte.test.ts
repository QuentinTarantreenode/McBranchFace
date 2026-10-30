// @vitest-environment jsdom
// Settings: every page, what Save writes, onboarding and the environment, and how config writes
// that overlap keep every change.
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/svelte";
import { tick } from "svelte";
import type { Config } from "$lib/bindings/Config";
import { store } from "$lib/store.svelte";
import { menu } from "$lib/ui/menu.svelte";
import { config } from "../../test/backend";
import { A, backend, settled, start } from "../../test/views";
import { waitFor } from "../../test/wait";
import Onboarding from "./Onboarding.svelte";
import SettingsDialog from "./SettingsDialog.svelte";
import ToolList from "./ToolList.svelte";

vi.mock("@lucide/svelte", async () => (await import("../../test/icons")).iconModule());

const lastSaved = () => backend.called("save_config").at(-1)!.config as Config;

it("settings: every page, save, and removing an ignore", async () => {
  await start();
  store.openSettings();
  render(SettingsDialog);
  await tick();
  for (const tab of ["Folders & scan", "Refresh & alerts", "Window & start", "Rules", "Online branches", "Commands", "Environment", "Configuration", "About", "Appearance"]) {
    await fireEvent.click(screen.getByRole("tab", { name: tab }));
    // Below its heading the page shows; some load their code on the first opening.
    await waitFor(() => expect(screen.getByRole("tabpanel", { name: tab }).childElementCount).toBeGreaterThan(1));
  }
  await fireEvent.click(screen.getByRole("tab", { name: "Rules" }));
  await tick();
  await fireEvent.click(screen.getByRole("button", { name: "Stop ignoring" }));
  await waitFor(() => expect(store.config?.ignores).toEqual([]));
  await fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(backend.called("save_config").length).toBeGreaterThan(0));
});

it("settings: Save writes what the dialog changed over what changed elsewhere while it was open", async () => {
  await start({ folder_kinds: (a) => (a.paths as string[]).map(() => true) });
  store.openSettings("repos");
  render(SettingsDialog);
  await tick();
  // While the dialog is open: a folder dropped on the sidebar, the tray switching notifications off.
  await store.addRoots(["D:/dropped"]);
  store.setAlerts({ notify: false });
  await tick();
  await fireEvent.click(screen.getByRole("checkbox", { name: /Ask the server on refresh/ }));
  await fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(lastSaved().fetchOnScan).toBe(false));
  expect(lastSaved().roots).toEqual(["C:/ws", "D:/dropped"]);
  expect(lastSaved().alerts.notify).toBe(false);
});

it("onboarding: environment, folders, providers", async () => {
  await start({ get_config: () => config({ language: "En", roots: [] }) });
  render(Onboarding);
  await tick();
  expect(screen.getByText("Welcome to McBranchFace")).toBeTruthy();
  await fireEvent.click(screen.getByRole("button", { name: "Next" }));
  await tick();
  expect((screen.getByRole("button", { name: "Next" }) as HTMLButtonElement).disabled).toBe(true);
});

it("environment list: states, versions and the next command", async () => {
  await start({ run_tool_command: () => null });
  render(ToolList);
  await tick();
  expect(screen.getByText("octocat", { exact: false })).toBeTruthy();
  await fireEvent.click(screen.getAllByRole("button", { name: /az login|Sign in/ })[0]);
  await waitFor(() => expect(backend.called("run_tool_command").length).toBe(1));
});

describe("pages", () => {
  it("prompts tab changes a built-in text and resets it, adds an own template with variables and previews it", async () => {
    await start({ get_config: () => config({ language: "En" }) });
    store.openSettings("prompts");
    render(SettingsDialog);
    const text = (await screen.findByRole("textbox", { name: "Text" })) as HTMLTextAreaElement;
    // The merge prompt's own text, rendered at once against a branch of the workspace.
    expect(text.value).toContain("{{steps.merge}}");
    await fireEvent.input(text, { target: { value: `${text.value}\nUse the skill git-merge.` } });
    expect(screen.getByText("changed")).toBeTruthy();
    await fireEvent.click(screen.getByRole("button", { name: "Reset to default" }));
    expect(screen.queryByText("changed")).toBeNull();
    await fireEvent.click(screen.getByRole("button", { name: "New template" }));
    const body = screen.getByRole("textbox", { name: "Text" }) as HTMLTextAreaElement;
    await fireEvent.input(body, { target: { value: "Review " } });
    body.setSelectionRange(7, 7);
    await fireEvent.click(screen.getByRole("button", { name: "Insert variable …" }));
    const groups = menu.current!.entries as { label: string; submenu: { label: string; run: () => void }[] }[];
    groups.find((g) => g.label === "Branch")!.submenu.find((i) => i.label === "{{branch}}")!.run();
    menu.current = null;
    await tick();
    expect(body.value).toBe("Review {{branch}}");
    expect(document.querySelector("pre")?.textContent).toMatch(/^Review \S+/);
    await fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect((lastSaved() as unknown as { prompts: unknown[] }).prompts).toEqual([expect.objectContaining({ name: "New template", body: "Review {{branch}}", builtin: null })]),
    );
  });

  it("window settings are disabled with a reason where the system has no tray", async () => {
    await start({ get_config: () => config({ language: "En" }), window_capabilities: () => ({ tray: false, autostart: true, startedHidden: false, home: null }) });
    store.openSettings("window");
    render(SettingsDialog);
    await tick();
    expect((screen.getByRole("checkbox", { name: /Closing keeps the app running/ }) as HTMLInputElement).disabled).toBe(true);
    expect(screen.getAllByText("This system has no tray area.").length).toBe(2);
    await fireEvent.click(screen.getByRole("checkbox", { name: /^Start with the system/ }));
    await fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(lastSaved().window.autostart).toBe(true));
  });

  it("prompts and about edit the dialog's draft as a bound prop, so Svelte reports no foreign mutation", async () => {
    const warn = vi.spyOn(console, "warn");
    try {
      await start({ get_config: () => config({ language: "En" }) });
      store.openSettings("prompts");
      render(SettingsDialog);
      await fireEvent.click(await screen.findByRole("button", { name: "New template" }));
      await fireEvent.click(screen.getByRole("tab", { name: "About" }));
      await fireEvent.click(await screen.findByRole("checkbox", { name: /^Log git calls and activities/ }));
      expect(warn.mock.calls.flat().join("\n")).not.toMatch(/ownership_invalid/);
    } finally {
      warn.mockRestore();
    }
  });
});

describe("settings keep what was typed", () => {
  it("a theme or size change while the dialog is open does not reset the other pages", async () => {
    await start();
    store.openSettings("rules");
    render(SettingsDialog);
    await tick();
    // The first field of the rules page: the own e-mail addresses.
    const emails = document.querySelector("dialog textarea") as HTMLTextAreaElement;
    await fireEvent.input(emails, { target: { value: "typed@example.com" } });
    await store.setTheme("Light");
    await store.setScale(130);
    await tick();
    expect((document.querySelector("dialog textarea") as HTMLTextAreaElement).value).toBe("typed@example.com");
  });
});

describe("config writes", () => {
  // The backend keeps whatever arrives last. Requests arrive at once; the answer to the first one comes
  // only when the test lets it, so the next write is asked for while that one is still on its way.
  async function delayedBackend() {
    const received: Config[] = [];
    let answer!: () => void;
    const late = new Promise<void>((r) => (answer = r));
    await start();
    backend.handlers.save_config = (a) => {
      const c = a.config as Config;
      received.push(c);
      return received.length === 1 ? late.then(() => c) : c;
    };
    return { received, answerFirst: () => answer() };
  }

  it("a lock set right after a layout change is not overwritten by the layout's older snapshot", async () => {
    const { received, answerFirst } = await delayedBackend();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      store.setUi({ sidebarWidth: 300 });
      const lock = store.setLock(A.path, "feature/x", true);
      await waitFor(() => expect(received).toHaveLength(1));
      // The layout's quiet save comes due while the lock's write waits for its answer.
      vi.advanceTimersByTime(400);
      answerFirst();
      await lock;
    } finally {
      vi.useRealTimers();
    }
    await settled();
    const last = received.at(-1)!;
    expect(last.locks.some((l) => l.identity === A.identity && l.branch === "feature/x")).toBe(true);
    expect(last.ui.sidebarWidth).toBe(300);
    expect(store.config?.locks.some((l) => l.branch === "feature/x")).toBe(true);
  });

  it("a note edited while a quiet save is in flight survives its answer", async () => {
    const { received, answerFirst } = await delayedBackend();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const lock = store.setLock(A.path, "feature/y", true);
      store.setAnnotation(A.path, "feature/y", { note: "keep me", tags: [] });
      await waitFor(() => expect(received).toHaveLength(1));
      // The note's quiet save comes due while the lock's write waits for its answer.
      vi.advanceTimersByTime(400);
      answerFirst();
      await lock;
    } finally {
      vi.useRealTimers();
    }
    await settled();
    expect(store.annotationOf(A.path, "feature/y").note).toBe("keep me");
    expect(Object.values(received.at(-1)!.annotations).some((a) => a.note === "keep me")).toBe(true);
    expect(received.at(-1)!.locks.some((l) => l.branch === "feature/y")).toBe(true);
  });

  it("a save that fails puts the previous config back", async () => {
    await start();
    backend.handlers.save_config = () => Promise.reject({ code: "Other", detail: "disk full" });
    const before = store.config!.roots;
    expect(await store.saveConfig({ ...store.config!, roots: ["D:/nope"] }, true)).toBe(false);
    expect(store.config!.roots).toEqual(before);
  });
});
