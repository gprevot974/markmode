//! The backend is deliberately thin: it hosts the window, reads and writes
//! files, lists them for the file picker, and tells the front end when an open
//! file changes on disk (an LLM or another editor writing to it). All editing
//! logic lives in the front end.

mod files;
mod helix;
mod recovery;

use std::collections::HashSet;
use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use notify::{EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use tauri::menu::{Menu, MenuItem, MenuItemKind};
use tauri::{AppHandle, Emitter, Manager, State};

/// An open file being watched, by its directory (canonical) and name.
struct Watched {
    dir: PathBuf,
    name: OsString,
    path: String,
}

#[derive(Default)]
struct AppState {
    /// File passed on the command line or via Finder before the front end asked for it.
    pending_open: Mutex<Option<String>>,
    watcher: Mutex<Option<RecommendedWatcher>>,
    watched: Arc<Mutex<Vec<Watched>>>,
    watched_dirs: Mutex<HashSet<PathBuf>>,
}

#[derive(serde::Serialize)]
struct FileText {
    text: String,
    format: files::Format,
}

/// A text file and the encoding it was found in.
#[tauri::command]
fn read_text(path: String) -> Result<FileText, String> {
    let bytes = std::fs::read(&path).map_err(|e| format!("{path}: {e}"))?;
    let (text, format) = files::decode(&bytes).map_err(|e| format!("{path}: {e}"))?;
    Ok(FileText { text, format })
}

/// Writes text in the given encoding (UTF-8 when none is given), atomically.
#[tauri::command]
fn write_text(path: String, contents: String, format: Option<files::Format>) -> Result<(), String> {
    let bytes = files::encode(&contents, format.unwrap_or(files::UTF8)).map_err(|e| format!("{path}: {e}"))?;
    files::write_atomic(Path::new(&path), &bytes).map_err(|e| format!("{path}: {e}"))
}

#[tauri::command]
fn write_bytes(path: String, bytes: Vec<u8>) -> Result<(), String> {
    files::write_atomic(Path::new(&path), &bytes).map_err(|e| format!("{path}: {e}"))
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct DirEntry {
    name: String,
    is_dir: bool,
}

/// Directory listing for path completion in the command line, sorted by name.
#[tauri::command]
fn list_dir(path: String) -> Result<Vec<DirEntry>, String> {
    let mut entries: Vec<DirEntry> = std::fs::read_dir(&path)
        .map_err(|e| format!("{path}: {e}"))?
        .filter_map(|entry| {
            let entry = entry.ok()?;
            Some(DirEntry {
                name: entry.file_name().to_string_lossy().into_owned(),
                is_dir: entry.path().is_dir(),
            })
        })
        .collect();
    entries.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    Ok(entries)
}

#[tauri::command]
fn home_dir() -> String {
    std::env::var("HOME").unwrap_or_default()
}

#[tauri::command]
fn take_initial_file(state: State<AppState>) -> Option<String> {
    state.pending_open.lock().unwrap().take()
}

/// Files under `root` for the file picker, relative to it. Like Helix, hidden
/// files and whatever `.gitignore` excludes are left out.
#[tauri::command]
async fn list_files(root: String) -> Result<Vec<String>, String> {
    const LIMIT: usize = 50_000;
    let base = PathBuf::from(&root);
    if !base.is_dir() {
        return Err(format!("{root}: not a directory"));
    }
    let mut files = Vec::new();
    for entry in ignore::WalkBuilder::new(&base).build().flatten() {
        if !entry.file_type().is_some_and(|t| t.is_file()) {
            continue;
        }
        if let Ok(rel) = entry.path().strip_prefix(&base) {
            files.push(rel.to_string_lossy().into_owned());
        }
        if files.len() >= LIMIT {
            break;
        }
    }
    files.sort();
    Ok(files)
}

/// The nearest directory at or above `dir` holding `.git` or `.helix`, else `dir`.
#[tauri::command]
fn workspace_root(dir: String) -> String {
    Path::new(&dir)
        .ancestors()
        .find(|d| d.join(".git").exists() || d.join(".helix").exists())
        .map(|d| d.to_string_lossy().into_owned())
        .unwrap_or(dir)
}

#[tauri::command]
fn current_dir() -> String {
    std::env::current_dir()
        .map(|d| d.to_string_lossy().into_owned())
        .unwrap_or_default()
}

/// Watches an open file and emits `file-changed` with its path when it is
/// modified. Parent directories are watched rather than files, so tools that
/// save by writing a temp file and renaming it over the original are still seen.
#[tauri::command]
fn watch_file(app: AppHandle, state: State<AppState>, path: String) -> Result<(), String> {
    let target = PathBuf::from(&path);
    let parent = target
        .parent()
        .ok_or_else(|| format!("{path}: no parent directory"))?;
    let dir = std::fs::canonicalize(parent).map_err(|e| format!("{path}: {e}"))?;
    let name = target
        .file_name()
        .ok_or_else(|| format!("{path}: no file name"))?
        .to_os_string();
    {
        let mut watched = state.watched.lock().unwrap();
        if watched.iter().any(|w| w.path == path) {
            return Ok(());
        }
        watched.push(Watched { dir: dir.clone(), name, path });
    }

    let mut watcher = state.watcher.lock().unwrap();
    if watcher.is_none() {
        let watched = state.watched.clone();
        *watcher = Some(
            notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
                let Ok(event) = res else { return };
                if !matches!(
                    event.kind,
                    EventKind::Modify(_) | EventKind::Create(_) | EventKind::Remove(_)
                ) {
                    return;
                }
                let watched = watched.lock().unwrap();
                for p in &event.paths {
                    let (Some(parent), Some(name)) = (p.parent(), p.file_name()) else {
                        continue;
                    };
                    let parent = std::fs::canonicalize(parent).unwrap_or_else(|_| parent.into());
                    for w in watched.iter().filter(|w| w.name == name && w.dir == parent) {
                        let _ = app.emit("file-changed", &w.path);
                    }
                }
            })
            .map_err(|e| e.to_string())?,
        );
    }
    if state.watched_dirs.lock().unwrap().insert(dir.clone()) {
        watcher
            .as_mut()
            .unwrap()
            .watch(&dir, RecursiveMode::NonRecursive)
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Stops reporting changes to a file (its directory stays watched; that is cheap).
#[tauri::command]
fn unwatch_file(state: State<AppState>, path: String) {
    state.watched.lock().unwrap().retain(|w| w.path != path);
}

/// Spelling, through the macOS spell checker: the languages, learned words
/// and automatic language detection set up in System Settings. Sync commands
/// run on the main thread, which AppKit wants.
#[cfg(target_os = "macos")]
mod spell {
    use objc2_app_kit::NSSpellChecker;
    use objc2_foundation::{NSNotFound, NSRange, NSString};

    fn checker() -> objc2::rc::Retained<NSSpellChecker> {
        let checker = NSSpellChecker::sharedSpellChecker();
        checker.setAutomaticallyIdentifiesLanguages(true);
        checker
    }

    /// Misspelled words as (start, length) in UTF-16 code units, like JS string offsets.
    #[tauri::command]
    pub fn check_spelling(text: String) -> Vec<(usize, usize)> {
        let checker = checker();
        let string = NSString::from_str(&text);
        let mut found = Vec::new();
        let mut offset = 0;
        loop {
            let r = checker.checkSpellingOfString_startingAt(&string, offset as isize);
            // It wraps around to the start once it runs out of text.
            if r.location == NSNotFound as usize || r.length == 0 || r.location < offset {
                break;
            }
            found.push((r.location, r.length));
            offset = r.location + r.length;
        }
        found
    }

    #[tauri::command]
    pub fn spelling_suggestions(word: String) -> Vec<String> {
        let string = NSString::from_str(&word);
        let range = NSRange::new(0, string.length());
        checker()
            .guessesForWordRange_inString_language_inSpellDocumentWithTag(range, &string, None, 0)
            .map(|guesses| guesses.iter().map(|g| g.to_string()).collect())
            .unwrap_or_default()
    }

    /// Adds a word to the user's dictionary, shared with every macOS app.
    #[tauri::command]
    pub fn learn_word(word: String) {
        checker().learnWord(&NSString::from_str(&word));
    }
}

#[cfg(not(target_os = "macos"))]
mod spell {
    #[tauri::command]
    pub fn check_spelling(_text: String) -> Vec<(usize, usize)> {
        Vec::new()
    }
    #[tauri::command]
    pub fn spelling_suggestions(_word: String) -> Vec<String> {
        Vec::new()
    }
    #[tauri::command]
    pub fn learn_word(_word: String) {}
}

/// Quits without asking: the front end has already dealt with unsaved buffers.
#[tauri::command]
fn exit_app(app: AppHandle, recovery: State<recovery::Recovery>) {
    recovery::clear(&recovery);
    app.exit(0);
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
        .manage(recovery::Recovery::default())
        .setup(|app| {
            if let Some(arg) = std::env::args().skip(1).find(|a| !a.starts_with('-')) {
                *app.state::<AppState>().pending_open.lock().unwrap() = Some(absolute(&arg));
            }
            // The stock Quit item terminates the app on the spot. This one asks
            // the front end, which checks for unsaved buffers first.
            let menu = Menu::default(app.handle())?;
            if let Some(MenuItemKind::Submenu(app_menu)) = menu.items()?.into_iter().next() {
                for item in app_menu.items()? {
                    if let MenuItemKind::Predefined(p) = &item {
                        if p.text()?.starts_with("Quit") {
                            app_menu.remove(&item)?;
                        }
                    }
                }
                let quit = MenuItem::with_id(app, "quit", "Quit md-editor", true, Some("CmdOrCtrl+Q"))?;
                app_menu.append(&quit)?;
            }
            app.set_menu(menu)?;
            Ok(())
        })
        .on_menu_event(|app, event| {
            if event.id() == "quit" {
                let _ = app.emit("quit-requested", ());
            }
        })
        .invoke_handler(tauri::generate_handler![
            read_text,
            write_text,
            write_bytes,
            take_initial_file,
            watch_file,
            unwatch_file,
            list_dir,
            list_files,
            workspace_root,
            current_dir,
            home_dir,
            exit_app,
            spell::check_spelling,
            spell::spelling_suggestions,
            spell::learn_word,
            recovery::recovery_write,
            recovery::recovery_remove,
            recovery::recovery_take,
            helix::helix_config,
            helix::helix_theme,
            helix::helix_themes
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
