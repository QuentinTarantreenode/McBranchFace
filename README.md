# McBranchFace

<p align="center"><img src="docs/logo.webp" alt="McBranchFace" width="220"></p>

Desktop tool for local git repositories with two perspectives:

- **Cleanup** – finds stale branches and cleans them up with confirmation, progress and a restorable backup:
  - **Local**: every local branch, with a verdict per branch whether it is safe to delete. By default the
    list shows the orphaned ones, whose upstream was deleted on the server (e.g. by PR auto-delete); the
    remembered switch "Orphaned only" also shows branches the server still has and branches never pushed.
  - **Online**: branches still on the server (`origin`) that are merged, or unmerged and inactive, mapped to
    the local branches that track them in every working copy.
- **Git** – a small git client for monitoring and daily work: changes with diff, history with search and
  commit diff, branches, switch/create, stage/unstage/discard, commit/amend, fetch/pull/push with progress.

Tauri 2 (Rust) + Svelte 5 + Tailwind 4, UI in German and English. Git is driven through the `git` CLI, so
your git config, credential manager, hooks and worktrees behave exactly as in any other client. Each
platform build contains only its own binaries.

## Cleanup: what it checks

For every local branch (protected names such as `main`, `dev`, `prod`, `release/*` and the default branch excluded):

| Check | How |
|---|---|
| Merged | tip reachable from the target, patch-equivalent commits (`git cherry`), squash probe (`commit-tree` + `git cherry`), still contained in another remote branch (or in its own upstream while the server still has it), or a completed PR containing the tip |
| Pushed | commits after the last known remote SHA – the upstream as it is now, from the snapshot taken before every prune (shared between working copies of one repository), or from the PR source commit; without an upstream of its own, the commits that are on no remote |
| Worktree | checked out anywhere; dirty files via `git status --porcelain=v2` |
| Stashes | stash message names the branch, or the stash base is an own commit of the branch |
| PR | `az repos pr list` (Azure DevOps) / `gh pr list` (GitHub), optional |

Verdicts: **Safe**, **Review** (clean, but no merge evidence), **Unsafe** (unpushed commits, dirty tree or stashes),
**Blocked** (checked out). Missing knowledge never results in Safe.

Branches on the server are **Merged** (same merge checks, or a completed PR containing the tip), **Inactive**
(unmerged, no commit for *n* days, default 30) or **Active**; changing *n* re-classifies at once. The online tab
shows when it was assessed and whether the last fetch failed; single repositories can be left out (context menu of
the repo). Deleting on the server goes to the server once per repository (`ls-remote`, then one
`push --delete` for all branches), refuses branches that moved, needs the typed name when a single branch is not
merged, leaves other people's branches unticked, can delete the local tracking branches in the same step, and keeps
every tip in a local backup ref; *Zuletzt gelöscht* pushes it back, and *Undo* restores the local copies too.

The visible list can be exported as Markdown (clipboard) or CSV.

Deleting always goes through one dialog: confirm → progress → result. A preflight detects lock files and files held
open in a worktree before anything is changed; every delete writes `refs/mcbranchface/backup/<ts>/…` first.

## Table and sidebar

- Columns: Status, Branch, Repo, Author, Commit, PR, and on the online tab Local ("2 copies" or "none") and Source (provider and remote,
  opens the branch page; off by default). Drag the right edge of a head to resize (double click resets), drag a head
  onto another to move it (pointer based, so it works while the window accepts file drops). The head menu (right
  click or `⋯`) sorts, filters, groups by the column, moves, hides and shows columns, and resets the layout. The
  layout is saved per tab (Local, Online).
- Column filters list the values with counts after all other filters (repo, author, commit age, PR state, local
  copy); active filters show as removable pills. Groups: folder, repo, prefix, verdict, author. The verdict filter
  is one segmented pill with counts; prefixes and tags (filter) and grouping and report (view) are separate groups.
