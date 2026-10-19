// Everything that touches the system: files, dialogs, clipboard, window. In
// Tauri it goes through the Rust backend; in a plain browser (`npm run dev`)
// it falls back to an in-memory stand-in, which is handy for working on the
// editor itself.

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { readText, writeText } from "@tauri-apps/plugin-clipboard-manager";
import sample from "../examples/sample.md?raw";

export interface Backend {
  readText(path: string): Promise<string>;
  writeText(path: string, contents: string): Promise<void>;
  writeBytes(path: string, bytes: Uint8Array): Promise<void>;
  pickOpen(): Promise<string | null>;
  pickSave(defaultPath: string, ext: "md" | "docx"): Promise<string | null>;
  initialFile(): Promise<string | null>;
  watch(path: string): Promise<void>;
  onFileChanged(cb: (path: string) => void): void;
  onOpenFile(cb: (path: string) => void): void;
  onFocusLost(cb: () => void): void;
  setTitle(title: string): Promise<void>;
  close(): Promise<void>;
  clipboardRead(): Promise<string>;
  clipboardWrite(text: string): Promise<void>;
}

const FILTERS = {
  md: [{ name: "Markdown", extensions: ["md", "markdown"] }],
  docx: [{ name: "Word document", extensions: ["docx"] }],
};

const tauriBackend: Backend = {
  readText: (path) => invoke("read_text", { path }),
  writeText: (path, contents) => invoke("write_text", { path, contents }),
  writeBytes: (path, bytes) => invoke("write_bytes", { path, bytes: Array.from(bytes) }),
  async pickOpen() {
    const picked = await openDialog({ multiple: false, directory: false, filters: FILTERS.md });
    return typeof picked === "string" ? picked : null;
  },
  pickSave: (defaultPath, ext) => saveDialog({ defaultPath, filters: FILTERS[ext] }),
  initialFile: () => invoke("take_initial_file"),
  watch: (path) => invoke("watch_file", { path }),
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
  close: () => getCurrentWindow().close(),
  clipboardRead: async () => (await readText()) ?? "",
  clipboardWrite: (text) => writeText(text),
};

// ── Browser stand-in ─────────────────────────────────────────────────────────

const memoryFiles = new Map<string, string>([["/sample.md", sample]]);

const browserBackend: Backend = {
  async readText(path) {
    const s = memoryFiles.get(path);
    if (s === undefined) throw new Error(`${path}: not found`);
    return s;
  },
  async writeText(path, contents) {
    memoryFiles.set(path, contents);
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
  onFileChanged: () => {},
  onOpenFile: () => {},
  onFocusLost(cb) {
    window.addEventListener("blur", cb);
  },
  setTitle: async (title) => {
    document.title = title;
  },
  close: async () => {},
  clipboardRead: () => navigator.clipboard.readText(),
  clipboardWrite: (text) => navigator.clipboard.writeText(text),
};

export const isTauri = "__TAURI_INTERNALS__" in window;
export const backend: Backend = isTauri ? tauriBackend : browserBackend;
