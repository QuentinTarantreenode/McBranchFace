// The cleanup table: its filters and sort, the lists they leave (local and on the server, with their
// ignored and locked sections), the groups and columns, what is selected and what is marked.
import { lensFilters, type Lens } from "$lib/alerts";
import type { CleanupScope } from "$lib/bindings/CleanupScope";
import type { ColumnPref } from "$lib/bindings/ColumnPref";
import type { OnlineVerdict } from "$lib/bindings/OnlineVerdict";
import type { TableGroup } from "$lib/bindings/TableGroup";
import type { Verdict } from "$lib/bindings/Verdict";
import { prefixStats } from "$lib/branchName";
import {
  branchKey, countByVerdict, countOnline, emptyFilters, facetCounts, facetField, filterBranches, filterOnline, isDeletable, isOrphaned, onlineKey,
  onlineVerdictMatches, prefixMatches, sortBranches, sortOnline, verdictMatches, viewFilters, withoutChips, withoutFacet,
  type Facet, type FilterContext, type Filters, type Sort, type SortKey, type ViewFilters,
} from "$lib/filter";
import { groupRows, type Grouped } from "$lib/groups";
import { t } from "$lib/i18n/index.svelte";
import { toggled } from "$lib/lists";
import { defaultSelection, moveIndex } from "$lib/selectionPolicy";
import { layoutFor } from "$lib/table/columns";
import { rowKey, tableRows, type AnyBranch, type Section as TableSection } from "$lib/table/rows";
import { groupKeyOf, groupLabelOf, tableGroupIds, withNameSingles, type Groupable, type RepoFacts } from "$lib/tableGrouping";
import { SvelteSet } from "svelte/reactivity";
import { clock } from "./clock.svelte";
import { fold } from "./fold.svelte";
import { repoSelection } from "./repoSelection.svelte";
import { rules } from "./rules.svelte";
import { scanResults } from "./scanResults.svelte";
import { settings } from "./settings.svelte";

const FIRST_SORT: Sort = { key: "verdict", dir: 1 };

class CleanupView {
  /** The table's own filters; the repos are the selection both perspectives share. */
  filters = $state<ViewFilters>(viewFilters(emptyFilters()));
  sort = $state.raw<Sort>(FIRST_SORT);
  selectedKey = $state<string | null>(null);
  /** Rows marked for deleting. */
  checked = new SvelteSet<string>();
  /** Rows a delete works on right now. */
  busy = new SvelteSet<string>();

  resetForTests() {
    this.filters = viewFilters(emptyFilters());
    this.sort = FIRST_SORT;
    this.selectedKey = null;
    this.checked.clear();
    this.busy.clear();
  }

  scope = $derived<CleanupScope>(settings.config?.ui.cleanupScope ?? "Local");
  orphanedOnly = $derived(settings.config?.ui.orphanedOnly ?? true);
  tableGroup = $derived<TableGroup>(settings.config?.ui.tableGroup ?? "None");

  /** The table's filters with the repo selection, as the filter functions take them. */
  all = $derived<Filters>({ ...this.filters, repos: repoSelection.repos });
  /** Every filter at once, the repo selection included. */
  setFilters(f: Filters) {
    this.filters = viewFilters(f);
    repoSelection.repos = f.repos;
  }

  // ---- local branches ------------------------------------------------------------------------

  // The clock only while an age filter is on: otherwise its 30 s tick would re-filter every list.
  private filterContext = $derived<FilterContext>({ now: this.all.ages.length ? clock.now : 0, localCount: scanResults.localCountOf });