- Refs show as powerline segments everywhere, also inside sentences: checks, upstream, merge evidence, PR source and
  target, button labels. A check about commits ("2 commits after the last push") opens exactly those commits in a
  window with search and date filter; the PR card has dates and loads the PR's commits (locally when both ends are
  here, else from the provider on request). "Show log" opens the Git history for the branch.
- Branch names show as powerline segments: a muted lead for leading parts without letters (`1/`, `2.4/`), the
  prefix in its colour, the rest as one segment that truncates once at its end.
- The list is virtual with a fixed row height: every row is placed by its index, the first visible row stays in
  place when the list regroups or refreshes, and hover effects and tooltips pause while scrolling.
- The sidebar shows one card per repository, with its linked worktrees inside the same card; a click filters the
  table to the repo, Ctrl+click adds more, a double click opens the folder in the file manager. The selection is
  shared by both perspectives; Git shows the repo clicked last. Folders are managed
  right in the list: add with the "+" at the "Folders" heading or by dropping folders from the file manager (already listed
  or nested ones change nothing), remove from the group header after a confirmation (the folder stays on disk),
  reorder by dragging a group header. A repo can get a colour of its own, shared by all its working copies. Every
  sign on a card (↑ ↓ ●, copy label, counters, flags, worktree icons) has a tooltip.
- The branch line of every card and worktree is a dropdown with search and a filter (All, Local, Server, Mine –
  last commit by one of your e-mail addresses): switch to a local or server branch, or create a new one from the
  current state or the default branch. Other repos with the same branch are offered with
  checkboxes (Ctrl+click-marked ones preselected) and switch one after the other; local changes come along or are
  stashed, and a partial failure offers the way back. A detached HEAD with commits on no branch is flagged, and
  worktree registrations that a folder copy brought along are hidden and can be removed from the context menu.
- Repo groups above the folders are your own sets of repos (one repo can be in several): created and filled by drag
  and drop, a click on the head filters the table, the group menu switches or creates a branch, fetches, pulls,
  pushes and runs your commands in all of them. Each row shows repo and branch in two columns; the edge between
  them can be dragged (one edge for all groups, saved in percent, double click resets to 50:50).
- Identities: folders, repos and repo groups carry a short sign and a colour (twelve tokens, each with a light and a
  dark shade). The app assigns them; "Identity …" in an object's menu sets your own. A repo's own sign replaces its
  folder's wherever the repo is named; a group's shows at its head, in the table's filter note and in Git.
- In Changes, status groups, repos and folders carry batch actions in their menus (stage, unstage, discard per repo;
  stage or unstage in all repos of a folder).
- Every cut-off name shows in full in its tooltip; the audit hovers every truncated text and checks it.
- Loading is per element and never blocks the rest: what has no state yet is a placeholder that cannot be clicked
  and opens no context menu; a repo whose state cannot be read says so; while a git operation runs in a repo, its
  controls stay visible, are locked and say what runs. Everything else stays usable.

## Working copies, locks, alerts

- The same repository cloned into several folders is recognised by its normalised `origin` URL (else its root
  commit). Its working copies share a colour and carry the folder that tells them apart.
- **Locks** (context menu of a branch or repo) keep branches from ever being deleted, in every working copy; locked
  branches are listed in their own section and the backend refuses to delete them.
- The **bell** counts stale branches of the chosen lenses (local Safe, local Review, online merged, online inactive
  and mine) and opens each lens in the cleanup view. A background refresh (default every 30 minutes, with fetch,
  while the app runs) keeps it current, silently; new findings raise a system notification. All of it can be
  changed in Settings → General.
- **Ignore** (context menu or detail pane: 30 days, 90 days, until further notice) takes a stale branch out of
  the bell and notifications without hiding it: ignored branches have their own section and can still be deleted.
  When the period ends they report again. Ignoring is no protection; locks are.
