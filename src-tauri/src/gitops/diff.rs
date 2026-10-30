//! Unified diff → structured hunks with line numbers and word-level intraline ranges, and the way
//! back: a patch of chosen lines, for staging, unstaging or discarding part of a file.

use std::collections::{HashMap, HashSet};

use anyhow::Result;

use crate::git::runner::Git;
use crate::model::{DiffLine, DiffOptions, DiffSource, FileDiff, Hunk, HunkPick, LineKind, Whitespace};

/// Beyond this the viewer shows the start and offers to load everything.
pub const LINE_LIMIT: usize = 5_000;
/// Context that shows a whole file as one hunk.
const WHOLE_FILE: u32 = 1_000_000;

/// The algorithm is fixed: a `diff.algorithm` in the user's config must not change what the viewer
/// shows, or which lines a partial stage picks.
fn base_args(opts: &DiffOptions) -> Vec<String> {
    let mut a: Vec<String> = ["--no-color", "--no-ext-diff", "--diff-algorithm=histogram"].map(String::from).into();
    a.push(format!("-U{}", opts.context.min(WHOLE_FILE)));
    match opts.whitespace {
        Whitespace::Keep => {}
        Whitespace::IgnoreChange => a.extend(["-b", "--ignore-cr-at-eol"].map(String::from)),
        Whitespace::IgnoreAll => a.extend(["-w", "--ignore-cr-at-eol"].map(String::from)),
    }
    a
}

/// The paths a diff is limited to: with the old one of a rename too, or git sees an added file.
fn spec<'a>(path: &'a str, orig: Option<&'a str>) -> Vec<&'a str> {
    std::iter::once("--").chain(std::iter::once(path)).chain(orig).collect()
}

const fn limit(opts: &DiffOptions) -> usize {
    if opts.full { usize::MAX } else { LINE_LIMIT }
}

/// git's own diff text of a working-tree file; the parsed view and a partial patch both start here.
pub async fn raw_working(git: &Git, path: &str, source: DiffSource, opts: &DiffOptions, orig: Option<&str>) -> Result<String> {
    let base = base_args(opts);
    let mut args: Vec<&str> = match source {
        DiffSource::Staged => vec!["diff", "--cached", "-M"],
        DiffSource::Untracked => vec!["diff", "--no-index"],
        DiffSource::Unstaged | DiffSource::Conflict => vec!["diff"],
    };
    args.extend(base.iter().map(String::as_str));
    if source == DiffSource::Untracked {
        // `--no-index` exits with 1 when files differ, which is the normal case here.
        args.extend(["--", "/dev/null", path]);
        return Ok(git.raw(&args).await?.stdout);
    }
    args.extend(spec(path, orig));
    git.out(&args).await
}

pub async fn working_diff(git: &Git, path: &str, source: DiffSource, opts: &DiffOptions, orig: Option<&str>) -> Result<FileDiff> {
    // git's combined diff for unmerged files is hard to read; the file with its markers is not.
    if source == DiffSource::Conflict {
        let text = std::fs::read_to_string(git.dir().join(path)).unwrap_or_default();
        return Ok(conflict_view(path, &text, limit(opts)));
    }
    let out = raw_working(git, path, source, opts, orig).await?;
    Ok(parse(path, &out, limit(opts)))
}