  /** Branches whose upstream the server deleted: what alerts and sidebar badges count. */
  orphaned = $derived(scanResults.allBranches.filter(isOrphaned));
  /** The local list as the "only orphaned" switch leaves it; every count and filter works on this. */
  localInView = $derived(this.orphanedOnly ? this.orphaned : scanResults.allBranches);
  private unlocked = $derived(this.localInView.filter((b) => !b.locked));
  private active = $derived(this.unlocked.filter((b) => !b.ignored));
  // One pass with every filter but the status chips and the prefixes; the lists and both counts take
  // those two from it, instead of each running the whole filter again.
  private localPass = $derived(filterBranches(this.localInView, withoutChips(this.all), rules.annotate, this.filterContext));
  private localShown = $derived(this.localPass.filter((b) => verdictMatches(this.all, b) && prefixMatches(this.all, b.name)));
  visible = $derived(sortBranches(this.localShown.filter((b) => !b.locked && !b.ignored), this.sort));
  visibleIgnored = $derived(sortBranches(this.localShown.filter((b) => !b.locked && b.ignored), this.sort));
  visibleLocked = $derived(sortBranches(this.localShown.filter((b) => b.locked), this.sort));
  counts = $derived(countByVerdict(this.localPass.filter((b) => !b.locked && !b.ignored && prefixMatches(this.all, b.name))));
  /** Name prefixes of what the other filters leave, so the numbers match the table once chosen. */
  prefixCounts = $derived.by(() =>
    this.scope === "Online"
      ? prefixStats(this.onlinePass.filter((b) => !b.locked && !b.ignored && onlineVerdictMatches(this.all, b)).map((b) => b.name))
      : prefixStats(this.localPass.filter((b) => !b.locked && !b.ignored && verdictMatches(this.all, b)).map((b) => b.name)),
  );
  selected = $derived(scanResults.allBranches.find((b) => branchKey(b) === this.selectedKey) ?? null);
  // Only what the filter still shows: a mark set before filtering must not delete a row out of sight.
  checkedSafe = $derived([...this.visible, ...this.visibleIgnored].filter((b) => this.checked.has(branchKey(b)) && isDeletable(b)));

  // ---- server branches -----------------------------------------------------------------------

  private onlineActive = $derived((scanResults.allOnline ?? []).filter((b) => !b.locked && !b.ignored));
  // As for the local list: one pass without status chips and prefixes, the rest taken from it.
  private onlinePass = $derived(filterOnline(scanResults.allOnline ?? [], withoutChips(this.all), rules.annotate, this.filterContext));
  private onlineShown = $derived(this.onlinePass.filter((b) => onlineVerdictMatches(this.all, b) && prefixMatches(this.all, b.name)));
  onlineVisible = $derived(sortOnline(this.onlineShown.filter((b) => !b.locked && !b.ignored), this.sort));
  onlineIgnored = $derived(sortOnline(this.onlineShown.filter((b) => !b.locked && b.ignored), this.sort));
  onlineLocked = $derived(sortOnline(this.onlineShown.filter((b) => b.locked), this.sort));
  onlineCounts = $derived(countOnline(this.onlinePass.filter((b) => !b.locked && !b.ignored && prefixMatches(this.all, b.name))));
  selectedOnline = $derived((scanResults.allOnline ?? []).find((b) => onlineKey(b) === this.selectedKey) ?? null);
  checkedOnline = $derived(this.onlineVisible.filter((b) => this.checked.has(onlineKey(b)) && isDeletable(b)));

  // ---- filters -------------------------------------------------------------------------------

  /** Values of a column facet with counts, over what all other filters leave (menu of a column head). */
  facetCounts(facet: Facet) {
    const online = this.scope === "Online";
    const f = withoutFacet(this.all, facet, online);
    const ctx: FilterContext = { now: clock.now, localCount: scanResults.localCountOf };
    const list = online ? filterOnline(this.onlineActive, f, rules.annotate, ctx) : filterBranches(this.active, f, rules.annotate, ctx);
    return facetCounts(list, facet, ctx);
  }

  /** The values chosen for a facet. */
  facetValues(facet: Facet): string[] {
    return this.all[facetField(facet, this.scope === "Online")];
  }

  facetActive(facet: Facet) {
    return this.facetValues(facet).length > 0;
  }

  toggleFacet(facet: Facet, value: string) {
    const field = facetField(facet, this.scope === "Online");
    // Every facet field is a list of values; the chosen value is one of them. The repos are the shared selection.
    if (field === "repos") repoSelection.repos = toggled(repoSelection.repos, value);
    else (this.filters as Record<typeof field, string[]>)[field] = toggled(this.filters[field], value);
  }

  togglePrefixFilter(prefix: string | null) {
    this.filters.prefixes = toggled(this.filters.prefixes, prefix ?? "");
  }

