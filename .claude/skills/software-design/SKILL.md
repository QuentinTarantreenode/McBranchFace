---
name: software-design
description: >-
  Design and review code at the level of modules and functions: one source per fact (SSOT), one job
  per unit (SRP), facts → classify → explain as pure functions, a backend that returns facts instead
  of UI text, no silent limits, no dead code, every bug first as a red test, heuristics checked against
  real data. Applies to the Rust backend and the TypeScript/Svelte frontend alike. Use when a
  contributor says "code review", "design review", "is this SSOT", "SOLID", "single responsibility",
  "clean code", "refactor", "this function is too long", "too many parameters", "duplicate",
  "defined twice", "dead code", "testability", "how should I structure this" — and unasked when
  designing a new module or before reporting a larger change as done. Neighbours:
  software-architecture (layers, boundaries, side effects), product-review (the whole review),
  author-blind-review (an outsider hunts for bugs).
---

# Software design — one source, one job, provable

Code can work, be tested, and still define the same fact in six places. Each rule below exists because
that kind of defect survived green tests; where it helps, a *Why* line says what went wrong without it.

## 1 · SSOT — every fact has exactly one source

Search patterns for a review (grep, then judge each hit):

| Symptom | Example | Instead |
|---|---|---|
| Several maps over one enum | `Record<Verdict, …>` for label, hint and tone in three components | one map per concern, typed against the enum: text in the dictionary (`t.verdict`), colour in `VERDICT_TONE` |
| Composite keys built by hand | `` `${repo}::${name}` `` while `branchKey()` exists in `filter.ts` | only the function, never the literal |
| DTOs written twice | hand-written TS interfaces beside Rust structs | generated: `ts-rs` writes `src/lib/bindings` |
| Copied class or style strings | the same button classes in five places | a component with variants |
| A config value in two places | minimum window width in the config **and** implied by the column layout | one defines it, the other references it or documents the arithmetic |
| A domain rule twice | "what is Safe" in Rust and rebuilt in Svelte | the rule lives in the core; the frontend shows the result |
| A UI pattern rebuilt | group heads with five heights, counters and fold logics | one component (`GroupHead`), one store (`stores/fold.svelte.ts`) |
| One object, several menus | a repo with different menus on card, worktree row and group | one builder (`copyMenu`); each place only adds its own entries |

Rules of thumb: changing a fact touches **one** file. Whoever builds a pattern a third time extracts it.
Whoever builds the same action in two places builds two rules that will drift apart.

- **One storage per fact.** Scattered fields (a repo colour here, folder colours from position there)
  become one record keyed by identity (`identities["repo:…"]`). Old fields are taken over on load by
  `sanitize` and stay read-only.
- **Order is data.** Where order means something (folders in the sidebar), it is the order of the config
  list and nowhere else; dragging changes the list. Deduplicate at every position, not only neighbours.
- **One panel, many triggers.** A panel opened from several places keeps its state in one small shared
  module and renders in one place; triggers only set that state. A mode is a value, not a second panel.
- **What an element can do, it says itself.** A tooltip promising "double click opens the folder" and the
  handler were two places that drifted. The gesture registers its hint where it is wired
  (`use:doubleClick={{ run, hint }}`); a tooltip only asks for registered gestures.
- **A rule that must run in two places gets one test table.** When the frontend reclassifies without a
  round trip (the user changes the inactivity threshold), the backend sends the *facts*, not only the
  verdict, and both implementations run against the same table
  (`src-tauri/tests/fixtures/online-rules.json`: `include_str!` in Rust, `import` in vitest), each row
  with a `why`.
- **Templates with variables: one table** feeds the renderer, the editor chips and the help. Built-in
  text becomes a template itself, with a test that its render equals the old output.

## 2 · SRP — collect facts, classify, explain

The most common violation is a function that fetches data, judges it **and** writes the text.
*Why:* a 150-line analysis function and a check builder with 10 parameters behind
`#[allow(clippy::too_many_arguments)]` could not be tested without git.

