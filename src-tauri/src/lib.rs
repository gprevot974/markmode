//! The backend is deliberately thin: it hosts the window, reads and writes
//! files, lists them for the file picker, and tells the front end when an open
//! file changes on disk (an LLM or another editor writing to it). All editing
//! logic lives in the front end.

mod cleaned;
mod clipboard;
mod files;
mod helix;
mod history;
mod recovery;
mod search;

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
    /// Files passed on the command line, by `mde` or via Finder before the
    /// front end asked for them; None once it has.
    pending_open: Mutex<Option<Vec<String>>>,
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

/// Moves (renames) a file; returns where it went (see files::move_file).
#[tauri::command]
fn move_file(from: String, to: String, overwrite: bool) -> Result<String, String> {
    let moved = files::move_file(Path::new(&from), Path::new(&to), overwrite).map_err(|e| format!("{from}: {e}"))?;
    Ok(moved.to_string_lossy().into_owned())
}

/// A file's bytes, as binary rather than JSON (images for the preview and the export).
#[tauri::command]
async fn read_bytes(path: String) -> Result<tauri::ipc::Response, String> {
    std::fs::read(&path).map(tauri::ipc::Response::new).map_err(|e| format!("{path}: {e}"))
}

/// Writes a file's bytes (an export, a pasted image), atomically. They come as
/// the request's raw body rather than a JSON array of numbers, which is several
/// times their size and slow to encode and parse; the path comes in the `path`
/// header, percent-encoded, as headers hold ASCII only.
#[tauri::command]
async fn write_bytes(request: tauri::ipc::Request<'_>) -> Result<(), String> {
    let path = request
        .headers()
        .get("path")
        .and_then(|v| v.to_str().ok())
        .map(|v| percent_encoding::percent_decode_str(v).decode_utf8_lossy().into_owned())
        .ok_or("write_bytes: no path header")?;
    let bytes = match request.body() {
        tauri::ipc::InvokeBody::Raw(bytes) => std::borrow::Cow::Borrowed(bytes.as_slice()),
        // Where Tauri falls back from its binary channel, they come as JSON.
        tauri::ipc::InvokeBody::Json(value) => std::borrow::Cow::Owned(
            serde_json::from_value::<Vec<u8>>(value.clone()).map_err(|e| format!("{path}: expected the file's bytes ({e})"))?,
        ),
    };
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

/// `~/.config/markmode`: config.toml and the export styles.
#[tauri::command]
fn config_dir() -> String {
    match std::env::var_os("XDG_CONFIG_HOME") {
        Some(dir) if !dir.is_empty() => PathBuf::from(dir).join("markmode"),
        _ => PathBuf::from(std::env::var("HOME").unwrap_or_default()).join(".config/markmode"),
    }
    .to_string_lossy()
    .into_owned()
}

/// Moves files to the Trash, where they can be put back from; stops at the
/// first that cannot be moved.
#[cfg(target_os = "macos")]
#[tauri::command]
fn trash_files(paths: Vec<String>) -> Result<(), String> {
    use objc2_foundation::{NSFileManager, NSString, NSURL};
    let manager = NSFileManager::defaultManager();
    for path in paths {
        let url = NSURL::fileURLWithPath(&NSString::from_str(&path));
        manager
            .trashItemAtURL_resultingItemURL_error(&url, None)
            .map_err(|e| format!("{path}: {}", e.localizedDescription()))?;
    }
    Ok(())
}

#[cfg(not(target_os = "macos"))]
#[tauri::command]
fn trash_files(_paths: Vec<String>) -> Result<(), String> {
    Err("moving files to the trash works on macOS only".into())
}

/// Makes a directory and the ones above it that are missing.
#[tauri::command]
fn create_dir(path: String) -> Result<(), String> {
    std::fs::create_dir_all(&path).map_err(|e| format!("{path}: {e}"))
}

#[tauri::command]
fn home_dir() -> String {
    std::env::var("HOME").unwrap_or_default()
}

#[tauri::command]
fn take_initial_files(state: State<AppState>) -> Vec<String> {
    state.pending_open.lock().unwrap().take().unwrap_or_default()
}

/// The file an opened URL names: a file URL from Finder or `open`, or
/// `markmode://open?path=...` from `mde`, which also names files that don't
/// exist yet (`open` refuses those).
fn opened_path(url: &tauri::Url) -> Option<String> {
    match url.scheme() {
        "file" => url.to_file_path().ok().map(|p| p.to_string_lossy().into_owned()),
        "markmode" => url.query_pairs().find(|(k, _)| k == "path").map(|(_, v)| v.into_owned()),
        _ => None,
    }
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

/// Opens a web or mail address, or a file this editor does not edit (an image,
/// a PDF), with the system's default app.
#[tauri::command]
fn open_external(target: String) -> Result<(), String> {
    let lower = target.to_ascii_lowercase();
    let url = ["http://", "https://", "mailto:"].iter().any(|s| lower.starts_with(s));
    if !url && !Path::new(&target).is_absolute() {
        return Err(format!("{target}: not an address or an absolute path"));
    }
    #[cfg(target_os = "macos")]
    let mut command = std::process::Command::new("open");
    #[cfg(target_os = "windows")]
    let mut command = std::process::Command::new("explorer");
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    let mut command = std::process::Command::new("xdg-open");
    command.arg(&target).spawn().map(|_| ()).map_err(|e| format!("{target}: {e}"))
}

#[tauri::command]
async fn search_files(root: String, pattern: String) -> Result<Vec<search::Match>, String> {
    search::search(Path::new(&root), &pattern)
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
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(AppState { pending_open: Mutex::new(Some(Vec::new())), ..Default::default() })
        .manage(recovery::Recovery::default())
        .setup(|app| {
            let args = std::env::args().skip(1).filter(|a| !a.starts_with('-'));
            if let Some(paths) = app.state::<AppState>().pending_open.lock().unwrap().as_mut() {
                paths.extend(args.map(|a| absolute(&a)));
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
                let quit = MenuItem::with_id(app, "quit", "Quit Markmode", true, Some("CmdOrCtrl+Q"))?;
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
            move_file,
            write_bytes,
            read_bytes,
            take_initial_files,
            watch_file,
            unwatch_file,
            list_dir,
            list_files,
            search_files,
            open_external,
            workspace_root,
            current_dir,
            home_dir,
            config_dir,
            create_dir,
            trash_files,
            cleaned::images_set_aside,
            cleaned::image_bring_back,
            exit_app,
            clipboard::clipboard_files,
            clipboard::clipboard_image,
            spell::check_spelling,
            spell::spelling_suggestions,
            spell::learn_word,
            recovery::recovery_write,
            recovery::recovery_remove,
            recovery::recovery_take,
            helix::helix_config,
            helix::helix_config_path,
            helix::helix_theme,
            helix::helix_themes,
            history::history_add,
            history::history_list,
            history::history_read,
            history::history_set_baseline,
            history::history_rename,
            history::history_baseline
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|_app, _event| {
        // Files opened from Finder ("Open With", double-click, `open -a`) or
        // by `mde`. At launch they come before the front end listens, so they
        // are kept for it to take; once it has, it opens them as they come.
        #[cfg(any(target_os = "macos", target_os = "ios"))]
        if let tauri::RunEvent::Opened { urls } = &_event {
            let state = _app.state::<AppState>();
            let mut pending = state.pending_open.lock().unwrap();
            for path in urls.iter().filter_map(opened_path) {
                match pending.as_mut() {
                    Some(paths) => paths.push(path),
                    None => drop(_app.emit("open-file", path)),
                }
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    fn path_of(url: &str) -> Option<String> {
        opened_path(&tauri::Url::parse(url).unwrap())
    }

    #[test]
    fn opened_urls_name_files() {
        assert_eq!(path_of("file:///notes/a%20b.md").as_deref(), Some("/notes/a b.md"));
        // As `mde` writes them: every byte percent-encoded.
        assert_eq!(path_of("markmode://open?path=%2f%61%20%23%3f%26.md").as_deref(), Some("/a #?&.md"));
        assert_eq!(path_of("markmode://open?path=/caf%C3%A9.md").as_deref(), Some("/café.md"));
        assert_eq!(path_of("markmode://open"), None);
        assert_eq!(path_of("https://example.com/a.md"), None);
    }
}
