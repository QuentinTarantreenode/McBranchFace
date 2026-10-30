// The app's state under the names one object once gave it, for tests and the scripts that drive the app
// over CDP (`window.__mbfStore`). Nothing here holds state or logic: every name hands through to the module
// that owns it. The app itself imports those modules; this file is never part of the release bundle.
import { bootstrap } from "./app/bootstrap.svelte";
import type { BranchReport } from "./bindings/BranchReport";
import type { DeleteRequest } from "./bindings/DeleteRequest";
import { deleteRequest } from "./deleteFlow";
import type { Filters } from "./filter";
import { deleting } from "./services/deleting";
import { navigation } from "./services/navigation";
import { repoActions } from "./services/repoActions.svelte";
import { scanner } from "./services/scanner.svelte";
import { activity } from "./stores/activity.svelte";
import { branchCommits } from "./stores/branchCommits.svelte";
import { cleanupView } from "./stores/cleanupView.svelte";
import { clock } from "./stores/clock.svelte";
import { commandRuns } from "./stores/commandRuns.svelte";
import { deletes } from "./stores/deletes.svelte";
import { dialogs } from "./stores/dialogs.svelte";
import { environment } from "./stores/environment.svelte";
import { gitClaims } from "./stores/gitClaims.svelte";
import { gitStatus } from "./stores/gitStatus.svelte";
import { identities } from "./stores/identities.svelte";
import { layout } from "./stores/layout.svelte";
import { lenses } from "./stores/lenses.svelte";
import { pullRequests } from "./stores/pullRequests.svelte";
import { repoSelection } from "./stores/repoSelection.svelte";
import { rules } from "./stores/rules.svelte";
import { scanResults } from "./stores/scanResults.svelte";
import { settings } from "./stores/settings.svelte";
import { sidebarSelection } from "./stores/sidebarSelection.svelte";
import { sidebarUi } from "./stores/sidebarUi.svelte";
import { toasts } from "./stores/toasts.svelte";
import { triggers } from "./stores/triggers.svelte";
import { dashboard } from "./dashboard/dashboard.svelte";

/** Names of an owner as the facade shows them: the same name, or the owner's own when it differs. */
type Names<T> = readonly (keyof T)[] | Readonly<Partial<Record<string, keyof T>>>;

/** Each name reads and writes the owner's member; a method comes bound to its owner. */
function expose<T extends object>(facade: object, owner: T, names: Names<T>) {
  const pairs = Array.isArray(names) ? names.map((n) => [n, n] as const) : Object.entries(names);
  for (const [name, member] of pairs) {
    Object.defineProperty(facade, name as string, {
      enumerable: true,
      get: () => {
        const v = owner[member as keyof T];
        return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(owner) : v;
      },
      set: (v: unknown) => {
        (owner as Record<keyof T, unknown>)[member as keyof T] = v;
      },
    });
  }
}

const TOASTS = ["toast", "fail", "safely", "copy", "dismiss"] as const;
const SETTINGS = ["config", "setUi", "saveConfig", "saveWith", "setAlerts", "setTheme", "setScale", "setLanguage", "setAlwaysOnTop", "dialogSize", "resolvedTheme"] as const;
const ENVIRONMENT = ["tools", "envChecked", "envChecking", "githubDesktop", "windowCaps", "needsOnboarding", "refreshEnvironment", "tool", "runTool"] as const;
const DIALOGS = ["settingsOpen", "settingsTab", "helpOpen", "helpAt", "shortcutsOpen", "deletedOpen", "commitSearchOpen", "copiesFor", "commitsView", "ask", "openSettings", "toggleHelp", "openCopies"] as const;
const CLOCK = ["now", "hourClock"] as const;
const RESULTS = [
  "repos", "results", "loaded", "repoByPath", "groups", "resultOf", "identityOf", "groupOf", "copyLabel", "copyLabelBeside", "repoLabel", "allBranches", "allOnline",
  "onlineState", "localCopiesOf", "localCountOf", "isPending", "backgroundFailures", "updateResult",
] as const;
const RULES = ["tags", "excludedRepos", "annotate", "isRepoLocked", "setLock", "setIgnore", "clearIgnore", "removeIgnore", "ignoreOf", "annotationOf", "setAnnotation"] as const;
const SELECTION = ["focusRepo", "gitRepo"] as const;
const CLEANUP = [
  "selectedKey", "checked", "sort", "busy", "scope", "orphaned", "orphanedOnly", "tableGroup", "localInView", "visible", "visibleIgnored", "visibleLocked", "counts", "prefixCounts",
  "selected", "checkedSafe", "onlineVisible", "onlineIgnored", "onlineLocked", "onlineCounts", "selectedOnline", "checkedOnline", "facetCounts", "toggleFacet", "facetActive",
  "togglePrefixFilter", "toggleTagFilter", "toggleVerdict", "toggleOnlineVerdict", "resetFilters", "setFilters", "setSort", "columns", "setColumns", "groupKeyOf", "groupLabelOf",
  "grouped", "toggleGroup", "isSectionOpen", "setSectionOpen", "sectionOpen", "deletable", "deletableKeys", "tableRows", "rows", "selectKey", "moveSelection", "toggleChecked",
  "setScope", "applyLens", "focusBranches",
] as const;
const LENSES = ["lenses", "lensKeysById", "lensCounts", "bellCount", "trayStatus"] as const;
const DELETES = ["deleted", "deleteJob", "loadDeleted", "openDelete", "openOnlineDelete", "closeDelete"] as const;
const SCANNER = ["scanning", "scanKind", "stage", "onlinePending", "scannedAt", "lastDurationMs", "doneRepos", "scan", "rescan", "rescanAll", "refreshOnline"] as const;
const REPO_ACTIONS = [
  "push", "fastForward", "stashApply", "stashDrop", "checkoutDefault", "removeWorktree", "removeWorktrees", "underRoots", "addRoot", "addRoots", "removeRoot", "moveRoot",
  "setRepoGroups", "setOnlineExcluded",
] as const;
const DELETING = ["runDelete", "retryDelete", "undoDelete", "restore", "purge", "checkoutAndDelete"] as const;
const NAVIGATION = ["show", "openHistory", "openChanges"] as const;

