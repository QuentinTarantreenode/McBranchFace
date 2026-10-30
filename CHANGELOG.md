# Changelog

One section per release, newest first. `scripts/release.mjs` adds the next one from the commits since the last tag.

## 1.3.0 · 2026-10-30

- Size budgets: exe 5.2 MB and installer 2.3 MB for the locks, scan pipeline and provider work of 1.3
- Release script: only a subject with a version marks the last release
- Test hook: reading a branch's commit lists stays out of the event log
- Release bundle: the test hook's import under a condition Vite replaces in main.ts
- README: the e2e run, its build, identity, options and failure reports
- E2E: scenarios on an embedded debug build beside the user's app, waits on the app's signals, real clicks, failure reports
- E2E identity: own identifier and product name; the autostart entry follows the product name
- Test hook: busy names what runs, report for failures, the periodic work on call, page changes wake a wait
- Build mode e2e: the test hooks under one predicate, into build-e2e; the last commands kept for failure reports
- One limit for every wait, a test limit for busy machines
- Merge probes: copies of one repository share the answer for the same tip and target commit
- View tests load only the dictionary part every start needs ahead
- UI audit: tooltips checked as soon as they show, checks counted by kind
- Commit lists on demand: results carry the counts, branch_commits reads a branch's lists when a view shows them
- Rust tests without timing: watcher by markers, probe by its first attempt, squash probe by its dates
- Date tests hold in every time zone; the version test splits the lock files once
- Git store, start view and the smaller tests wait for results too
- Tests by feature, waiting for results instead of fixed rounds
- Assessment takes the pull request lists it is handed instead of copying them
- The copy that holds the server branches keeps assessing them while it is reachable
- Merge probe: the merge base tells an ancestor, one git call less per probe
- One listing of the refs for the assessment and the snapshot, read under the snapshot's lock
- A light check that did not reach the server is said at the repo as a failed fetch, with git's words
- A capped pull request list is said also when it comes from the cache
- Fingerprint: the next ignore to run out instead of the day
- Headless scan reports processes, event bytes and results cache size per pass
- Scan stop on the refresh button's other half; only scans the user starts may ask for a sign-in; probe leftovers reported at start
- repoTip test mocks the stores the tip reads now
- Test hook: answers that are a whole assessment stay out of the event log
- README: the import graph gate and the test hook
- Facade: every name of the former store, orphaned and request included, checked against the scripts
- Changes view: forget the folds of working copies that are gone, once every repo has a fresh status
- Recently deleted: the online badge of a journal entry as a named display mapping
- Help: removed worktrees go to the backups, inactive needs a known PR list, Strg and Umschalt as the tooltips say
- Worktrees: removing says the folder moved to the backups and names a missing journal entry; a restored worktree says so; a server delete whose answer was lost says in words that the branch is gone
- Start views read only the core dictionary: failure texts, journal entry names, the worktree tip and upstream rows moved there; the dashboard names removed worktrees; the start test hovers every tip
- Report worktree folders left under their probe name as a startup issue
- Headless scan drives run_scan in a data folder of its own
- Key the state by path_key, keep pull requests per repository, index them
- Test hook: __mbfTest.idle, when and an event log in dev and audit builds; commands counted in one invoke wrapper
- Keep blocking file and folder work off the async threads
- Close the watcher's gaps: start window, lost batches, one failing folder
- Gate: the import graph has no cycle and its layers depend only downward; glob tests never come from the module cache
- api: leave interactive unset unless the caller passes it
- Group actions and the quick switch among the services; sibling imports inside stores and services
- Bootstrap the app outside the store; the store is a dev and test facade; one start chunk
- Land online results by generation, and let a server delete supersede them
- One fetch rule: fetched means origin answered
- Background network calls never ask; a scan can be cancelled
- Split the store: repo actions and deleting as services that reassess afterwards
- Split the store: the scanner as a service, its timers in the shared set and its ticks public
- One light check per repository, then a pipeline per working copy
- Split the store: deletes hold the dialog's job and the journal; the flow takes what follows a delete as a parameter
- Split the store: the bell's lenses and notifications, seen keys and tray texts as plain functions
- Split the store: navigation as a service, the dashboard's step runner beside its view
- Split the store: the cleanup table's view, grouping and selection rules as plain functions
- Share one process budget across scan, rescan, refresh, server check and search
- Split the store: the shared repo selection, the git-ready mark outside the status store
- Hold no global lock over server calls when deleting or restoring
- Split the store: rules for locks, ignores, notes and the online exclusion
- Lock a repository's refs by its common git dir, the index per working copy
- Split the store: scan results as the only writer of repos, merging as plain functions
- Split the store: environment, dialogs and clock as leaf stores
- Split commands.rs into state, scan pipeline, locks and command modules
- Split the store: settings with the write queue, appearance effects apart
- Split the store: toasts in their own store, timers in one set
- After merge: backups_size in the lock table, compat test reads the journal as a result
- release: names in capitals keep their case in the summary
- Lock rule comment as the backend has it; the start test loads its views outside the test time
- README and workflows: no remote, the local gates are the real ones; CI only prepared
- Start: listeners that came are ended even when another failed; Git operations typed as they answer
- Worktree icon tip built on hover; the start test covers worktree rows
- Dashboard texts in the core dictionary: the start views render without the second part, a test says so; folder head tip in the newer wording
- One source per rule: force, locks, gone counts, list toggles, tickets, per-key throttle, git claims, repo lookups, verdict lists; branch names checked by git
- Late answers and lost work: tickets for commit lists and help texts, listeners of a switched-off watch removed, typed search kept, zoom failures named, quick switch reads fresh and rescans owners
- Sidebar arrow keys write the filter once the keys rest; perf-scan times status events, arrows, Ctrl+A in Changes, group by name
- Dashboard: input in separate parts, branches indexed by name for pull requests
- PR warning texts name the provider and the azure-devops extension as the app does elsewhere; refs test independent of path case
- A light check's proof of current refs is process-wide, so the re-check before a delete sees it too
- Destructive paths: worktrees move to the backups, CAS branch delete, journal hardening
- Changes: rows in the virtual list, the tree drawn row by row, heads stay at the top; selection by sets
- Providers: gh's sign-in exit code counts as signed out whatever the text
- Assessment: fewer git processes per scan, same results
- Folds: a derived set per list for lookups; folds of table groups that are gone are pruned after a scan
- Statuses in a SvelteMap of plain values, compared without serialising; scripts read it by key
- Pull requests: robust parsing, classified failures, fallback list; fresher evidence rules
- Protection patterns and locks match branch names case-insensitively
- verify: an audit that ran with one tool missing counts as ok with a note
- Tools resolve from node_modules directly; release takes the nearest tag as the last release
- README: the real gates (verify, pre-push hook, release script), toolchain, tests and compat fixtures; CI runs once a remote exists
- CI workflows run verify.mjs with the pinned toolchain and Node version; actions pinned to commits
- Results change through one write path that replaces them; repos raw; one lock rule
- Mutation tests documented as a pre-release check for delete, restore, git operations and assessment; npm run mutants
- scripts/release.mjs: clean tree, version, compat fixtures, CHANGELOG, all gates, installers with budgets and checksums, commit and tag
- pre-push hook runs the quick gates; npm run hooks installs it; verify shares its program runner
- scripts/verify.mjs runs every gate fail-fast without shell pipes and prints a timed summary
- Vite serves the linked node_modules of a git worktree, so tests run there without extra config
- Toolchain pinned: Rust 1.98.1 with clippy, Node 22 or later
- CHANGELOG with one section per release, from the release commits
- One version source: tauri.conf.json reads package.json, a test compares every copy including both lock files
- Delete flow: restore counts what came back; rows are freed when a run breaks off
- Settings: Save writes only the dialog's own changes, over the config as it is then
- Scan: a rescan wins over the older batch, background failures show at the repo, auto fetch only what moved
- Golden compat fixtures of 1.2.6: config and journal still load with locks, protection and ignores, and restore
- Partial staging, unstaging and discarding tested with core.autocrlf=true
- Toasts: one with an action replaces the same message, with its action and a fresh timer
- Contract test between generate_handler, api.ts invokes and events; saveConfig resolves to Config
- Lock table covers every Tauri command; an unclassified command fails the test
- Rust tests read a fixed git config instead of the machine's system and global config
- vitest: one setup file for the jsdom polyfills, shared path keys imported statically, module cache across runs
- Git view: commit drafts per repo, hunk actions only on the selected file's diff, errors per resource