/// Working copy of a conflicted file: marker lines as Meta, "ours" as Del, "theirs" as Add.
pub fn conflict_view(path: &str, text: &str, limit: usize) -> FileDiff {
    #[derive(PartialEq)]
    enum Side {
        Outside,
        Ours,
        Base,
        Theirs,
    }
    let mut side = Side::Outside;
    let mut lines = Vec::new();
    let (mut ours, mut theirs, mut truncated) = (0, 0, false);
    for (i, raw) in text.lines().enumerate() {
        if i >= limit {
            truncated = true;
            break;
        }
        let kind = if raw.starts_with("<<<<<<<") {
            side = Side::Ours;
            LineKind::Meta
        } else if raw.starts_with("|||||||") && side == Side::Ours {
            side = Side::Base;
            LineKind::Meta
        } else if raw.starts_with("=======") && side != Side::Outside {
            side = Side::Theirs;
            LineKind::Meta
        } else if raw.starts_with(">>>>>>>") && side == Side::Theirs {
            side = Side::Outside;
            LineKind::Meta
        } else {
            match side {
                Side::Ours => {
                    ours += 1;
                    LineKind::Del
                }
                Side::Theirs => {
                    theirs += 1;
                    LineKind::Add
                }
                Side::Base | Side::Outside => LineKind::Context,
            }
        };
        let no = Some(i as u32 + 1);
        lines.push(DiffLine { kind, old_no: no, new_no: no, text: raw.to_string(), changed: Vec::new(), eol: false });
    }
    let n = lines.len() as u32;
    FileDiff {
        path: path.to_string(),
        old_path: None,
        similarity: None,
        old_mode: None,
        new_mode: None,
        binary: false,
        truncated,
        added: theirs,
        removed: ours,
        hunks: vec![Hunk { header: String::new(), section: String::new(), old_start: 1, old_lines: n, new_start: 1, new_lines: n, lines }],
        conflict: true,
    }
}

pub async fn commit_diff(git: &Git, sha: &str, path: &str, opts: &DiffOptions, orig: Option<&str>) -> Result<FileDiff> {
    // First-parent view: a merge commit shows what it brought into the branch.
    let sha = super::history::checked_rev(sha)?;
    let base = base_args(opts);
    let mut args = vec!["show", "--format=", "--diff-merges=first-parent", "-M"];
    args.extend(base.iter().map(String::as_str));
    args.push(sha);
    args.extend(spec(path, orig));
    let out = git.out(&args).await?;
    Ok(parse(path, &out, limit(opts)))
}

/// `12,3` → (12, 3); a range without a count has one line.
fn range(spec: &str) -> (u32, u32) {
    let mut p = spec.split(',');
    let start = p.next().and_then(|n| n.parse().ok()).unwrap_or(0);
    let len = p.next().map_or(1, |n| n.parse().unwrap_or(0));
    (start, len)
}

fn hunk_header(line: &str) -> Option<Hunk> {
    let rest = line.strip_prefix("@@ ")?;
    let end = rest.find(" @@")?;
    let mut specs = rest[..end].split(' ');
    let (old_start, old_lines) = range(specs.next()?.strip_prefix('-')?);
    let (new_start, new_lines) = range(specs.next()?.strip_prefix('+')?);
    let section = rest[end + 3..].trim().to_string();
    Some(Hunk { header: line.to_string(), section, old_start, old_lines, new_start, new_lines, lines: Vec::new() })
}

/// A line of git's output without its line ending, and whether that ending was CRLF.
fn split_cr(raw: &str) -> (&str, bool) {
    match raw.strip_suffix('\r') {
        Some(l) => (l, true),
        None => (raw, false),
    }
}

