# AGENTS.md

Guide for coding agents and contributors. [README.md](README.md) describes what the app does and every gate in
detail. This file describes how to work on it: where things live, the rules the code follows, and when a change is
done.

McBranchFace is a desktop git tool for many repositories, working copies and agent worktrees. It has two
perspectives: **Cleanup**, which assesses branches and deletes them safely with a backup and a restore, and **Git**,
a small client. It is built with Tauri 2 (Rust), Svelte 5 (runes, no SvelteKit), Tailwind 4 and Vite. Git is
always driven through the `git` CLI.

## Setup and everyday commands

Prerequisites: Node 22+ (`.nvmrc`), Rust as pinned in `rust-toolchain.toml` (rustup installs it), git, and on Windows
the C++ build tools. The UI audit needs Chrome or Edge.

```bash
npm install
npm run hooks              # once per clone: the pre-push hook runs the quick gates
npm run tauri dev          # the app with hot reload
npm run verify:quick       # versions, types, lint, knip, vitest, clippy, Rust tests, bindings (~4 min)
npm run verify             # all gates incl. build budgets, test-hook check, UI audit, advisories (~8 min)
npm run e2e                # end-to-end scenarios against a real debug build (~9 min)
npm test                   # vitest only
cd src-tauri && cargo test # Rust tests only; also regenerates src/lib/bindings
```

`node scripts/verify.mjs --list` shows the steps, and `--only <a,b>` runs a subset.

## Repository map

| Where | What |
|---|---|
| `src/main.ts` → `src/App.svelte` | Frontend entry |
| `src/lib/*.ts` | Functional core: plain TypeScript without runes or stores (filters, grouping, paths, checks, …) |
| `src/lib/stores/` | State, one store per concern, each with `resetForTests()` |
| `src/lib/services/` | Work that spans stores: scanner, repo actions, deleting, navigation |
| `src/lib/app/` | Bootstrap (start, listeners, startup issues) and the test hook |
| `src/lib/components/`, `ui/`, `git/`, `dashboard/`, `help/` | Svelte components |
| `src/lib/i18n/de.ts`, `en.ts` | Every UI text, same keys in both (checked by a test) |
| `src/lib/bindings/` | TypeScript types **generated** from Rust by ts-rs during `cargo test`. Never edit by hand. |
| `src/lib/api.ts` | The only place that invokes backend commands |
| `src/test/` | Test helpers: simulated backend (`backend.ts`), view and store starters, `wait.ts` |
| `src-tauri/src/commands/` | Tauri commands by area; `mod.rs` holds the lock table `COMMANDS` |
| `src-tauri/src/scan/`, `state/` | Scan pipeline (per repo, cancellable), caches, process budget |
| `src-tauri/src/git/`, `gitops/` | Reading git (refs, snapshots, merge evidence) and git operations |
| `src-tauri/src/delete*.rs`, `journal.rs`, `backup_refs.rs`, `preflight.rs` | Destructive paths: re-check, backup, act, journal, restore |
| `src-tauri/src/locks.rs`, `process.rs` | Locks per repository and scope, child processes with timeouts and job objects |
| `src-tauri/src/providers/` | Pull requests through `gh` and `az` |
| `src-tauri/tests/` | Integration tests against temporary repositories; `fixtures/compat` holds the config and journal shapes of every release |
| `src-tauri/examples/scan.rs` | Headless scan through the real pipeline |
| `scripts/` | `verify.mjs` (gates), `ui-audit.mjs` + `audit/` (layout audits), `e2e.mjs` + `e2e/` (E2E harness), `release.mjs`, `budgets.mjs`, `demo.mjs` |
| `eslint-rules/` | Local lint rules (no literal UI text, no raw colours, no native `title`, …) |
| `.claude/skills/` | Skills for agents, see below |

The import graph is checked by `src/lib/architecture.test.ts`: it has no cycles, and layers depend only downward
(core ← stores ← services/app ← components).

## Rules

**Code**
- Code, identifiers, comments, log texts and commit messages are in English.
- A comment explains *why*, never *what*. Keep comments generic: no names of companies, customers or people, no
  ticket or PR numbers, no machine paths.
- Match the surrounding style. **Do not run a formatter** (no prettier): it rewraps the code to 80 columns. Lines go
  up to about 120 characters.
