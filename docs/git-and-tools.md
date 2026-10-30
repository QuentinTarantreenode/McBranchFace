# Git perspective and tools

Working copies for parallel work, the diff viewer, prompts, custom commands, the start sequence, help and onboarding. Back to the [README](../README.md).

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