pub fn parse(path: &str, text: &str, limit: usize) -> FileDiff {
    let mut diff = FileDiff {
        path: path.to_string(),
        old_path: None,
        similarity: None,
        old_mode: None,
        new_mode: None,
        binary: false,
        truncated: false,
        added: 0,
        removed: 0,
        hunks: Vec::new(),
        conflict: false,
    };
    // Line endings of each hunk's lines, to tell a CRLF-only change from a real one.
    let mut crs: Vec<Vec<bool>> = Vec::new();
    let (mut old_no, mut new_no, mut count) = (0u32, 0u32, 0usize);
    for (line, cr) in text.split('\n').map(split_cr) {
        if diff.hunks.is_empty() {
            if line.starts_with("Binary files ") || line.starts_with("GIT binary patch") {
                diff.binary = true;
            } else if let Some(p) = line.strip_prefix("rename from ").or_else(|| line.strip_prefix("copy from ")) {
                diff.old_path = Some(p.to_string());
            } else if let Some(p) = line.strip_prefix("similarity index ") {
                diff.similarity = p.trim_end_matches('%').parse().ok();
            } else if let Some(m) = line.strip_prefix("old mode ") {
                diff.old_mode = Some(m.to_string());
            } else if let Some(m) = line.strip_prefix("new mode ") {
                diff.new_mode = Some(m.to_string());
            }
        }
        if line.starts_with("@@ ") {
            if let Some(h) = hunk_header(line) {
                old_no = h.old_start;
                new_no = h.new_start;
                diff.hunks.push(h);
                crs.push(Vec::new());
            }
            continue;
        }
        // File headers before the first hunk; an empty element is the end of the output.
        let (Some(hunk), Some(hunk_crs)) = (diff.hunks.last_mut(), crs.last_mut()) else { continue };
        if line.is_empty() {
            continue;
        }
        if count >= limit {
            diff.truncated = true;
            break;
        }
        let (kind, text) = match line.as_bytes()[0] {
            b'+' => (LineKind::Add, &line[1..]),
            b'-' => (LineKind::Del, &line[1..]),
            b'\\' => (LineKind::Meta, line),
            _ => (LineKind::Context, line.get(1..).unwrap_or("")),
        };
        let (o, n) = match kind {
            LineKind::Add => {
                diff.added += 1;
                new_no += 1;
                (None, Some(new_no - 1))
            }
            LineKind::Del => {
                diff.removed += 1;
                old_no += 1;
                (Some(old_no - 1), None)
            }
            LineKind::Context => {
                old_no += 1;
                new_no += 1;
                (Some(old_no - 1), Some(new_no - 1))
            }
            LineKind::Meta => (None, None),
        };
        hunk.lines.push(DiffLine { kind, old_no: o, new_no: n, text: text.to_string(), changed: Vec::new(), eol: false });
        hunk_crs.push(cr);
        count += 1;
    }
    for (h, c) in diff.hunks.iter_mut().zip(&crs) {
        mark_intraline(&mut h.lines, c);
    }
    diff
}

/// Pairs the deleted and added lines of each change and marks, word by word, what differs.
fn mark_intraline(lines: &mut [DiffLine], crs: &[bool]) {
    let mut i = 0;
    while i < lines.len() {
        if lines[i].kind != LineKind::Del {
            i += 1;
            continue;
        }
        let del_start = i;
        while i < lines.len() && lines[i].kind == LineKind::Del {
            i += 1;
        }
        let add_start = i;
        while i < lines.len() && lines[i].kind == LineKind::Add {
            i += 1;
        }
        for (d, a) in pair_lines(&lines[del_start..add_start], &lines[add_start..i]) {
            let (d, a) = (del_start + d, add_start + a);
            if lines[d].text == lines[a].text {
                // The same text on both sides: only the line ending changed.
                let eol = crs.get(d) != crs.get(a);
                lines[d].eol = eol;
                lines[a].eol = eol;
                continue;
            }
            let (dr, ar) = word_ranges(&lines[d].text, &lines[a].text);
            lines[d].changed = dr;
            lines[a].changed = ar;
        }
    }
}

/// A word, a run of whitespace or a single other character, with its place in UTF-16 units: the
/// UI slices JS strings with them.
#[derive(Debug, Clone, Copy)]
struct Token<'a> {
    text: &'a str,
    start: u32,
    end: u32,
}

impl Token<'_> {
    fn is_space(&self) -> bool {
        self.text.trim().is_empty()
    }
}

#[derive(PartialEq)]
enum Class {
    Word,
    Space,
    Other,
}

fn class(c: char) -> Class {
    if c.is_alphanumeric() || c == '_' {
        Class::Word
    } else if c.is_whitespace() {
        Class::Space
    } else {
        Class::Other
    }
}

