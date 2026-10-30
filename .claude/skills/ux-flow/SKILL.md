---
name: ux-flow
description: >-
  Design and review the McBranchFace user experience from the user's path: first understand the use (who, how
  often, which primary task), then check that the UI carries that path in few steps — primary action,
  progressive disclosure, delete with confirmation, progress and result, provoked error cases, the information
  for a decision where the decision is made, no empty areas, no hidden gestures, texts in the user's language.
  Applies when building a new surface and when reviewing one. Use when a contributor says "ux review", "user
  experience", "user flow", "user journey", "how is this used", "too many clicks", "too many steps",
  "streamline", "too cluttered", "is this intuitive", "does the ui support the user", "workflow", "error
  message", "empty state", "onboarding", "wording" — and without being asked before a new surface is built or
  reported as done. Neighbours: ui-layout (visuals, measuring), ui-critique (critique of the whole UI),
  product-review (overall review including code).
---

# UX flow — the user first, then the surface

A surface is good when the **most frequent path is the shortest**. Whether it looks right is ui-layout's
question; whether it *carries* the user is this one's. Why: a version that was functionally correct hid the
task the tool is opened for nine times out of ten behind a 14-px checkbox.

## Step 1 · Write down the user's path — before building or judging components

Without this step every UX finding is taste. Answer five questions in writing:

| Question | Example (cleanup perspective) |
|---|---|
| Who, how often, with what knowledge? | A developer, every few days, knows git well |
| With which goal does the surface get opened? | "Get rid of old branches without losing anything" |
| What is the primary task, and what share of the cases? | Delete all Safe branches: most of them |
| What are the exceptions, and what is needed to decide them? | A few branches with a stash or unpushed commits: see the content, then clean up or force delete |
| When is the user done? | The list is empty, or holds only branches kept on purpose |

From this comes the **target path** as numbered steps (open, overview, do the bulk, handle exceptions one by
one, done). Every later finding refers to a step of this path.

## Step 2 · Rules

### The primary task leads
- **The primary task is the most visible action:** a primary button with the count ("Delete 45 Safe
  branches"), in a fixed, prominent place, respecting the active filter. Selection checkboxes are the way for
  exceptions, not for the normal case.
- **Count the clicks, merge what always comes together** (switch to the default branch and delete), as long as
  the precondition is checked.
- **Problems loud, passed checks quiet:** errors and warnings in full and on top; passed checks fold into one
  line ("4 of 5 OK ▸"). Five green tiles of equal size are noise.
- **Steps first, then reasons:** a list of red findings says what is wrong, not what to do. The detail shows
  "To do" first: numbered steps in the order git allows them (save, push, finish, free, delete), each with the
  button that does it, else with the way there; the check below is the reason. A button that would fail (git
  will not delete a checked-out branch) is not offered; the step says why. A finding without a next step is
  unfinished.
- **The information for a decision stands where the decision is made:** every verdict with its reason, every
  stash with its file list. Why: "1 stash" without content sent the user to the terminal.
- **No empty areas:** after loading, select the first item that needs action, or show a summary with next
  steps. Each empty state (nothing found, nothing matches the filter, not set up yet) has its own sentence and
  an action.
- **Important first, extras later:** an object is usable as soon as it is known (name, folder, menu,
  selection); status, counts and files load after. Many of a kind (five worktrees and more) fold into one line.

### Delete: confirm, progress, result
- **Always ask, even with undo.** One dialog for every entry point (button, row icon, Del key, batch), three
  phases:
  1. **Confirm:** what exactly happens, grouped (by repo), each item with the reason it is safe (merge
     evidence) and how to restore it. The primary button names the count ("Delete 4").
  2. **Progress:** a bar with `x / n`, the current item by name, a state per item (waiting, running, ok, failed,
     skipped). Cancel stops after the current item; Esc, a click beside and the close button are locked meanwhile.
  3. **Result:** only the counts above zero, errors inline at their item, then Retry (failed and skipped), Undo
     all, Close. It stays until the user closes it.
- **With remaining risk** (force): list concretely what gets lost (commits with subject, files, stashes) and
  confirm by typing the name, never a generic "Are you sure?". What the backup does *not* save is said in bold.
- **Undo** lives in a message for at least 15 s (shorter was missed) and permanently in "Recently deleted",
  because messages are fleeting.
- **What affects others costs more:** deleting on the server says it affects everyone, never autofocuses the
  delete button, needs the typed name for an unmerged branch. Other people's entries are marked and unticked,
  with a sentence giving their number. Follow-up work (the local tracking branches) is an option in the same
  dialog, and undo brings it back too. Removing a worktree tries without force first; with changes a second,
  red question follows, and the changed files are copied before.

### Clarity of every control
- **A click says what it does.** A button names verb and object ("Push in Git", "Delete 59 branches …"), never
  only a place or a bare verb. Everything that shows the hand cursor says in its tooltip what a click does. A
  row that names something leads exactly there, filtered, and says so. What belongs to an object is in that
  object's menu (a repo's pull requests), not only in the top bar; a badge shows only a number above zero.
