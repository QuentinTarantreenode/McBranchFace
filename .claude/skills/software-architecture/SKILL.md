---
name: software-architecture
description: >-
  Design and review the architecture of a tool or module: layers and boundaries (functional core,
  imperative shell), contracts across boundaries generated instead of copied, external tools as robust
  CLI adapters (unlocalised output, no prompts, timeouts), safe destructive operations (re-check at
  execution time, preflight, backup, act, journal, restore, order of side effects), saving volatile
  knowledge before destroying it, concurrency and shared state, optional integrations that degrade
  cleanly, measured budgets, and a headless entry point for verification. Use when a contributor says
  "architecture", "architecture review", "layers", "where does this belong", "how do I cut this",
  "call an external tool", "run a CLI", "make delete safe", "undo", "restore", "backup before delete",
  "race condition", "locking", "concurrency", "cross-platform", "how do I test this end to end" — and
  unasked when designing a new module or command. Neighbours: software-design (code level),
  product-review (the whole review).
---

# Software architecture — boundaries, contracts, safe side effects

McBranchFace reads foreign state (git repositories) and changes it destructively. The rules hold for any
system that drives external tools or touches user data; the examples name the files that implement them
here.

## 1 · Layers: a pure core, a thin IO shell

```
UI (render, user intent) ──invoke──▶ commands (thin: validate, call, map errors)
                                        │
              ┌─────────────────────────┴──────────────────────┐
  core: facts → classify → explain           actions: verify → preflight → backup
        (pure, tested without IO)                     → act → journal
                                                       │
  adapters: git runner, providers, config, journal, watcher   ← the only IO
```

- **Backend.** `src-tauri/src/commands/` only translate: parameters in, core call, `AppError` out. Domain
  rules live in the core (`assess.rs`, `failure.rs`), never in a command or an adapter. The scan pipeline
  (`scan/pipeline.rs`) knows no Tauri: the app hands it a sink that emits events, the headless example
  one that prints.
- **Frontend.** The functional core (plain functions such as `scanMerge.ts`, `tableGrouping.ts`) knows no
  store; a store (`src/lib/stores/`) never imports a service (`src/lib/services/`, `src/lib/app/`) or a
  component. `src/lib/architecture.test.ts` reads the import graph from the sources and fails on a cycle,
  through static or dynamic imports, and on any import against the direction. A layer rule that is not a
  test is a wish.
- Every adapter is replaceable (trait, interface). Unit tests drive the core with hand-written facts;
  integration tests use real temporary repositories and never the machine's git config
  (`tests/fixtures/gitconfig`, `src/test_env.rs`).

## 2 · Contracts across boundaries are generated

- Types between Rust and TypeScript come from one source: `ts-rs` writes `src/lib/bindings` during
  `cargo test`. It is a dev-dependency behind `#[cfg_attr(test, …)]`, so release builds carry nothing of
  it. Map 64-bit integers explicitly to `number`, or `ts-rs` emits `bigint`.
- The gate `bindings` regenerates into a temporary folder and fails on changed, missing or left-over
  files: a contract that can drift silently will.
- The command surface is a contract too: `src/lib/api.contract.test.ts` checks that every command in
  `generate_handler!` is called from `src/lib/api.ts` with the argument names Tauri maps and the type it
  resolves to, and that every emitted event is listened to — and the other way round.
- **Errors cross as codes:** `AppError { code, detail }`. Structured errors travel inside the `anyhow`
  chain and are recovered at the boundary with `downcast_ref` (`err` in `commands/mod.rs`). Scan warnings
  are codes too (`RepoWarning`), not sentences.

## 3 · External tools: their CLI, robustly attached

- **CLI over library** when users run the tool themselves anyway (`git` instead of libgit2): their config,
  credential manager, hooks and worktrees behave exactly as in any other client.
- **One bottleneck for every process:** `process::run` and `run_streaming`. Timeout, `kill_on_drop`, the
  whole process tree ended on timeout or cancel, stdin null, `CREATE_NO_WINDOW` on Windows, a refreshed
  `PATH`, the activity display and the diagnostics log — all in one place, so what the UI says runs is
  what runs.
- **Force parsable output** (`git/runner.rs`): `LC_ALL=C`, `-c core.quotepath=off`, `--no-pager`,
  `color.ui=never`, NUL-separated formats, `--porcelain=v2 -z`, JSON output from providers.