fn tokenize(s: &str) -> Vec<Token<'_>> {
    let mut out: Vec<Token> = Vec::new();
    let (mut from, mut from_units, mut units) = (0usize, 0u32, 0u32);
    let mut current: Option<Class> = None;
    for (i, c) in s.char_indices() {
        let k = class(c);
        // Words and whitespace are runs; every other character is a token of its own.
        let joins = current.as_ref().is_some_and(|p| *p == k && k != Class::Other);
        if !joins {
            if current.is_some() {
                out.push(Token { text: &s[from..i], start: from_units, end: units });
            }
            from = i;
            from_units = units;
            current = Some(k);
        }
        units += c.len_utf16() as u32;
    }
    if current.is_some() {
        out.push(Token { text: &s[from..], start: from_units, end: units });
    }
    out
}

/// Share of equal words between two lines: Dice over the multiset of tokens, whitespace aside.
fn similarity(a: &[Token], b: &[Token]) -> f64 {
    let (na, nb) = (a.iter().filter(|t| !t.is_space()).count(), b.iter().filter(|t| !t.is_space()).count());
    if na + nb == 0 {
        return 1.0;
    }
    let mut bag: HashMap<&str, u32> = HashMap::new();
    for t in b.iter().filter(|t| !t.is_space()) {
        *bag.entry(t.text).or_default() += 1;
    }
    let mut common = 0u32;
    for t in a.iter().filter(|t| !t.is_space()) {
        if let Some(n) = bag.get_mut(t.text).filter(|n| **n > 0) {
            *n -= 1;
            common += 1;
        }
    }
    2.0 * f64::from(common) / (na + nb) as f64
}

/// Below this share of equal words two lines are different lines, not an edited one.
const PAIR_SIMILARITY: f64 = 0.4;

/// Pairs deleted with added lines in order, each with the most similar one still ahead; a line
/// with nothing similar stays unpaired. Long runs pair by position: the search grows with both.
fn pair_lines(dels: &[DiffLine], adds: &[DiffLine]) -> Vec<(usize, usize)> {
    if dels.len() * adds.len() > 2_500 {
        return (0..dels.len().min(adds.len())).map(|k| (k, k)).collect();
    }
    let dt: Vec<Vec<Token>> = dels.iter().map(|l| tokenize(&l.text)).collect();
    let at: Vec<Vec<Token>> = adds.iter().map(|l| tokenize(&l.text)).collect();
    let mut out = Vec::new();
    let mut next = 0;
    for (d, dtok) in dt.iter().enumerate() {
        let mut best: Option<(usize, f64)> = None;
        for (a, atok) in at.iter().enumerate().skip(next) {
            let s = similarity(dtok, atok);
            if s >= PAIR_SIMILARITY && best.is_none_or(|(_, b)| s > b) {
                best = Some((a, s));
            }
        }
        if let Some((a, _)) = best {
            out.push((d, a));
            next = a + 1;
        }
    }
    out
}

/// Beyond this many token pairs a line is compared by common prefix and suffix only.
const LCS_CELLS: usize = 40_000;

/// Which tokens of each side belong to the longest common subsequence.
fn lcs(a: &[Token], b: &[Token]) -> (Vec<bool>, Vec<bool>) {
    let (n, m) = (a.len(), b.len());
    let at = |i: usize, j: usize| i * (m + 1) + j;
    let mut t = vec![0u32; (n + 1) * (m + 1)];
    for i in (0..n).rev() {
        for j in (0..m).rev() {
            t[at(i, j)] = if a[i].text == b[j].text { t[at(i + 1, j + 1)] + 1 } else { t[at(i + 1, j)].max(t[at(i, j + 1)]) };
        }
    }
    let (mut ma, mut mb) = (vec![false; n], vec![false; m]);
    let (mut i, mut j) = (0, 0);
    while i < n && j < m {
        if a[i].text == b[j].text {
            ma[i] = true;
            mb[j] = true;
            i += 1;
            j += 1;
        } else if t[at(i + 1, j)] >= t[at(i, j + 1)] {
            i += 1;
        } else {
            j += 1;
        }
    }
    (ma, mb)
}

