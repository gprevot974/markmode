//! Version history. Each time a file is opened, saved or changed by another
//! program, the front end hands over its text, which is kept as a snapshot in
//! `<app data>/history/<key>/`, where the key is a hash of the file's path.
//! The directory names its file in `path` and holds the latest `KEEP`
//! snapshots as `<milliseconds>-<kind>.md`. Text equal to the latest snapshot
//! is not kept again.
//!
//! The directory also keeps the file's baseline, `baseline.md`: the text its
//! changes are reviewed against, which is the text from before the outside
//! changes still under review, or else the file as last seen. When the file
//! differs from it on opening, the difference is up for review, so changes
//! made while the app was closed, or left pending when it quit, are not
//! taken in unseen.

use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::Serialize;
use tauri::{AppHandle, Manager};

use crate::files::write_atomic;

const KEEP: usize = 100;

#[derive(Serialize, Debug, PartialEq)]
pub struct Snapshot {
    id: String,
    /// Milliseconds since the epoch.
    time: u64,
    /// What happened: "opened", "saved" or "outside".
    kind: String,
}

/// FNV-1a: stable across Rust versions, unlike the standard hasher.
pub(crate) fn key(path: &str) -> String {
    let mut hash: u64 = 0xcbf29ce484222325;
    for b in path.as_bytes() {
        hash ^= u64::from(*b);
        hash = hash.wrapping_mul(0x100000001b3);
    }
    format!("{hash:016x}")
}

fn dir_for(root: &Path, path: &str) -> PathBuf {
    root.join(key(path))
}

fn parse_id(id: &str) -> Option<(u64, &str)> {
    let (time, kind) = id.strip_suffix(".md")?.split_once('-')?;
    let valid = !kind.is_empty() && kind.bytes().all(|b| b.is_ascii_lowercase() || b == b'-');
    Some((time.parse().ok()?, kind)).filter(|_| valid)
}

/// Oldest first.
fn snapshots(dir: &Path) -> Vec<Snapshot> {
    let mut found: Vec<Snapshot> = fs::read_dir(dir)
        .into_iter()
        .flatten()
        .flatten()
        .filter_map(|e| {
            let id = e.file_name().into_string().ok()?;
            let (time, kind) = parse_id(&id)?;
            let kind = kind.to_string();
            Some(Snapshot { id, time, kind })
        })
        .collect();
    found.sort_by_key(|s| s.time);
    found
}

/// The directory for `path`, created and named.
fn own_dir(root: &Path, path: &str) -> io::Result<PathBuf> {
    let dir = dir_for(root, path);
    fs::create_dir_all(&dir)?;
    let named = dir.join("path");
    match fs::read_to_string(&named) {
        Ok(p) if p != path => return Err(io::Error::other(format!("history of {path} collides with {p}"))),
        Ok(_) => {}
        Err(_) => fs::write(&named, path)?,
    }
    Ok(dir)
}

/// Keeps `text` as the latest snapshot of `path`; false when it already was.
pub fn add(root: &Path, path: &str, text: &str, kind: &str) -> io::Result<bool> {
    if parse_id(&format!("0-{kind}.md")).is_none() {
        return Err(io::Error::new(io::ErrorKind::InvalidInput, format!("bad snapshot kind: {kind}")));
    }
    let dir = own_dir(root, path)?;
    let existing = snapshots(&dir);
    if let Some(last) = existing.last() {
        if fs::read_to_string(dir.join(&last.id)).is_ok_and(|t| t == text) {
            return Ok(false);
        }
    }
    let now = SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |d| d.as_millis() as u64);
    let time = existing.last().map_or(now, |last| now.max(last.time + 1));
    write_atomic(&dir.join(format!("{time}-{kind}.md")), text.as_bytes())?;
    for old in existing.iter().take((existing.len() + 1).saturating_sub(KEEP)) {
        let _ = fs::remove_file(dir.join(&old.id));
    }
    Ok(true)
}

/// Newest first.
pub fn list(root: &Path, path: &str) -> Vec<Snapshot> {
    let mut found = snapshots(&dir_for(root, path));
    found.reverse();
    found
}

pub fn read(root: &Path, path: &str, id: &str) -> io::Result<String> {
    if parse_id(id).is_none() {
        return Err(io::Error::new(io::ErrorKind::InvalidInput, format!("bad snapshot id: {id}")));
    }
    fs::read_to_string(dir_for(root, path).join(id))
}

pub fn set_baseline(root: &Path, path: &str, text: &str) -> io::Result<()> {
    write_atomic(&own_dir(root, path)?.join("baseline.md"), text.as_bytes())
}

pub fn baseline(root: &Path, path: &str) -> Option<String> {
    fs::read_to_string(dir_for(root, path).join("baseline.md")).ok()
}

fn root(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app.path().app_data_dir().map_err(|e| e.to_string())?.join("history"))
}

#[tauri::command]
pub fn history_add(app: AppHandle, path: String, text: String, kind: String) -> Result<bool, String> {
    add(&root(&app)?, &path, &text, &kind).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn history_list(app: AppHandle, path: String) -> Result<Vec<Snapshot>, String> {
    Ok(list(&root(&app)?, &path))
}

#[tauri::command]
pub fn history_read(app: AppHandle, path: String, id: String) -> Result<String, String> {
    read(&root(&app)?, &path, &id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn history_set_baseline(app: AppHandle, path: String, text: String) -> Result<(), String> {
    set_baseline(&root(&app)?, &path, &text).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn history_baseline(app: AppHandle, path: String) -> Result<Option<String>, String> {
    Ok(baseline(&root(&app)?, &path))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_root(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("markmode-history-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        dir
    }

    #[test]
    fn keeps_changed_text_newest_first() {
        let root = temp_root("order");
        assert!(add(&root, "/a.md", "one", "opened").unwrap());
        assert!(!add(&root, "/a.md", "one", "saved").unwrap(), "same text is not kept twice");
        assert!(add(&root, "/a.md", "two", "outside").unwrap());
        let snaps = list(&root, "/a.md");
        assert_eq!(snaps.iter().map(|s| s.kind.as_str()).collect::<Vec<_>>(), ["outside", "opened"]);
        assert_eq!(read(&root, "/a.md", &snaps[0].id).unwrap(), "two");
        assert!(list(&root, "/b.md").is_empty());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn keeps_only_the_latest() {
        let root = temp_root("prune");
        for i in 0..KEEP + 5 {
            add(&root, "/a.md", &i.to_string(), "saved").unwrap();
        }
        let snaps = list(&root, "/a.md");
        assert_eq!(snaps.len(), KEEP);
        assert_eq!(read(&root, "/a.md", &snaps[0].id).unwrap(), (KEEP + 4).to_string());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn keeps_a_baseline_apart_from_the_versions() {
        let root = temp_root("baseline");
        assert_eq!(baseline(&root, "/a.md"), None);
        set_baseline(&root, "/a.md", "seen").unwrap();
        add(&root, "/a.md", "one", "saved").unwrap();
        assert_eq!(baseline(&root, "/a.md").as_deref(), Some("seen"));
        assert_eq!(list(&root, "/a.md").len(), 1);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn rejects_ids_and_kinds_outside_the_pattern() {
        let root = temp_root("ids");
        assert!(read(&root, "/a.md", "../../etc/passwd").is_err());
        assert!(read(&root, "/a.md", "1-x/../y.md").is_err());
        assert!(add(&root, "/a.md", "x", "../evil").is_err());
        let _ = fs::remove_dir_all(root);
    }
}
