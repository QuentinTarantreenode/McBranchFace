use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::LazyLock;

use anyhow::{Context, Result};

use crate::model::DeletedEntry;

// Starts at the clock's nanoseconds, so a restart within the same second does not reuse a number.
static SEQ: LazyLock<AtomicU64> = LazyLock::new(|| {
    AtomicU64::new(std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| u64::from(d.subsec_nanos())))
});

/// A journal id that no other entry has: two working copies deleting the same branch within one
/// second (a bulk job, "also delete local copies") must still be restored one by one.
pub fn entry_id(ts: i64, name: &str) -> String {
    format!("{ts}-{}-{name}", SEQ.fetch_add(1, Ordering::Relaxed))
}

/// Append-only record of deletions; the backup refs it names are what makes a restore possible.
/// Every write takes the journal's own lock, and a change of entries reads and writes under it in one
/// go: a delete in one repo appends while a restore in another waits for its push, and neither loses
/// the other's line.
pub struct Journal {
    path: PathBuf,
    lock: std::sync::Mutex<()>,
}

impl Journal {
    pub fn new(path: PathBuf) -> Self {
        Self { path, lock: std::sync::Mutex::new(()) }
    }

    fn locked(&self) -> std::sync::MutexGuard<'_, ()> {
        self.lock.lock().unwrap_or_else(|p| p.into_inner())
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    /// Next to the journal: the files a delete kept from a worktree it removed.
    pub fn backups_dir(&self) -> PathBuf {
        self.path.parent().map(|p| p.join("backups")).unwrap_or_else(|| PathBuf::from("backups"))
    }

    /// Only a journal that does not exist yet is empty. Any other read error is one: taken for empty,
    /// the next rewrite would replace every entry with the few written after it.
    pub fn load(&self) -> Result<Vec<DeletedEntry>> {
        Ok(read_lines(&self.path)?.lines().filter_map(|l| serde_json::from_str(l).ok()).collect())
    }

    pub fn append(&self, entry: &DeletedEntry) -> Result<()> {
        let _lock = self.locked();
        self.append_line(entry)
    }

    fn append_line(&self, entry: &DeletedEntry) -> Result<()> {
        if let Some(dir) = self.path.parent() {
            std::fs::create_dir_all(dir)?;
        }
        let mut line = serde_json::to_string(entry)?;
        line.push('\n');
        let mut f = std::fs::OpenOptions::new().create(true).read(true).append(true).open(&self.path)?;
        // A crash mid-append leaves a last line without its newline: the new entry starts on a line of
        // its own instead of being glued to it, where neither would parse.
        if f.metadata()?.len() > 0 {
            let mut last = [0u8; 1];
            f.seek(SeekFrom::End(-1))?;
            f.read_exact(&mut last)?;
            if last[0] != b'\n' {
                line.insert(0, '\n');
            }
        }
        // One write per line: `writeln!` may split it, and an interrupted append would leave half a line.
        f.write_all(line.as_bytes())?;
        f.sync_all()?;
        Ok(())
    }

    pub fn upsert(&self, entry: &DeletedEntry) -> Result<()> {
        self.update(|entries| match entries.iter_mut().find(|e| e.id == entry.id) {
            Some(e) => *e = entry.clone(),
            None => entries.push(entry.clone()),
        })
    }

    /// Reads the entries, lets `change` work on them and writes them back, all under the journal's
    /// lock: nothing appended meanwhile is lost.
    pub fn update<R>(&self, change: impl FnOnce(&mut Vec<DeletedEntry>) -> R) -> Result<R> {
        self.edit(|entries| (Edit::Rewrite, change(entries)))
    }

    /// `update` where `change` decides how its result is written: new entries only appended leave
    /// every other line, unreadable ones included, where it was.
    pub fn edit<R>(&self, change: impl FnOnce(&mut Vec<DeletedEntry>) -> (Edit, R)) -> Result<R> {
        let _lock = self.locked();
        let mut entries = self.load()?;
        let (how, r) = change(&mut entries);
        match how {
            Edit::Keep => {}
            Edit::Append(fresh) => {
                for e in &fresh {
                    self.append_line(e)?;
                }
            }
            Edit::Rewrite => self.write_all(&entries)?,
        }
        Ok(r)
    }

    pub fn replace_all(&self, entries: &[DeletedEntry]) -> Result<()> {
        let _lock = self.locked();
        self.write_all(entries)
    }

    fn write_all(&self, entries: &[DeletedEntry]) -> Result<()> {
        if let Some(dir) = self.path.parent() {
            std::fs::create_dir_all(dir)?;
        }
        // Lines this version cannot read (damaged, or from a newer version) would vanish on rewrite.
        let text = read_lines(&self.path)?;
        if text.lines().any(|l| !l.trim().is_empty() && serde_json::from_str::<DeletedEntry>(l).is_err()) {
            let backup = self.path.with_extension(format!("jsonl.bak-{}", crate::git::snapshot::now()));
            std::fs::copy(&self.path, backup)?;
        }
        let mut text = String::new();
        for e in entries {
            text.push_str(&serde_json::to_string(e)?);
            text.push('\n');
        }
        crate::config::write_atomic(&self.path, text.as_bytes()).with_context(|| format!("cannot write {}", self.path.display()))
    }
}