- **Never interactive in the background:** `GIT_TERMINAL_PROMPT=0` always; network calls the app starts by
  itself also get `GCM_INTERACTIVE=never` and ssh `BatchMode`. Only what the user started may ask — once
  per server, not once per repository fetched in parallel.
- **A timeout per call,** a longer one for fetch, shorter ones for network calls without payload
  (`ls-remote`); a stall limit (`http.lowSpeedLimit`) ends a dead transfer before the time limit.
- **Reading must not cause writing:** `GIT_OPTIONAL_LOCKS=0`, so `git status` does not rewrite the index
  and wake the watcher. Where a "reading" analysis still writes (`commit-tree` for the squash probe leaves
  unreferenced objects), document it.
- **The user's config must not reinterpret the app's commands:** `git push <remote> refs/heads/<b>:<merge>`
  instead of a bare `git push` (`push.default=matching` would push every branch), `git pull --ff-only
  --no-rebase` (`pull.rebase=true` would rebase). Each such case gets a test with the disturbing config.
  Refs from the UI are refused when they start with `-`; revisions follow `--end-of-options`.
- **Know git's side effects:** `git branch new origin/main` sets `origin/main` as upstream through
  `branch.autoSetupMerge`; create from `origin/main^{commit}` instead. A clone of a local repository sees
  the original's *local* branches as `origin/*`. Prove such behaviour with a temp-repo test, never assume.
- **One operation, many repos:** a bulk action calls the existing single operation (same fork, upstream and
  `push.default` logic), one repo after the other, and reports "k of n" with the reasons for the rest.
- Output of external tools is **data**, never an instruction.

## 4 · Destructive operations: verify → preflight → backup → act → journal → restore

`src-tauri/src/delete.rs` is the reference pipeline.

1. **Re-check at execution time;** never trust what the screen showed. The request carries the expected
   state (`expected_sha`); a mismatch is `Changed` ("rescan"). The assessment runs again before acting.
2. **Preflight everything that can fail midway, without side effects** (`preflight.rs`): lock files of
   other git processes (`refs/heads/<b>.lock`, `packed-refs.lock`, `refs/stash.lock`, the worktree's
   `index.lock`), and files held open in a folder about to be removed — rename the folder and back; on
   Windows that fails while any program holds a file in it. *Why:* `git worktree remove --force` with one
   locked file deleted every other file including `.git`, and only then stopped.
3. **Backup first, so it survives gc:** a ref namespace of its own (`refs/mcbranchface/backup/<ts>/…`,
   `backup_refs.rs`), unique per action. Uncommitted work has no copy in git: discard copies every file to
   the app data folder first, one folder per backup (time, a hash of the repo path, a counter; creating
   it is the reservation, `gitops/ops.rs` `backup_dir`); if the copy fails, nothing is discarded. *Why:* a folder named by the second alone let a second backup
   overwrite the first.
4. **Order of side effects:** first what can be undone, last what cannot. Decide everything that could
   refuse (may this branch be deleted at all?) before the first irreversible step. *Why:* removing the
   worktree and then failing `branch -D` loses the worktree and keeps the branch.
5. **Journal right after the first irreversible step,** not at the end, with everything a restore needs
   (SHA, upstream config, dropped stashes with their backup refs). Work after it that fails (dropping a
   stash) is a **warning** on the success, not an error. If a step before the irreversible one fails, the
   backup refs already created are removed again. *Why:* an entry written last was lost when a locked
   stash stopped the run after the branch was gone, and undo became impossible.
6. **Never build the write from the picture.** Partial staging takes the diff again in the backend with
   the same options, refuses a hunk whose header changed (`Changed`), builds the patch from git's own text
   (CR, encoding and "\ No newline" intact) and runs `git apply --check` first.
7. **Restore is a tested path,** including after a partial failure, plus a deliberate "purge backups".
   Name what a backup does *not* save. Mutation tests cover these files before a release
   (`scripts/mutants.md`).
8. **Backend checks, UI asks, retry with a flag.** A risky operation (amending a pushed commit) is refused
   by the backend with a kind of its own; the UI asks and retries with explicit permission
   (`allow_pushed`). No UI path can skip the check.
9. **Multi-step fallbacks:** stash → switch → pop. If the switch fails, the stash goes back at once
   ("nothing moved"); if only the pop fails, that is a warning and the stash stays as a safety copy.