- **Notes and tags** per branch (detail pane) and per repo (sidebar context menu). Rows show a branch's own tags,
  the repo's tags count for the tag filter and the search (`#tag`, note text). Reports carry both.
- Between the background refreshes a light **server check** (default every 5 minutes, one `ls-remote` per repo,
  no data) notices new or deleted branches on the server; only then that repo is fetched and assessed again.
  Local changes arrive through the file-system watcher within about half a second.
- The app runs once: starting it again brings the running window to the front.
- **Tray and start with the system:** closing the window keeps the app running in the tray by default (background
  scan, server check, notifications); minimizing to the tray is optional. The tray menu opens, refreshes, toggles
  notifications and quits. "Start with the system" uses the Run key on Windows, a LaunchAgent on macOS and an
  autostart `.desktop` file on Linux, optionally straight into the tray (`--hidden`). Without a tray host (e.g. GNOME
  without extension) closing works as usual. Settings → General → Window & start.
- **Folder groups:** the sidebar groups repos by root folder in collapsible, sticky groups with counts (repos, gone,
  Unsafe) and a group menu (reassess all, open folder, run a command in every repo). The cleanup table can be grouped
  by folder, repo, prefix, status, author or **branch name** (Group button), with a header per group that marks all
  deletable branches of the group. By branch name, one feature worked on in several repositories is one group, and
  the names several repos share come first.
- **Behind the server:** a local branch the server still has shows `↓n` when its upstream has commits it lacks; a
  click (or the row menu) fast-forwards it to the last fetched state, without network and without merging: a branch
  with commits of its own is refused.
- **Find a commit everywhere** (`Ctrl Shift F`, magnifier in the top bar): subject, author or SHA over every working
  copy at once, each hit with the local and remote branches that contain it. Cherry-picks keep their subject, so
  "is my fix in every release line?" is one search.
- **Forgotten work:** the alert "Local: forgotten" counts branches never pushed, Unsafe and quiet for over a month;
  opening it shows exactly those.
- **Branch names as pills:** a name with a prefix (`feature/checklist-ui`) shows as one pill, prompt style: the
  prefix tinted (fixed colours for feature, bugfix, hotfix, release, spike, chore …), then `›` and the rest. The
  **Prefixes** button above the table counts branches per prefix after all other filters, with bars, and filters
  with multiple choice; the search finds `feature › x` as well.

## Working copies for parallel work

"Create working copies …" (context menu of a repo or a branch, or the head of the Git view) creates up to eight
further folders of a repository at once, e.g. one per AI agent:

- **Worktree** (default): fast and small, shares the object store; each worktree gets its own branch.
- **Own clone**: independent, cloned locally without network or credentials. `origin` points to the original's
  server, and the remote-tracking branches are the ones the original knows, not its local branches.

Suggested are free folders next to the repo (`<name>-agent-1` …) and a new branch per copy after a template
(`agent/{n}`) from the server state of the default branch, or an existing branch. The dialog checks folders and
names before it creates anything and shows the git commands. If one copy fails, only that one is cleaned up.
Worktrees are listed in the sidebar below their repo (click: open in the Git view; menu: folder, terminal,
commands, remove). Removing moves the folder to `backups/`; *Zuletzt gelöscht* restores the worktree or purges its
folder. A worktree with changes is removed only after a second question. Clones show up as another working copy
after the next scan, or the dialog offers to add their parent folder as a root.

## Diff viewer

One column or side by side; changed words are marked stronger than their line (word-level, several places per line,
lines paired by similarity), a line-ending-only change is labelled, syntax is coloured (highlight.js, loaded with the
first diff, per hunk side so multi-line comments stay right). Options: ignore whitespace (`-b`, `-w`), context of 3,
10, 25 lines or the whole file; the algorithm is fixed to histogram, whatever `diff.algorithm` says. Renames show
where the file came from and how similar it is. In Changes a hunk or chosen lines are staged, unstaged or discarded:
the backend takes the diff again, refuses a hunk whose header changed meanwhile, builds the patch from git's own text
(CRLF byte for byte), runs `git apply --check` first and copies the file to the backup folder before discarding.
Keys: n/p or Alt ↓/↑ between hunks, Ctrl F search, s/u stage or unstage the hunk at the top; a marker strip shows
where the changes are, the current hunk header stays at the top.

