# McBranchFace

<p align="center"><img src="docs/logo.webp" alt="McBranchFace" width="220"></p>

<p align="center"><b>A desktop git tool for many repositories, working copies and agent worktrees, with safe branch cleanup.</b></p>

You work in a dozen repositories, each cloned a few times, and your AI agents leave branches and worktrees behind.
McBranchFace shows all of them in one place, tells you which branches are safe to delete, and deletes them with a
backup you can restore.

## What it does

**Cleanup**: find stale branches and remove them safely.

- A verdict for every branch: **Safe**, **Review**, **Unsafe** or **Blocked**. Missing knowledge never counts as Safe.
- Local branches whose upstream is gone, and server branches that are merged or inactive.
- Deleting always goes confirm → progress → result, writes a backup ref first and can be undone.
- Locks, ignores, notes and tags per branch; a bell and system notifications for new findings.

**Git**: a small client for daily work.

- Changes with a side-by-side diff, staging by hunk or line, commit and amend.
- History with search, branches, switch and create, fetch, pull and push with progress.
- Switch or create a branch in several repositories at once.
- Parallel working copies (worktrees or local clones) for AI agents, and prompts for them to copy.

**Built for many repositories**: the same repository cloned into several folders is recognised and shown as one;
pull requests come from `gh` (GitHub) and `az` (Azure DevOps) when they are installed. German and English UI.

## Install

There is no signed installer yet. Build it yourself (below). Windows is the platform it is developed and tested on;
macOS and Linux have never been built.

## Build from source

You need Node 22+, Rust (installed through [rustup](https://rustup.rs); the version is pinned in
`rust-toolchain.toml`), git, and on Windows the Visual Studio C++ build tools.

```bash
npm install
npm run tauri dev      # run the app with hot reload
npm run tauri build    # build the installer
```

## Documentation

| Page | What is in it |
|---|---|
| [Cleanup and the branch table](docs/cleanup.md) | The checks behind every verdict, the table, the sidebar, locks and alerts |
| [Git perspective and tools](docs/git-and-tools.md) | Working copies, diff viewer, prompts, custom commands, onboarding |
| [Safety, robustness and state](docs/safety.md) | What protects your repositories and data, and where the app keeps its files |
| [Shortcuts](docs/shortcuts.md) | Every keyboard shortcut |
| [Development](docs/development.md) | Setup, the quality gates, tests, E2E and releases |
| [AGENTS.md](AGENTS.md) | Repository map and rules for contributors and coding agents |
| [CHANGELOG.md](CHANGELOG.md) | What changed in each release |

## License

MIT, see [LICENSE](LICENSE).