- The repository uses LF line endings (`.gitattributes`). On Windows, make sure your tools do not write CRLF.
- Fix a bug with a failing test first, then the fix.
- No dead code, no silent limits. A cap that drops data must be visible to the user.
- Example and test data uses neutral names only: Acme, Contoso, Fabrikam, Northwind, `example.com`.

**Backend ↔ frontend**
- The backend delivers facts (codes, counts, paths) and the frontend words them. No UI text in Rust: errors are
  `ErrorCode` plus parameters.
- A new command is registered in `generate_handler!`, listed in the lock table `COMMANDS` (with how it locks), and
  called from `api.ts`. `src/lib/api.contract.test.ts` and the lock-table test fail until all three agree.
- After changing a Rust type that crosses the boundary, run `cargo test` and commit the regenerated bindings together
  with the change. The `bindings` gate fails on drift.
- git runs through `process.rs` with a timeout. Background work never prompts: no credential dialogs, `BatchMode`
  for ssh. Only scans the user starts may ask for a sign-in.
- Destructive operations check the state again when they run, write a backup before acting, record the step in the
  journal, and can be restored. Keep that order.

**UI**
- Every visible text comes from `i18n` (German and English) and is a full sentence where it explains something.
  The lint rule `mbf/no-literal-ui-text` enforces this.
- Clickable elements look like buttons and have a tooltip that says what a click does. Lists with columns are grids.
- Keep the look and feel: design tokens in `src/app.css`, no raw colours (lint rule).
- Check both themes and the minimum window width (1100 px). The UI audit must report 0 findings.

**Safety while testing**
- Tests never touch real repositories. Rust tests use temporary repos and read only `tests/fixtures/gitconfig`.
  Frontend tests use the simulated backend. The E2E builds its own demo workspace.
- The E2E app has its own identifier (`app.mcbranchface.e2e`), so it runs beside an installed McBranchFace. Never
  start two E2E runs at once.
- Test hooks (`window.__mbfStore`, `window.__mbfTest`) exist only in dev, audit and e2e builds. The
  `bundle-hooks` gate fails if one reaches the release bundle.

## When a change is done

1. `npm run verify:quick` is green.
2. You touched UI, build or bundling: `npm run verify` is green, including the UI audit with 0 findings. Look at the
   screenshots of the views you changed (`npm run audit -- --shots audit-shots`).
3. You changed a user flow, the scan, deleting or anything the E2E drives: `npm run e2e` reports every scenario as
   PASS. Run a single scenario with `npm run e2e -- --only <name>`, and list them with `--list`.
4. Commits are small, one topic each. The subject is a short English sentence about what behaves differently now.

A release is cut with `npm run release -- <version>`. It runs all gates, builds the installers, checks the size
budgets, writes the CHANGELOG section, commits and tags.

## Driving the running app

- **Test hook:** in dev, audit and e2e builds, `window.__mbfTest` has `idle()`, `busy()`, `when(cond, ms)`, `events`
  (toasts and command outcomes), `report()`, `tick(...)` and `reset(...)`. Wait on `when(...)` or `idle()`, never on
  fixed sleeps. Details are in the README section *Tests*.
- **CDP:** start the dev app with `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9333` to use the
  audit scripts against it.
- **Headless scan:** `cd src-tauri && cargo run --example scan -- <root> [--fetch] [--online] [--json]` runs the real
  pipeline in a temporary data folder.

## Skills

`.claude/skills/` holds task guides. Claude Code loads them automatically. Other agents should read the matching
`SKILL.md` before starting such a task.

| Skill | Use it for |
|---|---|
| `ux-flow` | Designing or reviewing a user flow: who does what and how often, primary action, few steps |
| `ui-layout` | Visual design measured, not eyeballed: layout budget, audits at several widths, both themes |
| `ui-critique` | Critiquing the whole UI for consistency, with findings P1–P3 |
| `software-design` | Code-level design and review: SSOT, SRP, pure functions, tests first |
| `software-architecture` | Layers, contracts, CLI adapters, safe destructive operations, concurrency |
| `product-review` | Full review in a fixed order: user flow, UI, code, architecture |
| `author-blind-review` | A reviewer with fresh context who knows only the requirement and the diff |