  toggleTagFilter(tag: string) {
    this.filters.tags = toggled(this.filters.tags, tag);
  }

  toggleVerdict(v: Verdict) {
    this.filters.verdicts = toggled(this.filters.verdicts, v);
  }

  toggleOnlineVerdict(v: OnlineVerdict) {
    this.filters.onlineVerdicts = toggled(this.filters.onlineVerdicts, v);
  }

  /** Every filter off, the repo selection included. */
  resetFilters() {
    this.setFilters(emptyFilters());
  }

  setSort(key: SortKey) {
    this.sort = this.sort.key === key ? { key, dir: this.sort.dir === 1 ? -1 : 1 } : { key, dir: 1 };
  }

  // ---- columns and groups --------------------------------------------------------------------

  columns = $derived(layoutFor(this.scope, settings.config?.ui.tableLayout?.[this.scope === "Online" ? "online" : "local"] ?? []));

  setColumns(layout: ColumnPref[]) {
    const current = settings.config?.ui.tableLayout ?? { local: [], online: [], branches: [] };
    settings.setUi({ tableLayout: { ...current, [this.scope === "Online" ? "online" : "local"]: layout } });
  }

  /** Repo name by identity, for the group heads of the table: the first copy listed names it. */
  private nameByIdentity = $derived.by(() => {
    const names = new Map<string, string>();
    for (const i of scanResults.repoByPath.values()) if (!names.has(i.identity)) names.set(i.identity, i.name);
    return names;
  });
  private repoFacts: RepoFacts = {
    rootOf: (path) => scanResults.repoByPath.get(path)?.root,
    identityOf: (path) => scanResults.identityOf(path),
    nameOf: (identity) => this.nameByIdentity.get(identity),
  };

  /** Group of a row by a column: its root folder, its repo across working copies, its prefix or name, verdict or author. */
  groupKeyOf = (b: Groupable, by: TableGroup): string => groupKeyOf(b, by, this.repoFacts);

  /** The head of a group: the folder, the repo's name, the prefix, the verdict's label. */
  groupLabelOf = (key: string, by: TableGroup): string =>
    groupLabelOf(key, by, this.repoFacts, {
      other: t.sidebar.other,
      noPrefix: t.cleanup.noPrefix,
      verdict: (k) => (t.verdict as Record<string, { label: string }>)[k]?.label ?? (t.onlineVerdict as Record<string, { label: string }>)[k]?.label,
    });

  grouped<T extends Groupable>(list: T[]): Grouped<T>[] {
    const collapsed = fold.foldedSet("tableGroups");
    const groups = groupRows(list, this.tableGroup, this.groupKeyOf, this.groupLabelOf, collapsed);
    return this.tableGroup === "Name" ? withNameSingles(groups, t.cleanup.nameSingles, collapsed) : groups;
  }

  toggleGroup = (id: string) => fold.toggle("tableGroups", id);

  /**
   * Forgets the folds of table groups no branch belongs to any more, by any grouping. Only after a scan
   * that read every repo: a repo that failed to read would lose its folds for nothing.
   */
  pruneTableFolds() {
    if (scanResults.results.some((r) => r.error)) return;
    const ids = tableGroupIds([...scanResults.allBranches, ...(scanResults.allOnline ?? [])], this.repoFacts);
    fold.prune("tableGroups", (id) => ids.has(id));
  }

  /**
   * Whether a section of the table is open; keyboard navigation skips what is folded away. The sections
   * start folded, so their fold list holds the open ones, the other way round from every other list.
   */
  isSectionOpen(section: TableSection) {
    return fold.foldedSet("tableSections").has(section);
  }
  setSectionOpen(section: TableSection, open: boolean) {
    if (open !== this.isSectionOpen(section)) fold.setAll("tableSections", [section], !open);
  }
  // Read and written per section (`sectionOpen.ignored = true`), saved with the layout like every fold.
  private sectionView = ((v: CleanupView) => ({
    get ignored() {
      return v.isSectionOpen("ignored");
    },
    set ignored(open: boolean) {
      v.setSectionOpen("ignored", open);
    },
    get locked() {
      return v.isSectionOpen("locked");
    },
    set locked(open: boolean) {
      v.setSectionOpen("locked", open);
    },
  }))(this);
  get sectionOpen(): Record<TableSection, boolean> {
    return this.sectionView;
  }
  set sectionOpen(open: Record<TableSection, boolean>) {
    this.setSectionOpen("ignored", open.ignored);
    this.setSectionOpen("locked", open.locked);
  }