```
collect(io)      -> Facts        // side effects: git, providers, files
classify(&Facts) -> Verdict      // pure
explain(&Facts)  -> Vec<Check>   // pure, structured (kind, outcome, params), no UI text
```

- `Facts` is a struct with named fields: it removes parameter lists and is the natural test input. See
  `src-tauri/src/assess.rs` (`Facts`, `classify`, `checks`): every rule has a test with a hand-written
  `Facts`, no IO, milliseconds.
- **Review signals:** a function over ~60 lines, more than 5 parameters, a lint `allow` for complexity,
  `// --- step 3` comments. These are the seams to cut at.
- **Next steps are a pure function of the same facts.** `todos(report)` in `src/lib/todos.ts` returns
  typed entries without text; the component turns them into sentences and buttons, the tests check order
  and choice without a DOM. The tool's rules belong inside (a push onto a deleted server branch would be
  refused or recreate it, so it is `ready: false` and the view shows the way instead of the button), not
  in the view.
- **Selection is a pure function over the visible order:** `nextSelection(state, action, order)` in
  `src/lib/selection.ts` knows click, Ctrl, Shift, arrows, all and none. A filter derived from the
  selection follows it; setting that filter from outside replaces the selection instead of creating a
  second truth.
- O, L, I and D in the same spirit: a new variant (another provider, another kind of merge evidence) is a
  new case in a list or a new trait implementation, not one more `if` in an existing function. External
  systems sit behind a narrow interface (runner, provider) that tests can replace.

## 3 · The backend returns facts, not UI text

Sentences in the Rust core mix presentation into the domain: text cannot change without rebuilding the
core, two places phrase things, and no translation is possible. The core returns
`{ kind, outcome, code, params }`; the frontend phrases. Exception: technical messages of external tools
pass through, with context in front.

- **Errors are facts.** Commands return `AppError { code, detail }`, not `String`; a delete step fails
  with a `DeleteFailure` carrying `FailureKind`, step and path. The kind is an enum the UI maps to a title
  and a way out (one text map); `detail` is the raw message for "technical details". Mapping raw text to
  a kind is a pure, tested function (`failure::classify`). git runs in the C locale; OS errors are
  recognised by code (`os error 32`), never by localised text.
- **Dictionaries are the source of all text.** `src/lib/i18n/de.ts` defines the shape (the type
  `Dict`), `en.ts` must satisfy it. Texts with values are functions, so placeholders and
  plurals are compiler-checked; backend enums map via `satisfies Record<Enum, …>`, so a new enum value
  without text is a compile error. `i18n.test.ts` compares keys, leaf kinds and parameter counts and gives
  every error kind a title and a way out in both languages. No translated text in module constants (it
  would not follow a language switch); labelled lists are `$derived`. Colour classes stay apart from text
  and are written out in full (Tailwind does not see composed class names). Dates and numbers use
  `Intl.*` with the active locale. The lint rules in `eslint-rules/` forbid literal UI text in markup.
- **Sentences with data are rich text, not concatenated strings.** A sentence with a ref, a number or a
  SHA comes from the dictionary as parts (`src/lib/rich.ts`: `ref`, `strong`, `mono`, `path`); the UI
  decides how a ref looks, the grammar stays in the language.
- **One error kind in two areas needs two texts.** `Changed` from deleting says "rescan"; the same kind
  from partial staging would give wrong advice. Reusing a kind in a new area means checking the text the
  user then reads. Advice says what happened, what did *not* ("nothing was changed") and what to do now.
- **A hint names only ways that exist.** Every sentence that points to a feature is checked against that
  feature; if it is missing, the text names the way outside the app (the git command) and the gap goes on
  the list.
- **Visibility is not an assessment filter.** Assess everything and return the state as a fact
  (`upstreamState`); what is shown is a remembered switch in the UI that cuts the list at the source
  (`localInView`), so rows, counters and facets follow by themselves. What deliberately does not follow
  uses one named predicate (`isOrphaned`). *Why:* assessing only some branches left branches visible in
  one view that could be cleaned up nowhere.

## 4 · No silent limits, no silent swallowing

