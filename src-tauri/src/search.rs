//! `space /`: a regex search of the files under the workspace root, as Helix's
//! global search runs ripgrep's libraries. The walk is the file picker's
//! (hidden and git-ignored files left out); binary and very large files are
//! skipped.

use std::path::{Path, PathBuf};

use regex::RegexBuilder;

const MAX_MATCHES: usize = 2_000;
const MAX_FILE_BYTES: u64 = 8 << 20;
/// Characters of a matching line kept, around the match.
const MAX_LINE_CHARS: usize = 300;

#[derive(serde::Serialize, Debug, PartialEq)]
pub struct Match {
    /// Relative to the root.
    pub path: String,
    /// One-based.
    pub line: usize,
    /// The line, or a window of it around the match.
    pub text: String,
    /// The match in `text`, in UTF-16 code units (JavaScript string offsets).
    pub from: usize,
    pub to: usize,
}

/// Smart case, as Helix: a pattern with no uppercase letter ignores case.
pub fn search(root: &Path, pattern: &str) -> Result<Vec<Match>, String> {
    let regex = RegexBuilder::new(pattern)
        .case_insensitive(!pattern.chars().any(char::is_uppercase))
        .multi_line(true)
        .build()
        .map_err(|e| e.to_string().lines().last().unwrap_or("invalid pattern").trim().to_string())?;
    let mut matches = Vec::new();
    let mut files: Vec<PathBuf> = ignore::WalkBuilder::new(root)
        .build()
        .flatten()
        .filter(|e| e.file_type().is_some_and(|t| t.is_file()))
        .filter(|e| e.metadata().is_ok_and(|m| m.len() <= MAX_FILE_BYTES))
        .map(|e| e.into_path())
        .collect();
    files.sort();
    for path in files {
        let Ok(bytes) = std::fs::read(&path) else { continue };
        if bytes[..bytes.len().min(8192)].contains(&0) {
            continue;
        }
        let text = String::from_utf8_lossy(&bytes);
        let rel = path.strip_prefix(root).unwrap_or(&path).to_string_lossy().into_owned();
        for (n, line) in text.lines().enumerate() {
            // One result a line, at its first match, as a picker row.
            let Some(m) = regex.find(line) else { continue };
            if m.start() == m.end() && line.is_empty() {
                continue;
            }
            matches.push(excerpt(&rel, n + 1, line, m.start(), m.end()));
            if matches.len() >= MAX_MATCHES {
                return Ok(matches);
            }
        }
    }
    Ok(matches)
}

/// The line with the match at byte offsets `start..end`, cut to a window of
/// it when long, and with its indentation trimmed.
fn excerpt(path: &str, line: usize, text: &str, start: usize, end: usize) -> Match {
    let trimmed = text.trim_start();
    let indent = text.len() - trimmed.len();
    let (mut a, mut b) = (indent.min(start), text.len());
    if text[a..b].chars().count() > MAX_LINE_CHARS {
        // Some context before the match, then as much after as fits.
        a = text[..start].char_indices().rev().nth(40).map_or(a, |(i, _)| i.max(a));
        b = text[a..].char_indices().nth(MAX_LINE_CHARS).map_or(b, |(i, _)| a + i).max(end);
    }
    let units = |s: &str| s.encode_utf16().count();
    Match {
        path: path.to_string(),
        line,
        text: text[a..b].trim_end().to_string(),
        from: units(&text[a..start]),
        to: units(&text[a..end.min(b)]),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn dir(files: &[(&str, &[u8])]) -> PathBuf {
        let root = std::env::temp_dir().join(format!("md-editor-search-{}-{}", std::process::id(), files.len()));
        let _ = std::fs::remove_dir_all(&root);
        for (name, bytes) in files {
            let path = root.join(name);
            std::fs::create_dir_all(path.parent().unwrap()).unwrap();
            std::fs::write(path, bytes).unwrap();
        }
        root
    }

    #[test]
    fn finds_lines_with_smart_case() {
        let root = dir(&[
            ("a.md", b"# Title\n\n  The cost is high.\nno match\n"),
            ("sub/b.md", "Café cost\n".as_bytes()),
            ("bin.dat", b"cost\0\0"),
            (".hidden.md", b"cost"),
        ]);
        let found = search(&root, "cost").unwrap();
        let rows: Vec<_> = found.iter().map(|m| (m.path.as_str(), m.line, m.text.as_str(), m.from, m.to)).collect();
        assert_eq!(rows, vec![("a.md", 3, "The cost is high.", 4, 8), ("sub/b.md", 1, "Café cost", 5, 9)]);
        assert_eq!(search(&root, "Cost").unwrap().len(), 0);
        assert_eq!(search(&root, "COST|title").unwrap().len(), 0);
        assert_eq!(search(&root, "cost|title").unwrap().len(), 3);
        assert!(search(&root, "(").is_err());
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn cuts_long_lines_around_the_match() {
        let line = format!("{}needle{}", "a".repeat(500), "b".repeat(500));
        let m = excerpt("x.md", 1, &line, 500, 506);
        assert!(m.text.chars().count() <= MAX_LINE_CHARS + 1);
        assert_eq!(&m.text[m.from..m.to], "needle");
    }
}