## Copy as prompt

The row menu and the detail pane copy a Markdown prompt for an AI assistant: merge into the default branch, open a
pull request (only without an open one), clean up the branch, rebase onto the default branch. Merge and rebase are
offered only for branches with own commits. Each prompt states the goal, the situation (repo, folder, commits up to
50, uncommitted changes, evidence, PR), the exact git commands (names with shell characters quoted) and rules: ask
before every push, force-push or deletion, report conflicts instead of guessing, and the SHA that restores the branch.
The prompt texts load with the menu, in the UI language. Settings → Prompts edits the four texts (reset brings the
shipped one back) and adds templates of your own with variables: values such as `{{branch}}`, `{{default}}`,
`{{sha}}`, `{{prUrl}}`, quoted ones for commands (`{{branch.q}}`), and blocks such as `{{situation}}`, `{{commits}}`,
`{{rules}}`, `{{steps.merge}}`. Unknown names stay as written and are named in the preview, which renders against a
real branch. Templates travel with the settings export and import.

## Custom commands

Settings → Commands holds your own scripts, offered in the context menu of a repo, a folder group, a branch row and
as a button in the detail pane. Per command: shell (PowerShell, cmd, bash, sh), run in a terminal (visible,
interactive) or in the background (live output, exit code, cancel, 30 minute limit), which repos, whether on branch
rows too, and whether to ask first. Placeholders `{{path}}`, `{{repo}}`, `{{identity}}`, `{{branch}}`, `{{remote}}`,
`{{default}}` are inserted already quoted for the shell; the editor shows a live preview rendered by the same backend
code that runs it. Each run gets its own script file in the app data folder (`commands/`). Imported settings show
every command with its script before they apply.

## Start and Git perspective

- The start shows what the last run knew at once: branches, verdicts and the git state of every repo (cached in
  `cache/status-v1.json`), dimmed until fresh. The fresh statuses are read beside the scan, the open repo first.
- The scan runs in two stages: first local, without network or providers (the last pull requests, cached, stand in);
  then fetch and server. A repo whose inputs did not change (refs, worktrees, pull requests, settings, day) and that
  the watcher did not report takes its verdicts over from the first stage.
- Branches across repos, for a repo group or a folder: switch all (created where missing), create a new one in
  all, or take over a branch only some have ("Not everywhere" suggests them); the start point of new branches is a
  visible choice, and "Only create" creates without switching.
- Changes: "This repo" or "All repos" (optionally grouped by folder), one block per repo (the selection or repo group on the left, else all, with
  their linked worktrees). A file opens its repo; staging and discarding act in the row's repo.

## Git perspective: safety

- Every writing operation checks for `index.lock` first and reports failures by kind (lock, local changes in the way,
  diverged, rejected, sign-in needed, network …) with a hint what to do.
- Discard copies every affected file to the app data folder (`backups/<ts>-<repo>/`, a folder of its own per backup)
  before throwing it away.
- Amending a commit that is already on the server asks first. Switching with conflicting local changes offers
  *Mitnehmen* / *Nur stashen*.
- Pull is fast-forward only (`git pull --ff-only --no-rebase`, so `pull.rebase` cannot turn it into a rebase). Push
  names remote and refspec (`git push <remote> refs/heads/<b>:<merge>`), so `push.default=matching` never pushes
  other branches; the first push publishes the branch (`push -u origin`). Every sync button's tooltip shows the
  exact command. Credentials come from git's credential manager; the tool never asks for passwords.
