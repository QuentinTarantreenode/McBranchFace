//! Production code must not panic on input: every `unwrap`/`expect` outside tests is either gone
//! or one of these reviewed invariants. A new one fails this test until it is justified here.
use std::path::Path;

const ALLOWED: &[(&str, &str)] = &[
    // The app cannot run at all without its window; nothing to recover to.
    ("lib.rs", r#".expect("error while running tauri application")"#),
    // Both streams are configured as piped a few lines above.
    ("process.rs", r#".expect("piped stdout")"#),
    ("process.rs", r#".expect("piped stderr")"#),
    // The semaphore is private to the budget, which never closes it.
    ("budget.rs", r#".expect("the budget's semaphore is never closed")"#),
];

#[test]
fn no_unreviewed_unwrap_or_expect_in_production_code() {
    let mut found = Vec::new();
    let src = Path::new(env!("CARGO_MANIFEST_DIR")).join("src");
    let mut stack = vec![src.clone()];
    while let Some(dir) = stack.pop() {
        for e in std::fs::read_dir(&dir).unwrap().flatten() {
            let p = e.path();
            if p.is_dir() {
                stack.push(p);
                continue;
            }
            if p.extension().and_then(|x| x.to_str()) != Some("rs") {
                continue;
            }
            let text = std::fs::read_to_string(&p).unwrap();
            // Everything after the test module marker is test code.
            let prod = text.split("#[cfg(test)]").next().unwrap_or("");
            let name = p.file_name().unwrap().to_string_lossy().to_string();
            for line in prod.lines().filter(|l| l.contains(".unwrap()") || l.contains(".expect(")) {
                let ok = ALLOWED.iter().any(|(f, s)| *f == name && line.contains(s));
                if !ok {
                    found.push(format!("{name}: {}", line.trim()));
                }
            }
        }
    }
    assert!(found.is_empty(), "unreviewed unwrap/expect:\n{}", found.join("\n"));
}