/// Changed spans [start, end) of a line in UTF-16 units.
type Ranges = Vec<(u32, u32)>;

/// Unmatched tokens as ranges. Two changes only whitespace apart read as one, so they become one.
fn ranges(tokens: &[Token], matched: &[bool]) -> Ranges {
    let mut out: Vec<(u32, u32)> = Vec::new();
    let mut joinable = false;
    for (t, m) in tokens.iter().zip(matched) {
        if *m {
            joinable = joinable && t.is_space();
            continue;
        }
        match out.last_mut() {
            Some(r) if r.1 == t.start || joinable => r.1 = t.end,
            _ => out.push((t.start, t.end)),
        }
        joinable = true;
    }
    out
}

/// Word ranges that differ between an old and a new line. No word in common: no marks, the line
/// is new as a whole and marking all of it adds nothing.
fn word_ranges(a: &str, b: &str) -> (Ranges, Ranges) {
    let (ta, tb) = (tokenize(a), tokenize(b));
    if ta.len() * tb.len() > LCS_CELLS {
        let (x, y) = changed_ranges(a, b);
        return (x.into_iter().collect(), y.into_iter().collect());
    }
    let (ma, mb) = lcs(&ta, &tb);
    if !ta.iter().zip(&ma).any(|(t, m)| *m && !t.is_space()) {
        return (Vec::new(), Vec::new());
    }
    (ranges(&ta, &ma), ranges(&tb, &mb))
}

/// Character ranges that differ, in UTF-16 units: the fallback for very long lines.
type Range = Option<(u32, u32)>;

fn changed_ranges(a: &str, b: &str) -> (Range, Range) {
    let a16: Vec<u16> = a.encode_utf16().collect();
    let b16: Vec<u16> = b.encode_utf16().collect();
    let prefix = a16.iter().zip(&b16).take_while(|(x, y)| x == y).count();
    let max_suffix = a16.len().min(b16.len()) - prefix;
    let suffix = a16.iter().rev().zip(b16.iter().rev()).take(max_suffix).take_while(|(x, y)| x == y).count();
    let range = |len: usize| {
        let (s, e) = (prefix, len - suffix);
        (e > s && (prefix + suffix) > 0).then_some((s as u32, e as u32))
    };
    (range(a16.len()), range(b16.len()))
}

#[derive(Debug, PartialEq, Eq)]
pub enum PatchError {
    /// A hunk is not the one that was shown: the file changed in between.
    Changed,
    /// Nothing that changes a line was chosen.
    Nothing,
    /// Added and deleted files move as a whole.
    WholeFileOnly,
}