- Refs and SHAs from the UI are checked before git sees them: a leading `-` (`--output=…`, `-`, `--detach`) is
  refused before anything is stashed or switched, and logs pass the revision after `--end-of-options`.

## Robustness

- A damaged `config.json` is moved aside (`config.corrupt-<ts>.json`) and reported; it is never overwritten silently.
  Saving writes a temporary file and renames it.
- Journal lines that cannot be read are skipped and kept in a backup before the journal is rewritten.
- Fetch failures are reported once per cause (offline, sign-in needed), not once per repository.
- Network calls the app starts by itself (background scan, server check, auto-fetch) never ask anything: no sign-in
  window of the credential manager (`GCM_INTERACTIVE=never`), no ssh question (`BatchMode`, unless you configured an
  ssh command of your own), and a transfer slower than 1 KB/s for 30 s ends. A refresh you start may ask, once per
  server: the first call to a server goes alone, and when the server refuses the sign-in, the other repositories on it
  are not asked again in that scan. A running scan can be stopped; what it assessed until then stays.
- A repository folder that disappears is shown as unreachable and no longer watched.
- Git operations lock only the repos they run in (claim with the operation's name in the UI). In the backend a
  repository's refs have one lock, shared by all its worktrees (a commit in a linked worktree waits for a delete or
  fetch in the main one), and each working copy's index has its own (staging never waits for a fetch); reading
  (status, log, diff) is never blocked, and online queries run beside everything local.
- Every error message has a title and a way out, in both languages (checked by a test against the backend's
  error enums). Uncaught errors end up as a message, a view that fails to render shows a replacement surface with
  "Reload" while the rest keeps working, and a crash of the backend leaves `crash.log`, reported at the next start.

## Help

`F1` opens a help sidebar on the topic of the current view, with drill-down (topics → sections), search and
"Show" links into the UI. The legend shows every sign of the interface with the real components beside its meaning:
verdicts, branch segments, sidebar cards, worktree rows, table flags, refresh buttons. `?` shows every shortcut. Shortcuts and error texts come from the same source as the UI.

## Onboarding and settings

On first start the app checks git (required, ≥ 2.31), Azure CLI + `azure-devops` extension, GitHub CLI and GitHub
Desktop (optional), and offers the official page, the install/login command to copy, or to run it in a visible
terminal. Commands come from a fixed allowlist in the backend. Settings can be **exported and imported** as JSON
(with a preview; window layout and theme stay local). The window can stay **always on top** (pin in the top bar).
Settings are pages with a navigation on the left (appearance, folders & scan, refresh & alerts, window & start,
rules, online branches, commands, environment, configuration, about); dialogs open at the top, move by their header
and keep their size per dialog. The interface size is 100, 115 (default) or 130 %; the minimum window grows along.

## Shortcuts

| Keys | Action |
|---|---|
| `Ctrl 1` / `Ctrl 2` | Perspective Cleanup / Git |
| `F5` / `Shift F5` | Refresh with fetch / local only |
| `Ctrl B` / `Ctrl J` | Toggle repo list / details |
| `Ctrl F` | Search (cleanup) |
| `Ctrl ,` | Settings |
| `Ctrl +` / `Ctrl −` / `Ctrl 0` | Interface larger / smaller / default |
| `F1` / `?` | Help / shortcut overview |
| `←` / `→` on a group header | Collapse / expand the group |
| `Alt 1..3` | Git tabs: changes, history, branches |
| `↑ ↓` `j k` | Move in lists; `Space` mark / stage; `Del` delete / discard |
| `Shift F10` / context-menu key | Context menu of the focused row |
| `Ctrl Enter` | Commit |

## State

App data directory (`%LOCALAPPDATA%\McBranchFace` on Windows): `config.json`, `snapshots/`, `deleted.jsonl`,
`cache/` (last results, merge evidence), `backups/` (discarded files, files of force-removed worktrees), `crash-*.log`, and `diagnostics.log` when the
diagnostics switch (Settings → About, off by default) is on. `MCBRANCHFACE_DATA_DIR` points the app to another
folder; tests and the E2E run use that.

