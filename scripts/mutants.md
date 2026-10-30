# Mutation tests before a release

The tests pass; the question here is whether they would notice if the code were wrong. [cargo-mutants]
changes the code one small step at a time (a condition inverted, a return value replaced, an operator
swapped), builds, and runs the tests. A mutant the tests do not catch ("missed") is a line nobody checks.

It covers the code that destroys or restores data, where an unnoticed mistake costs the user work:

| File | What it decides |
|---|---|
| `src/delete.rs`, `src/delete_online.rs` | deleting local and server branches, backup refs, journal entries |
| `src/actions.rs` | restore, adopting orphaned backups, purging |
| `src/gitops/ops.rs` | switch, stash, stage, discard, partial patches, push and pull |
| `src/gitops/copies.rs` | creating and removing worktrees and clones |
| `src/assess*.rs` | the verdict that decides whether a branch is offered for deletion |

It is not part of `verify`: a run takes hours, not minutes. Run it before a release that touched these
files, and after a larger change to them.

## Run

```bash
cargo install --locked cargo-mutants     # once
npm run mutants                          # all files above
cargo mutants --dir src-tauri --file src/gitops/ops.rs        # one file
cargo mutants --dir src-tauri --file src/gitops/ops.rs --list # the mutants, without running them
git diff main > changes.diff && cargo mutants --dir src-tauri --in-diff changes.diff   # only changed lines
```

Every mutant builds the crate and runs the whole test suite; `--jobs 2` runs two at once (each in a copy
of the tree, so it needs the disk space of two builds). The first build of each copy is a full one.

## Read the result

`src-tauri/mutants.out/` holds the outcome per mutant: `caught.txt`, `missed.txt`, `timeout.txt` and
`unviable.txt` (did not compile). Only `missed.txt` needs work: for each line, either write the test
that fails with this mutant, or decide the mutant changes nothing that matters (an equivalent mutant,
e.g. a log text) and note why. A timeout usually means a loop condition was inverted; it counts as
caught.

[cargo-mutants]: https://mutants.rs/