/// A patch with the chosen lines of `raw` (git's diff output), applied forwards to stage and
/// backwards to unstage or discard. What is not chosen keeps the side the patch is applied to as
/// it is: an unchosen deletion is context forwards and left out backwards, an unchosen addition the
/// other way round. Built from the raw text, so CRLF lines stay byte for byte.
pub fn partial_patch(raw: &str, picks: &[HunkPick], reverse: bool) -> Result<String, PatchError> {
    let parsed = parse("", raw, usize::MAX);
    let first = raw.find("\n@@ ").map(|i| i + 1).ok_or(PatchError::Changed)?;
    let head = &raw[..first];
    if head.lines().any(|l| l.starts_with("new file mode") || l.starts_with("deleted file mode")) {
        return Err(PatchError::WholeFileOnly);
    }
    // The raw lines of each hunk, with their line endings, counted as `parse` counts them.
    let mut hunks: Vec<Vec<&str>> = Vec::new();
    for piece in raw[first..].split_inclusive('\n') {
        let (line, _) = split_cr(piece.trim_end_matches('\n'));
        if line.starts_with("@@ ") {
            hunks.push(Vec::new());
        } else if !line.is_empty() {
            if let Some(h) = hunks.last_mut() {
                h.push(piece);
            }
        }
    }
    let mut picks: Vec<&HunkPick> = picks.iter().collect();
    picks.sort_by_key(|p| p.hunk);
    picks.dedup_by_key(|p| p.hunk);
    let mut out = head.to_string();
    let mut delta: i64 = 0;
    let mut any = false;
    for p in picks {
        let i = p.hunk as usize;
        let (Some(h), Some(lines)) = (parsed.hunks.get(i).filter(|h| h.header == p.header), hunks.get(i)) else {
            return Err(PatchError::Changed);
        };
        let chosen: Option<HashSet<u32>> = p.lines.as_ref().map(|l| l.iter().copied().collect());
        let picked = |k: usize| chosen.as_ref().is_none_or(|c| c.contains(&(k as u32)));
        let (mut body, mut olds, mut news, mut changes) = (String::new(), 0i64, 0i64, 0);
        let mut kept = false;
        for (k, (l, raw_line)) in h.lines.iter().zip(lines).enumerate() {
            let mark = match l.kind {
                LineKind::Context => Some(' '),
                LineKind::Add if picked(k) => Some('+'),
                LineKind::Del if picked(k) => Some('-'),
                LineKind::Add => reverse.then_some(' '),
                LineKind::Del => (!reverse).then_some(' '),
                // "\ No newline at end of file" belongs to the line before it.
                LineKind::Meta => {
                    if kept {
                        body.push_str(raw_line);
                    }
                    continue;
                }
            };
            kept = mark.is_some();
            let Some(m) = mark else { continue };
            match m {
                ' ' => {
                    olds += 1;
                    news += 1;
                }
                '+' => {
                    news += 1;
                    changes += 1;
                }
                _ => {
                    olds += 1;
                    changes += 1;
                }
            }
            body.push(m);
            body.push_str(&raw_line[1..]);
        }
        if changes == 0 {
            continue;
        }
        any = true;
        // Forwards the old side is the file as it is, backwards the new side is.
        let (os, ns) = if reverse {
            (i64::from(h.new_start) - delta, i64::from(h.new_start))
        } else {
            (i64::from(h.old_start), i64::from(h.old_start) + delta)
        };
        delta += news - olds;
        out.push_str(&format!("@@ -{os},{olds} +{ns},{news} @@\n"));
        out.push_str(&body);
        if !body.ends_with('\n') {
            out.push('\n');
        }
    }
    if any { Ok(out) } else { Err(PatchError::Nothing) }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE: &str = "diff --git a/f.rs b/f.rs\nindex 1..2 100644\n--- a/f.rs\n+++ b/f.rs\n\
@@ -1,4 +1,5 @@ fn main()\n keep\n-let x = 1;\n+let x = 42;\n+added\n keep2\n\\ No newline at end of file\n\
@@ -10,2 +11,2 @@\n-old\n+new\n";

    #[test]
    fn parses_hunks_ranges_and_numbers() {
        let d = parse("f.rs", SAMPLE, LINE_LIMIT);
        assert_eq!((d.added, d.removed, d.hunks.len()), (3, 2, 2));
        let h = &d.hunks[0];
        assert_eq!((h.old_start, h.old_lines, h.new_start, h.new_lines, h.section.as_str()), (1, 4, 1, 5, "fn main()"));
        let l = &h.lines;
        assert_eq!((l[0].kind, l[0].old_no, l[0].new_no), (LineKind::Context, Some(1), Some(1)));
        assert_eq!((l[1].kind, l[1].old_no, l[1].new_no), (LineKind::Del, Some(2), None));
        assert_eq!((l[2].kind, l[2].old_no, l[2].new_no), (LineKind::Add, None, Some(2)));
        assert_eq!((l[3].kind, l[3].new_no), (LineKind::Add, Some(3)));
        assert_eq!((l[4].old_no, l[4].new_no), (Some(3), Some(4)));
        assert_eq!(l[5].kind, LineKind::Meta);
        assert_eq!(d.hunks[1].lines[0].old_no, Some(10));
        assert_eq!(d.hunks[1].lines[1].new_no, Some(11));
        assert_eq!(d.hunks[1].section, "");
    }

    #[test]
    fn marks_words_several_per_line() {
        let d = parse("f.rs", SAMPLE, LINE_LIMIT);
        let l = &d.hunks[0].lines;
        assert_eq!(l[1].changed, vec![(8, 9)], "'1' in 'let x = 1;'");
        assert_eq!(l[2].changed, vec![(8, 10)], "'42' in 'let x = 42;'");
        assert!(l[3].changed.is_empty(), "unpaired add");
        let (a, b) = word_ranges("call(one, two, three)", "call(uno, two, tres)");
        assert_eq!((a, b), (vec![(5, 8), (15, 20)], vec![(5, 8), (15, 19)]), "two words, each its own range");
        assert_eq!(word_ranges("abc", "xyz"), (vec![], vec![]), "nothing in common");
        assert_eq!(word_ranges("äöü x", "äöü y"), (vec![(4, 5)], vec![(4, 5)]), "UTF-16 offsets");
        // Only additions: the old line has nothing that is not in the new one.
        let (old, new) = word_ranges("        var pages = report.Pages.ToList();", "        var pages = report.Pages?.ToList() ?? [];");
        assert_eq!((old, new), (vec![], vec![(32, 33), (42, 48)]));
        let joined = word_ranges("a b c", "a x y c").1;
        assert_eq!((joined.len(), joined[0].0), (1, 2), "whitespace between two changed words joins them: {joined:?}");
    }

    #[test]
    fn pairs_an_edited_line_with_its_new_version_not_with_the_next_one() {
        let diff = "@@ -1,2 +1,3 @@\n-fn alpha(x: u32) -> u32\n-return x;\n+// new comment\n+fn alpha(x: u64) -> u32\n+return x;\n";
        let d = parse("f.rs", diff, LINE_LIMIT);
        let l = &d.hunks[0].lines;
        assert!(l[2].changed.is_empty(), "the inserted comment has no partner");
        assert_eq!(l[0].changed, vec![(12, 15)], "u32 → u64 in the parameter only");
        assert_eq!(l[3].changed, vec![(12, 15)]);
    }

    #[test]
    fn a_line_ending_change_is_marked_as_such() {
        let d = parse("f.txt", "@@ -1 +1 @@\n-same\r\n+same\n", LINE_LIMIT);
        let l = &d.hunks[0].lines;
        assert!(l[0].eol && l[1].eol);
        assert_eq!(l[0].text, "same", "the \\r is not part of the text");
    }

    #[test]
    fn reads_rename_similarity_and_mode() {
        let text = "diff --git a/old.rs b/new.rs\nold mode 100644\nnew mode 100755\nsimilarity index 87%\nrename from old.rs\nrename to new.rs\n@@ -1 +1 @@\n-a\n+b\n";
        let d = parse("new.rs", text, LINE_LIMIT);
        assert_eq!((d.old_path.as_deref(), d.similarity), (Some("old.rs"), Some(87)));
        assert_eq!((d.old_mode.as_deref(), d.new_mode.as_deref()), (Some("100644"), Some("100755")));
    }

    #[test]
    fn conflict_view_marks_both_sides() {
        let text = "top\n<<<<<<< Updated upstream\nmine\n=======\ntheirs 1\ntheirs 2\n>>>>>>> Stashed changes\nbottom\n";
        let d = conflict_view("f.txt", text, LINE_LIMIT);
        let k: Vec<LineKind> = d.hunks[0].lines.iter().map(|l| l.kind).collect();
        use LineKind::*;
        assert_eq!(k, vec![Context, Meta, Del, Meta, Add, Add, Meta, Context]);
        assert_eq!((d.removed, d.added), (1, 2));
        assert_eq!(d.hunks[0].lines[7].new_no, Some(8), "line numbers are file line numbers");
    }

    #[test]
    fn binary_and_truncation() {
        let b = parse("img.png", "diff --git a/img.png b/img.png\nBinary files a/img.png and b/img.png differ\n", LINE_LIMIT);
        assert!(b.binary && b.hunks.is_empty());
        let big: String = std::iter::once("@@ -1,0 +1,10 @@".to_string()).chain((0..10).map(|i| format!("+l{i}"))).collect::<Vec<_>>().join("\n");
        let t = parse("big", &big, 4);
        assert!(t.truncated);
        assert_eq!(t.hunks[0].lines.len(), 4);
    }

    const TWO: &str = "diff --git a/f.txt b/f.txt\n--- a/f.txt\n+++ b/f.txt\n@@ -1,3 +1,3 @@\n a\n-b\n+B\n c\n@@ -10,2 +10,3 @@\n x\n+new 1\n+new 2\n y\n";

    fn pick(hunk: u32, lines: Option<Vec<u32>>) -> HunkPick {
        let header = parse("", TWO, usize::MAX).hunks[hunk as usize].header.clone();
        HunkPick { hunk, header, lines }
    }

    #[test]
    fn a_partial_patch_keeps_the_unchosen_lines_as_they_are() {
        // Forwards (stage): the second hunk, first new line only; the other one stays out.
        let p = partial_patch(TWO, &[pick(1, Some(vec![1]))], false).unwrap();
        assert!(p.ends_with("@@ -10,2 +10,3 @@\n x\n+new 1\n y\n"), "{p}");
        // Backwards (unstage, discard): the unchosen addition is context, it stays.
        let p = partial_patch(TWO, &[pick(1, Some(vec![1]))], true).unwrap();
        assert!(p.ends_with("@@ -10,3 +10,4 @@\n x\n+new 1\n new 2\n y\n"), "{p}");
        // An unchosen deletion forwards is context: the line stays in the index.
        let p = partial_patch(TWO, &[pick(0, Some(vec![2]))], false).unwrap();
        assert!(p.contains("@@ -1,3 +1,4 @@\n a\n b\n+B\n c\n"), "{p}");
        // The second hunk moves by what the first one changed.
        let p = partial_patch(TWO, &[pick(0, Some(vec![2])), pick(1, None)], false).unwrap();
        assert!(p.contains("@@ -10,2 +11,4 @@"), "{p}");
    }

    #[test]
    fn a_partial_patch_refuses_a_changed_hunk_an_empty_choice_and_new_files() {
        let stale = HunkPick { hunk: 0, header: "@@ -1,3 +1,4 @@".into(), lines: None };
        assert_eq!(partial_patch(TWO, &[stale], false), Err(PatchError::Changed));
        assert_eq!(partial_patch(TWO, &[pick(0, Some(vec![0, 3]))], false), Err(PatchError::Nothing), "context only");
        let new = "diff --git a/n b/n\nnew file mode 100644\n--- /dev/null\n+++ b/n\n@@ -0,0 +1,2 @@\n+a\n+b\n";
        let p = HunkPick { hunk: 0, header: "@@ -0,0 +1,2 @@".into(), lines: Some(vec![0]) };
        assert_eq!(partial_patch(new, &[p], false), Err(PatchError::WholeFileOnly));
    }

    #[test]
    fn a_partial_patch_keeps_crlf_lines_byte_for_byte() {
        let crlf = "diff --git a/w.txt b/w.txt\n--- a/w.txt\n+++ b/w.txt\n@@ -1,2 +1,2 @@\n one\r\n-two\r\n+TWO\r\n";
        let header = parse("", crlf, usize::MAX).hunks[0].header.clone();
        let p = partial_patch(crlf, &[HunkPick { hunk: 0, header, lines: None }], false).unwrap();
        assert!(p.ends_with(" one\r\n-two\r\n+TWO\r\n"), "{p:?}");
    }
}
