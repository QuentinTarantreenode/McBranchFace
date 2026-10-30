// @vitest-environment jsdom
// Custom commands: their settings page, the runs panel with live output, and the question before one.
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/svelte";
import { tick } from "svelte";
import { emit } from "@tauri-apps/api/event";
import { store } from "$lib/store.svelte";
import { commandRuns } from "$lib/stores/commandRuns.svelte";
import { config } from "../../test/backend";
import { A, backend, CMD, start } from "../../test/views";
import { waitFor } from "../../test/wait";
import AskDialog from "./AskDialog.svelte";
import RunsPanel from "./RunsPanel.svelte";
import SettingsDialog from "./SettingsDialog.svelte";

vi.mock("@lucide/svelte", async () => (await import("../../test/icons")).iconModule());

describe("custom commands", () => {
  it("commands tab edits, inserts placeholders, previews and removes", async () => {
    await start({ get_config: () => config({ language: "En", commands: [CMD as never] }), preview_custom_command: (a) => `rendered: ${a.script}` });
    store.openSettings("commands");
    render(SettingsDialog);
    expect(await screen.findByText("Custom commands")).toBeTruthy();
    expect(await screen.findByText(/rendered: git status/)).toBeTruthy();
    await fireEvent.click(screen.getByRole("button", { name: "{{repo}}" }));
    await fireEvent.click(screen.getByRole("tab", { name: "cmd" }));
    await fireEvent.click(screen.getByRole("tab", { name: "Selected only" }));
    await fireEvent.click(screen.getByRole("checkbox", { name: "a" }));
    await fireEvent.click(screen.getByRole("button", { name: "Duplicate" }));
    await fireEvent.click(screen.getAllByRole("button", { name: "Move up" })[1]);
    await fireEvent.click(screen.getByRole("button", { name: "New command" }));
    await fireEvent.click(screen.getAllByRole("button", { name: "Remove" })[2]);
    await fireEvent.click(screen.getByRole("button", { name: "Save" }));
    const saved = () => backend.called("save_config").at(-1)!.config as { commands: { name: string; script: string; shell: string; repos: string[] }[] };
    await waitFor(() => expect(saved().commands.map((c) => c.name)).toEqual(["Status 2", "Status"]));
    expect(saved().commands[1]).toMatchObject({ shell: "Cmd", repos: [A.identity] });
    expect(saved().commands[1].script).toContain("{{repo}}");
  });

  it("commands tab edits the dialog's draft as a bound prop, so Svelte reports no foreign mutation", async () => {
    const warn = vi.spyOn(console, "warn");
    try {
      await start({ get_config: () => config({ language: "En", commands: [CMD as never] }), preview_custom_command: (a) => `rendered: ${a.script}` });
      store.openSettings("commands");
      render(SettingsDialog);
      await fireEvent.click(await screen.findByRole("button", { name: "New command" }));
      await fireEvent.click(screen.getAllByRole("button", { name: "Move up" })[1]);
      await fireEvent.click(screen.getAllByRole("button", { name: "Remove" })[0]);
      expect(screen.getAllByRole("button", { name: "Remove" })).toHaveLength(1);
      expect(warn.mock.calls.flat().join("\n")).not.toMatch(/ownership_invalid/);
    } finally {
      warn.mockRestore();
    }
  });

  it("runs panel lists runs, opens the output, cancels and runs again", async () => {
    let n = 8;
    await start({ get_config: () => config({ language: "En", commands: [CMD as never] }), run_custom_command: () => `run-${++n}` });
    commandRuns.runCommand(CMD as never, A.path, null);
    // Output reaches a run once the backend named it.
    await waitFor(() => expect(commandRuns.runs.map((r) => r.runId)).toEqual(["run-9"]));
    render(RunsPanel);
    await tick();
    await emit("command-output", { runId: "run-9", lines: [{ text: "line one", err: false }, { text: "warn", err: true }] });
    await fireEvent.click(screen.getByText("Status"));
    expect(await screen.findByText("line one")).toBeTruthy();
    await fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(backend.called("cancel_custom_command")).toEqual([{ runId: "run-9" }]));
    await emit("command-done", { runId: "run-9", code: 0, error: null, durationMs: 1500 });
    // Ended: the run offers to go again.
    const again = await screen.findByRole("button", { name: "Run again" });
    await fireEvent.click(screen.getByRole("button", { name: "Copy output" }));
    await fireEvent.click(again);
    await waitFor(() => expect(backend.called("run_custom_command")).toHaveLength(2));
    await fireEvent.click(screen.getByRole("button", { name: "Collapse" }));
    await fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(commandRuns.openRun).toBeNull();
  });

  it("asks before a command that wants confirmation", async () => {
    await start({ get_config: () => config({ language: "En" }), run_custom_command: () => "run-a" });
    commandRuns.runCommand({ ...CMD, confirm: true } as never, A.path, null);
    render(AskDialog);
    await tick();
    expect(screen.getByText(/Run “Status”\?/)).toBeTruthy();
    await fireEvent.click(screen.getByRole("button", { name: "Run" }));
    await waitFor(() => expect(backend.called("run_custom_command")).toHaveLength(1));
    expect(store.ask).toBeNull();
  });
});
