//! The backend is deliberately thin: it hosts the window, reads and writes
//! files, and tells the front end when the open file changes on disk (an LLM
//! or another editor writing to it). All editing logic lives in the front end.

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use notify::{EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use tauri::{AppHandle, Emitter, Manager, State};

#[derive(Default)]
struct AppState {
    /// File passed on the command line or via Finder before the front end asked for it.
    pending_open: Mutex<Option<String>>,
    watcher: Mutex<Option<RecommendedWatcher>>,
}

#[tauri::command]
fn read_text(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path).map_err(|e| format!("{path}: {e}"))
}

#[tauri::command]
fn write_text(path: String, contents: String) -> Result<(), String> {
    std::fs::write(&path, contents).map_err(|e| format!("{path}: {e}"))
}

#[tauri::command]
fn write_bytes(path: String, bytes: Vec<u8>) -> Result<(), String> {
    std::fs::write(&path, bytes).map_err(|e| format!("{path}: {e}"))
}

#[tauri::command]
fn take_initial_file(state: State<AppState>) -> Option<String> {
    state.pending_open.lock().unwrap().take()
}

/// Watches the open file and emits `file-changed` when it is modified. The
/// parent directory is watched rather than the file itself, so tools that save
/// by writing a temp file and renaming it over the original are still seen.
#[tauri::command]
fn watch_file(app: AppHandle, state: State<AppState>, path: String) -> Result<(), String> {
    let target = PathBuf::from(&path);
    let dir = target
        .parent()
        .ok_or_else(|| format!("{path}: no parent directory"))?
        .to_path_buf();
    let name = target.file_name().map(|n| n.to_os_string());
    let emitted = path.clone();
    let mut watcher = notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
        let Ok(event) = res else { return };
        if !matches!(
            event.kind,
            EventKind::Modify(_) | EventKind::Create(_) | EventKind::Remove(_)
        ) {
            return;
        }
        if event.paths.iter().any(|p| p.file_name().map(|n| n.to_os_string()) == name) {
            let _ = app.emit("file-changed", &emitted);
        }
    })
    .map_err(|e| e.to_string())?;
    watcher
        .watch(&dir, RecursiveMode::NonRecursive)
        .map_err(|e| e.to_string())?;
    // Replacing the previous watcher drops it, which stops it.
    *state.watcher.lock().unwrap() = Some(watcher);
    Ok(())
}

fn absolute(arg: &str) -> String {
    std::path::absolute(Path::new(arg))
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or_else(|_| arg.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .manage(AppState::default())
        .setup(|app| {
            if let Some(arg) = std::env::args().skip(1).find(|a| !a.starts_with('-')) {
                *app.state::<AppState>().pending_open.lock().unwrap() = Some(absolute(&arg));
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            read_text,
            write_text,
            write_bytes,
            take_initial_file,
            watch_file
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|_app, _event| {
        // Files opened from Finder ("Open With", double-click, `open -a`).
        #[cfg(any(target_os = "macos", target_os = "ios"))]
        if let tauri::RunEvent::Opened { urls } = &_event {
            if let Some(path) = urls.iter().find_map(|u| u.to_file_path().ok()) {
                let path = path.to_string_lossy().into_owned();
                *_app.state::<AppState>().pending_open.lock().unwrap() = Some(path.clone());
                let _ = _app.emit("open-file", path);
            }
        }
    });
}
