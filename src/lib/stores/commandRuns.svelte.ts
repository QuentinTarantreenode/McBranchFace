// The user's own commands as they run: their output, their end, and which one is open.
import { api } from "$lib/api";
import type { CommandDone } from "$lib/bindings/CommandDone";
import type { CommandOutput } from "$lib/bindings/CommandOutput";
import type { CustomCommand } from "$lib/bindings/CustomCommand";
import type { OutputLine } from "$lib/bindings/OutputLine";
import { t } from "$lib/i18n/index.svelte";
import { PROBED } from "$lib/probe";
import { toasts } from "./toasts.svelte";
import { settings } from "./settings.svelte";
import { dialogs } from "./dialogs.svelte";
import { scanResults } from "./scanResults.svelte";

export interface CommandRun {
  runId: string;
  command: CustomCommand;
  repoPath: string;
  branch: string | null;
  status: "running" | "ok" | "failed" | "cancelled";
  code: number | null;
  error: string | null;
  lines: OutputLine[];
  durationMs: number | null;
}

/** Runs kept in memory; older ones drop off. */
const KEEP_RUNS = 20;
/** Lines kept per run, so a chatty script cannot fill the memory. */
const KEEP_LINES = 20_000;

class CommandRuns {
  // Raw, and a changed run is a new object: a chatty script sends thousands of lines, and a deep proxy
  // over every one of them made each output event cost more the longer the run went.
  runs = $state.raw<CommandRun[]>([]);
  /** The run whose output is open. */
  openRun = $state<string | null>(null);
  /** Height of the runs panel, so toasts stack above it instead of covering it. */
  runsPanelHeight = $state(0);

  resetForTests() {
    this.runs = [];
    this.openRun = null;
    this.runsPanelHeight = 0;
  }

  /** Commands offered for a repository, or for a branch when `branch` is given. */
  commandsFor(repoPath: string, branch: string | null = null): CustomCommand[] {
    const id = scanResults.identityOf(repoPath);
    return (settings.config?.commands ?? []).filter((c) => (branch === null || c.branches) && (c.repos.length === 0 || (!!id && c.repos.includes(id))));
  }

  runCommand(command: CustomCommand, repoPath: string, branch: string | null = null) {
    const go = () => this.startCommand(command, repoPath, branch);
    if (!command.confirm) return go();
    const where = branch ? `${branch} · ${repoPath}` : repoPath;
    dialogs.ask = { title: t.commands.confirmTitle(command.name), text: t.commands.confirmText, detail: where, action: t.commands.run, run: go };
  }

  private async startCommand(command: CustomCommand, repoPath: string, branch: string | null) {
    let runId: string;
    try {
      runId = await api.runCustomCommand(command.id, repoPath, branch);
    } catch (e) {
      toasts.fail(e);
      return;
    }
    if (command.mode === "Terminal") {
      toasts.toast("info", t.commands.inTerminal(command.name));
      return;
    }
    const run: CommandRun = { runId, command, repoPath, branch, status: "running", code: null, error: null, lines: [], durationMs: null };
    this.runs = [run, ...this.runs].slice(0, KEEP_RUNS);
  }

  cancelRun(runId: string) {
    api.cancelCustomCommand(runId).catch((e) => toasts.fail(e));
  }

  /** Replaces the run with `runId` by what `change` makes of it; null when there is none. */
  private update(runId: string, change: (r: CommandRun) => CommandRun): CommandRun | null {
    const i = this.runs.findIndex((x) => x.runId === runId);
    if (i < 0) return null;
    const next = change(this.runs[i]);
    this.runs = this.runs.with(i, next);
    return next;
  }

  output(e: CommandOutput) {
    this.update(e.runId, (r) => {
      const lines = r.lines.concat(e.lines);
      return { ...r, lines: lines.length > KEEP_LINES ? lines.slice(lines.length - KEEP_LINES) : lines };
    });
  }

  done(e: CommandDone) {
    const status = e.error === "cancelled" ? "cancelled" : e.error === null && e.code === 0 ? "ok" : "failed";
    const r = this.update(e.runId, (r) => ({ ...r, durationMs: e.durationMs, code: e.code, error: e.error, status }));
    if (!r) return;
    if (r.status === "failed") {
      const why = e.error?.startsWith("missing:") ? t.commands.missingShell(e.error.slice(8)) : e.error === "timeout" ? t.commands.timedOut : t.commands.exitCode(e.code ?? -1);
      toasts.toast("error", t.commands.failed(r.command.name), { detail: why, action: { label: t.commands.showOutput, run: () => (this.openRun = r.runId) } });
    }
  }

  clearRuns() {
    this.runs = this.runs.filter((r) => r.status === "running");
    this.openRun = null;
  }
}

export const commandRuns = new CommandRuns();
if (PROBED) (globalThis as Record<string, unknown>).__mbfCommandRuns = commandRuns;
