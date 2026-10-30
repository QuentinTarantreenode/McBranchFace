// @vitest-environment jsdom
// Custom commands: which ones a repo offers, runs with live output, why one failed, the question before one.
import { describe, expect, it, vi } from "vitest";
import { emit } from "@tauri-apps/api/event";
import { config, repo, result } from "../../test/backend";
import { backend, commandRuns, start, store, storeTests } from "../../test/store";
import { waitFor } from "../../test/wait";

// Only the menu helpers need icons; loading the whole icon package would dominate the run time.
vi.mock("@lucide/svelte", () => ({ Eye: {}, EyeOff: {} }));

const A = repo("C:/ws/a");
const B = repo("C:/ws/b");

storeTests();

describe("custom commands", () => {
  const cmd = (over = {}) => ({ id: "c1", name: "Status", script: "git status", shell: "Default", mode: "Background", repos: [], branches: false, confirm: false, ...over }) as never;

  it("offer commands by repo and on branches only when asked for", async () => {
    await start({
      get_config: () => config({ commands: [cmd(), cmd({ id: "c2", name: "Only B", repos: [B.identity] }), cmd({ id: "c3", name: "Branch", branches: true })] }),
      cached_results: () => [result(A), result(B)],
    });
    expect(commandRuns.commandsFor(A.path).map((c) => c.id)).toEqual(["c1", "c3"]);
    expect(commandRuns.commandsFor(B.path).map((c) => c.id)).toEqual(["c1", "c2", "c3"]);
    expect(commandRuns.commandsFor(A.path, "x").map((c) => c.id)).toEqual(["c3"]);
  });

  it("run in the background with live output, then report the end", async () => {
    await start({ run_custom_command: () => "run-1" });
    commandRuns.runCommand(cmd(), A.path, null);
    await waitFor(() => expect(commandRuns.runs[0]?.status).toBe("running"));
    await emit("command-output", { runId: "run-1", lines: [{ text: "clean", err: false }] });
    await emit("command-output", { runId: "other", lines: [{ text: "x", err: false }] });
    await emit("command-done", { runId: "run-1", code: 0, error: null, durationMs: 12 });
    await waitFor(() => expect(commandRuns.runs[0]).toMatchObject({ status: "ok", code: 0, durationMs: 12 }));
    expect(commandRuns.runs[0].lines.map((l) => l.text)).toEqual(["clean"]);
    commandRuns.clearRuns();
    expect(commandRuns.runs).toEqual([]);
  });

  it("name why a run failed and offer its output", async () => {
    let n = 0;
    await start({ run_custom_command: () => `run-${++n}` });
    for (let i = 0; i < 4; i++) commandRuns.runCommand(cmd(), A.path, null);
    await waitFor(() => expect(commandRuns.runs).toHaveLength(4));
    await emit("command-done", { runId: "run-1", code: 2, error: null, durationMs: 1 });
    await emit("command-done", { runId: "run-2", code: null, error: "timeout", durationMs: 1 });
    await emit("command-done", { runId: "run-3", code: null, error: "missing:pwsh", durationMs: 1 });
    await emit("command-done", { runId: "run-4", code: null, error: "cancelled", durationMs: 1 });
    await emit("command-done", { runId: "nope", code: 0, error: null, durationMs: 1 });
    await waitFor(() => expect(commandRuns.runs.map((r) => r.status)).toEqual(["cancelled", "failed", "failed", "failed"]));
    const errors = store.toasts.filter((t) => t.kind === "error");
    // The same message for several runs is shown once, and it names and opens the run that failed last.
    expect(errors).toHaveLength(1);
    expect(errors[0].detail).toContain("pwsh");
    errors[0].action!.run();
    expect(commandRuns.openRun).toBe("run-3");
    commandRuns.cancelRun("run-1");
    await waitFor(() => expect(backend.called("cancel_custom_command")).toEqual([{ runId: "run-1" }]));
  });

  it("ask first when the command says so, and say where a terminal command runs", async () => {
    await start({ run_custom_command: () => "run-t" });
    commandRuns.runCommand(cmd({ confirm: true, mode: "Terminal" }), A.path, "feature/x");
    expect(store.ask?.detail).toBe(`feature/x · ${A.path}`);
    await store.ask!.run();
    await waitFor(() => expect(store.toasts.at(-1)?.kind).toBe("info"));
    expect(backend.called("run_custom_command")).toEqual([{ id: "c1", repoPath: A.path, branch: "feature/x" }]);
    expect(commandRuns.runs).toEqual([]);
    expect(store.toasts.at(-1)?.kind).toBe("info");
  });

  it("report a command that cannot start", async () => {
    await start({ run_custom_command: () => { throw { code: "UnknownPlaceholder", detail: "{{nope}}" }; } });
    commandRuns.runCommand(cmd(), A.path, null);
    await waitFor(() => expect(store.toasts.at(-1)?.text).toBe("Unbekannter Platzhalter im Befehl."));
  });
});
