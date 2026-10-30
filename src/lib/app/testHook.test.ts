// @vitest-environment jsdom
// The quiescence hook the CDP scripts wait on: idle only when nothing runs or waits, and a log of what the
// user was told and how operations ended.
import { afterEach, describe, expect, it, vi } from "vitest";
import { branch, flush, installBackend, outcome, repo, result } from "../../test/backend";

vi.mock("@lucide/svelte", () => ({ Eye: {}, EyeOff: {} }));

const A = repo("C:/ws/a");

/** An answer that comes when the test lets it. */
function gate<T>() {
  let open!: (v: T) => void;
  const answer = new Promise<T>((r) => (open = r));
  return { answer, open };
}

let dispose = () => {};
afterEach(() => dispose());

describe("test hook", () => {
  it("idle_waits_for_invokes_timers_rescans_and_claims", async () => {
    const backend = installBackend({ cached_results: () => [result(A, [branch(A.path, "x")])] });
    vi.resetModules();
    const { install, testApi } = await import("./testHook.svelte");
    const { store } = await import("$lib/store.svelte");
    const { gitClaims } = await import("$lib/stores/gitClaims.svelte");
    install();
    expect((globalThis as Record<string, unknown>).__mbfTest).toBe(testApi);
    expect((globalThis as Record<string, unknown>).__mbfStore).toBe(store);
    const { idle, when, events } = testApi;
    await store.init();
    dispose = () => store.dispose();
    // The start: two scans, statuses, the watcher. Quiet once all of them ended.
    await when(idle);
    expect(store.scanning).toBe(false);

    // A command in flight: a reassessment whose answer is still on its way.
    const rescan = gate<unknown>();
    backend.handlers.rescan_repo = () => rescan.answer;
    const reassessed = store.rescan(A.path);
    expect(idle()).toBe(false);
    rescan.open(result(A, [branch(A.path, "y")]));
    await reassessed;
    await when(idle);
    expect(store.allBranches.map((b) => b.name)).toEqual(["y"]);

    // A timer some work waits for: the quiet save of a layout change, a moment later.
    store.setUi({ sidebarWidth: 300 });
    expect(idle()).toBe(false);
    const saves = backend.called("save_config").length;
    await when(idle);
    expect(backend.called("save_config").length).toBe(saves + 1);

    // A scan: not idle from its start to its end, its queued follow-up included.
    const scan = gate<unknown>();
    backend.handlers.scan = () => scan.answer;
    const scanned = store.scan(false);
    expect(idle()).toBe(false);
    let quiet = false;
    const settled = when(idle).then(() => (quiet = true));
    await flush();
    expect(quiet).toBe(false);
    scan.open({ durationMs: 1, repoCount: 1 });
    await scanned;
    await settled;
    expect(idle()).toBe(true);

    // A git operation holds its repos: not idle until it lets them go.
    expect(gitClaims.gitStart([A.path], "push")).toBe(true);
    expect(idle()).toBe(false);
    gitClaims.gitEnd([A.path]);
    expect(idle()).toBe(true);

    // A delete that runs: idle once it is done and the repo is reassessed.
    const deleted = gate<unknown>();
    backend.handlers.delete_branch = () => deleted.answer;
    backend.handlers.rescan_repo = () => result(A, []);
    await store.openDelete(store.allBranches);
    const deleting = store.runDelete();
    await flush();
    expect(store.deleteJob?.phase).toBe("running");
    expect(idle()).toBe(false);
    deleted.open(outcome({ repoPath: A.path, name: "y" }));
    await deleting;
    await when(idle);
    expect(store.allBranches).toEqual([]);

    // The log: what the user was told and how the operations ended, in order, reads left out.
    const ops = events.filter((e) => e.kind === "op").map((e) => [e.text, e.ok]);
    expect(ops).toContainEqual(["rescan_repo", true]);
    expect(ops).toContainEqual(["save_config", true]);
    expect(ops).toContainEqual(["delete_branch", true]);
    expect(ops.some(([text]) => text === "repo_status" || text === "get_config")).toBe(false);
    expect(events.map((e) => e.seq)).toEqual(events.map((_, i) => i + 1));
    expect(events.find((e) => e.text === "delete_branch")?.result).toMatchObject({ entry: { branch: "y" } });

    // A failed operation names its failure, and its toast is in the log too.
    backend.handlers.git_fast_forward = () => Promise.reject({ kind: "Diverged", op: "FastForward", detail: "", path: null, changed: false });
    await store.fastForward(branch(A.path, "z"));
    await when(idle);
    expect(events.find((e) => e.text === "git_fast_forward")).toMatchObject({ kind: "op", ok: false, detail: "Diverged" });
    expect(events.at(-2)).toMatchObject({ kind: "toast", level: "error" });
  });

  it("busy_names_what_runs_report_keeps_the_last_commands_and_tick_runs_the_periodic_work_once", async () => {
    const backend = installBackend({ cached_results: () => [result(A, [branch(A.path, "x")], [])], server_heads: () => [] });
    vi.resetModules();
    const { testApi } = await import("./testHook.svelte");
    const { store } = await import("$lib/store.svelte");
    await store.init();
    dispose = () => store.dispose();
    const { idle, when, busy, report, tick } = testApi;
    await when(idle);
    expect(busy()).toEqual({});

    // What runs, by name; the report has it with its arguments, and keeps it after it ended.
    const rescan = gate<unknown>();
    backend.handlers.rescan_repo = () => rescan.answer;
    const reassessed = store.rescan(A.path);
    expect(busy()).toMatchObject({ invokes: ["rescan_repo"] });
    expect(report().running.map((i) => i.command)).toEqual(["rescan_repo"]);
    rescan.open(result(A, [branch(A.path, "x")], []));
    await reassessed;
    await when(idle);
    const done = report().invokes.find((i) => i.command === "rescan_repo")!;
    expect(done).toMatchObject({ ok: true });
    expect(JSON.parse(done.args)).toMatchObject({ path: A.path });
    expect(done.ms).toBeGreaterThanOrEqual(0);
    expect(report().running).toEqual([]);

    // The periodic work runs once when called as its interval would; before the interval passed it does nothing.
    await tick("serverCheck");
    expect(backend.called("server_heads")).toHaveLength(0);
    await tick("serverCheck", Date.now() + 6 * 60_000);
    expect(backend.called("server_heads")).toEqual([{ paths: [A.path] }]);
    const scans = backend.called("scan").length;
    await tick("autoFetch", Date.now() + 31 * 60_000);
    await when(idle);
    expect(backend.called("scan").slice(scans)).toEqual([expect.objectContaining({ fetch: true })]);
  });

  it("when rejects a condition that is never met, and counts a throwing one as not met", async () => {
    installBackend();
    vi.resetModules();
    const { testApi } = await import("./testHook.svelte");
    await expect(
      testApi.when(() => {
        throw new Error("not there yet");
      }, 120),
    ).rejects.toThrow("120 ms");
  });
});

