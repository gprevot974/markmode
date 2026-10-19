//! Crash recovery. While a buffer has unsaved changes, the front end keeps a
//! copy of it in `<app data>/recovery/<pid>/<buffer id>.json`. A clean exit
//! deletes the directory. After a crash it is still there, and the next start
//! hands its files back to the front end.
//!
//! Each running instance holds a lock on `<pid>/lock` for as long as it lives,
//! which the system drops when the process dies, however it dies. A directory
//! whose lock can be taken therefore belongs to an instance that is gone, even
//! if its pid has been reused since.

use std::fs::{self, File};
use std::path::PathBuf;
use std::sync::Mutex;

use tauri::{AppHandle, Manager, State};

use crate::files::write_atomic;

#[derive(Default)]
pub struct Recovery {
    /// Our directory and its lock file, held open (and locked) until exit.
    own: Mutex<Option<(PathBuf, File)>>,
}

fn root(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app.path().app_data_dir().map_err(|e| e.to_string())?.join("recovery"))
}

fn own_dir(app: &AppHandle, state: &Recovery) -> Result<PathBuf, String> {
    let mut own = state.own.lock().unwrap();
    if let Some((dir, _)) = own.as_ref() {
        return Ok(dir.clone());
    }
    let dir = root(app)?.join(std::process::id().to_string());
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let lock = File::create(dir.join("lock")).map_err(|e| e.to_string())?;
    lock.try_lock().map_err(|e| e.to_string())?;
    *own = Some((dir.clone(), lock));
    Ok(dir)
}

fn file_name(id: u32) -> String {
    format!("{id}.json")
}

#[tauri::command]
pub fn recovery_write(app: AppHandle, state: State<Recovery>, id: u32, contents: String) -> Result<(), String> {
    let dir = own_dir(&app, &state)?;
    write_atomic(&dir.join(file_name(id)), contents.as_bytes()).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn recovery_remove(state: State<Recovery>, id: u32) {
    if let Some((dir, _)) = state.own.lock().unwrap().as_ref() {
        let _ = fs::remove_file(dir.join(file_name(id)));
    }
}

/// The copies left behind by instances that are no longer running, removed
/// from disk as they are handed over: the front end saves its own copies of
/// whatever it restores.
#[tauri::command]
pub fn recovery_take(app: AppHandle) -> Result<Vec<String>, String> {
    let root = root(&app)?;
    let own = std::process::id().to_string();
    let mut found = Vec::new();
    let Ok(entries) = fs::read_dir(&root) else {
        return Ok(found);
    };
    for entry in entries.flatten() {
        let dir = entry.path();
        if !dir.is_dir() || entry.file_name() == own.as_str() {
            continue;
        }
        // Still locked: another instance is running and owns these.
        if let Ok(lock) = File::open(dir.join("lock")) {
            if lock.try_lock().is_err() {
                continue;
            }
        }
        for file in fs::read_dir(&dir).into_iter().flatten().flatten() {
            if file.path().extension().is_some_and(|e| e == "json") {
                if let Ok(contents) = fs::read_to_string(file.path()) {
                    found.push(contents);
                }
            }
        }
        let _ = fs::remove_dir_all(&dir);
    }
    Ok(found)
}

/// On a clean exit: nothing to recover.
pub fn clear(state: &Recovery) {
    if let Some((dir, _)) = state.own.lock().unwrap().take() {
        let _ = fs::remove_dir_all(dir);
    }
}