- **No hidden gestures with side effects:** gestures speed up what is visible, they never trigger anything of
  their own. Every gesture is named in the tooltip foot (`src/lib/ui/gestures.ts`), every drag has a menu path.
- **Disabled controls explain themselves or go:** a tooltip with reason and way out. A column of disabled
  checkboxes is noise. Locked for a while means: the content stays, the tooltip says what it waits for
  ("Running: Pull."), and only the affected repo's elements are locked.
- **File actions go to the file:** "In file manager" shows the file selected; a deleted file shows its folder.
  An entry that does almost the same as another one is dropped.
- **Filters in one place, navigation in another:** the sidebar navigates, the bar above the list holds every
  filter (status chips with counts, search, "Only mine"). Active filters are visible, resetting is one click.

### Language
- **The user's language, not the implementation's:** buttons describe the result, not the mechanism. The
  domain's terms are the user's language: whoever knows git looks for Fast-forward, gone, ahead, behind, Push;
  invented translations make them search for a feature that does not exist. One term everywhere.
  `src/lib/i18n/typography.test.ts` holds the forbidden translations, exceptions named with their reason; a
  new pattern is proven once on a planted hit.
- **Names short, explanations as sentences.** Names (buttons, menu entries, tabs, columns, titles, counts such
  as "2 changed files") are short, start with a capital, no final period. Explanations (tooltip text, hints,
  messages, empty states, help) are full sentences with a period: the thing is the subject, third person
  ("Deletes every Safe branch the filter shows right now. The app asks first."); a request addresses the user
  ("Switch to the default branch first."). Two statements are two sentences, no keyword tail after a dash. A
  command never starts a sentence. Several hints in a tooltip foot stand on lines of their own. The typography
  test checks every explanation of four words or more in both dictionaries (`src/lib/i18n/de.ts`, `en.ts`),
  which always change together.

### Feedback and errors
- **Feedback for everything that takes time,** per unit (a spinner per repo, "Scanning 3/7"); old results stay
  until new ones arrive; nothing freezes without a sign. Four states per element: **there** (fresh or cached,
  usable; actions fetch the fresh state first), **loading** (never seen: placeholder, not usable), **working**
  (an operation runs: visible, locked, tooltip names it), **failed** (says so instead of loading on). Everything
  else stays usable.
- **Say what runs:** source (local, server, provider), operation (fetch, read pull requests, read status) and
  place (repo), in **one** place (the status slot in the top bar), only when the user turns it on, no
  milliseconds in the UI. Own runs over several repos always show `n/m` and can be stopped. Whatever happens on
  its own (background refresh, server check) can be looked up and switched off.
- **Provoke error cases, don't assume them:** a lock file of another process, a file held open by another
  program, a folder that vanished, a state changed since it was shown, a sign-in that is needed. Why: only
  watching it showed that a locked file in a worktree once led to all other files being deleted, and that a
  branch reported "error" although it was already gone.