// The scripts that drive the app over CDP, and the tests, read the facade by the names the one store object had.
const FORMER = `addRoot addRoots allBranches allOnline annotate annotationOf applyLens ask backgroundFailures bellCount busy checked checkedOnline
checkedSafe checkoutAndDelete checkoutDefault clearIgnore closeDelete columns commitSearchOpen commitsView config copiesFor copy copyLabel copyLabelBeside
counts deletable deletableKeys deleteJob deleted deletedOpen dialogSize dismiss dispose doneRepos envChecked envChecking excludedRepos facetActive
facetCounts fail fastForward filters focusBranches focusRepo gitRepo githubDesktop groupKeyOf groupOf grouped groups helpAt helpOpen hourClock
identityOf ignoreOf init isPending isRepoLocked isSectionOpen lastDurationMs lensCounts lensKeysById lenses loadDeleted loaded localCopiesOf
localCountOf localInView moveRoot moveSelection needsOnboarding now onlineCounts onlineIgnored onlineLocked onlinePending onlineState onlineVisible
openChanges openCopies openDelete openHistory openOnlineDelete openSettings orphaned orphanedOnly prefixCounts purge push refreshEnvironment
refreshOnline removeIgnore removeRoot removeWorktree removeWorktrees repoByPath repoLabel repos request rescan rescanAll resetFilters resolvedTheme
restore resultOf results retryDelete rows runDelete runTool safely saveConfig saveWith scan scanKind scannedAt scanning scope sectionOpen selectKey
selected selectedKey selectedOnline setAlerts setAlwaysOnTop setAnnotation setColumns setIgnore setLanguage setLock setOnlineExcluded setRepoGroups
setScale setScope setSectionOpen setSort setTheme setUi settingsOpen settingsTab shortcutsOpen show sort stage stashApply stashDrop tableGroup
tableRows tags toast toasts toggleChecked toggleFacet toggleGroup toggleHelp toggleOnlineVerdict togglePrefixFilter toggleTagFilter toggleVerdict
tool tools trayStatus underRoots undoDelete updateResult visible visibleIgnored visibleLocked windowCaps`.split(/\s+/);
const scripts = import.meta.glob<string>(["/scripts/*.mjs", "/scripts/e2e/**/*.mjs", "/scripts/audit/*.js"], { query: "?raw", import: "default", eager: true });

describe("store facade", () => {
  it("keeps every name of the former store, and every one the CDP scripts read", async () => {
    const { store } = await import("$lib/store.svelte");
    // The e2e scenarios write the facade as `${S}` (scripts/e2e/scenarios/common.mjs).
    const used = new Set(Object.values(scripts).flatMap((text) => [...text.matchAll(/(?:__mbfStore|\$\{S\})\.([A-Za-z_$][\w$]*)/g)].map((m) => m[1])));
    expect(used.size).toBeGreaterThan(5);
    expect([...FORMER, ...used].filter((n) => !(n in store))).toEqual([]);
  });
});
