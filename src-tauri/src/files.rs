//! Reading and writing text files without losing anything: the encoding and
//! byte order mark found on reading are used again on writing, and writes go
//! to a temporary file that is renamed over the original, so a crash or a full
//! disk midway never leaves a half-written file behind.

use std::fs::{self, File};
use std::io::{self, ErrorKind, Write};
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum Encoding {
    #[serde(rename = "utf-8")]
    Utf8,
    #[serde(rename = "utf-16le")]
    Utf16le,
    #[serde(rename = "utf-16be")]
    Utf16be,
    /// Anything that is not valid UTF-8 and has no BOM. Every byte means
    /// something in it, so reading never fails.
    #[serde(rename = "windows-1252")]
    Windows1252,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct Format {
    pub encoding: Encoding,
    pub bom: bool,
}

pub const UTF8: Format = Format { encoding: Encoding::Utf8, bom: false };

pub fn decode(bytes: &[u8]) -> Result<(String, Format), String> {
    if let Some(rest) = bytes.strip_prefix(b"\xEF\xBB\xBF") {
        let text = String::from_utf8(rest.to_vec()).map_err(|_| "invalid UTF-8 after a UTF-8 BOM")?;
        return Ok((text, Format { encoding: Encoding::Utf8, bom: true }));
    }
    if let Some(rest) = bytes.strip_prefix(b"\xFF\xFE") {
        return Ok((utf16(rest, u16::from_le_bytes)?, Format { encoding: Encoding::Utf16le, bom: true }));
    }
    if let Some(rest) = bytes.strip_prefix(b"\xFE\xFF") {
        return Ok((utf16(rest, u16::from_be_bytes)?, Format { encoding: Encoding::Utf16be, bom: true }));
    }
    // A NUL byte outside UTF-16 means an image, a PDF or the like.
    if bytes.contains(&0) {
        return Err("binary file".into());
    }
    match String::from_utf8(bytes.to_vec()) {
        Ok(text) => Ok((text, UTF8)),
        Err(_) => {
            let (text, _, _) = encoding_rs::WINDOWS_1252.decode(bytes);
            Ok((text.into_owned(), Format { encoding: Encoding::Windows1252, bom: false }))
        }
    }
}

fn utf16(bytes: &[u8], word: fn([u8; 2]) -> u16) -> Result<String, String> {
    if bytes.len() % 2 != 0 {
        return Err("invalid UTF-16: odd number of bytes".into());
    }
    let words: Vec<u16> = bytes.chunks_exact(2).map(|c| word([c[0], c[1]])).collect();
    String::from_utf16(&words).map_err(|_| "invalid UTF-16".into())
}

pub fn encode(text: &str, format: Format) -> Result<Vec<u8>, String> {
    let mut out = Vec::with_capacity(text.len() + 3);
    match format.encoding {
        Encoding::Utf8 => {
            if format.bom {
                out.extend_from_slice(b"\xEF\xBB\xBF");
            }
            out.extend_from_slice(text.as_bytes());
        }
        Encoding::Utf16le | Encoding::Utf16be => {
            let le = format.encoding == Encoding::Utf16le;
            if format.bom {
                out.extend_from_slice(if le { b"\xFF\xFE" } else { b"\xFE\xFF" });
            }
            for w in text.encode_utf16() {
                out.extend_from_slice(&if le { w.to_le_bytes() } else { w.to_be_bytes() });
            }
        }
        Encoding::Windows1252 => {
            let (bytes, _, unmappable) = encoding_rs::WINDOWS_1252.encode(text);
            if unmappable {
                let c = text
                    .chars()
                    .find(|c| encoding_rs::WINDOWS_1252.encode(&c.to_string()).2)
                    .unwrap_or('?');
                return Err(format!(
                    "\"{c}\" does not exist in the file's encoding (Windows-1252); \
                     use :encoding utf-8 to save it as UTF-8"
                ));
            }
            out.extend_from_slice(&bytes);
        }
    }
    Ok(out)
}

/// Writes `bytes` to `path` all at once: a reader sees the old file or the
/// new one, never a mix. Symbolic links are followed, so the link stays a
/// link, and the file keeps its permissions.
pub fn write_atomic(path: &Path, bytes: &[u8]) -> io::Result<()> {
    let target = match fs::canonicalize(path) {
        Ok(p) => p,
        Err(e) if e.kind() == ErrorKind::NotFound => path.to_path_buf(),
        Err(e) => return Err(e),
    };
    let dir = target.parent().ok_or_else(|| io::Error::other("no parent directory"))?;
    let name = target.file_name().ok_or_else(|| io::Error::other("no file name"))?;
    let tmp: PathBuf = dir.join(format!(".{}.md-editor-{}.tmp", name.to_string_lossy(), std::process::id()));
    let existing = fs::metadata(&target).ok();

    let mut file = match File::create(&tmp) {
        Ok(f) => f,
        // A file we may write in a directory we may not: write it in place.
        Err(e) if e.kind() == ErrorKind::PermissionDenied && existing.is_some() => {
            return fs::write(&target, bytes);
        }
        Err(e) => return Err(e),
    };
    let result = (|| {
        file.write_all(bytes)?;
        if let Some(meta) = &existing {
            file.set_permissions(meta.permissions())?;
        }
        file.sync_all()?;
        fs::rename(&tmp, &target)?;
        // Makes the rename itself survive a power loss.
        if let Ok(d) = File::open(dir) {
            let _ = d.sync_all();
        }
        Ok(())
    })();
    if result.is_err() {
        let _ = fs::remove_file(&tmp);
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    fn round_trip(bytes: &[u8]) {
        let (text, format) = decode(bytes).unwrap();
        assert_eq!(encode(&text, format).unwrap(), bytes, "{format:?}");
    }

    #[test]
    fn encodings_survive_a_round_trip() {
        round_trip(b"plain\nascii\n");
        round_trip("caf\u{e9} \u{1F600}\r\n".as_bytes());
        round_trip(b"\xEF\xBB\xBFwith bom\n");
        round_trip(b"\xFF\xFEh\0i\0\n\0");
        round_trip(b"\xFE\xFF\0h\0i\0\n");
        round_trip(b"caf\xE9 \x93quoted\x94\n");
    }

    #[test]
    fn detects_formats() {
        assert_eq!(decode(b"x").unwrap().1, UTF8);
        assert_eq!(decode(b"\xEF\xBB\xBFx").unwrap().1, Format { encoding: Encoding::Utf8, bom: true });
        assert_eq!(decode(b"caf\xE9").unwrap(), ("caf\u{e9}".into(), Format { encoding: Encoding::Windows1252, bom: false }));
        assert!(decode(b"\x89PNG\r\n\x1a\n\0\0").is_err());
    }

    #[test]
    fn refuses_characters_the_encoding_lacks() {
        let format = Format { encoding: Encoding::Windows1252, bom: false };
        assert!(encode("caf\u{e9}", format).is_ok());
        assert!(encode("\u{1F600}", format).unwrap_err().contains('\u{1F600}'));
    }

    #[cfg(unix)]
    #[test]
    fn atomic_write_keeps_links_and_permissions() {
        use std::os::unix::fs::{symlink, PermissionsExt};
        let dir = std::env::temp_dir().join(format!("md-editor-test-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let real = dir.join("real.md");
        let link = dir.join("link.md");
        fs::write(&real, "old").unwrap();
        fs::set_permissions(&real, fs::Permissions::from_mode(0o640)).unwrap();
        symlink(&real, &link).unwrap();

        write_atomic(&link, b"new").unwrap();
        assert!(fs::symlink_metadata(&link).unwrap().file_type().is_symlink());
        assert_eq!(fs::read_to_string(&real).unwrap(), "new");
        assert_eq!(fs::metadata(&real).unwrap().permissions().mode() & 0o777, 0o640);

        write_atomic(&dir.join("fresh.md"), b"x").unwrap();
        assert_eq!(fs::read_dir(&dir).unwrap().count(), 3, "no temporary file left behind");
        fs::remove_dir_all(&dir).unwrap();
    }
}