## 1.2.6 · 2026-10-16

Worktree removal waits out the app's own short git calls; e2e follows the dashboard grid.

## 1.2.5 · 2026-10-16

Review fixes for destructive paths, races, caches, process trees, store and components.

## 1.2.4 · 2026-10-16

The start fetches only repos whose server moved, one pull request list per repository, fingerprints survive a restart with the worktree files checked.

## 1.2.3 · 2026-10-15

Names cut where they do not tell apart, folder filter as one chip, status chips keep their names, toasts capped, settings texts as sentences, shortcuts as key caps, audit views fixed.

## 1.2.2 · 2026-10-15

Every left edge carries the identity colour, the folder's where a repo has none; no OS notifications from development builds.

## 1.2.1 · 2026-10-15

The left edge is the repo's colour and the selection a frame and fill; tooltips on whole device pixels.

## 1.2.0 · 2026-10-14

Dashboard lines open the filtered list, tiles as tables, PR authors by name, top bar divider, folder badges in non-status colours.

## 1.1.5 · 2026-10-14

The watcher skips files git ignores, asked once per working copy until an ignore rule changes.

## 1.1.4 · 2026-10-14

Providers left of refresh and data state in the top bar, activity panel clamped to the viewport.

## 1.1.3 · 2026-10-14

