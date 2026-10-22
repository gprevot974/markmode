//! Images `:images-clean!` moved to the Trash, kept aside so they come back on
//! their own when a link to them does: a version from the history, an undo,
//! an outside change. Each one is kept in `<app data>/cleaned/<key>/`, keyed
//! like the version history by a hash of its path, as `image` beside `path`,
//! which names it. They are kept `DAYS` days, as the Trash may be emptied.

use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

use tauri::{AppHandle, Manager};

use crate::files::write_atomic;
use crate::history::key;

const DAYS: u64 = 90;

/// Keeps a copy of each image, and lets go of the ones kept longer than `DAYS`.
pub fn set_aside(root: &Path, paths: &[String]) -> io::Result<()> {
    prune(root, SystemTime::now() - Duration::from_secs(DAYS * 24 * 3600));
    for path in paths {
        let dir = root.join(key(path));
        fs::create_dir_all(&dir)?;
        fs::write(dir.join("path"), path)?;
        fs::copy(path, dir.join("image"))?;
    }
    Ok(())
}

/// Puts back the image kept for `path`, when there is none there; false when none was kept.
pub fn bring_back(root: &Path, path: &str) -> io::Result<bool> {
    let dir = root.join(key(path));
    if fs::read_to_string(dir.join("path")).ok().as_deref() != Some(path) || Path::new(path).exists() {
        return Ok(false);
    }
    let bytes = fs::read(dir.join("image"))?;
    if let Some(parent) = Path::new(path).parent() {
        fs::create_dir_all(parent)?;
    }
    write_atomic(Path::new(path), &bytes)?;
    fs::remove_dir_all(dir)?;
    Ok(true)
}

fn prune(root: &Path, before: SystemTime) {
    for entry in fs::read_dir(root).into_iter().flatten().flatten() {
        // Dated by `path`, written when the image was set aside: the copy may keep the image's own date.
        let old = entry.path().join("path").metadata().and_then(|m| m.modified()).is_ok_and(|t| t < before);
        if old {
            let _ = fs::remove_dir_all(entry.path());
        }
    }
}

fn root(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app.path().app_data_dir().map_err(|e| e.to_string())?.join("cleaned"))
}

#[tauri::command]
pub fn images_set_aside(app: AppHandle, paths: Vec<String>) -> Result<(), String> {
    set_aside(&root(&app)?, &paths).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn image_bring_back(app: AppHandle, path: String) -> Result<bool, String> {
    bring_back(&root(&app)?, &path).map_err(|e| format!("{path}: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn brings_a_cleaned_image_back_once() {
        let base = std::env::temp_dir().join(format!("md-editor-cleaned-{}", std::process::id()));
        let _ = fs::remove_dir_all(&base);
        let root = base.join("cleaned");
        let image = base.join("doc/assets/a.png");
        fs::create_dir_all(image.parent().unwrap()).unwrap();
        fs::write(&image, b"png").unwrap();
        let path = image.to_string_lossy().into_owned();

        set_aside(&root, &[path.clone()]).unwrap();
        assert!(!bring_back(&root, &path).unwrap(), "not while the image is still there");
        fs::remove_dir_all(base.join("doc")).unwrap();
        assert!(bring_back(&root, &path).unwrap());
        assert_eq!(fs::read(&image).unwrap(), b"png", "with its folder");
        fs::remove_file(&image).unwrap();
        assert!(!bring_back(&root, &path).unwrap(), "the kept copy goes once it is back");
        assert!(!bring_back(&root, "/never/cleaned.png").unwrap());
        fs::remove_dir_all(base).unwrap();
    }

    #[test]
    fn lets_old_ones_go() {
        let base = std::env::temp_dir().join(format!("md-editor-cleaned-prune-{}", std::process::id()));
        let _ = fs::remove_dir_all(&base);
        let image = base.join("a.png");
        fs::create_dir_all(&base).unwrap();
        fs::write(&image, b"png").unwrap();
        let root = base.join("cleaned");
        set_aside(&root, &[image.to_string_lossy().into_owned()]).unwrap();
        prune(&root, SystemTime::now() + Duration::from_secs(1));
        assert_eq!(fs::read_dir(&root).unwrap().count(), 0);
        fs::remove_dir_all(base).unwrap();
    }
}