## Develop

Prerequisites: Rust as `rust-toolchain.toml` pins it (1.98.1 with clippy; rustup installs it on first use, MSVC on
Windows), Node 22 or later (`.nvmrc`, `engines`), and for Windows the C++ build tools.

```bash
npm install
npm run hooks            # once per clone: git runs the quick gates before every push (core.hooksPath = .githooks)
npm run tauri dev        # app with hot reload
npm run verify           # every gate, see below; npm run verify:quick without builds and audits
npm run check            # svelte-check
npm run lint             # ESLint, including the local rules in eslint-rules/
npm test                 # frontend unit, component, property, contract and lint-rule tests (vitest, jsdom)
npm run coverage         # the same with coverage (coverage/index.html)
npm run build && npm run budgets   # start-bytes budget; add --release after a tauri build for exe and installer
npm run audit            # headless layout, tooltip and jank audit (audit build, Chrome or Edge over CDP)
npm run perf             # scan of 150 repos with 2000 branches each, long animation frames and interaction steps against budgets
npm run e2e              # the end-to-end run (see E2E below): e2e build, demo workspace, every scenario over CDP
npm run demo -- <folder> [--large]  # the demo workspace alone; --large adds 128 branches with real name shapes
npm run release -- <version> [--summary "<line>"] [--dry-run]   # see Release
npm run mutants          # mutation tests of the destructive paths, before a release (scripts/mutants.md)
node scripts/logo.mjs    # icon and logo from docs/logo.webp, then: npm run tauri icon app-icon.png
cd src-tauri && cargo test       # Rust unit + integration tests (temporary repos)
cd src-tauri && cargo llvm-cov   # the same with coverage
cd src-tauri && cargo run --example scan -- <root>... [--fetch] [--changed-only] [--online] [--json] [--data-dir <folder>]
                         # headless scan through the app's pipeline, in a temporary data folder unless --data-dir
```

TypeScript types in `src/lib/bindings` are generated from the Rust structs by `ts-rs` during `cargo test`
(`ts-rs` is a dev-dependency only); commit them with the Rust change. UI texts live in `src/lib/i18n/de.ts` and
`en.ts`; both must have the same keys (checked by a test).

The frontend is plain Svelte 5 + Vite (no SvelteKit): `index.html` → `src/main.ts` → `src/App.svelte`.

Working with a coding agent: [AGENTS.md](AGENTS.md) has the repository map, the rules and when a change is done;
`.claude/skills/` has task guides for UI, UX, design, architecture and reviews.

### Gates

`node scripts/verify.mjs` runs every gate, fastest failures first; each is a program started without a shell, its exit
status checked, and the first failure ends the run with a non-zero exit. A table at the end shows each step with its
result and duration. `--quick` leaves out the builds and audits, `--only <step>[,<step>]` runs single steps, `--list`
names them:

| Step | What fails it |
|---|---|
| `versions` | a version in `package-lock.json`, `Cargo.toml` or `Cargo.lock` that differs from `package.json`, or a number in `tauri.conf.json` instead of `../package.json` |
| `types`, `lint`, `knip` | svelte-check errors or warnings, ESLint, unused files, exports and dependencies |
| `vitest` | frontend tests |
| `clippy` | any clippy warning (`--all-targets -D warnings`) |
| `rust-tests` | Rust tests; the bindings they export go to a temporary folder, so the run changes nothing |
| `bindings` | `src/lib/bindings` differs from what the Rust types generate: changed, missing or left-over files |
| `build` | the production build, then the start-bytes budget |
| `bundle-hooks` | a test hook (`__mbf…`, `__e2e…`) in the production build |
| `ui-audit` | the audit build and `scripts/ui-audit.mjs` with any finding |
| `audit` | `cargo audit` (skipped with a note when cargo-audit is not installed) and `npm audit --omit=dev` |

