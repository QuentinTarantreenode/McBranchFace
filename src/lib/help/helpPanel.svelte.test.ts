// @vitest-environment jsdom
// The help panel: opened on the current view, its topics, the search, and the legend of the real elements.
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/svelte";
import { tick } from "svelte";
import { store } from "$lib/store.svelte";
import { startApp } from "../../test/views";
import { waitFor } from "../../test/wait";
import HelpPanel from "./HelpPanel.svelte";

vi.mock("@lucide/svelte", async () => (await import("../../test/icons")).iconModule());

describe("HelpPanel", () => {
  it("opens on the current view, drills down, searches and shows", async () => {
    await startApp();
    store.setUi({ perspective: "Cleanup" });
    store.toggleHelp();
    render(HelpPanel);
    expect(await screen.findByText("Verdicts")).toBeTruthy();
    await fireEvent.click(screen.getByText("Verdicts"));
    await tick();
    expect(screen.getByText(/provably merged/)).toBeTruthy();
    await fireEvent.click(screen.getByRole("button", { name: "Back" }));
    await fireEvent.click(screen.getByRole("button", { name: "Back" }));
    await tick();
    // The start page lists the topics under the part of the app they belong to.
    expect(["Getting started", "Git", "Setup", "Reference"].every((g) => screen.getByText(g))).toBe(true);
    await fireEvent.input(screen.getByPlaceholderText("Search help"), { target: { value: "ignore" } });
    await tick();
    await fireEvent.click(screen.getAllByText("Ignore")[0]);
    await tick();
    await fireEvent.click(screen.getByRole("button", { name: "Show in the app" }));
    expect(store.settingsTab).toBe("rules");
    await fireEvent.input(screen.getByPlaceholderText("Search help"), { target: { value: "xyzzy" } });
    await tick();
    expect(screen.getByText("Nothing found.")).toBeTruthy();
  });

  it("shows a legend with the real elements beside their explanations, and finds it by those", async () => {
    await startApp();
    store.toggleHelp();
    store.helpAt = { topic: "legend", section: "sidebar" };
    render(HelpPanel);
    await waitFor(() => expect(document.querySelector("[data-legend=sidebar]")).toBeTruthy());
    const rows = [...document.querySelectorAll("[data-legend=sidebar] dt")];
    expect(rows.length).toBe(15);
    expect(rows.every((dt) => dt.childElementCount > 0 || dt.textContent?.trim())).toBe(true);
    // The legend draws the same chip the cards use, so the two cannot drift apart.
    expect(document.querySelector("[data-legend=sidebar] [data-status=ahead]")?.textContent?.trim()).toBe("2");
    await fireEvent.input(screen.getByPlaceholderText("Search help"), { target: { value: "not pulled" } });
    await tick();
    expect(screen.getByText("Sidebar", { selector: "span" })).toBeTruthy();
  });
});
