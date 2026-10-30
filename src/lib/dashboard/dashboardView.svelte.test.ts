// @vitest-environment jsdom
// The dashboard as the app starts on it: what is due, where a line leads, and putting a step aside.
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/svelte";
import { store } from "$lib/store.svelte";
import { gitStatus } from "$lib/stores/gitStatus.svelte";
import { A, start } from "../../test/views";
import { waitFor } from "../../test/wait";
import DashboardView from "./DashboardView.svelte";

vi.mock("@lucide/svelte", async () => (await import("../../test/icons")).iconModule());

describe("dashboard", () => {
  it("starts on the dashboard, lists what is due, opens what a line names, and puts a step aside", async () => {
    await start();
    expect(store.config?.ui.perspective).toBe("Dashboard");
    await gitStatus.refreshStatus(A.path);
    render(DashboardView);
    // Four changed files: a row of the table says what, why, where and how much, and its button says what it does.
    const dirty = await screen.findAllByText("Not committed");
    const before = dirty.length;
    const row = dirty.map((d) => d.closest("[role=row]") as HTMLElement).find((r) => r.textContent!.includes("4 files"))!;
    expect(within(row).getByText("These changes are in no commit yet.")).toBeTruthy();
    expect(within(row).getByRole("button", { name: "View changes" })).toBeTruthy();
    // The chevron unfolds the files in place; the row itself leads to them in Git.
    await fireEvent.click(within(row).getByRole("button", { name: "Show details" }));
    await waitFor(() => expect(row.nextElementSibling?.querySelector("[role=table]")).toBeTruthy());
    expect(store.config?.ui.perspective).toBe("Dashboard");
    await fireEvent.click(within(row).getByText("These changes are in no commit yet."));
    await waitFor(() => expect(store.config?.ui.perspective).toBe("Git"));
    await fireEvent.click(within(row).getByRole("button", { name: "Put aside" }));
    await waitFor(() => expect(screen.queryAllByText("Not committed")).toHaveLength(before - 1));
    expect(Object.keys(store.config?.ui.dashboardDismissed ?? {})).toHaveLength(1);
    // The cleanup tile opens the table on a lens.
    store.setUi({ perspective: "Dashboard" });
    await fireEvent.click(await screen.findByRole("button", { name: /Server merged/ }));
    expect(store.config?.ui.perspective).toBe("Cleanup");
    expect(store.scope).toBe("Online");
  });
});
