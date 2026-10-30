# Cleanup and the branch table

What the Cleanup perspective checks, how the table and the sidebar work, and how locks, alerts and ignores keep stale branches in view. Back to the [README](../README.md).

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
