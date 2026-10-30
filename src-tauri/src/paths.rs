//! One rule for when two spellings name the same folder. Callers pass paths as the user typed them,
//! as git prints them and as `Path::join` builds them; every comparison, map key and persisted key
//! goes through `path_key`, so the rule can only change here.

/// Separators unified, trailing slashes dropped, case folded only on Windows (its file system ignores
/// case; elsewhere `A` and `a` are two folders).
pub fn path_key(path: &str) -> String {
    let slashed = path.replace('\\', "/");
    let trimmed = slashed.trim_end_matches('/');
    if cfg!(windows) { trimmed.to_lowercase() } else { trimmed.to_string() }
}

pub fn same_path(a: &str, b: &str) -> bool {
    path_key(a) == path_key(b)
}

/// The folder itself or anything below it; `C:/ab` is not below `C:/a`.
pub fn is_under(path: &str, folder: &str) -> bool {
    format!("{}/", path_key(path)).starts_with(&format!("{}/", path_key(folder)))
}

/// For display only: git prints forward slashes, joined paths contain backslashes on Windows. Case
/// stays as it was, so the user reads the folder as it is spelled on disk.
pub fn slashes(path: &str) -> String {
    path.replace('\\', "/")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[derive(serde::Deserialize)]
    struct Case {
        input: String,
        windows: String,
        other: String,
    }

    /// Shared with the frontend: both implementations must agree on every row.
    #[test]
    fn keys_follow_the_shared_table() {
        let cases: Vec<Case> = serde_json::from_str(include_str!("../tests/fixtures/path-keys.json")).unwrap();
        assert!(!cases.is_empty());
        for c in cases {
            let expected = if cfg!(windows) { &c.windows } else { &c.other };
            assert_eq!(&path_key(&c.input), expected, "input {:?}", c.input);
        }
    }

    #[test]
    fn same_path_and_is_under_use_the_key() {
        assert!(same_path("C:\\ws\\a\\", "C:/ws/a"));
        assert!(!same_path("C:/ws/a", "C:/ws/ab"));
        assert_eq!(same_path("C:/WS/a", "c:/ws/a"), cfg!(windows));
        assert!(is_under("C:\\ws\\a\\b", "C:/ws/a/"));
        assert!(is_under("C:/ws/a", "C:/ws/a"));
        assert!(!is_under("C:/ws/ab", "C:/ws/a"), "a sibling with a longer name is not below");
        assert_eq!(slashes("C:\\Ws\\A"), "C:/Ws/A");
    }
}