- Every limit (paging, `--max-count`, a timeout, a cap on a list) reports when it applies. *Why:* a capped
  PR list would have claimed "no PR found". Better than a message is removing the limit: let git filter
  (`--grep`, `--author`, `-i --fixed-strings`) instead of loading the last N commits and filtering those.
- `unwrap_or_default()`, `.ok()` and `catch {}` only where "absent" truly means "empty". Otherwise a
  warning goes to the caller.
- Errors carry context: what was tried, with what, and what came back.
- **Silent defaults are decisions somebody else makes.** Where the code chooses for the user (start point
  of a new branch, target of a backup), the choice is visible or documented with its reason. Ask each
  path: "what happens in the repo that does not have this branch?"
- New defaults for existing configs are offered once (`…DefaultsKnown`), not on every load: a pattern the
  user removed stays removed. Loading never writes back.

## 5 · Heuristics need counterexamples

Every mapping "probably belongs to X" (stash ↔ branch, commit ↔ PR) has a case where it maps wrongly.
Write the counter-case down before building and turn it into a test. Explicit evidence (the branch name
in the stash message) beats derived evidence (ancestry); derived evidence applies only when no explicit
evidence contradicts it. *Why:* mapping stashes by ancestry gave a release branch's stashes to every
feature branch cut from it; only a run on real data (`cargo run --example scan`) showed several branches
wrongly marked Unsafe.

- **Classifying tool output: the specific result first.** Tools print more than the cause: `git commit`
  with nothing to commit prints the whole status, which may mention "have diverged". A chain of
  `contains` checks tests the operation's result before incidental context, and matches numbers only with
  context (`returned error: 401`, else it hits paths and SHAs). Each rule gets the **real** output as a
  test case.
- **Algorithms over sets: test the growing case.** A rule that decides for a whole set (labels, column
  widths, groups) is tested with one more element that resembles only part of the set. "Distinguish all
  on one level, else fall back" then flips for everyone; decide per subgroup and fall back only there.
- **Sorting is stable and complete:** a tiebreak down to uniqueness (name → repo path → remote). Without
  it, equal names swap places on every rebuild and a virtual list jumps.
- **Runtime IDs come from a counter,** plus time for readability. Second-plus-count repeats as soon as a
  run ends.
- **Placeholders must not collide with the target language.** Shell templates use `{{name}}`; single
  braces are everywhere in PowerShell and sh. Unknown names stay as written and are reported, so a typo
  shows in the preview instead of vanishing.

## 6 · Tests that prove something

