// Everything that touches the system: files, dialogs, clipboard, window. In
// Tauri it goes through the Rust backend; in a plain browser (`npm run dev`)
// it falls back to an in-memory stand-in, which is handy for working on the
// editor itself.

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { message as messageDialog, open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { readText, writeText } from "@tauri-apps/plugin-clipboard-manager";
import { check, type Update } from "@tauri-apps/plugin-updater";
import sample from "../examples/sample.md?raw";
import chart from "../examples/chart.svg?raw";
import type { DiskFormat } from "./fileformat.ts";
import { MAX_MATCHES, searchRegex, searchText, type SearchMatch } from "./search.ts";

export interface Backend {
  /** A text file and the encoding it was found in. */
  readText(path: string): Promise<FileText>;
  /** Writes atomically: a crash midway leaves the old file, never half of the new one. */
  writeText(path: string, contents: string, format?: DiskFormat): Promise<void>;
  /**
   * Moves a file and returns where it went: into `to` when that is a folder,
   * with the file's extension when `to` has none. A file already at `to` is
   * replaced only with `overwrite`.
   */
  moveFile(from: string, to: string, overwrite: boolean): Promise<string>;
  writeBytes(path: string, bytes: Uint8Array): Promise<void>;
  /** A file's bytes: images, for the preview and the export. */
  readBytes(path: string): Promise<Uint8Array>;
  pickOpen(): Promise<string | null>;
  pickSave(defaultPath: string, ext: "md" | "docx" | "html"): Promise<string | null>;
  /** The files passed on the command line, by `mde` or from Finder before the front end asked for them. */
  initialFiles(): Promise<string[]>;
  watch(path: string): Promise<void>;
  unwatch(path: string): Promise<void>;
  onFileChanged(cb: (path: string) => void): void;
  onOpenFile(cb: (path: string) => void): void;
  /** Files dragged over the window from Finder, and dropped on it. */
  onDragDrop(cb: (e: DragDrop) => void): void;
  onFocusLost(cb: () => void): void;
  setTitle(title: string): Promise<void>;
  /**
   * The title bar: its background (the window's, which shows through it) and
   * its light or dark text; a null theme follows the system.
   */
  setAppearance(theme: "light" | "dark" | null, background: string): Promise<void>;
  /** Quits the app, without asking. */
  exit(): Promise<void>;
  /** The window's close button, Cmd-W and Cmd-Q. */
  onQuitRequested(cb: () => void): void;
  /** Asks what to do with unsaved buffers before quitting. */
  askUnsaved(names: string[]): Promise<"save" | "discard" | "cancel">;
  /** Misspelled words in `text`, as [start, length] in string offsets. */
  checkSpelling(text: string): Promise<[number, number][]>;
  spellingSuggestions(word: string): Promise<string[]>;
  learnWord(word: string): Promise<void>;
  clipboardRead(): Promise<string>;
  /** The image files copied in Finder, as paths. */
  clipboardFiles(): Promise<string[]>;
  /** The image on the clipboard, as PNG; empty when there is none. */
  clipboardImage(): Promise<Uint8Array>;
  clipboardWrite(text: string): Promise<void>;
  listDir(path: string): Promise<DirEntry[]>;
  /** Every file under `root` (relative paths), minus hidden and git-ignored ones. */
  listFiles(root: string): Promise<string[]>;
  /** The lines matching a regex in the files `listFiles` lists, at most 2000 (smart case). */
  searchFiles(root: string, pattern: string): Promise<SearchMatch[]>;
  /** Opens a web or mail address, or a file this editor does not edit, with the system's default app. */
  openExternal(target: string): Promise<void>;
  /** The nearest directory at or above `dir` holding `.git` or `.helix`, else `dir`. */
  workspaceRoot(dir: string): Promise<string>;
  homeDir(): Promise<string>;
  /** ~/.config/markmode: config.toml and the export styles. */
  configDir(): Promise<string>;
  /** Moves files to the Trash. */
  trashFiles(paths: string[]): Promise<void>;
  /** Keeps a copy of images about to be cleaned up, for imageBringBack. */
  imagesSetAside(paths: string[]): Promise<void>;
  /** Puts back an image cleaned up earlier, when it is missing; false when none was kept. */
  imageBringBack(path: string): Promise<boolean>;
  /** Makes a directory, with the ones above it. */
  createDir(path: string): Promise<void>;
  currentDir(): Promise<string>;
  /** Keeps a copy of a buffer with unsaved changes, for after a crash. */
  recoveryWrite(id: number, contents: string): Promise<void>;
  recoveryRemove(id: number): Promise<void>;
  /** Copies left by an earlier run that did not exit cleanly. */
  recoveryTake(): Promise<string[]>;
  /** ~/.config/helix/config.toml, parsed; null when there is none. */
  helixConfig(): Promise<Record<string, unknown> | null>;
  /** Where config.toml is or would be; null without a Helix setup (the browser). */
  helixConfigPath(): Promise<string | null>;
  /** A Helix theme file, parsed (its `inherits` not yet applied). */
  helixTheme(name: string): Promise<Record<string, unknown>>;
  helixThemes(): Promise<string[]>;
  /** Keeps a version of a file's text; false when it equals the latest one kept. */
  historyAdd(path: string, text: string, kind: SnapshotKind): Promise<boolean>;
  /** The versions kept of a file, newest first. */
  historyList(path: string): Promise<Snapshot[]>;
  historyRead(path: string, id: string): Promise<string>;
  /** The text the file's changes are reviewed against (see history.rs); null when there is none yet. */
  historyBaseline(path: string): Promise<string | null>;
  historySetBaseline(path: string, text: string): Promise<void>;
  /** Hands the versions kept of a file that moved over to its new path. */
  historyRename(from: string, to: string): Promise<void>;
  /** The version of a newer release, from GitHub; null when this one is the latest. */
  checkUpdate(): Promise<string | null>;
  /** Downloads and installs the newer release, which starts on the next launch; its version, or null when there is none. */
  installUpdate(): Promise<string | null>;
}

/** A drag from Finder: the files (on enter and drop) and where the pointer is, in CSS pixels. */
export interface DragDrop {
  type: "enter" | "over" | "drop" | "leave";
  paths: string[];
  x: number;
  y: number;
}

export type SnapshotKind = "opened" | "saved" | "outside";

export interface Snapshot {
  id: string;
  /** Milliseconds since the epoch. */
  time: number;
  kind: SnapshotKind;
}

export interface FileText {
  text: string;
  format: DiskFormat;
}

export interface DirEntry {
  name: string;
  isDir: boolean;
}

const FILTERS = {
  md: [{ name: "Markdown", extensions: ["md", "markdown"] }],
  docx: [{ name: "Word document", extensions: ["docx"] }],
  html: [{ name: "Web page", extensions: ["html"] }],
};

/** The newer release the last check found, for installUpdate. */
let update: Update | null = null;

const tauriBackend: Backend = {
  readText: (path) => invoke("read_text", { path }),
  writeText: (path, contents, format) => invoke("write_text", { path, contents, format }),
  moveFile: (from, to, overwrite) => invoke("move_file", { from, to, overwrite }),
  // The bytes go as the request's body, the path in a header (see write_bytes).
  writeBytes: (path, bytes) => invoke("write_bytes", bytes, { headers: { path: encodeURIComponent(path) } }),
  readBytes: async (path) => new Uint8Array(await invoke<ArrayBuffer>("read_bytes", { path })),
  async pickOpen() {
    const picked = await openDialog({ multiple: false, directory: false, filters: FILTERS.md });
    return typeof picked === "string" ? picked : null;
  },
  pickSave: (defaultPath, ext) => saveDialog({ defaultPath, filters: FILTERS[ext] }),
  initialFiles: () => invoke("take_initial_files"),
  watch: (path) => invoke("watch_file", { path }),
  unwatch: (path) => invoke("unwatch_file", { path }),
  onFileChanged(cb) {
    void listen<string>("file-changed", (e) => cb(e.payload));
  },
  onOpenFile(cb) {
    void listen<string>("open-file", (e) => cb(e.payload));
  },
  // The webview takes drags from other apps itself, so the page sees no drag
  // events for them, only these. Their position is typed as physical pixels,
  // but on macOS it comes in points, which are already CSS pixels.
  onDragDrop(cb) {
    const scale = navigator.platform.startsWith("Mac") ? 1 : devicePixelRatio;
    void getCurrentWebview().onDragDropEvent(({ payload: p }) => {
      if (p.type === "leave") return cb({ type: "leave", paths: [], x: 0, y: 0 });
      const paths = p.type === "over" ? [] : p.paths;
      cb({ type: p.type, paths, x: p.position.x / scale, y: p.position.y / scale });
    });
  },
  onFocusLost(cb) {
    window.addEventListener("blur", cb);
  },
  setTitle: (title) => getCurrentWindow().setTitle(title),
  async setAppearance(theme, background) {
    const win = getCurrentWindow();
    await Promise.all([win.setTheme(theme), win.setBackgroundColor(background)]);
  },
  exit: () => invoke("exit_app"),
  onQuitRequested(cb) {
    void listen("quit-requested", cb);
    void getCurrentWindow().onCloseRequested((e) => {
      e.preventDefault();
      cb();
    });
  },
  async askUnsaved(names) {
    const save = "Save All";
    const discard = "Don't Save";
    const answer = await messageDialog(`Unsaved changes in ${names.join(", ")}.`, {
      title: "Save changes before quitting?",
      kind: "warning",
      buttons: { yes: save, no: discard, cancel: "Cancel" },
    });
    return answer === save || answer === "Yes" ? "save" : answer === discard || answer === "No" ? "discard" : "cancel";
  },
  checkSpelling: (text) => invoke("check_spelling", { text }),
  spellingSuggestions: (word) => invoke("spelling_suggestions", { word }),
  learnWord: (word) => invoke("learn_word", { word }),
  clipboardRead: async () => (await readText()) ?? "",
  clipboardWrite: (text) => writeText(text),
  clipboardFiles: () => invoke("clipboard_files"),
  clipboardImage: async () => new Uint8Array(await invoke<ArrayBuffer>("clipboard_image")),
  listDir: (path) => invoke("list_dir", { path }),
  listFiles: (root) => invoke("list_files", { root }),
  searchFiles: (root, pattern) => invoke("search_files", { root, pattern }),
  openExternal: (target) => invoke("open_external", { target }),
  workspaceRoot: (dir) => invoke("workspace_root", { dir }),
  homeDir: () => invoke("home_dir"),
  configDir: () => invoke("config_dir"),
  createDir: (path) => invoke("create_dir", { path }),
  trashFiles: (paths) => invoke("trash_files", { paths }),
  imagesSetAside: (paths) => invoke("images_set_aside", { paths }),
  imageBringBack: (path) => invoke("image_bring_back", { path }),
  currentDir: () => invoke("current_dir"),
  recoveryWrite: (id, contents) => invoke("recovery_write", { id, contents }),
  recoveryRemove: (id) => invoke("recovery_remove", { id }),
  recoveryTake: () => invoke("recovery_take"),
  helixConfig: () => invoke("helix_config"),
  helixConfigPath: () => invoke("helix_config_path"),
  helixTheme: (name) => invoke("helix_theme", { name }),
  helixThemes: () => invoke("helix_themes"),
  historyAdd: (path, text, kind) => invoke("history_add", { path, text, kind }),
  historyList: (path) => invoke("history_list", { path }),
  historyRead: (path, id) => invoke("history_read", { path, id }),
  historyBaseline: (path) => invoke("history_baseline", { path }),
  historyRename: (from, to) => invoke("history_rename", { from, to }),
  historySetBaseline: (path, text) => invoke("history_set_baseline", { path, text }),
  async checkUpdate() {
    update = await check();
    return update?.version ?? null;
  },
  async installUpdate() {
    update ??= await check();
    if (!update) return null;
    await update.downloadAndInstall();
    return update.version;
  },
};

// ── Browser stand-in ─────────────────────────────────────────────────────────

const FILE = "markmode.file.";
const RECOVERY = "markmode.recovery.";
const HISTORY = "markmode.history.";
const BASELINE = "markmode.baseline.";

/** The tab's storage, which outlives reloading the page; null where it is blocked. */
function tabStorage(): Storage | null {
  try {
    return sessionStorage;
  } catch {
    return null;
  }
}

// Files written in this tab are kept in its storage too, so they are still
// there after reloading the page, as they would be on disk after a restart.
// Writing a file tells whoever watches it, as the system's file watcher does,
// so a test can play another program changing a file.
const memoryFiles = new Map<string, string>([
  ["/sample.md", sample],
  ["/chart.svg", chart],
  ["/notes/ideas.md", "# Ideas\n\n- A second file, for trying buffers and the file picker.\n"],
  ...Object.entries(tabStorage() ?? {})
    .filter(([k]) => k.startsWith(FILE))
    .map(([k, v]): [string, string] => [k.slice(FILE.length), v]),
]);

const watched = new Set<string>();
/** Images :images-clean! cleaned up, kept for imageBringBack. */
const setAside = new Map<string, string>();
let fileChanged: (path: string) => void = () => {};

type StoredSnapshot = Snapshot & { text: string };
const historyOf = (path: string): StoredSnapshot[] => JSON.parse(tabStorage()?.getItem(HISTORY + path) ?? "[]");

const browserBackend: Backend = {
  async readText(path) {
    const text = memoryFiles.get(path);
    if (text === undefined) throw new Error(`${path}: not found`);
    // As files.rs: a NUL byte means an image, a PDF or the like.
    if (text.includes("\0")) throw new Error(`${path}: binary file`);
    return { text, format: { encoding: "utf-8", bom: false } };
  },
  async writeText(path, contents) {
    memoryFiles.set(path, contents);
    tabStorage()?.setItem(FILE + path, contents);
    if (watched.has(path)) setTimeout(() => fileChanged(path));
  },
  async moveFile(from, to, overwrite) {
    const text = memoryFiles.get(from);
    if (text === undefined) throw new Error(`${from}: not found`);
    const name = from.slice(from.lastIndexOf("/") + 1);
    const ext = /\.[^.]+$/.exec(name)?.[0] ?? "";
    if ([...memoryFiles.keys()].some((p) => p.startsWith(`${to}/`))) to = `${to}/${name}`;
    else if (!/\.[^./]+$/.test(to)) to += ext;
    if (to !== from && memoryFiles.has(to) && !overwrite) throw new Error(`${from}: ${to} already exists`);
    memoryFiles.delete(from);
    tabStorage()?.removeItem(FILE + from);
    memoryFiles.set(to, text);
    tabStorage()?.setItem(FILE + to, text);
    return to;
  },
  // The stand-in's files are text; an SVG file stands in for an image.
  async readBytes(path) {
    const text = memoryFiles.get(path);
    if (text === undefined) throw new Error(`${path}: not found`);
    return new TextEncoder().encode(text);
  },
  async writeBytes(path, bytes) {
    // Kept for the tests, then downloaded.
    (window as unknown as { written: Record<string, Uint8Array> }).written ??= {};
    (window as unknown as { written: Record<string, Uint8Array> }).written[path] = bytes;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([bytes as BlobPart]));
    a.download = path.split("/").pop()!;
    a.click();
    URL.revokeObjectURL(a.href);
  },
  pickOpen: () =>
    new Promise((resolve) => {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = ".md,.markdown,text/markdown";
      input.onchange = async () => {
        const file = input.files?.[0];
        if (!file) return resolve(null);
        memoryFiles.set(`/${file.name}`, await file.text());
        resolve(`/${file.name}`);
      };
      input.click();
    }),
  pickSave: async (defaultPath) => prompt("Save as", defaultPath),
  initialFiles: async () => ["/sample.md"],
  watch: async (path) => void watched.add(path),
  unwatch: async (path) => void watched.delete(path),
  onFileChanged(cb) {
    fileChanged = cb;
  },
  onOpenFile: () => {},
  // Drops reach the page as drop events here (see imageInput in main.ts).
  onDragDrop: () => {},
  onFocusLost(cb) {
    window.addEventListener("blur", cb);
  },
  setTitle: async (title) => {
    document.title = title;
  },
  setAppearance: async () => {},
  exit: async () => {},
  onQuitRequested: () => {},
  askUnsaved: async (names) => (confirm(`Discard unsaved changes in ${names.join(", ")}?`) ? "discard" : "cancel"),
  // A few planted typos stand in for a dictionary.
  async checkSpelling(text) {
    return [...text.matchAll(/\b(?:teh|recieve|wrold|mispelled)\b/gi)].map((m) => [m.index, m[0].length]);
  },
  spellingSuggestions: async (word) => ({ teh: ["the", "tech"], recieve: ["receive"], wrold: ["world", "wold"] })[word.toLowerCase()] ?? [],
  learnWord: async () => {},
  clipboardRead: () => navigator.clipboard.readText(),
  clipboardWrite: (text) => navigator.clipboard.writeText(text),
  // The page's paste event has the clipboard's images here.
  clipboardFiles: async () => [],
  clipboardImage: async () => new Uint8Array(),
  async listDir(path) {
    const dir = path.endsWith("/") ? path : `${path}/`;
    const names = new Map<string, boolean>();
    for (const p of memoryFiles.keys()) {
      if (!p.startsWith(dir)) continue;
      const [name, ...rest] = p.slice(dir.length).split("/");
      names.set(name, rest.length > 0);
    }
    return [...names].map(([name, isDir]) => ({ name, isDir }));
  },
  listFiles: async (root) => {
    const dir = root.endsWith("/") ? root : `${root}/`;
    return [...memoryFiles.keys()].filter((p) => p.startsWith(dir)).map((p) => p.slice(dir.length));
  },
  async searchFiles(root, pattern) {
    const re = searchRegex(pattern);
    const files = (await this.listFiles(root)).sort();
    const dir = root.endsWith("/") ? root : `${root}/`;
    return files.flatMap((rel) => searchText(rel, memoryFiles.get(dir + rel)!, re)).slice(0, MAX_MATCHES);
  },
  // Tests read what was opened from the page.
  async openExternal(target) {
    (window as unknown as { openedExternally: string[] }).openedExternally ??= [];
    (window as unknown as { openedExternally: string[] }).openedExternally.push(target);
  },
  workspaceRoot: async () => "/",
  homeDir: async () => "",
  configDir: async () => "/config/markmode",
  createDir: async () => {},
  async trashFiles(paths) {
    for (const path of paths) {
      // A folder goes with what is in it.
      for (const p of [...memoryFiles.keys()].filter((p) => p === path || p.startsWith(`${path}/`))) {
        memoryFiles.delete(p);
        tabStorage()?.removeItem(FILE + p);
      }
    }
  },
  async imagesSetAside(paths) {
    for (const path of paths) setAside.set(path, memoryFiles.get(path)!);
  },
  async imageBringBack(path) {
    const kept = setAside.get(path);
    if (kept === undefined || memoryFiles.has(path)) return false;
    await this.writeText(path, kept);
    setAside.delete(path);
    return true;
  },
  currentDir: async () => "/",
  // Kept in the page's storage, so reloading the page plays the part of a
  // restart after a crash.
  async recoveryWrite(id, contents) {
    tabStorage()?.setItem(RECOVERY + id, contents);
  },
  async recoveryRemove(id) {
    tabStorage()?.removeItem(RECOVERY + id);
  },
  async recoveryTake() {
    const storage = tabStorage();
    if (!storage) return [];
    const keys = Object.keys(storage).filter((k) => k.startsWith(RECOVERY));
    const found = keys.map((k) => storage.getItem(k)!);
    keys.forEach((k) => storage.removeItem(k));
    return found;
  },
  // Tests stand in a config.toml, as JSON, under this key.
  helixConfig: async () => JSON.parse(tabStorage()?.getItem("markmode.helix-config") ?? "null"),
  helixConfigPath: async () => null,
  async helixTheme(name) {
    throw new Error(`no Helix theme named ${name}`);
  },
  helixThemes: async () => [],
  async historyAdd(path, text, kind) {
    const list = historyOf(path);
    if (list[list.length - 1]?.text === text) return false;
    const time = Math.max(Date.now(), (list[list.length - 1]?.time ?? 0) + 1);
    list.push({ id: `${time}-${kind}.md`, time, kind, text });
    try {
      tabStorage()?.setItem(HISTORY + path, JSON.stringify(list.slice(-100)));
    } catch {
      return false; // Over the storage quota: a large file.
    }
    return true;
  },
  historyList: async (path) => historyOf(path).map(({ id, time, kind }) => ({ id, time, kind })).reverse(),
  historyBaseline: async (path) => tabStorage()?.getItem(BASELINE + path) ?? null,
  async historySetBaseline(path, text) {
    try {
      tabStorage()?.setItem(BASELINE + path, text);
    } catch {
      // Over the storage quota: a large file.
    }
  },
  async historyRename(from, to) {
    const storage = tabStorage();
    for (const key of [HISTORY, BASELINE]) {
      const kept = storage?.getItem(key + from);
      if (kept == null) continue;
      storage!.setItem(key + to, kept);
      storage!.removeItem(key + from);
    }
  },
  async historyRead(path, id) {
    const found = historyOf(path).find((s) => s.id === id);
    if (!found) throw new Error(`no version ${id} of ${path}`);
    return found.text;
  },
  checkUpdate: async () => null,
  installUpdate: async () => null,
};


export const isTauri = "__TAURI_INTERNALS__" in window;
export const backend: Backend = isTauri ? tauriBackend : browserBackend;
