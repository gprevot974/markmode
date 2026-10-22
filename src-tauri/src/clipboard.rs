//! Images on the clipboard, for pasting into a document. The webview hands a
//! paste event only some of what the pasteboard holds (a screenshot is not
//! always among its files, and a file copied in Finder comes as its name), so
//! the front end asks here when the event has no image. Sync commands run on
//! the main thread, which AppKit wants.

/// The image files copied in Finder, as paths; empty when there are none.
#[cfg(target_os = "macos")]
#[tauri::command]
pub fn clipboard_files() -> Vec<String> {
    use objc2_app_kit::{NSPasteboard, NSPasteboardTypeFileURL};
    use objc2_foundation::NSURL;

    let board = NSPasteboard::generalPasteboard();
    let Some(items) = board.pasteboardItems() else { return Vec::new() };
    items
        .iter()
        .filter_map(|item| item.stringForType(unsafe { NSPasteboardTypeFileURL }))
        .filter_map(|url| NSURL::URLWithString(&url))
        .filter_map(|url| url.path())
        .map(|path| path.to_string())
        .collect()
}

/// The image on the clipboard, as PNG; empty when there is none. A TIFF (what
/// some apps copy) is converted.
#[cfg(target_os = "macos")]
#[tauri::command]
pub fn clipboard_image() -> tauri::ipc::Response {
    use objc2_app_kit::{NSBitmapImageFileType, NSBitmapImageRep, NSPasteboard, NSPasteboardTypePNG, NSPasteboardTypeTIFF};
    use objc2_foundation::NSDictionary;

    let board = NSPasteboard::generalPasteboard();
    if let Some(png) = board.dataForType(unsafe { NSPasteboardTypePNG }) {
        return tauri::ipc::Response::new(png.to_vec());
    }
    let png = board
        .dataForType(unsafe { NSPasteboardTypeTIFF })
        .and_then(|tiff| NSBitmapImageRep::imageRepWithData(&tiff))
        .and_then(|rep| unsafe { rep.representationUsingType_properties(NSBitmapImageFileType::PNG, &NSDictionary::new()) });
    tauri::ipc::Response::new(png.map(|data| data.to_vec()).unwrap_or_default())
}

#[cfg(not(target_os = "macos"))]
#[tauri::command]
pub fn clipboard_files() -> Vec<String> {
    Vec::new()
}

#[cfg(not(target_os = "macos"))]
#[tauri::command]
pub fn clipboard_image() -> tauri::ipc::Response {
    tauri::ipc::Response::new(Vec::new())
}
