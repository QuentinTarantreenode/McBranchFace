# Development

Building, testing and releasing McBranchFace. Back to the [README](../README.md).

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
node scripts/logo.mjs    # icon and logo from logo.webp, then: npm run tauri icon app-icon.png
cd src-tauri && cargo test       # Rust unit + integration tests (temporary repos)
cd src-tauri && cargo llvm-cov   # the same with coverage
cd src-tauri && cargo run --example scan -- <root>... [--fetch] [--changed-only] [--online] [--json] [--data-dir <folder>]
                         # headless scan through the app's pipeline, in a temporary data folder unless --data-dir
```

TypeScript types in `src/lib/bindings` are generated from the Rust structs by `ts-rs` during `cargo test`
(`ts-rs` is a dev-dependency only); commit them with the Rust change. UI texts live in `src/lib/i18n/de.ts` and
`en.ts`; both must have the same keys (checked by a test).

The frontend is plain Svelte 5 + Vite (no SvelteKit): `index.html` → `src/main.ts` → `src/App.svelte`.

Working with a coding agent: [AGENTS.md](../AGENTS.md) has the repository map, the rules and when a change is done;
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

Planned: [AI assistant](roadmap-ai-assistant.md) (commit messages, review, change reports) - postponed.