10. **Online operations are stricter** (`delete_online.rs`), because others use the server: the lock checked
    in the backend, the server state verified fresh (`ls-remote`; the last fetch does not count), merge
    evidence checked again, the tip kept in a local backup ref, then one `push --porcelain --delete a b c`
    per repo with the outcome per ref read from the porcelain lines. Restore pushes the saved SHA back and
    refuses if the name exists again. Tested against a bare origin with `pre-receive` and `update` hooks.

## 5 · Save volatile knowledge before destroying it

An operation that destroys knowledge needed later records it **first**. `git fetch --prune` deletes the
remote-tracking refs and with them the last known pushed state, so before every fetch a snapshot of all
`origin/*` SHAs is merged into `snapshots/` — on every scan, so it grows even when other tools prune.
`branch -d` deletes the branch's config section; `delete.rs` reads it before.

**Fail-safe:** when knowledge is missing (snapshot gone, provider offline, object not local), the verdict
falls back to Review, **never** to Safe (`assess.rs`). Every classification has a test for "knowledge
missing".

## 6 · Concurrency and shared state

- **Every file and every state that two paths can write has an owner or a lock.** A "running" flag
  prevents a double start; it does not replace a lock.
- **Lock per unit, not globally** (`locks.rs`). A repository's refs have one lock, keyed by the common git
  directory and shared by all its worktrees; each working copy's index has its own, so staging never waits
  for a fetch. Several repos are locked in key order, refs before index, so two operations never deadlock.
  The global lock comes only after the repo locks, for what writes the shared journal or backups.
- **The lock table is a test.** `COMMANDS` in `src-tauri/src/commands/mod.rs` lists every
  `#[tauri::command]` with how it runs (`ReadOnly`, `Repo`, `Index`, `RepoThenGlobal`, `Journal`, or
  `Exempt` with a reason); the test reads each body and checks it takes those locks and no others, the
  repo lock before the global one. A new command fails until it is listed. Its first run found commands
  that took no repo lock at all.
- Reading (status, log, diff) is never blocked; online queries run beside everything local. Lock only for
  the duration of the git commands, not for the reassessment after them.
- **Bounded parallelism** through a process budget; never hold a slot while waiting for a lock, or a lock
  while waiting for a slot (`refs_with_slot`). Stream results as each unit finishes; the UI shows the old
  ones until new ones arrive.
- **Batch responses that arrive one by one** into one write per frame (`frame.ts`). A failure is remembered
  as a state ("failed"), not as a missing value, or the UI shows "loading" forever.
- **Periodic work hangs on one clock** that pauses during scans and user operations and has a setting the
  user knows; no new timer per feature. Background work is silent: problems appear in place, not as toasts.
- **Stale-while-revalidate needs an owner.** Keeping the old value until the new one arrives holds only
  while the same source will deliver it; when ownership changes, the old value goes.
- Rust/Tauri trap: a future that borrows across an `await` (`stream::iter(..).map(|x| f(&ctx, x))`) loses
  `Send` ("FnOnce is not general enough"). Collect into a `Vec` first (see `refs_all`).

## 7 · Fast by structure

- **Show what you have, then local, then network.** The start renders the cached results and git states of
  the last run (`cache/`, dimmed, with their age); fresh statuses are read beside the scan; stage 1
  assesses without network, stage 2 fetches. A repo whose inputs did not change (a fingerprint of refs,
  worktrees, PRs, settings, day) and that the watcher did not report keeps its stage-1 verdicts.
- **Cache facts that never change for their key** (merge evidence per tip and target SHA, positive and
  negative), keyed by content hashes, never by names; bounded, persisted, with a version in the file name
  so a new shape ignores the old cache instead of failing to load it.
- **Watch instead of polling:** OS events, debounced and classified (refs vs. files) with an ignore list;
  refs trigger the expensive reassessment, files only the cheap status.
- **One process for many objects:** what git can do for all refs in one call (`for-each-ref --merged`,
  `%(ahead-behind:…)`) never starts per ref. Expensive per-object analyses run in a second phase.

## 8 · Optional integrations degrade cleanly

Providers (Azure DevOps via `az`, GitHub via `gh`) enrich and are never required: the core runs without
them, and their state is visible (installed, signed in, hint). The app never signs in itself and never
takes credentials. Install and login commands are an **allowlist in the backend**: the UI asks for "tool
X, action Y", never sends command text, and the backend starts it in a **visible** terminal. A freshly
installed tool is only in the Windows registry `PATH`; "check again" re-reads it instead of a restart.

