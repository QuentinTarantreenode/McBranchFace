// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { emit } from "@tauri-apps/api/event";
import { clearMocks, flush, installBackend } from "../../test/backend";
import { waitFor } from "../../test/wait";

vi.mock("@lucide/svelte", () => ({ Eye: {}, EyeOff: {} }));

afterEach(() => clearMocks());

describe("the backend's external calls in the activity", () => {
  it("switched on and off again before the listeners were there: none of them stays", async () => {
    installBackend();
    vi.resetModules();
    await (await import("../i18n/index.svelte")).i18n.set("En");
    const { activity } = await import("./activity.svelte");
    const { watch } = await import("./activityProcess");
    const begin = vi.spyOn(activity, "begin");
    const on = watch(true);
    const off = watch(false);
    await Promise.all([on, off]);
    await emit("process-started", { id: 1, program: "git", args: ["status"], cwd: "C:/ws/a" });
    await flush();
    expect(begin).not.toHaveBeenCalled();
    await watch(true);
    await emit("process-started", { id: 2, program: "git", args: ["status"], cwd: "C:/ws/a" });
    await waitFor(() => expect(begin).toHaveBeenCalledTimes(1));
    await watch(false);
  });
});