The **pre-push hook** (`.githooks/pre-push`, installed by `npm run hooks`) runs `verify.mjs --quick`.

The gates that count are local: `verify`, the pre-push hook and the release script. On GitHub,
`.github/workflows/check.yml` runs the full `verify.mjs` on Windows and Ubuntu and `release.yml` builds Windows, macOS
(arm64, x64) and Linux artifacts, both with actions pinned to commits. Both start by hand (Actions → Run workflow)
until a first run is green, because macOS and Linux have never been built; then they get their `push` triggers.

The local lint rules forbid literal UI text, `break-all`, native `title`, raw colours, paths shown without
`displayPath`, and tooltips that repeat the visible text; a deliberate exception needs `eslint-disable-next-line`
with a reason.

### Tests

- `npm test` (vitest): unit, component (jsdom; the polyfills jsdom lacks are in `src/test/setup.ts`), property and
  lint-rule tests, and the **backend contract** (`src/lib/api.contract.test.ts`): every command in
  `generate_handler!` is invoked from `src/lib/api.ts` with the argument names Tauri maps (camelCase) and the return
  type it resolves to, and every event the backend emits is listened to, and the other way round. The **import
  graph** (`src/lib/architecture.test.ts`) has no cycle, through static or dynamic imports, and its layers depend only
  downward: the functional core knows no store, a store (`src/lib/stores/`) never imports a service
  (`src/lib/services/`, `src/lib/app/`) or a component. Tests that read the sources through `import.meta.glob` never
  come from vitest's module cache, so a file added since the last run is seen.
- Dev, audit and e2e builds (`PROBED` in `src/lib/probe.ts`) put `window.__mbfStore` (the state under its old names)
  and `window.__mbfTest` on the page for the CDP scripts: `idle()` is true when no command is in flight, no scan, git
  operation or delete runs, no timer some work waits for is pending and no external call the backend reported is open,
  and `busy()` names what keeps it from that; `when(cond, ms)` resolves once a condition holds, woken by store changes,
  ending work and changes of the page; `events` logs toasts and the outcome of every command that changes something;
  `report()` has the last 50 commands with their arguments, duration and outcome, the activities and the triggers;
  `tick("serverCheck" | "autoFetch", now)` runs the periodic work once; `reset(...stores)` puts stores back as at the
  start.
- `cd src-tauri && cargo test`: unit and integration tests against temporary repositories. Every test binary reads
  `tests/fixtures/gitconfig` instead of the machine's system and global git config (`src/test_env.rs`), so line ending
  conversion, the default branch name or a missing identity on a machine change nothing; `tests/line_endings.rs` turns
  `core.autocrlf` on in its own repos for the partial staging paths. The lock table in `commands/mod.rs` lists every
  `#[tauri::command]` with how it locks (none, its repo's refs, one working copy's index, its repo then the global lock, the journal only, or exempt
  with a reason); a new command fails until it is listed.
- **Compat fixtures** (`src-tauri/tests/fixtures/compat`): the config and journal shapes of each release. Today's code
  must read every one of them with locks, protected patterns and ignores intact and restore their journal entries.
  `scripts/release.mjs` writes the pair of the new version (`write_current_shapes` in `tests/compat.rs`, from the
  samples there); a sample that gains a field is changed in that file.

### E2E

`npm run e2e` (`scripts/e2e.mjs`) drives the real app over CDP through every scenario, each from a fresh copy of the
demo workspace (`scripts/demo.mjs`) and a fresh page:

- **Build:** the frontend in mode `e2e` (with the test hooks, into `build-e2e/`), then `tauri build --debug --no-bundle`
  into `src-tauri/target-e2e/` with `src-tauri/tauri.e2e.conf.json` merged in. The frontend is embedded, so no dev
  server runs and a change in the project never reloads a running test. The release build stays free of hooks
  (gate `bundle-hooks`). `--no-build` reuses the last e2e build.