- **Every error message answers four questions:** what happened (in the user's words), what can I do (a
  concrete way out), where (the path, selectable), and was anything changed already ("Stopped at …; nothing
  was changed", or clearly red when it was). The raw git or OS text is folded under technical details. A partial
  success is a success with a warning. Every error kind has a title and a way out in both languages (checked
  by a test against the backend's enums).
- **Test with real data, not only fixtures.** Fixtures show the built cases; real repos show which cases exist.
  Why: only a run on real repositories showed several branches wrongly rated Unsafe, which users experience as
  an over-cautious tool and then ignore.

### Sets, groups, selection
- **Actions on sets:** count before ("Push (2)"); a zero is disabled with its reason. One question for all
  (bring changes along or stash them, once). Run one after the other when a sign-in may be involved; a failure
  leaves the others, and the message offers the way back; what was skipped (no upstream, detached,
  unreachable) is named in the result. Nothing vanishes silently.
- **Batch actions at every level of a grouping** (status group, repo, folder), in the context menu and a visible
  `⋯` button. Discarding across several repos does not exist: too much at once that never comes back.
- **A choice that differs per target is visible before the start** (the start point of new branches);
  "only create" is its own button for those who prepare without switching.
- **Same concept, same handling:** a folder head and a group head select, fold and open their menu alike; an
  object offers the same menu on its card, as a worktree row or as a group member; the place only adds its own
  entries.
- **Selection like a file manager:** click selects one, Ctrl toggles, Shift selects a range, Ctrl+Shift adds
  one; every single member of a group is selectable. Keys: ↑↓ (j k), Shift+↑↓ extends, Space toggles, Enter
  selects only this one, Ctrl+A all visible, Esc none, ← to the group head; one tab stop per list (roving
  tabindex). An action on a multi-selection applies to all of it.
- **The selection belongs to the list:** when a search filters the selected item away, the selection moves to
  the first hit. The detail never shows what the list does not.
- **Groups fold as expected:** every group folds; a parent hides everything below; expand and collapse all
  once per area (section tools), plus Alt+click on the chevron, Alt+arrows and the menu, no extra button on
  every head. The fold state survives a restart. Every level indents.
- **Manage things where they are listed:** add, remove and reorder folders in the sidebar itself (button, drop
  from the file manager, drag the head); a duplicate or nested folder changes nothing and a message says why.

### The tool speaks up
- **Mute is not protect:** Ignore takes something out of the bell and notifications but keeps it visible and
  usable (own section, a duration submenu, it reports again when the period ends); Lock protects, and the
  backend refuses too. Locked things sit in a folded section at the end, without delete actions.
- **The bell** counts what needs attention, per lens; a lens opens the same table filtered, it is no second
  surface. System notifications only for what is new since the last run, and they can be turned off.
  Closing hides into the tray, and the first time says so once by notification (a message in a hidden window
  is never seen); without a tray host closing quits, and the settings say why the option is locked.
- **The dashboard says what is due:** "Next" is a table with column heads (what, why, where, scope, action);
  each row one sentence and one action, dismissed until its state changes; many of a kind are summed up per
  repo. The sidebar selection narrows it, with a visible note and "Show all".
- **Freshness of other people's data is shown in place** ("as of 5 minutes ago", the last fetch failed), not
  as a message.

### Setup, settings, help
- **The tool says what it needs:** it checks its external programs itself (git required, provider CLIs
  optional), in parallel to the first load, never before it. One card per dependency: state, version, required
  or optional, its purpose in one sentence, and the action for the state (show the command, copy, run in a
  visible terminal, official page, check again without restart). Reachable later from the settings and the
  status chips; a required one missing later brings the onboarding back instead of a broken main view;
  optional ones degrade visibly and never block.
- **Onboarding layout:** steps on the left, content on the right, a fixed action bar (Back left, forward
  right). Never two buttons with the same effect.
- **Proposals instead of empty fields** (free folders, a branch name after a template); check before creating
  and say per row what is in the way; if one of several fails, only that one is cleaned up; the result shows in
  the dialog itself, not again as a message; what was created is visible at once.
- **A preview is rendered by the code that executes** (custom commands, prompt templates); unknown placeholders
  stop before the start, with the list of allowed ones.
- **Settings:** what can follow the system (language, theme) offers "System" as a choice and as the default,
  and follows a change at runtime. Language switches at once, also in the onboarding. Export carries an app
  and format marker; import shows a preview and refuses foreign, broken or newer files with a clear message.
  Settings made from a context menu also show in the settings, removable there.
- **Help:** F1 opens the topic of the current view (overview, topic, section, search, "Show" links into the
  UI). Shortcuts and error texts come from the same source as the UI; references to settings pages are checked
  by a test. A new feature reaches the help in the same change.

### Git client patterns users expect
- Counts on the actions ("Pull ↓5", "Push ↑1"); the button that has something to do stands out.
- A branch switcher as a popover with search, keys and "New branch …" at the end; switching with local changes
  offers "Bring along", "Stash", "Cancel" instead of a raw error.
- Conflicts as their own group on top, the diff with markers; stage actions at the row and per group; Space
  stages, Del discards after a question with the file list.
- The commit box below the file list: length counter for the summary, `Ctrl Enter`, amend takes the last
  message, a disabled button says why. Branch names are checked while typing; the backend decides anyway.
- The first file or commit is selected; a diff area is never empty when there is something to show.

## Step 3 · While building
Write the user's path into the plan before the component list; per step note component, action and clicks.
Build and test the primary task first. Empty, error and loading states are part of done. Before "done", click
through the whole path once (over CDP, see ui-layout) and count the clicks.

## Step 4 · Review output
First the user's path (short, numbered), then findings by priority: **P1** breaks or slows the primary task;
**P2** grouping, clutter, detours for exceptions; **P3** polish. Each line: **Finding | why it bothers the user
(which step) | proposal.** Then "What is good and stays", so a rebuild does not tear down what works. Before
closing, the visual check of ui-layout (is it obvious what each area shows and what each button does, any
redundancy, empty areas, missing help). Last an order of implementation and the question what to implement.
