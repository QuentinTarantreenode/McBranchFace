import type { HelpDict } from "./types";

export const help: HelpDict = {
  title: "Help",
  search: "Search help",
  back: "Back",
  show: "Show in the app",
  noMatch: "Nothing found.",
  groups: { start: "Getting started", cleanup: "Cleanup", git: "Git", setup: "Setup", reference: "Reference" },
  forView: "For this view",
  topics: [
    {
      id: "overview",
      title: "Overview",
      summary: "What McBranchFace is for and how the window is laid out.",
      sections: [
        {
          id: "what",
          title: "What McBranchFace does",
          body: [
            "McBranchFace assesses every local branch and the branches on the server. By default the local list shows only gone branches: branches whose upstream was deleted after a pull request ([gone]). Switched off, “Gone only” also shows the ones the server still has, and those never pushed.",
            "Every branch gets a verdict with evidence. Nothing is deleted without confirmation, and always with a backup ref – every deletion can be undone.",
          ],
        },
        {
          id: "layout",
          title: "Window layout",
          body: [
            "- On the left the sidebar with every repo under your folders, one card per repo with its worktrees below; a click filters the table to one repo, with Ctrl or Shift you add more. The selection holds in both perspectives; Git shows the repo clicked last. The legend explains the signs on the cards.",
            "- In the middle the table of branches, switchable between Local and Online.",
            "- On the right the detail pane: the verdict at the top, then “To do” with the git steps up to deleting, then the checks, note & tags and the evidence.",
            "At the top you switch between three views, as tabs: Dashboard (Ctrl 1), Cleanup (Ctrl 2) and Git (Ctrl 3). The active tab runs into the view below it. Dashboard counts what is due, Cleanup the branches safe to delete, Git the changed files of the repo it would open. Past a divider come “Connections”: the status of Azure DevOps and GitHub, a click signs in and opens links. Then the “Data” group: Refresh, the crossed-out cloud for “reassess without the server” (the running button turns its icon) and the age of the data; a click on it shows what refreshed when. On the right alerts, commit search and history, then window and appearance, then help and settings.",
            "Tooltips name at their foot what an element can do besides the click – such as “Double click: open in the file manager” or “Right click: more actions”.",
            "Every branch name copies by right click – in the table, on the sidebar cards, in the detail pane, in the Git view and in dialogs. Remote branches offer the name with and without the remote.",
            "The whole interface can be enlarged: Ctrl + and Ctrl − in three steps, Ctrl 0 resets to 115 % (also under Settings → Appearance).",
          ],
          show: { perspective: "Cleanup", scope: "Local" },
        },
        {
          id: "dashboard",
          title: "Dashboard",
          body: [
            "The app starts on the dashboard. On top is “Next”: reviews waiting for you, your pull requests with change requests, approval or a long wait, commits that exist only locally, then cleaning up, merged worktrees, a default branch behind the server and uncommitted changes. Every line has one action; “Put aside” hides it until its state changes.",
            "Below are the tiles Pull requests, Cleanup, Local changes, Worktrees and Recently deleted. Pull requests shows “Mine” (yours and those waiting for your review) or “All”. Azure CLI and GitHub CLI say who you are; the app only asks them and never takes credentials.",
            "With repos selected in the sidebar, the dashboard shows only those.",
          ],
          show: { perspective: "Dashboard" },
        },
        {
          id: "folders",
          title: "Folders in the repo list",
          body: [
            "- Add: the “+” at the “Folders” heading in the sidebar, or drag folders from the file manager onto the sidebar. They are scanned at once. A folder already in the list, or inside one, changes nothing; files are not added.",
            "- Remove: in the “⋯” menu of the folder head. After confirming, only the repos leave the list; the folder stays on disk. They leave the repo groups too.",
            "- Select: a folder head selects like a group head. A click selects its repos, a second one clears the selection, with Ctrl you add them or take them out, with Shift you extend the selection up to there. The arrow in front folds the folder.",
            "- A folder’s menu offers what a group’s does: fetch, pull and push with counts, switch, create and take over branches, commands, pull requests, reassess. On top comes what a place on disk has: folder, terminal, path.",
            "- Order: drag a group header onto another one.",
            "- A double click on a repo card, a worktree or a group header opens the folder in the file manager.",
            "- Colour: in the menu of a repo card under “Colour”. It applies to every working copy of the repo and tints the card.",
          ],
          show: { perspective: "Cleanup", scope: "Local" },
        },
        {
          id: "table",
          title: "Columns, filters, groups",
          body: [
            "- Width: drag the right edge of a column head; a double click resets it, with focus the arrow keys work too.",
            "- Order: drag a column head onto another one.",
            "- The author column is on by default. Online there is also the “Source” column (provider and remote, a click opens the branch in the browser), switched on in the head menu.",
            "- Above the table the pill “All · Safe · Review · Blocked · Unsafe” filters by verdict, several at once. At the top right are the filters Prefixes and Tags and the view (Group, Report).",
            "- Head menu (right click or “⋯” on the head): sort, filter, group by the column, move, hide, show other columns, reset.",
            "The filter in the head menu lists the column’s values with counts – counted after all other filters – and allows multiple choice. Active filters show as pills above the table and can be removed one by one there.",
            "Grouping works by folder, repo, prefix, verdict, author or branch name. McBranchFace keeps the layout separately for Local and Online.",
            "By branch name, names that exist in several repos come first. The “⋯” menu on the group header acts on every repo of the group: fast-forward, check out everywhere, push everywhere, create in more repos. Each repo runs on its own, a summary follows at the end.",
          ],
          show: { perspective: "Cleanup", scope: "Local" },
        },
        {
          id: "find",
          title: "Find a commit",
          body: [
            "Ctrl Shift F or the magnifier at the top right searches a commit in every repo: by SHA, the start of a SHA or the text of the commit message. The hits are listed per repo with the branches that contain the commit; a click opens it in the Git history.",
          ],
        },
        {
          id: "switch",
          title: "Switching branches from the sidebar",
          body: [
            "The branch line of every repo card is a dropdown, and so is the line of every worktree. It starts with a search; type a name that does not exist and the dropdown offers “New branch” – from the current state or from the server’s default branch.",
            "Below it a bar filters the list: All, Local, Server (only there; switching creates the local branch) or Mine (last commit by one of your e-mail addresses from the settings). The choice stays for the next opening.",
            "When other repos have the same branch, locally or on the server, they are listed with a checkbox; repos marked with Ctrl or Shift are preselected. The repos switch one after the other – git cannot switch several repos in one step. If one fails, the others stay switched, and the message offers “Back”.",
            "Local changes come along (stashed and re-applied) or are stashed. If re-applying conflicts, git keeps the stash and the repo shows the conflicts.",
            "A branch can be checked out in only one worktree at a time; such entries are greyed out.",
          ],
          show: { perspective: "Cleanup", scope: "Local" },
        },
        {
          id: "groups",
          title: "Repo groups",
          body: [
            "Above the folders are your repo groups: your own sets of repos, such as all that a release needs together. A repo can be in several groups. Groups are not the same as “Group by” in the table, which only orders the rows.",
            "Create and fill them by drag and drop: drag a repo card or a worktree line onto “New group” or onto a group. Repos marked with Ctrl or Shift come along. Out of a group, dragging onto another group copies, with Shift it moves; dropped on the folders, it takes the repo out of the group. Esc cancels, and every change can be undone from the message.",
            "Without a mouse: “Add to group” in the context menu of a repo or worktree. Rename a group by double-clicking its head, with F2 or with “Rename”. On a folder head a double click opens the folder in the file manager, as the app does not rename folders.",
            "A click on the group head selects the repos of the group, a second one clears the selection; with Ctrl you add them to the selection or take them out. Select single repos of a group as in a file manager: click, with Ctrl one more, with Shift a range.",
            "With the keyboard: ↑ and ↓ select, Shift+↑ and Shift+↓ extend, Space toggles, Ctrl+A selects all, Esc none, ← jumps to the group head, and Alt+← or Alt+→ fold all groups. The same four tools sit at the top of “Folders” and “Repo groups” and in the context menu of every group head.",
            "The group menu (“⋯” or right click) acts on all of its repos: switch or create a branch, fetch, pull, push and your own commands. The entries say beforehand how many repos they touch. Pull takes only repos on a branch with an upstream, push only those with commits the server lacks or with a new branch (then with its upstream). The message at the end names what was left out.",
            "When switching, the list shows every branch once, with the number of repos it exists in. The second step lists every repo with what happens there. Local changes are handled once for all: bring them along (stash, switch, stash pop) or stash them.",
            "The same works for a folder of the sidebar, from the menu of its head. “Take a branch over …” suggests branches only some of the repos have (scope “Not everywhere”) and creates them in the rest. Whether from HEAD or from the default branch is your choice as soon as anything is created; “Only create in … repos” creates without switching.",
            "Single repos are handled right in the group: every line has its own branch dropdown to switch and create, and its context menu offers fetch, pull and push for that repo only.",
            "Repo and branch stand in two columns. Drag the edge between them; it applies to all groups, and a double click brings back 50:50. Where a name is cut off, its tooltip shows it in full.",
            "Shimmering grey areas are on their way: the repo's state is still being read. Until then nothing there can be clicked, not even a context menu. While a git operation runs in a repo, its branch stays visible and the tooltip says what it waits for.",
            "A working copy the scan no longer finds stays greyed out in the group until you take it out.",
            "Folders, repos and groups have an identity made of a sign and a colour. The app assigns them; “Identity …” in the menu lets you choose your own. A repo's sign replaces its folder's wherever the repo is named; a group's shows at its head and, while it is selected, in the table's filter note and in Git.",
          ],
          show: { perspective: "Cleanup", scope: "Local" },
        },
        {
          id: "detached",
          title: "Detached HEAD",
          body: [
            "Detached means HEAD points at a commit instead of a branch. That is harmless as long as you do not commit there – commits made while detached belong to no branch and after a switch can only be found through the reflog.",
            "The fix: create a new branch from the current state in the dropdown (like git switch -c), or switch to an existing branch. When a detached HEAD carries commits on no branch, its line warns with a triangle.",
            "When a repo has worktree entries that came along with a folder copy, its card shows a symbol; the context menu removes the entry (it goes to the backup folder, the worktree itself stays).",
          ],
        },
        {
          id: "refresh",
          title: "Refresh",
          body: [
            "“Refresh” (F5) fetches all remotes and assesses everything again. Shift F5 reassesses without the server, without network and without the providers; the pull requests of the last run still count.",
            "At the start, what the last run knew is there at once: branches, verdicts and the git state of every repo, slightly dimmed until the fresh state arrives. The time at the top says how old the data is.",
            "Then the start runs in two stages, shown at the top as “Local” and “Server”. First what is here is assessed, without network; repos whose branches and files are as the last run left them keep their assessment. Then a light check asks each server whether anything happened there. Only those repos are fetched and asked for pull requests, the rest keeps the state of the last run. Fetching everything stays the job of “Refresh” and the auto fetch.",
            "Local changes – commit, checkout, stash – reach McBranchFace through the file-system watcher within about half a second.",
            "A light check asks the server every few minutes (Settings → Refresh & alerts). Only when something changed there does a fetch follow for that repo.",
          ],
          show: { settings: "updates" },
        },
      ],
    },
    {
      id: "local",
      title: "Cleanup · Local",
      summary: "Verdicts, evidence, deleting and restoring local branches.",
      sections: [
        {
          id: "verdicts",
          title: "Verdicts",
          body: [
            "- Safe: the content is provably merged and nothing local depends on it.",
            "- Review: clean locally, but without merge evidence. After deletion the commits exist only in the backup ref.",
            "- Unsafe: unpushed commits, changed files or a stash belong to the branch.",
            "- Blocked: the branch is still checked out. “To do” in the detail pane offers the checkout of the default branch.",
          ],
          show: { perspective: "Cleanup", scope: "Local" },
        },
        {
          id: "todo",
          title: "To do and checks",
          body: [
            "When a branch is not safe, the detail pane lists under “To do” the git steps up to deleting it, in the order git allows them: commit or stash the changes, review the stashes, push (the first time with -u), fast-forward, complete the PR, remove the worktree, check out the default branch. Where an operation exists, its button is next to it.",
            "Below the checks: open ones expanded with their reason, passed ones folded into one green line “n of m OK”, a click shows them.",
            "git does not delete the branch checked out in the main worktree; the app offers no delete for it and says why when you press Delete. A branch in a linked worktree can go with Force Delete: the worktree is removed, and its folder moves to the backups with all its files. Under “Recently deleted” you bring branch and worktree back or remove the backup for good.",
          ],
          show: { perspective: "Cleanup", scope: "Local" },
        },
        {
          id: "evidence",
          title: "Evidence",
          body: [
            "A branch counts as merged when its tip is contained in the default branch (merge commit or fast-forward), when every own commit has a patch-equal counterpart there (rebase or cherry-pick), when its overall diff matches a commit there (squash merge), when a completed pull request merged exactly this state, or when another branch on the server contains its tip.",
            "Its own upstream does not count: pushed is not merged. A fully pushed branch that is not merged is therefore Review, not Safe.",
            "The checks in the detail pane show which evidence applies and what else was checked.",
            "Where a check means commits – such as “2 commits after the last push” –, “Show commits” lists exactly those commits in a window of their own, with search and date filter. The PR card shows title, source → target, dates and, on request, the PR’s commits.",
          ],
        },
        {
          id: "delete",
          title: "Deleting",
          body: [
            "Delete safe branches one by one, marked, or all visible at once. Before deleting, McBranchFace checks every branch again; if something changed, it stays.",
            "Other verdicts can only be deleted with Force Delete, after explicitly confirming the risks.",
          ],
        },
        {
          id: "restore",
          title: "Backup and undo",
          body: [
            "Every deleted branch is kept as a backup ref under refs/mcbranchface/backup.",
            "Right after deleting, “Undo” reverts everything. Later you find every deletion under “Recently deleted” (clock icon at the top) and restore it there.",
          ],
        },
      ],
    },
    {
      id: "online",
      title: "Cleanup · Online",
      summary: "Branches on the server: verdict, state, other people's branches, local copies.",
      sections: [
        {
          id: "verdicts",
          title: "Verdicts",
          body: [
            "- Merged: the content is provably in the default branch; the branch on the server can go.",
            "- Inactive: not merged, no open pull request and without a commit for a long time (threshold in Settings → Online branches). Only when the list of pull requests is known: while it is missing, no branch becomes inactive.",
            "- Active: recent commits or an open pull request.",
          ],
          show: { perspective: "Cleanup", scope: "Online" },
        },
        {
          id: "state",
          title: "State and reachability",
          body: [
            "Next to the tabs you see how old the server state is. “Offline” marks repos whose server could not be reached at the last check.",
            "Exclude single repos from the online check through their context menu in the sidebar.",
          ],
        },
        {
          id: "foreign",
          title: "Other people's branches",
          body: [
            "Branches whose last commit is not yours are unticked in the delete dialog. You can add them deliberately.",
            "Which addresses are “you” is set in Settings → Rules.",
          ],
          show: { settings: "rules" },
        },
        {
          id: "copies",
          title: "Local copies",
          body: [
            "The “Local” column counts the local branches tracking this server branch. When deleting on the server, McBranchFace offers to delete them as well – also with a backup.",
          ],
        },
      ],
    },
    {
      id: "protect",
      title: "Lock, ignore, tags",
      summary: "Protect, silence and label branches.",
      sections: [
        {
          id: "lock",
          title: "Lock",
          body: [
            "A locked branch – or a whole locked repo – is never deleted, not even with Force Delete. Locked branches have their own section at the end of the table.",
            "Lock through the context menu or the detail pane; the list is in Settings → Rules.",
          ],
          show: { settings: "rules" },
        },
        {
          id: "ignore",
          title: "Ignore",
          body: [
            "Ignored branches no longer count for the bell and notifications. They stay visible in the “Ignored” section and can still be marked and deleted.",
            "Ignore for 30 days, 90 days or until further notice. When the period ends, the branch reports again.",
            "Ignoring is no protection – that is what locks are for.",
          ],
          show: { settings: "rules" },
        },
        {
          id: "prefixes",
          title: "Prefixes",
          body: [
            "Branch names show as arrow segments, like a shell prompt: the prefix (feature, bugfix, hotfix …) in colour, the rest as one segment after it. Known prefixes have fixed colours.",
            "Leading parts without letters – a namespace such as “1/” or a version such as “2.4/” – come first, muted, and do not count as a prefix. In “2.4/release/rc-1/main” the prefix is “release”.",
            "The “Prefixes” button above the table counts the branches per prefix – after all other filters – and filters with multiple choice. The search finds “feature/x” as “feature › x” too.",
          ],
        },
        {
          id: "tags",
          title: "Tags and notes",
          body: [
            "In the detail pane you add tags and a note to any branch. For a whole repo use its context menu in the sidebar; branches inherit the repo tags for filter and search.",
            "The “Tags” button above the table filters by tags. The search finds tags with #tag and the text of notes. The report contains both.",
            "Tags and notes apply to every working copy of the same repo and are exported with the settings.",
          ],
        },
      ],
    },
    {
      id: "alerts",
      title: "Bell and notifications",
      summary: "What is reported and when.",
      sections: [
        {
          id: "bell",
          title: "Bell and lenses",
          body: [
            "The bell counts branches that need attention, by lens – such as “Local: Safe”, “Local: never pushed” or “Online: merged”. A click on a lens opens the matching filtered table.",
            "Choose which lenses count in Settings → Refresh & alerts. Locked and ignored branches never count.",
          ],
          show: { settings: "updates" },
        },
        {
          id: "notify",
          title: "Notifications",
          body: ["When a background scan finds new candidates, the system reports them once. Branches already reported are not reported again."],
        },
      ],
    },
    {
      id: "copies",
      title: "Working copies",
      summary: "The same repo in several folders.",
      sections: [
        {
          id: "identity",
          title: "Colour and label",
          body: [
            "When the same repo lives in several folders, all copies share one colour and each gets a label – such as the folder name. A colour of its own is chosen in the menu of the repo card.",
            "Locks, ignores, tags and notes apply to the repo, so to all its working copies at once.",
          ],
        },
        {
          id: "create",
          title: "Working copies for parallel work",
          body: [
            "“Create working copies …” in the context menu of a repo, of a branch or in the head of the Git view creates one or more further folders – e.g. one per AI agent, so the agents do not change each other's files.",
            "- Worktree: fast and small, shares the objects with the original. Each worktree needs a branch of its own; one branch cannot be checked out in two worktrees.",
            "- Own clone: independent of the original, cloned locally and without signing in. origin then points to the same server as in the original; the server branches are those the original knows.",
            "Suggested are free folders next to the repo (Name-agent-1, Name-agent-2 …) and a new branch per copy after the template agent/{n}, starting from the server state of the default branch. Before creating, the dialog checks folders and branch names; “Commands” shows what runs.",
          ],
        },
        {
          id: "cleanup",
          title: "Removing worktrees",
          body: [
            "Worktrees are listed in the sidebar below their repo. A click opens one in the Git view; the context menu offers folder, terminal, commands and “Remove worktree …”.",
            "Removing moves the folder to the backups; the branch stays in the repo. Under “Recently deleted” you bring the worktree back or remove its folder for good. If the worktree has changes, McBranchFace asks a second time before it removes it with them.",
            "A clone is a normal repo: it shows up as another working copy after the next scan when it lies below one of your folders. Otherwise the dialog offers to add its parent folder.",
          ],
        },
      ],
    },
    {
      id: "git",
      title: "Git perspective",
      summary: "Changes, history, branches, push and pull.",
      sections: [
        {
          id: "changes",
          title: "Changes",
          body: [
            "The list shows conflicts, staged and unstaged files. Space stages or unstages the selected file; discard asks first.",
            "Write the commit message at the bottom and commit.",
            "“All repos” at the top shows the changes of all repos, one block per repo; with a selection or repo group on the left, only those. The head of a block stages everything at once, ← and → fold and unfold it. A click on a file opens its repo; diff, commit and git commands then refer to it, and the commit area names it.",
            "Repos without changes are gathered in one line. A repo whose state is still being read shows a grey placeholder.",
            "The button beside “All repos” groups the blocks by the folders the repos sit in. A file's context menu shows it selected with “In file manager”.",
            "Each level sits one step in: folder, repo, status and, if you like, directory. Every head folds and hides everything below it. Alt+click on the arrow or Alt+← and Alt+→ fold all groups of a level; the button at the top right folds everything. A file that is partly staged shows in both groups and carries a double sign.",
            "When a repo has open pull requests, its head shows how many. A click lists them, an entry opens the pull request in the browser.",
          ],
          show: { perspective: "Git", gitTab: "changes" },
        },
        {
          id: "diff",
          title: "Diff",
          body: [
            "The diff marks changed words stronger than their line and colours the syntax. Top right: side by side instead of one column, ignore whitespace, more context up to the whole file, previous and next hunk, search.",
            "In Changes, the bar above each hunk stages, unstages or discards the whole hunk. Single lines are chosen in the margin with the line numbers: a click chooses, Shift extends, dragging chooses several; the bar at the bottom applies them. Discarding asks first and copies the file to the backup folder.",
            "With whitespace ignored or a shortened diff this is not possible, the patch would not fit; new and deleted files only as a whole, from the file list.",
            "- n / p or Alt ↓ / ↑: next, previous hunk\n- Ctrl F: search the diff, Enter jumps\n- s / u: stage or unstage the hunk at the top\n- Esc: clear the choice",
          ],
          show: { perspective: "Git", gitTab: "changes" },
        },
        {
          id: "history",
          title: "History",
          body: [
            "The history loads more while scrolling. The search finds commits by text, author or SHA. A click shows files and diff.",
            "Above the list you choose which commits: checked out (HEAD), a given branch, or only what is new on the branch compared to the default branch. “Show log” in the menu of a table row and in the detail pane opens the history right for that branch.",
          ],
          show: { perspective: "Git", gitTab: "history" },
        },
        {
          id: "branches",
          title: "Branches, push and pull",
          body: [
            "The branch switcher at the top is the same as in the sidebar: it switches or creates branches; with local changes it asks whether to take them along.",
            "Fetch, pull and push are at the top right in the “Sync” group; each tooltip names the exact command. Pull is always a fast-forward (git pull --ff-only --no-rebase): if both sides changed, nothing happens. Push sends only the current branch to its upstream, even if git is configured otherwise.",
            "When an operation started elsewhere runs in the open repo, such as a pull from a repo group, it shows at the top right. Until it is done, sync, commit and staging wait; their tooltip says for what.",
            "The “Branches” list is a table with columns: sort with a click on the head, drag the widths, show and hide columns from the head's context menu. At the top you choose local, server or all, filter by upstream state, worktree and your own branches, and group by prefix, worktree, upstream or author. Choose several branches with Ctrl or Shift; “Mark in Cleanup” hands them to the safe delete.",
            "git handles sign-in itself – McBranchFace never asks for credentials.",
          ],
          show: { perspective: "Git", gitTab: "branches" },
        },
      ],
    },
    {
      id: "settings",
      title: "Settings",
      summary: "Folders, rules, alerts, environment, export.",
      sections: [
        {
          id: "general",
          title: "Layout",
          body: ["The sections are on the left: Appearance (language, theme, interface size), Folders & scan, Refresh & alerts, Window & start, Rules, Online branches, Commands, Environment, Configuration (export and import) and About. Appearance applies at once, everything else with “Save”."],
          show: { settings: "appearance" },
        },
        {
          id: "window",
          title: "Tray and start with the system",
          body: [
            "By default closing the window keeps the app in the tray: background scan, server check and notifications keep running. The tray menu opens, refreshes, toggles notifications and quits.",
            "“Start with the system” adds McBranchFace to the startup items (Windows, macOS, Linux); it can then start in the tray only. Without a tray area, closing works as usual.",
          ],
          show: { settings: "window" },
        },
        {
          id: "repos",
          title: "Folders & scan",
          body: ["The folders McBranchFace searches for repos, in their order, plus search depth, concurrency and whether a scan fetches. The same list is also kept right in the sidebar."],
          show: { settings: "repos" },
        },
        {
          id: "rules",
          title: "Rules",
          body: ["Your e-mail addresses, protected branches, default branches and the lists of locks and ignores."],
          show: { settings: "rules" },
        },
        {
          id: "env",
          title: "Environment",
          body: ["Which tools were found – git, Azure CLI, GitHub CLI – and how to install missing ones."],
          show: { settings: "env" },
        },
        {
          id: "about",
          title: "About and diagnostics",
          body: [
            "Version, app data folder and crash logs. If McBranchFace ended unexpectedly, it says so at the next start and keeps the log in this folder.",
            "The diagnostics switch logs every git call and every activity with its duration and result. It is off by default and costs nothing then.",
            "“Show activities” makes the top bar say what is being asked right now and where, with source and operation. A click on it lists what runs and what ran, with errors. Durations are in the log. Switched off, the app records none of it. Your own runs across repos always show their progress and can be stopped there.",
          ],
          show: { settings: "about" },
        },
      ],
    },
    {
      id: "commands",
      title: "Custom commands",
      summary: "Scripts on repos and branches, started from the context menu.",
      sections: [
        {
          id: "create",
          title: "Create",
          body: [
            "In Settings → Commands you set name, shell and script, whether the command is offered for every repo or selected ones, and whether also on branch rows.",
            "The preview shows the script as it runs for a chosen repo; the test run saves and runs it once.",
          ],
          show: { settings: "commands" },
        },
        {
          id: "placeholders",
          title: "Placeholders",
          body: [
            "- {{path}} – folder of the working copy",
            "- {{repo}} – name of the repo, {{identity}} – its identity across copies",
            "- {{branch}} – the branch (branch rows only), {{remote}} – origin, {{default}} – the default branch",
            "Values are inserted safely quoted for the chosen shell, even with spaces, & or $(…) in a name. So write no quotes of your own around placeholders. The shell's own braces ({ … }, ${var}) stay as they are.",
          ],
        },
        {
          id: "modes",
          title: "Terminal or background",
          body: [
            "In a terminal the command runs visibly and interactively – for anything that asks.",
            "In the background it appears in the list of runs at the bottom right, with exit code, duration and cancel; a click shows the output. A failure reports with “Show output”. It is stopped after 30 minutes.",
          ],
        },
        {
          id: "where",
          title: "Where commands appear",
          body: [
            "In the context menu of a repo in the sidebar, of a folder (then for every repo in it), of a branch row, and as a “Commands” button in the detail pane.",
            "Commands run with your rights. They come only from your settings; an import shows them for review first.",
          ],
        },
        {
          id: "prompts",
          title: "Copy as prompt",
          body: [
            "For work with an AI assistant: the context menu of a branch row and the “Prompt” button in the detail pane copy a ready-made instruction as Markdown to the clipboard.",
            "- Merge into the default branch\n- Open a pull request, only without an open PR\n- Clean up the branch\n- Rebase onto the default branch",
            "Merge and rebase are offered only for branches with own commits. Every prompt states the goal, the situation (repo, folder, commits, uncommitted changes, evidence, PR), the exact git commands and rules: the assistant asks before every push and every deletion, reports conflicts instead of guessing and names the SHA that restores the branch.",
            "Settings → Prompts changes the four texts or adds your own templates. {{branch}}, {{default}}, {{situation}}, {{steps.merge}} and the other variables insert the values of the branch; each chip names what it holds, the preview shows the result on a real branch. A template of your own can name a skill of your assistant, and says where it is offered (local, online, both) and whether only with own commits.",
          ],
        },
      ],
    },
    {
      id: "legend",
      title: "Legend",
      summary: "Every sign of the interface as it looks, with its meaning.",
      sections: [
        {
          id: "verdicts",
          title: "Verdicts",
          body: ["The pill at the start of every row says what is going on with the branch. Local and online assess differently."],
          legend: {
            visual: "verdicts",
            items: {
              Safe: "Local: provably merged, nothing local depends on it. Can go.",
              Review: "Local: clean, but without merge evidence. Check before deleting.",
              Unsafe: "Local: unpushed commits, uncommitted changes or stashes. Deleting loses work.",
              Blocked: "Local: still checked out, cannot be deleted like this.",
              Merged: "Online: the content is on the default branch. The branch on the server can go.",
              Inactive: "Online: not merged, no commit for a long time.",
              Active: "Online: not merged, worked on recently or with an open PR.",
            },
          },
          show: { perspective: "Cleanup" },
        },
        {
          id: "segments",
          title: "Branch names",
          body: ["Branch names show as segments, like in a shell prompt. Only the last part shortens when space runs out."],
          legend: {
            visual: "segments",
            items: {
              remote: "Grey in front: the remote, here origin. Missing for local branches.",
              namespace: "Grey in front: a namespace without letters, such as a version number.",
              prefix: "Coloured: the prefix, the kind of work. Every prefix has its own colour.",
              rest: "Neutral: the name itself.",
            },
          },
        },
        {
          id: "sidebar",
          title: "Sidebar",
          body: ["Every repo is a card. All signs have a tooltip; here they are together."],
          legend: {
            visual: "sidebar",
            items: {
              repoGroup: "A repo group: a click filters the table to its repos, “⋯” opens the actions for all of them.",
              repoIcon: "The short sign of the folder the repo is in: the same at the folder header, on the card, in the table and in the detail. The tooltip names the path.",
              copyLabel: "Only where two copies sit in one folder: the name of the working copy, in the folder's colour.",
              gone: "Gone branches: local branches whose upstream was deleted on the server. The folder shows the same sign summed up.",
              goneUnsafe: "Red: some of them hold work that exists nowhere else.",
              ahead: "Ahead: commits of the checked-out branch not pushed yet.",
              behind: "Behind: commits on the server not pulled yet. Pull or fast-forward brings them in.",
              dirty: "Changed files in the folder, not committed yet.",
              stash: "Stashes of the repo, for all its worktrees together.",
              foreign: "A worktree of this repo lies outside the sidebar's folders.",
              note: "A note on the repo; the tooltip shows it.",
              more: "More signs than fit on the line; the tooltip names them.",
              locked: "The whole repo is locked: none of its branches is deleted.",
              onlineExcluded: "Excluded from the online check.",
              problem: "A problem during scan or fetch; the tooltip says which.",
            },
          },
        },
        {
          id: "worktree",
          title: "Worktree rows",
          body: ["Under a card each worktree has a row. Three shapes for three things."],
          legend: {
            visual: "worktree",
            items: {
              worktree: "The worktree, a second folder of the same repo.",
              detached: "Detached HEAD: the worktree is on a commit, not on a branch.",
              stranded: "Commits on no branch. Create a branch before you switch.",
            },
          },
        },
        {
          id: "table",
          title: "Table",
          body: ["Small signs in the Branch column and beside it say what a branch still holds."],
          legend: {
            visual: "table",
            items: {
              unpushed: "Unpushed commits without evidence; a click shows them.",
              dirty: "Uncommitted changes in the branch’s worktree.",
              checkedOut: "Checked out in a worktree, clean there.",
              stashes: "Stashes on this branch.",
              locked: "Locked: never deleted.",
              ignored: "Ignored for alerts; stays in the list.",
              note: "Your own note on the branch.",
              gone: "Upstream deleted on the server, the ref is in the tooltip. The local copy is the last state.",
              copies: "Online: this many working copies have the branch locally.",
            },
          },
          show: { perspective: "Cleanup", scope: "Local" },
        },
        {
          id: "topbar",
          title: "Refresh",
          body: ["At the top in the “Data” group, right of the connections. The button that is running turns its icon."],
          legend: {
            visual: "topbar",
            items: {
              refresh: "Refresh (F5): fetch in every repo, then assess again.",
              local: "Reassess without the server (Shift F5): fast, as of the last fetch.",
            },
          },
        },
      ],
    },
    { id: "keys", title: "Keyboard shortcuts", summary: "Every shortcut at a glance.", sections: [] },
    { id: "errors", title: "Error messages", summary: "What a message means and what you can do.", sections: [] },
  ],
};