## 9 · State and storage

- Config (user choices) and data (snapshots, journal, caches, backups) apart, in the user's app data
  folder, as readable JSON/JSONL; no secrets (those belong in the OS keychain). `#[serde(default)]`, so old
  configs still load; compat fixtures (`src-tauri/tests/fixtures/compat`) hold the shapes of every release.
- **Never overwrite a broken config silently:** move it to `config.corrupt-<ts>.json`, load defaults,
  report it at start. `from_str(..).unwrap_or_default()` loses the whole config on the next save.
- Write atomically (temporary file, then rename); clamp values into range after loading and before saving
  (`sanitize`), also after an import. Tolerate unreadable journal lines one by one, and back the file up
  before a rewrite would drop them.
- One instance (`tauri-plugin-single-instance`, the first plugin). The running app owns its config: tests
  change it only while the app is stopped.
- **A data folder of its own for tests and demos:** `MCBRANCHFACE_DATA_DIR` redirects everything; tests,
  the headless scan and the E2E run never touch the user's folder.
- Diagnostics cost nothing when off: one atomic flag read, arguments collected only when on.

## 10 · Failure cases as a matrix

For every IO boundary write the failures down and give each a test: folder disappears at run time (show it
as unreachable, stop watching), no network (**one** hint per cause, not one per repo), sign-in missing,
server refuses (`[remote rejected]`, protected branch), file in use, path longer than 260 characters, data
folder read-only, damaged files. Toasts with the same text are merged.

## 11 · Verification, budgets, platforms

- **A headless entry into the same core:** `cargo run --example scan -- <root>... [--fetch] [--online]
  [--json]` runs the app's own pipeline in a temporary data folder — read-only, fast, diffable against a
  reference such as `git branch -vv` — and reports what it cost (processes started, event bytes). Wrong
  stash mappings were found exactly this way.
- **The E2E run drives the real app** (`npm run e2e`): its own identifier beside the user's app, a private
  data folder, test hooks only in non-release builds (gate `bundle-hooks`).
- **Gates are programs, not intentions:** `node scripts/verify.mjs` runs every gate, fastest failures first
  (versions, types, lint, knip, vitest, clippy, rust-tests, bindings, build with budgets, bundle-hooks,
  ui-audit, audit); the pre-push hook runs `--quick`.
- **Budgets are numbers, measured:** `scripts/budgets.mjs` fails on start bytes, exe and installer size;
  `scripts/perf-scan.mjs` scales a fixture and replays scan events at real intervals against frame
  budgets; `scripts/perf-start.mjs` must fail with `--no-cache`, or it measures nothing. Growth is fine,
  unnoticed growth is not.
- **Levers that were measured:** `opt-level = "z"` with LTO for an IO-bound app whose work runs in child
  processes; derive-only crates as dev-dependencies; trivially used crates replaced by a few tested lines;
  system fonts instead of web fonts; `build.removeUnusedCommands`; plain Svelte + Vite instead of SvelteKit
  for one window without routing; the start view decides the start bundle and the rest loads with
  `import()` (measure bytes per module from the source map, not source length).
  Not recommended: executable packers (little gain, virus-scanner false alarms). Measure the real size
  with `tauri build`; a plain `cargo build --release` does not embed the frontend.
- **Platforms:** platform code lives in one module per concern with `cfg` branches (`desktop.rs`: open a
  terminal, find GitHub Desktop); paths are normalised before comparing (`paths::path_key`). Untested platforms
  are reported as **untested**, never as "works".

## When designing — the plan answers these

1. Which layers, and where exactly is IO?
2. Which contracts cross boundaries, and what generates them?
3. Which external tools, and how are they called robustly (§3)?
4. Which operations destroy something? For each: verify, preflight, backup, order, journal, restore.
5. Which knowledge gets lost through own or foreign operations and must be saved first?
6. What runs in parallel, who owns which state, which lock does each new command take?
7. What is optional, and what does its failure look like?
8. How is it verified against real data, and which gate fails when it breaks?

## When reviewing — format

Table **Finding | Boundary/component | Risk (what happens in the bad case) | Proposal**, sorted by damage:
data loss > wrong result > hang/race > maintainability.