- **Bug → red test first.** Reproduce, see it red, fix, see it green. The test names the case ("stash on
  base branch is not attributed to feature"), not the implementation.
- **A test that would be green without the fix proves nothing.** Check that it is red before writing the
  fix. If it cannot be made red on this machine, say so and question whether the problem exists here.
  *Why:* a custom long-path prefix came with a test that was green without it, because Rust's `std::fs`
  adds the prefix itself; the fix went, the test stayed as a regression guard.
- **Every check is proven with a planted fault.** A rule that never fires looks like one that finds
  nothing. Plant a hit (a dead dictionary key, an overlapping element, a literal UI string), see the run
  go red, revert. The lock-table test in `src-tauri/src/commands/mod.rs` ends by checking its own parser
  for that reason. A fixture must contain the state a view is meant to show, or the audit is green for an
  empty view.
- **Cut for testability instead of forcing coverage.** Parsers of tool output live beside the call and
  are tested with recorded real output; the call stays thin. Error paths come from the file system, not from
  mocks: a folder where a file is expected, a `pre-receive` hook that refuses, a dead `pushurl`, a locked
  worktree. What only a race can reach is named in the report, not "covered" by injection code.
- **Tests share no time and no module state.** A debounced write of one test fired into the next test's
  backend; `afterEach` clears pending timers. A test sets the state it needs instead of inheriting it.
  Green alone and red in the suite is a finding about shared state, not chance.
- **Wait for the result, never for a number of ticks.** A test that flushed a fixed number of microtasks
  was green only because an earlier test had already loaded a lazy module. Use `vi.waitFor`
  (`src/test/wait.ts`).
- **E2E waits for what the next action needs,** not for the first thing that changes: after staging a
  hunk the file list updates before the diff below it, and selecting lines then hits the old diff. A step
  that counts things earlier steps changed checks the shape, not a fixed number.
- **Audit views prove their precondition and reset what they open.** A view meant to show an open menu
  throws if the menu is not open, else it audits the page behind and is green for nothing. A dialog left
  open covers every following view, so each new surface that can open joins the reset in the same commit.
  Fixture values are pinned by index, not drawn from a random stream.
- **Long checks report progress and have time limits** per step that count as a finding, so a slow run
  can be told from a hung one.
- **Mutation tests** cover the destructive paths before a release (`scripts/mutants.md`): a surviving
  mutant is a line nobody checks.

## 7 · Reactive state (Svelte 5)

- **An effect does not read what it writes.** An effect that resets state depends only on its cause; the
  rest is read in `untrack`. *Why:* "filter empty → clear the field" read the field itself and erased
  every keystroke; only an E2E run with real input events found it.
- **Late responses carry no settings.** Flags that follow from the config (locked, ignored) are set from
  the *current* config when an async response is applied, not from the response, which may have been
  computed before the last save. *Why:* a rescan after undo overwrote an ignore set a moment earlier.
- **Selection hangs on content, not on the object.** Data refetched on every refresh is a new object each
  time; clearing the selection on a new object loses it on every background refresh. Reset only when the
  key the selection refers to changes (path, source, hunk headers), as a `$derived` string. Do not clear
  after an action: success changes the content and with it the key; failure keeps the selection for the
  retry.
- **Derive once per change, not per row.** A getter every row calls that walks the whole selection is
  quadratic; a `$derived` `Set` is O(1) per row. Use existing indexes (`repoByPath`) instead of `find`.
- **Keep derivations stable.** A map rebuilt on every event invalidates every row; rebuild only when a
  comparison key changes (`infoKey` in `stores/scanResults.svelte.ts`). Apply many small events in one
  write per tick, normalise a query once, share one `Intl.Collator`.
- **A state with inverted meaning gets a name.** A fold list that holds the *open* entries was toggled
  like all the others and wrote back the same state; the row never opened and no test noticed. The
  exception gets a named function with its why (`toggleWorktrees`) and a test that opens **and** closes.

## 8 · Dead code

- After every decision ("dark is the default"), remove the paths it made unreachable (a fallback media
  query, unused sort keys or fields). In a review, check every config variant for reachability.
- Find it by program: `svelte-check` and `knip` (gates `types`, `knip`), `clippy -D warnings`, and
  `src/lib/unused.test.ts` for what those cannot see — dictionary entries, CSS classes, colour tokens. Such
  a check must know built names (`t.verdict[v]`, `var(--id-${n})`) and Tailwind namespaces, or it raises
  false alarms; and it must be proven with a planted dead entry, or it may be reading nothing.
- Merge duplicate code only when it is the same knowledge (two parsers of the same output), not merely the
  same shape.

## 9 · Readability

Identifiers, comments and log texts in English. Comments explain *why*, never *what*, and stay generic: no
names of people, customers, tickets or machines. No doc blocks that retell the code. New code looks like
the code beside it.

## Before the first line of code

1. Which facts exist, and where is the one source of each? Write the list into the plan.
2. Where is the line between IO and pure logic? Sketch the `Facts` struct.
3. Which heuristics, and what is the counter-case of each? Phrase them as tests.
4. Which limits exist, and how do they report themselves?
5. Which text does the user read, and which dictionary key holds it?

## Review — procedure and format

1. Grep passes: one enum in several maps, key literals, copied class strings, lint `allow`s,
   `unwrap_or_default` / `.ok()` / `catch {}`, function lengths (largest files first).
2. Every heuristic: look for the counterexample, run it against real data.
3. Result as a table **Finding | Location (`file:line`) | Consequence | Proposal**, grouped by
   SSOT · SRP/SOLID · correctness risks · test gaps. No finding without a location.
