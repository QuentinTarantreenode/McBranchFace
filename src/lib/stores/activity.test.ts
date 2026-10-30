// @vitest-environment jsdom
// The activity: background work recorded only while shown or logged, named in the top bar, written to the log.
import { describe, expect, it, vi } from "vitest";
import { config, repo, result } from "../../test/backend";
import { backend, gitStatus, start, storeTests } from "../../test/store";
import { waitFor } from "../../test/wait";

// Only the menu helpers need icons; loading the whole icon package would dominate the run time.
vi.mock("@lucide/svelte", () => ({ Eye: {}, EyeOff: {} }));

const A = repo("C:/ws/a");

storeTests();

describe("activity", () => {
  it("records nothing in the background while neither shown nor logged", async () => {
    await start({ cached_results: () => [result(A, [])] });
    const { activity } = await import("$lib/stores/activity.svelte");
    await gitStatus.refreshStatus(A.path);
    expect(activity.recent).toEqual([]);
    expect(activity.begin("x", A.path)).toBe(0);
  });

  it("names background work in the top bar and writes it to the log when that is on", async () => {
    // Lines are written once a second at most: the test moves that second on itself.
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    await start({ get_config: () => config({ diagnostics: true, ui: { ...config().ui, activityShown: true } }), cached_results: () => [result(A, [])], diagnostics_note: () => null });
    const { activity } = await import("$lib/stores/activity.svelte");
    const id = activity.begin("Reading status", A.path);
    expect(activity.front?.text).toBe("Reading status");
    expect(activity.front?.id).toBe(id);
    activity.end(id, "failed", "no repo");
    expect(activity.recent[0].outcome).toBe("failed");
    vi.advanceTimersByTime(1000);
    const lines = () => backend.called("diagnostics_note").flatMap((a) => a.lines as string[]);
    await waitFor(() => expect(lines().some((l) => l.includes("failed") && l.includes("Reading status") && l.includes(A.path) && l.includes("no repo"))).toBe(true));
  });
});
