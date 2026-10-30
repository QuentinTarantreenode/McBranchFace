// @vitest-environment jsdom
// The top bar: perspectives, tools, refresh and its stop, and the size of the interface.
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/svelte";
import { tick } from "svelte";
import { store } from "$lib/store.svelte";
import { backend, start } from "../../test/views";
import { waitFor } from "../../test/wait";
import TopBar from "./TopBar.svelte";

vi.mock("@lucide/svelte", async () => (await import("../../test/icons")).iconModule());

it("top bar: perspectives, bell with lenses, tools, theme, settings", async () => {
  await start();
  render(TopBar, { detailAvailable: true });
  await tick();
  await fireEvent.click(screen.getByRole("tab", { name: /Git/ }));
  expect(store.config?.ui.perspective).toBe("Git");
  await fireEvent.click(screen.getByRole("button", { name: /Alerts/ }));
  await fireEvent.click(screen.getByRole("button", { name: "GitHub" }));
  await fireEvent.click(screen.getByRole("button", { name: /theme/ }));
  await fireEvent.click(screen.getByRole("button", { name: "Settings" }));
  expect(store.settingsOpen).toBe(true);
  await fireEvent.click(screen.getByRole("button", { name: "Help" }));
  expect(store.helpOpen).toBe(true);
  await fireEvent.click(screen.getByRole("button", { name: /Recently deleted/ }));
  expect(store.deletedOpen).toBe(true);
  await fireEvent.click(screen.getByRole("button", { name: /Always on top/ }));
  await fireEvent.click(screen.getByRole("button", { name: /details/ }));
  await fireEvent.click(screen.getByRole("button", { name: /Refresh/ }));
  await fireEvent.click(screen.getByRole("button", { name: /without the server/ }));
  expect(backend.called("scan").length).toBeGreaterThan(0);
});

it("top bar: refresh turns while it fetches, and its other half stops a running scan", async () => {
  await start();
  render(TopBar, { detailAvailable: true });
  const fetch = () => screen.getAllByRole("button").find((b) => /^Refresh/.test(b.textContent?.trim() ?? ""))!;
  Object.assign(store, { scanning: true, scanKind: "local" });
  await tick();
  expect(fetch().getAttribute("aria-busy")).toBeNull();
  expect(screen.queryByRole("button", { name: /without the server/ })).toBeNull();
  Object.assign(store, { scanKind: "fetch" });
  await tick();
  expect(fetch().getAttribute("aria-busy")).toBe("true");
  await fireEvent.click(screen.getByRole("button", { name: "Stop scan" }));
  expect(backend.called("cancel_scan").length).toBe(1);
  Object.assign(store, { scanning: false, scanKind: null });
  await tick();
  expect(screen.queryByRole("button", { name: "Stop scan" })).toBeNull();
  expect(screen.getByRole("button", { name: /without the server/ })).toBeTruthy();
});

describe("scan requests during a scan", () => {
  it("a folder added while a scan runs is scanned right after it, not dropped", async () => {
    let release: () => void = () => {};
    await start({ folder_kinds: () => [true] });
    backend.handlers.scan = () => new Promise((r) => (release = () => r({ durationMs: 1, repoCount: 1 })));
    const before = backend.called("scan").length;
    const scans = () => backend.called("scan").length - before;
    const first = store.scan(true);
    await waitFor(() => expect(scans()).toBe(1));
    await store.addRoots(["D:/new"]);
    expect(scans()).toBe(1);
    release();
    await waitFor(() => expect(scans()).toBe(2));
    expect(backend.called("scan").at(-1)).toEqual({ fetch: false, changedOnly: false, interactive: true });
    release();
    await first;
    expect(store.scanning).toBe(false);
    expect(scans()).toBe(2);
  });
});

describe("interface size", () => {
  it("zooms in steps, grows the minimum window along and keeps the choice", async () => {
    await start();
    await store.setScale(130);
    expect(backend.called("plugin:webview|set_webview_zoom").at(-1)).toEqual({ label: "main", value: 1.3 });
    expect(backend.called("plugin:window|set_min_size").at(-1)).toEqual({ label: "main", value: { Logical: { width: 1430, height: 806 } } });
    expect(store.config?.ui.scale).toBe(130);
    const zooms = backend.called("plugin:webview|set_webview_zoom").length;
    store.setScale(125);
    expect(backend.called("plugin:webview|set_webview_zoom")).toHaveLength(zooms);
  });

  it("says so when the window refuses the zoom, instead of claiming the new size", async () => {
    await start();
    store.toasts = [];
    backend.handlers["plugin:webview|set_webview_zoom"] = () => {
      throw "no zoom here";
    };
    await store.setScale(150);
    expect(store.toasts.map((x) => [x.kind, x.text])).toEqual([["error", "no zoom here"]]);
  });
});
