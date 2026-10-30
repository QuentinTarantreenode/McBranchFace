# Safety, robustness and state

What the app does to keep your repositories and your data safe, and where it keeps its own files. Back to the [README](../README.md).

## Git perspective: safety

- Every writing operation checks for `index.lock` first and reports failures by kind (lock, local changes in the way,
  diverged, rejected, sign-in needed, network …) with a hint what to do.
- Discard copies every affected file to the app data folder (`backups/<ts>-<repo>/`, a folder of its own per backup)
  before throwing it away.
- Amending a commit that is already on the server asks first. Switching with conflicting local changes offers
  *Mitnehmen* / *Nur stashen*.
- Pull is fast-forward only (`git pull --ff-only --no-rebase`, so `pull.rebase` cannot turn it into a rebase). Push
  names remote and refspec (`git push <remote> refs/heads/<b>:<merge>`), so `push.default=matching` never pushes
  other branches; the first push publishes the branch (`push -u origin`). Every sync button's tooltip shows the
  exact command. Credentials come from git's credential manager; the tool never asks for passwords.
- Refs and SHAs from the UI are checked before git sees them: a leading `-` (`--output=…`, `-`, `--detach`) is
  refused before anything is stashed or switched, and logs pass the revision after `--end-of-options`.

## Robustness

- A damaged `config.json` is moved aside (`config.corrupt-<ts>.json`) and reported; it is never overwritten silently.
  Saving writes a temporary file and renames it.
- Journal lines that cannot be read are skipped and kept in a backup before the journal is rewritten.
- Fetch failures are reported once per cause (offline, sign-in needed), not once per repository.
- Network calls the app starts by itself (background scan, server check, auto-fetch) never ask anything: no sign-in
  window of the credential manager (`GCM_INTERACTIVE=never`), no ssh question (`BatchMode`, unless you configured an
  ssh command of your own), and a transfer slower than 1 KB/s for 30 s ends. A refresh you start may ask, once per
  server: the first call to a server goes alone, and when the server refuses the sign-in, the other repositories on it
  are not asked again in that scan. A running scan can be stopped; what it assessed until then stays.
- A repository folder that disappears is shown as unreachable and no longer watched.
- Git operations lock only the repos they run in (claim with the operation's name in the UI). In the backend a
  repository's refs have one lock, shared by all its worktrees (a commit in a linked worktree waits for a delete or
  fetch in the main one), and each working copy's index has its own (staging never waits for a fetch); reading
  (status, log, diff) is never blocked, and online queries run beside everything local.
- Every error message has a title and a way out, in both languages (checked by a test against the backend's
  error enums). Uncaught errors end up as a message, a view that fails to render shows a replacement surface with
  "Reload" while the rest keeps working, and a crash of the backend leaves `crash.log`, reported at the next start.

## State

App data directory (`%LOCALAPPDATA%\McBranchFace` on Windows): `config.json`, `snapshots/`, `deleted.jsonl`,
`cache/` (last results, merge evidence), `backups/` (discarded files, files of force-removed worktrees), `crash-*.log`, and `diagnostics.log` when the
diagnostics switch (Settings → About, off by default) is on. `MCBRANCHFACE_DATA_DIR` points the app to another
folder; tests and the E2E run use that.