- **Beside your app:** the e2e build has its own identifier, product name and window title (`McBranchFace E2E`), so
  the single-instance lock, the WebView2 profile and the autostart entry are its own; your McBranchFace keeps running.
  It runs with a private data folder (`MCBRANCHFACE_DATA_DIR`), WebView2 timers that are not throttled behind other
  windows, a page that keeps its focus, a clipboard of its own and no system notifications.
- **Config:** server check and automatic fetch off (a scenario that tests them calls `__mbfTest.tick`), a refs change
  reassessed at once, the activity display and `diagnostics.log` on.
- **Waits and clicks:** every action waits until the app is idle before and after. A click names a control by role and
  exact accessible name (or a regular expression for names that carry a count or a description), fails on none or
  several, waits until it is enabled, uncovered and still for two frames, and presses with real mouse input; success
  is read from `__mbfTest.events`, not from toasts on screen.
- **Options:** `--list`, `--only <name>[,<name>]`, `--from <name>`, and a work folder as first argument (default
  `<tmp>/mcbranchface-e2e-<time>-<pid>`; of the earlier ones the last three are kept). A failed scenario runs once more on a new
  app; each one ends as PASS, FLAKY (green only on the rerun) or FAIL, and any FLAKY or FAIL fails the run.
- **Failure report** in `<work>/failures/NN-<scenario>/`: `summary.txt` (the wait's label, condition, values over time
  and what kept the app busy when it ended), `state.json`, `events.json`, `ipc.json` (the last 50 commands),
  `activity.json`, `triggers.json`, `targets.txt` (every control a click could name), `dom.html`, `git.txt` (refs,
  worktrees and stashes of each demo repo), `app.log`, `diagnostics.log` and `screenshot.png`. A screenshot of every
  passed scenario is in `<work>/shots/`.

Do not run two e2e runs at once: the second app hands over to the first, like a second start of McBranchFace does.

### Release

`npm run release -- <version> [--summary "<line>"]` refuses a tree with changes, sets the version (`package.json`,
`package-lock.json`, `Cargo.toml`, `Cargo.lock`; `tauri.conf.json` reads `package.json`), writes the compat fixtures
of this version, puts a section with the commit subjects since the last tag (or the last release commit) at the top of
`CHANGELOG.md`, runs `verify.mjs`, builds the installers (`tauri build`), checks the exe and installer budgets, writes a
`.sha256` beside every installer, commits `Release <version>: <summary>` and tags `v<version>`. Every step checks its
exit status and stops the release. `--dry-run` does everything but the installer build, the commit and the tag, and
puts the tree back.

The UI audit builds `audit.html` (`vite build --mode audit`, never part of the release bundle): the app on the
simulated backend from `src/test/backend.ts` with the demo data in `src/audit/fixture.ts`. `scripts/ui-audit.mjs` runs
`scripts/audit/layout-audit.js` in both themes at 1100, 1280 and 1600 px, `tooltip-audit.js` at 1280 and
`jank-probe.js` on the lists; findings not listed in `scripts/audit/allow.json` (each with its reason) fail the run.
`scripts/perf-start.mjs` measures the start with realistic delays (`?timing=1`): the cached statuses at the first
paint, the first fresh status and both stages; `--no-cache` must fail it. `scripts/perf-scan.mjs` scales the same fixture (`?repos=N&branches=M`), replays a scan as `scan-repo` events and
fails when long animation frames or a search, sort or regroup step exceed their budgets. It also lets the status of
every repo arrive on its own, as at the start, and fails when frames drop beyond what the idle page drops (60 fps).
Statuses land once per frame; repo cards out of view are not laid out (`content-visibility`).
Against the running dev app the same scripts work over CDP when it is started with
`WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9333`.

Planned: [AI assistant](docs/roadmap-ai-assistant.md) (commit messages, review, change reports) — postponed.

## License

MIT, see [LICENSE](LICENSE).