Refresh triggers logged for the run and switchable, ref changes reassess a repo at most once per gap, git's helper files trigger nothing, settings keep the activity switch.

## 1.1.2 · 2026-10-13

Activity shown once, in the top bar, only when switched on; no notes on elements, no durations on screen.

## 1.1.1 · 2026-10-13

Worktrees unfold again, activity shown by default, conflicts and status sums, more end-to-end coverage.

## 1.1.0 · 2026-10-13

Dashboard as start view, views as tabs, review states of pull requests, visual review fixes.

## 1.0.3 · 2026-10-13

Folders act like groups, one menu per working copy, activity display and log, stop for group runs.

## 1.0.2 · 2026-10-13

Quiet watcher, shimmer refresh with motion setting, tooltips beside menus, PR lists, tidier detail head.

## 1.0.1 · 2026-10-13

Where repos live, their colour in the middle, parts that load on their own, review findings.

The service of each repo (local, Azure DevOps, GitHub, another server) shows on cards and heads; a repo's colour marks its table rows, its Git head and its worktrees; cards and the Git head hold placeholders per part; the description calls it a Git client; the visual review's findings are fixed: labels, quiet actions, primary steps, the floating detail below the table's bars.

## 1.0.0 · 2026-10-12

A Git client with cleanup.

Loading and refreshing show per element and keep what is known usable; worktrees show as labels, many folded and grouped by branch prefix, merged ones marked; the Git perspective selects several repos and groups; Git branches are a grid with filters, grouping and selection; repo tooltips stay short. Start budget raised for the sidebar's grouping and states.

## 0.17.0 · 2026-10-12

Groups, selection, pull requests per repo, ribbon look.

