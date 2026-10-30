# Roadmap: AI assistant (postponed)

Status: **to do** — not implemented. This note keeps the requirements until the feature is scheduled.

## Goal

Help with the text work around a change, from inside the Git perspective:

- **Commit message** for the staged changes: a headline (≤ 72 characters) and a body.
- **Code review** of a change: findings with file and line, grouped by severity.
- **Change report** for a commit, a range of commits, or the uncommitted working tree:
  - headline and message, usable as pull request title and description,
  - what changed per module and per file,
  - risks and suggested tests.

## Configuration

- An **OpenAI-compatible endpoint** (base URL), so hosted and self-hosted models work alike.
- **Model selection**: a list fetched from the endpoint (`GET /models`), plus a free-text fallback.
- The **API key lives in the OS keychain** (Windows Credential Manager, macOS Keychain, Secret Service),
  never in `config.json` and never in an export.
- A per-repository **opt-in**: nothing is sent for repositories that are not enabled.

## Privacy and control

- Code leaves the machine only on an explicit click, never in the background.
- Before sending, a **preview** shows exactly which diff and which files go out, with their size.
- Size limits per request; large diffs are summarised per file or cut, and the UI says so.
- Generated text is a proposal: it lands in the commit box or a copyable panel and is never committed,
  pushed or posted automatically.

## UI sketch

- Commit box: a button "Suggest message" next to the message field; the proposal replaces an empty
  message or is offered as a diff against the current one.
- History and changes: "Review" and "Report" actions for the selected commit, range or working tree,
  opening a side panel with the result and a copy button per section (headline, message, per module).
- Settings → new tab "Assistant": endpoint, model, key (stored via the keychain), per-repo opt-in,
  size limit.

## Open questions

- Prompt templates: fixed, or editable per repository (house style for commit messages)?
- Streaming responses in the panel, or wait for the complete answer?
- How to split very large changes: per module (folder) or per file type?
- Cost display: show token counts from the response, if the endpoint returns them?
- Should the report reuse the merge evidence McBranchFace already knows (PR, target branch)?

## Rough stages

1. Settings and keychain storage, endpoint check ("Test connection").
2. Commit message for staged changes, with preview of what is sent.
3. Change report for a commit or the working tree (PR title and description).
4. Code review with findings linked to diff lines.
