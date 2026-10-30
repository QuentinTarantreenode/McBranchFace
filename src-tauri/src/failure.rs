//! Turning git and OS messages into failure kinds the UI can explain — shared by every operation.

use crate::model::FailureKind as K;
use crate::model::FailureKind;

/// For a command that talks to a server: running out of time there means the server or the way to it.
pub fn classify(text: &str) -> FailureKind {
    classify_in(text, true)
}

/// For a command that needs no server (status, commit, switch, a scan's reading): when it runs out of
/// time, the cause is local (a huge repo, a hook, a locked disk), and "check the network" misleads.
pub fn classify_local(text: &str) -> FailureKind {
    classify_in(text, false)
}

/// git runs in the C locale, so its messages are stable English; OS errors are matched by code.
fn classify_in(text: &str, network: bool) -> FailureKind {
    let t = text.to_lowercase();
    let has = |needles: &[&str]| needles.iter().any(|n| t.contains(n));
    if has(&["another git process", "file exists"]) && t.contains(".lock") {
        K::Lock
    } else if has(&[
        "could not read username", "authentication failed", "terminal prompts disabled",
        "permission denied (publickey", "invalid username or password", "returned error: 401", "returned error: 403",
    ]) {
        K::AuthRequired
    } else if has(&["could not resolve host", "unable to access", "connection timed out", "operation timed out", "failed to connect", "connection refused"]) {
        K::Network
    // How `ProcError::Timeout` reads: the app stopped the command after its time limit.
    } else if has(&["timed out"]) {
        if network { K::Network } else { K::Timeout }
    } else if has(&["would be overwritten by checkout", "your local changes to the following files would be overwritten", "untracked working tree files would be overwritten", "please commit your changes or stash them"]) {
        K::LocalChanges
    // Before Diverged: `git commit` prints the full status, which may mention "have diverged" in passing.
    } else if has(&["nothing to commit", "no changes added to commit", "nothing added to commit"]) {
        K::NothingToCommit
    } else if has(&["not possible to fast-forward", "diverging branches", "have diverged"]) {
        K::Diverged
    } else if has(&[
        "[rejected]", "updates were rejected", "failed to push some refs", "non-fast-forward", "[remote rejected]",
        "protected branch", "pushes to this branch are not permitted", "gh006",
    ]) {
        K::Rejected
    } else if has(&["is not a valid branch name", "not a valid ref name"]) {
        K::InvalidName
    } else if has(&["is already checked out at", "is already used by worktree at"]) {
        K::CheckedOut
    } else if has(&["contains modified or untracked files"]) {
        K::LocalChanges
    } else if has(&["already exists"]) {
        K::AlreadyExists
    } else if has(&[
        "permission denied", "access is denied", "being used by another process", "resource busy",
        "unable to unlink", "failed to delete", "directory not empty", "os error 5)", "os error 32)",
    ]) {
        K::FileInUse
    } else if has(&["not a git repository", "cannot change to"]) {
        K::RepoMissing
    } else {
        K::Other
    }
}

/// Path quoted in git's lock message: "Unable to create '<path>': File exists."
pub fn lock_path(text: &str) -> Option<String> {
    let start = text.find("Unable to create '")? + "Unable to create '".len();
    let end = text[start..].find('\'')?;
    Some(crate::paths::slashes(&text[start..start + end]))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classifies_git_messages() {
        let lock = "error: cannot lock ref 'refs/heads/x': Unable to create 'C:/r/.git/refs/heads/x.lock': File exists.\n\
                    Another git process seems to be running in this repository";
        assert_eq!(classify(lock), K::Lock);
        assert_eq!(lock_path(lock).as_deref(), Some("C:/r/.git/refs/heads/x.lock"));
        assert_eq!(classify("error: failed to delete 'C:/wt': Invalid argument"), K::FileInUse);
        assert_eq!(classify("warning: unable to unlink 'a.txt': Permission denied"), K::FileInUse);
        assert_eq!(classify("Der Prozess kann nicht auf die Datei zugreifen (os error 32)"), K::FileInUse);
        assert_eq!(classify("fatal: not a git repository"), K::RepoMissing);
        assert_eq!(classify("error: The branch 'x' is not fully merged."), K::Other);
    }

    #[test]
    fn classifies_operation_messages() {
        assert_eq!(classify("error: Your local changes to the following files would be overwritten by checkout:\n\ta.txt"), K::LocalChanges);
        assert_eq!(classify("fatal: Not possible to fast-forward, aborting."), K::Diverged);
        assert_eq!(classify(" ! [rejected]        main -> main (fetch first)\nerror: failed to push some refs"), K::Rejected);
        assert_eq!(classify("fatal: could not read Username for 'https://x': terminal prompts disabled"), K::AuthRequired);
        assert_eq!(classify("git@github.com: Permission denied (publickey)."), K::AuthRequired, "auth, not a locked file");
        assert_eq!(classify("fatal: unable to access 'https://x/': Could not resolve host: x"), K::Network);
        assert_eq!(classify("'git' timed out"), K::Network, "a fetch or push out of time: the server or the way to it");
        assert_eq!(classify_local("'git' timed out"), K::Timeout, "a local command out of time is no network problem");
        assert_eq!(classify_local("ssh: connect to host x port 22: Connection timed out"), K::Network, "the message names the network");
        assert_eq!(classify_local("fatal: unable to access 'https://x/': Operation timed out after 30000 milliseconds"), K::Network);
        assert_eq!(classify_local("fatal: not a git repository"), K::RepoMissing, "everything else as for any command");
        assert_eq!(classify("fatal: unable to access 'https://x/': The requested URL returned error: 401"), K::AuthRequired);
        assert_eq!(classify("error: pathspec 'src/401/a.rs' did not match"), K::Other, "digits in paths are not HTTP codes");
        assert_eq!(classify("nothing to commit, working tree clean"), K::NothingToCommit);
        let commit_on_diverged = "On branch main\nYour branch and 'origin/main' have diverged,\n\
                                  and have 1 and 1 different commits each, respectively.\n\nnothing to commit, working tree clean";
        assert_eq!(classify(commit_on_diverged), K::NothingToCommit, "the status note must not win");
        assert_eq!(classify("fatal: 'a..b' is not a valid branch name"), K::InvalidName);
        assert_eq!(classify("fatal: a branch named 'x' already exists"), K::AlreadyExists);
        assert_eq!(classify(" ! [remote rejected] x (pre-receive hook declined)\nerror: failed to push some refs"), K::Rejected);
        assert_eq!(classify("remote: error: GH006: Protected branch update failed for refs/heads/x."), K::Rejected);
        assert_eq!(classify("fatal: 'main' is already checked out at 'C:/work'"), K::CheckedOut);
        assert_eq!(classify("fatal: 'main' is already used by worktree at 'C:/work'"), K::CheckedOut, "newer git wording");
        assert_eq!(classify("fatal: 'C:/wt' contains modified or untracked files, use --force to delete it"), K::LocalChanges);
    }
}