  /** What "delete all" takes in the current scope. */
  deletable = $derived<AnyBranch[]>((this.scope === "Online" ? this.onlineVisible : this.visible).filter(isDeletable));
  // Every row and group head asks "deletable?": a Set answers without walking the list each time.
  deletableKeys = $derived(new Set(this.deletable.map(rowKey)));

  /** Every line of the table in the order shown, heads of groups and sections included. */
  tableRows = $derived.by(() => {
    const online = this.scope === "Online";
    return tableRows(
      online
        ? { main: this.onlineVisible, ignored: this.onlineIgnored, locked: this.onlineLocked }
        : { main: this.visible, ignored: this.visibleIgnored, locked: this.visibleLocked },
      this.sectionOpen,
      { by: this.tableGroup, online, grouped: (list) => this.grouped(list), deletable: this.deletableKeys },
    );
  });
  /** The branches of the table in the order shown; folded groups and sections are left out. */
  rows = $derived(this.tableRows.flatMap((r) => (r.kind === "local" || r.kind === "online" ? [r.b] : [])));

  // ---- selection and marks -------------------------------------------------------------------

  /** Keeps a selection so the detail pane is never empty: first branch that needs attention, else the first. */
  ensureSelection() {
    const key =
      this.scope === "Online"
        ? defaultSelection(this.onlineVisible, !!this.selectedOnline, (b) => b.verdict !== "Active", onlineKey)
        : defaultSelection(this.visible, !!this.selected, (b) => b.verdict !== "Safe", branchKey);
    if (key !== null) this.selectedKey = key;
  }

  selectKey(key: string | null) {
    this.selectedKey = key;
  }

  moveSelection(delta: number) {
    const list = this.rows;
    if (list.length === 0) return;
    this.selectKey(rowKey(list[moveIndex(list.length, list.findIndex((b) => rowKey(b) === this.selectedKey), delta)]));
  }

  toggleChecked(key: string) {
    if (this.checked.has(key)) this.checked.delete(key);
    else this.checked.add(key);
  }

  /** Marks of rows the results no longer have go: a mark must not delete a branch that comes back later. */
  pruneChecked() {
    if (!this.checked.size) return;
    const keys = new Set([...scanResults.allBranches.map(branchKey), ...(scanResults.allOnline ?? []).map(onlineKey)]);
    for (const k of [...this.checked]) if (!keys.has(k)) this.checked.delete(k);
  }

  // ---- where the table opens -----------------------------------------------------------------

  setScope(scope: CleanupScope) {
    if (scope === this.scope) return;
    settings.setUi({ cleanupScope: scope });
    this.selectedKey = null;
    this.ensureSelection();
  }

  /** Opens the cleanup table exactly as a lens defines it. */
  applyLens(lens: Lens) {
    settings.setUi({ perspective: "Cleanup", cleanupScope: lens.scope, ...(lens.upstream ? { orphanedOnly: lens.upstream === "Gone" } : {}) });
    // "Gone" is the table's own switch; any other upstream state stays a filter the chip bar shows.
    const f = lensFilters(lens);
    this.setFilters({ ...f, upstreams: f.upstreams.filter((u) => u !== "Gone") });
    this.selectedKey = null;
    this.ensureSelection();
  }

  /** The cleanup table on exactly these branches, with the reason as a removable chip: where a step of
   * the dashboard leads. Gone-only would hide branches that never had an upstream, so it is switched off. */
  focusBranches(label: string, keys: string[], scope: CleanupScope) {
    settings.setUi({ perspective: "Cleanup", cleanupScope: scope, ...(scope === "Local" ? { orphanedOnly: false } : {}) });
    this.setFilters({ ...emptyFilters(), focus: { label, keys } });
    this.checked.clear();
    this.selectedKey = null;
    this.ensureSelection();
  }
}

export const cleanupView = new CleanupView();