/// How `Journal::edit` writes what its change did.
pub enum Edit {
    /// Nothing changed.
    Keep,
    /// These entries are new; the others are as they were read.
    Append(Vec<DeletedEntry>),
    /// The entries as the change left them replace the file.
    Rewrite,
}

/// The journal's text; bytes that are no UTF-8 (a torn write) only spoil their own line.
fn read_lines(path: &Path) -> Result<String> {
    match std::fs::read(path) {
        Ok(bytes) => Ok(String::from_utf8_lossy(&bytes).into_owned()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(String::new()),
        Err(e) => Err(anyhow::Error::new(e).context(format!("cannot read {}", path.display()))),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::Verdict;

    #[test]
    fn ids_of_the_same_branch_in_the_same_second_differ() {
        let a = entry_id(1700, "feature/x");
        let b = entry_id(1700, "feature/x");
        assert_ne!(a, b);
        assert!(a.starts_with("1700-") && a.ends_with("-feature/x"));
    }

    fn entry(id: &str) -> DeletedEntry {
        DeletedEntry { id: id.into(), sha: "s".into(), verdict: Verdict::Safe, deleted_at: 1, ..DeletedEntry::new("r", "b", "b", "s", "refs/x", 1) }
    }

    #[test]
    fn damaged_lines_are_skipped_and_kept_in_a_backup() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("deleted.jsonl");
        let good = serde_json::to_string(&entry("a")).unwrap();
        std::fs::write(&path, format!("{good}\n{{ broken\n")).unwrap();
        let j = Journal::new(path.clone());
        assert_eq!(j.load().unwrap().len(), 1, "readable entries survive a damaged line");
        j.replace_all(&[entry("a"), entry("b")]).unwrap();
        let backups: Vec<_> = std::fs::read_dir(dir.path()).unwrap().flatten().filter(|e| e.file_name().to_string_lossy().contains(".bak-")).collect();
        assert_eq!(backups.len(), 1);
        assert!(std::fs::read_to_string(backups[0].path()).unwrap().contains("{ broken"));
        assert_eq!(j.load().unwrap().len(), 2);
    }

    #[test]
    fn upsert_adds_a_missing_entry_and_a_path_without_folder_fails_cleanly() {
        let dir = tempfile::tempdir().unwrap();
        let j = Journal::new(dir.path().join("sub").join("deleted.jsonl"));
        let mut e = entry("a");
        j.upsert(&e).unwrap();
        e.forced = true;
        j.upsert(&e).unwrap();
        assert_eq!(j.load().unwrap().len(), 1);
        assert!(j.load().unwrap()[0].forced);
        assert!(Journal::new(PathBuf::new()).append(&e).is_err());
        assert!(Journal::new(PathBuf::new()).replace_all(&[]).is_err());
    }

    #[test]
    fn a_journal_that_cannot_be_read_is_not_taken_for_empty() {
        let dir = tempfile::tempdir().unwrap();
        assert!(Journal::new(dir.path().join("missing.jsonl")).load().unwrap().is_empty(), "not there yet: empty");
        // A folder where the file should be: reading fails with something other than "not found".
        let j = Journal::new(dir.path().to_path_buf());
        assert!(j.load().is_err());
        assert!(j.upsert(&entry("a")).is_err(), "a writer stops instead of replacing what it could not read");
    }

    #[test]
    fn an_append_after_a_torn_last_line_starts_a_line_of_its_own() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("deleted.jsonl");
        let good = serde_json::to_string(&entry("a")).unwrap();
        std::fs::write(&path, format!("{good}\n{{\"id\":\"torn")).unwrap();
        let j = Journal::new(path);
        j.append(&entry("b")).unwrap();
        let ids: Vec<String> = j.load().unwrap().into_iter().map(|e| e.id).collect();
        assert_eq!(ids, ["a", "b"]);
    }

    #[test]
    fn entries_of_older_versions_read_with_the_new_fields_empty() {
        let old = r#"{"id":"1-1-x","repoPath":"r","branch":"x","sha":"s","upstreamRemote":null,"upstreamMerge":null,"backupRef":"refs/x","deletedAt":1,"forced":false,"verdict":"Safe","droppedStashes":[],"removedWorktree":null,"restoredAt":null}"#;
        let e: DeletedEntry = serde_json::from_str(old).unwrap();
        assert!(e.files_backup.is_none() && e.worktree_backup.is_none() && e.branch_config.is_empty() && e.remote.is_none());
    }
}