Every grouped list nests one step per level, folds and unfolds all, and selects all or none; the sidebar selects like a file manager, also single group members and worktrees, by mouse and keyboard; selection shows by fill and bar. Repos show and list their open pull requests. Panes and columns size freely. Menus, dialogs and the branch switcher share a ribbon look; popovers close on a press on the title bar. Start budget raised for selection, folds and pull requests.

## 0.16.0 · 2026-10-12

Fast start, changes of all repos, branches across repos, identities.

The last git state shows at once and the start runs in two stages; Changes shows all repos, by folder if wanted, with batch actions; groups and folders switch, create and take over branches; folders, repos and groups get identities; the detail pane is ordered by context. Budgets raised for the caches and identities.

## 0.15.4 · 2026-10-12

Readable sidebar, loading per element, 60 fps.

Repo groups show repo and branch in two columns with a draggable edge; cut-off names show in full. What loads cannot be used; operations lock only their repo and say so, in the sidebar and in Git. Statuses come with the scan and land once per frame; off-screen cards are not laid out.

## 0.15.3 · 2026-10-12

UI review.

Branch names keep a readable rest; the detail pane needs fewer lines; folders and repo groups share one section style; long worktree paths no longer overlap in the repo tip.

## 0.15.2 · 2026-10-12

Logic fixes from the review.

Pushed is not merged; deletes check evidence, protection and worktree files at the moment they run; counts agree; repo group menus open at once; git operations lock only their repos; worktrees get their status.

## 0.15.1 · 2026-09-30

Folders of linked worktrees no longer look empty.

## 0.15.0 · 2026-09-30

Repo groups, toggles you can read, texts as sentences.

## 0.14.3 · 2026-09-30

Copy any branch name by right click.

Every branch name offers "Copy branch name", with and without its remote; rows with a menu of their own carry the entry there. Over a modal dialog the menu joins the top layer, so it works in dialogs too.

## 0.14.2 · 2026-09-29

The detail pane stays when the window grows or shrinks.

Open over the table in a narrow window, it stays open beside the table when the window grows; closed beside it, it stays closed when the window shrinks.

## 0.14.1 · 2026-09-29

Messages and runs keep 24 px to the window edge.

## 0.14.0 · 2026-09-29

A short badge per root folder, repos named the same everywhere.

Each root folder gets unique initials in a colour of its own, shown at its sidebar header and wherever a repo is named: on the card, in the table and its folder groups, in the detail, the quick switch and tooltips. A repo is badge plus name throughout; a copy label appears only where two copies share a folder.

## 0.13.4 · 2026-09-29

Repo column and repo tooltip say which repo and which working copy.

The cell shows the repo by name and, where it has several working copies, the folder of this one as a place. The tooltip is grouped into what is checked out (branch to upstream on full-width lines, changes, stashes), the repository (default branch, provider) and all working copies with this one marked.

## 0.13.3 · 2026-09-29

System theme, readable repo column and group tallies, wider column grip.

The theme can follow the system like the language, also when it switches while the app runs. The repo column shows the folder icon in the repo's colour with the copy as a pill, group headers count by verdict in the status pills, and the sidebar's signs share one frame. Column edges are easier to grab and keep the drag from the WebView. Stashes apply only to a worktree the branch is checked out in; apply, drop and column resize are covered end to end.

## 0.13.2 · 2026-09-29

Stash apply and drop, framed signs everywhere.

Stashes in the detail can be applied to the branch's worktree or dropped behind a backup ref. Counts, status icons and verdict tallies in the table, group headers, filters, history and quick switch use the same chips as the sidebar. Menus whose entries load late keep their room to the window edge.

## 0.13.1 · 2026-09-29

To-do steps in the detail, status chips, stable top bar.

The detail leads with the git steps up to deleting a branch, with a button for each, and folds passed checks into one line. Sidebar counters are framed chips with the icons the table uses, including stashes. All local branches with a gone-only switch, grouping by branch name with actions for every repo, commit search across repos. Perspectives and refresh keep their width in every state, columns move by dragging with visible feedback, the help is grouped by area, and git's own terms replace invented translations.
