//! The user's Helix setup: `config.toml` (key remaps, editor options, theme)
//! and the theme files, from their own config directory and from the Helix
//! installation's runtime. The TOML is handed to the front end as JSON; making
//! sense of it happens there.

use std::path::{Path, PathBuf};

fn home() -> PathBuf {
    PathBuf::from(std::env::var("HOME").unwrap_or_default())
}

/// `~/.config/helix`, as Helix itself uses on macOS and Linux.
fn config_dir() -> PathBuf {
    match std::env::var_os("XDG_CONFIG_HOME") {
        Some(dir) if !dir.is_empty() => PathBuf::from(dir).join("helix"),
        _ => home().join(".config/helix"),
    }
}

/// Where Helix keeps its runtime files, most specific first. Apps started
/// from Finder do not get the shell's PATH, so the usual install locations
/// are tried as well.
fn runtime_dirs() -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    if let Some(dir) = std::env::var_os("HELIX_RUNTIME") {
        dirs.push(PathBuf::from(dir));
    }
    dirs.push(config_dir().join("runtime"));
    let mut binaries: Vec<PathBuf> = std::env::var_os("PATH")
        .map(|p| std::env::split_paths(&p).map(|d| d.join("hx")).collect())
        .unwrap_or_default();
    binaries.extend(
        ["/opt/homebrew/bin/hx", "/usr/local/bin/hx", "/usr/bin/hx"].map(PathBuf::from),
    );
    binaries.push(home().join(".cargo/bin/hx"));
    for bin in binaries {
        let Ok(bin) = std::fs::canonicalize(&bin) else { continue };
        let Some(prefix) = bin.parent().and_then(Path::parent) else { continue };
        // Homebrew, Linux packages, and a build from a source checkout.
        for rel in ["libexec/runtime", "share/helix/runtime", "lib/helix/runtime", "../runtime"] {
            let dir = prefix.join(rel);
            if dir.is_dir() && !dirs.contains(&dir) {
                dirs.push(dir);
            }
        }
    }
    dirs.push(PathBuf::from("/usr/lib/helix/runtime"));
    dirs
}

/// Theme directories, the user's first so their themes win.
fn theme_dirs() -> Vec<PathBuf> {
    std::iter::once(config_dir().join("themes"))
        .chain(runtime_dirs().into_iter().map(|d| d.join("themes")))
        .filter(|d| d.is_dir())
        .collect()
}

fn read_toml(path: &Path) -> Result<serde_json::Value, String> {
    let text = std::fs::read_to_string(path).map_err(|e| format!("{}: {e}", path.display()))?;
    let value: toml::Table = toml::from_str(&text).map_err(|e| format!("{}: {e}", path.display()))?;
    serde_json::to_value(value).map_err(|e| e.to_string())
}

/// The parsed `config.toml`, or nothing when there is none.
#[tauri::command]
pub fn helix_config() -> Result<Option<serde_json::Value>, String> {
    let path = config_dir().join("config.toml");
    if !path.exists() {
        return Ok(None);
    }
    read_toml(&path).map(Some)
}

/// Where `config.toml` is, or would be.
#[tauri::command]
pub fn helix_config_path() -> String {
    config_dir().join("config.toml").to_string_lossy().into_owned()
}

/// A theme file by name, as Helix finds it (`inherits` is left to the caller).
#[tauri::command]
pub fn helix_theme(name: String) -> Result<serde_json::Value, String> {
    if name.contains('/') || name.contains("..") {
        return Err(format!("{name}: not a theme name"));
    }
    theme_dirs()
        .into_iter()
        .map(|d| d.join(format!("{name}.toml")))
        .find(|p| p.is_file())
        .ok_or_else(|| format!("no Helix theme named {name}"))
        .and_then(|p| read_toml(&p))
}

/// Every theme name found, sorted, for completion.
#[tauri::command]
pub fn helix_themes() -> Vec<String> {
    let mut names: Vec<String> = theme_dirs()
        .iter()
        .flat_map(|d| std::fs::read_dir(d).into_iter().flatten().flatten())
        .filter_map(|e| {
            let path = e.path();
            if path.extension()? != "toml" {
                return None;
            }
            Some(path.file_stem()?.to_string_lossy().into_owned())
        })
        .collect();
    names.sort();
    names.dedup();
    names
}


