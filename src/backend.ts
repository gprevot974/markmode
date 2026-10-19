// Everything that touches the system: files, dialogs, clipboard, window. In
// Tauri it goes through the Rust backend; in a plain browser (`npm run dev`)
// it falls back to an in-memory stand-in, which is handy for working on the
// editor itself.

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { message as messageDialog, open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { readText, writeText } from "@tauri-apps/plugin-clipboard-manager";
import sample from "../examples/sample.md?raw";
import type { DiskFormat } from "./fileformat.ts";

export interface Backend {
  /** A text file and the encoding it was found in. */
  readText(path: string): Promise<FileText>;
  /** Writes atomically: a crash midway leaves the old file, never half of the new one. */
  writeText(path: string, contents: string, format?: DiskFormat): Promise<void>;
  writeBytes(path: string, bytes: Uint8Array): Promise<void>;
  pickOpen(): Promise<string | null>;
  pickSave(defaultPath: string, ext: "md" | "docx"): Promise<string | null>;
  initialFile(): Promise<string | null>;
  watch(path: string): Promise<void>;
  unwatch(path: string): Promise<void>;
  onFileChanged(cb: (path: string) => void): void;
  onOpenFile(cb: (path: string) => void): void;
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
  clipboardWrite(text: string): Promise<void>;
  listDir(path: string): Promise<DirEntry[]>;
  /** Every file under `root` (relative paths), minus hidden and git-ignored ones. */
  listFiles(root: string): Promise<string[]>;
  /** The nearest directory at or above `dir` holding `.git` or `.helix`, else `dir`. */
  workspaceRoot(dir: string): Promise<string>;
  homeDir(): Promise<string>;
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
};

const tauriBackend: Backend = {
  readText: (path) => invoke("read_text", { path }),
  writeText: (path, contents, format) => invoke("write_text", { path, contents, format }),
  writeBytes: (path, bytes) => invoke("write_bytes", { path, bytes: Array.from(bytes) }),
  async pickOpen() {
    const picked = await openDialog({ multiple: false, directory: false, filters: FILTERS.md });
    return typeof picked === "string" ? picked : null;
  },
  pickSave: (defaultPath, ext) => saveDialog({ defaultPath, filters: FILTERS[ext] }),
  initialFile: () => invoke("take_initial_file"),
  watch: (path) => invoke("watch_file", { path }),
  unwatch: (path) => invoke("unwatch_file", { path }),
  onFileChanged(cb) {
    void listen<string>("file-changed", (e) => cb(e.payload));
  },
  onOpenFile(cb) {
    void listen<string>("open-file", (e) => cb(e.payload));
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
  listDir: (path) => invoke("list_dir", { path }),
  listFiles: (root) => invoke("list_files", { root }),
  workspaceRoot: (dir) => invoke("workspace_root", { dir }),
  homeDir: () => invoke("home_dir"),
  currentDir: () => invoke("current_dir"),
  recoveryWrite: (id, contents) => invoke("recovery_write", { id, contents }),
  recoveryRemove: (id) => invoke("recovery_remove", { id }),
  recoveryTake: () => invoke("recovery_take"),
  helixConfig: () => invoke("helix_config"),
  helixConfigPath: () => invoke("helix_config_path"),
  helixTheme: (name) => invoke("helix_theme", { name }),
  helixThemes: () => invoke("helix_themes"),
};

// ── Browser stand-in ─────────────────────────────────────────────────────────

const FILE = "md-editor.file.";
const RECOVERY = "md-editor.recovery.";

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
const memoryFiles = new Map<string, string>([
  ["/sample.md", sample],
  ["/notes/ideas.md", "# Ideas\n\n- A second file, for trying buffers and the file picker.\n"],
  ...Object.entries(tabStorage() ?? {})
    .filter(([k]) => k.startsWith(FILE))
    .map(([k, v]): [string, string] => [k.slice(FILE.length), v]),
]);

const browserBackend: Backend = {
  async readText(path) {
    const text = memoryFiles.get(path);
    if (text === undefined) throw new Error(`${path}: not found`);
    return { text, format: { encoding: "utf-8", bom: false } };
  },
  async writeText(path, contents) {
    memoryFiles.set(path, contents);
    tabStorage()?.setItem(FILE + path, contents);
  },
  async writeBytes(path, bytes) {
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
  initialFile: async () => "/sample.md",
  watch: async () => {},
  unwatch: async () => {},
  onFileChanged: () => {},
  onOpenFile: () => {},
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
  workspaceRoot: async () => "/",
  homeDir: async () => "",
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
  helixConfig: async () => null,
  helixConfigPath: async () => null,
  async helixTheme(name) {
    throw new Error(`no Helix theme named ${name}`);
  },
  helixThemes: async () => [],
};


export const isTauri = "__TAURI_INTERNALS__" in window;
export const backend: Backend = isTauri ? tauriBackend : browserBackend;