type Facade = Pick<typeof toasts, (typeof TOASTS)[number]> &
  Pick<typeof settings, (typeof SETTINGS)[number]> &
  Pick<typeof environment, (typeof ENVIRONMENT)[number]> &
  Pick<typeof dialogs, (typeof DIALOGS)[number]> &
  Pick<typeof clock, (typeof CLOCK)[number]> &
  Pick<typeof scanResults, (typeof RESULTS)[number]> &
  Pick<typeof rules, (typeof RULES)[number]> &
  Pick<typeof repoSelection, (typeof SELECTION)[number]> &
  Pick<typeof cleanupView, (typeof CLEANUP)[number]> &
  Pick<typeof lenses, (typeof LENSES)[number]> &
  Pick<typeof deletes, (typeof DELETES)[number]> &
  Pick<typeof scanner, (typeof SCANNER)[number]> &
  Pick<typeof repoActions, (typeof REPO_ACTIONS)[number]> &
  Pick<typeof deleting, (typeof DELETING)[number]> &
  Pick<typeof navigation, (typeof NAVIGATION)[number]> & {
    /** The toasts on screen. */
    toasts: typeof toasts.list;
    /** The cleanup table's filters with the shared repo selection, as one object to read and write. */
    filters: Filters;
    allFilters: Filters;
    init(): Promise<void>;
    dispose(): void;
    /** Every store as at the start, for tests that keep one module instance across tests. */
    resetForTests(): void;
    /** The plain delete request of a local branch, with changes. */
    request(b: BranchReport, over?: Partial<DeleteRequest>): DeleteRequest;
  };

/** The filters as one object, the repos included: those go to the selection both perspectives share. */
const filtersView = new Proxy({} as Filters, {
  get: (_, k) => (k === "repos" ? repoSelection.repos : Reflect.get(cleanupView.filters, k)),
  set: (_, k, v) => {
    if (k === "repos") repoSelection.repos = v;
    else Reflect.set(cleanupView.filters, k, v);
    return true;
  },
  has: (_, k) => k === "repos" || Reflect.has(cleanupView.filters, k),
  ownKeys: () => [...Reflect.ownKeys(cleanupView.filters), "repos"],
  getOwnPropertyDescriptor: (_, k) => ({ configurable: true, enumerable: true, writable: true, value: k === "repos" ? repoSelection.repos : Reflect.get(cleanupView.filters, k) }),
});

/** Every store that keeps state of its own, by name: a test resets one, some or all of them. */
export const resettable = {
  toasts, settings, environment, dialogs, clock, scanResults, repoSelection, cleanupView, deletes, scanner, gitStatus, gitClaims, activity, commandRuns, pullRequests,
  identities, sidebarSelection, triggers, dashboard, branchCommits,
};

export const store = {
  get filters(): Filters {
    return filtersView;
  },
  set filters(f: Filters) {
    cleanupView.setFilters(f);
  },
  init: () => bootstrap.init(),
  request: (b: BranchReport, over: Partial<DeleteRequest> = {}) => ({ ...deleteRequest(b), ...over }),
  dispose: () => bootstrap.dispose(),
  resetForTests() {
    bootstrap.dispose();
    for (const s of Object.values(resettable)) s.resetForTests();
    sidebarUi.annotating = null;
    layout.tableTop = 0;
  },
} as Facade;

expose(store, toasts, { toasts: "list" });
expose(store, toasts, TOASTS);
expose(store, settings, SETTINGS);
expose(store, environment, ENVIRONMENT);
expose(store, dialogs, DIALOGS);
expose(store, clock, CLOCK);
expose(store, scanResults, RESULTS);
expose(store, rules, RULES);
expose(store, repoSelection, SELECTION);
expose(store, cleanupView, CLEANUP);
expose(store, cleanupView, { allFilters: "all" });
expose(store, lenses, LENSES);
expose(store, deletes, DELETES);
expose(store, scanner, SCANNER);
expose(store, repoActions, REPO_ACTIONS);
expose(store, deleting, DELETING);
expose(store, navigation, NAVIGATION);
