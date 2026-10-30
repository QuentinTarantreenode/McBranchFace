// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { clearMocks, installBackend } from "../test/backend";
import { api, errorText, explainError, isFailure } from "./api";
import { i18n } from "./i18n/index.svelte";

beforeAll(() => i18n.set("En"));
afterEach(() => clearMocks());

describe("api", () => {
  it("maps every call to its command with camel-case arguments", async () => {
    const backend = installBackend();
    const calls: [keyof typeof api, unknown[]][] = [
      ["exportConfig", ["p"]], ["importConfig", ["p"]], ["stashStat", ["r", "s"]], ["exportReport", ["p", "c"]],
      ["pruneTracking", ["r", "origin", "b"]], ["restoreBranch", ["id"]], ["purgeBackups", [["id"]]], ["backupsSize", []],
      ["checkoutDefault", ["r"]], ["gitLog", ["r", "HEAD", 0, 10, null]], ["commitDetail", ["r", "s"]], ["branchList", ["r"]],
      ["workingDiff", ["r", "f", "Staged", false]], ["commitDiff", ["r", "s", "f", true]], ["gitSwitch", ["r", "t", false, "Keep"]],
      ["gitCreateBranch", ["r", "n", null, true]], ["gitStage", ["r", ["a"]]], ["gitUnstage", ["r", ["a"]]], ["gitDiscard", ["r", ["a"], []]],
      ["gitCommit", ["r", "m", false, false]], ["gitRemote", ["r", "Fetch", "id"]], ["gitClone", ["u", "t", "id"]], ["gitCancel", ["id"]], ["openFolder", ["p"]],
      ["appInfo", []], ["openUrl", ["u"]], ["openTerminal", ["p"]], ["openGithubDesktop", ["p"]], ["runToolCommand", ["Git", "Install"]],
      ["deleteBranch", [{}]], ["deleteRemoteBranches", [[]]], ["serverHeads", [["p"]]], ["fetchRepo", ["p"]], ["watchRepos", [["p"]]],
      ["freeCopyFolders", ["r", "agent", 2]], ["checkCopyTargets", ["r", "Worktree", []]], ["createWorkingCopies", ["r", "Clone", "main", [], "id"]],
      ["removeWorktree", ["r", "w", false]],
    ];
    for (const [name, args] of calls) await (api[name] as (...a: unknown[]) => Promise<unknown>)(...args);
    expect(backend.calls.map((c) => c.cmd)).toContain("git_create_branch");
    expect(backend.called("git_create_branch")[0]).toEqual({ path: "r", name: "n", start: null, switch: true });
    expect(new Set(backend.calls.map((c) => c.cmd)).size).toBe(calls.length);
  });

  it("explains every kind of error in words", () => {
    expect(explainError({ code: "Network", detail: "timeout" })).toEqual({ text: "Server not reachable.", detail: "Check the network or VPN and try again. · timeout" });
    expect(explainError({ code: "Other", detail: "" }).text).toBe("Error");
    expect(explainError({ kind: "Lock", detail: "index.lock" }).text).toBeTruthy();
    expect(explainError({ kind: "Nonsense" }).text).toBe("Unexpected error");
    expect(explainError(new Error("boom"))).toEqual({ text: "Unexpected error", detail: "boom" });
    expect(explainError(new Error(""))).toEqual({ text: "Unexpected error", detail: undefined });
    expect(explainError(42)).toEqual({ text: "Unexpected error", detail: "42" });
    expect(errorText("plain")).toBe("plain");
    expect(errorText({ code: "PathMissing", detail: "C:/x" })).toContain("C:/x");
    expect(isFailure(null)).toBe(false);
  });
});
