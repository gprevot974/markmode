import { EditorState, EditorSelection, type Extension, Text } from "@codemirror/state";
import { EditorView, drawSelection, highlightActiveLine, keymap, type ViewUpdate } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, isolateHistory } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { languages } from "@codemirror/language-data";

import { config } from "./config.ts";
import { backend } from "./backend.ts";
import { helixState, modeField, nextBoundaryIn, type Mode } from "./helix/state.ts";
import { helixKeys } from "./helix/dispatcher.ts";
import { normalKeys, insertKeys, mergeKeys } from "./helix/keymap.ts";
import { blockCursor } from "./helix/cursor.ts";
import { jumpLabels } from "./helix/jumplabels.ts";
import { commands, type Host } from "./helix/commands.ts";
import { livePreview } from "./preview/livePreview.ts";
import { kanagawa } from "./theme/kanagawa.ts";

const $ = (id: string) => document.getElementById(id)!;
const basename = (p: string) => p.split("/").pop() ?? p;
const dirname = (p: string) => p.slice(0, p.lastIndexOf("/"));

/** The smallest single change turning `a` into `b`, so selections survive a reload. */
function diffChange(a: string, b: string) {
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let end = 0;
  while (end < a.length - start && end < b.length - start && a[a.length - 1 - end] === b[b.length - 1 - end]) end++;
  return { from: start, to: a.length - end, insert: b.slice(start, b.length - end) };
}

class App implements Host {
  view: EditorView;
  path: string | null = null;
  savedDoc: Text;
  dirty = false;
  /** The file changed on disk while there were unsaved edits here. */
  diskConflict = false;
  private promptHistory: string[] = [];
  private reloadTimer: number | undefined;

  constructor() {
    this.view = new EditorView({ state: this.createState(""), parent: $("editor") });
    this.savedDoc = this.view.state.doc;
    document.body.classList.toggle("cursorline", config.cursorline);
    this.renderStatus();

    backend.onFileChanged(() => {
      clearTimeout(this.reloadTimer);
      this.reloadTimer = window.setTimeout(() => void this.onDiskChange(), 120);
    });
    backend.onOpenFile((path) => void this.runTypable(`open ${path}`));
    backend.onFocusLost(() => {
      if (config.autoSaveOnFocusLost && this.dirty && this.path) void this.save();
    });
    window.addEventListener("keydown", (e) => this.appShortcut(e), true);
  }

  private createState(doc: string): EditorState {
    const extensions: Extension[] = [
      helixState,
      history({ newGroupDelay: 10 * 60_000 }),
      drawSelection(),
      EditorState.allowMultipleSelections.of(true),
      config.cursorline ? highlightActiveLine() : [],
      config.softWrap ? EditorView.lineWrapping : [],
      markdown({ base: markdownLanguage, codeLanguages: languages }),
      livePreview,
      blockCursor,
      jumpLabels,
      kanagawa,
      helixKeys(
        this,
        {
          normal: mergeKeys(normalKeys, config.keys.normal),
          insert: mergeKeys(insertKeys, config.keys.insert),
        },
        (keys) => ($("sl-pending").textContent = keys),
      ),
      keymap.of([...defaultKeymap, ...historyKeymap]),
      EditorView.contentAttributes.of({ spellcheck: "true", autocorrect: "off", autocapitalize: "off" }),
      EditorView.updateListener.of((u) => this.onUpdate(u)),
    ];
    // Start on the first character, like Helix, rather than an empty cursor.
    const selection = doc.length ? EditorSelection.single(0, nextBoundaryIn(Text.of(doc.split("\n")), 0)) : undefined;
    return EditorState.create({ doc, extensions, selection });
  }

  // ── Status ─────────────────────────────────────────────────────────────────

  private onUpdate(u: ViewUpdate) {
    if (u.docChanged) {
      const wasDirty = this.dirty;
      this.dirty = !u.state.doc.eq(this.savedDoc);
      if (wasDirty !== this.dirty) this.updateTitle();
    }
    this.renderStatus();
  }

  private renderStatus() {
    const { state } = this.view;
    const mode: Mode = state.field(modeField);
    document.body.classList.remove("mode-normal", "mode-insert", "mode-select");
    document.body.classList.add(`mode-${mode}`);
    $("sl-mode").textContent = { normal: "NOR", insert: "INS", select: "SEL" }[mode];
    const file = $("sl-file");
    file.textContent = this.path ? basename(this.path) : "[scratch]";
    file.classList.toggle("dirty", this.dirty);
    const sel = state.selection;
    $("sl-sels").textContent = sel.ranges.length > 1 ? `${sel.mainIndex + 1}/${sel.ranges.length} sels` : "";
    const main = sel.main;
    const pos = mode !== "insert" && main.head > main.anchor ? main.head - 1 : main.head;
    const line = state.doc.lineAt(pos);
    $("sl-pos").textContent = `${line.number}:${pos - line.from + 1}`;
  }

  private updateTitle() {
    const name = this.path ? basename(this.path) : "scratch";
    void backend.setTitle(`${this.dirty ? "● " : ""}${name}`);
  }

  message(text: string, kind: "info" | "error" = "info") {
    const el = $("sl-message");
    el.textContent = text;
    el.classList.toggle("error", kind === "error");
  }

  // ── Prompt ─────────────────────────────────────────────────────────────────

  prompt(label: string, onSubmit: (value: string) => void, initial = "") {
    const box = $("prompt");
    const input = $("prompt-input") as HTMLInputElement;
    $("prompt-label").textContent = label;
    input.value = initial;
    box.hidden = false;
    input.focus();
    let historyIndex = this.promptHistory.length;
    const finish = (submit: boolean) => {
      box.hidden = true;
      input.onkeydown = null;
      input.onblur = null;
      this.view.focus();
      if (submit) {
        if (input.value && label === ":") this.promptHistory.push(input.value);
        onSubmit(input.value);
      }
    };
    input.onblur = () => finish(false);
    input.onkeydown = (e) => {
      if (e.key === "Enter") finish(true);
      else if (e.key === "Escape" || (e.key === "c" && e.ctrlKey)) finish(false);
      else if (label === ":" && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
        historyIndex = Math.max(0, Math.min(this.promptHistory.length, historyIndex + (e.key === "ArrowUp" ? -1 : 1)));
        input.value = this.promptHistory[historyIndex] ?? "";
      } else return;
      e.preventDefault();
    };
  }

  // ── Typable commands ───────────────────────────────────────────────────────

  async runTypable(cmdline: string) {
    const [rawName, ...args] = cmdline.trim().split(/\s+/);
    if (!rawName) return;
    const force = rawName.endsWith("!");
    const name = force ? rawName.slice(0, -1) : rawName;
    const arg = args.join(" ") || undefined;
    try {
      switch (name) {
        case "w":
        case "write":
        case "wa":
        case "write-all":
          await this.save(arg);
          return;
        case "wq":
        case "x":
        case "write-quit":
          if (await this.save(arg)) await backend.close();
          return;
        case "q":
        case "quit":
          if (this.dirty && !force) return this.message("unsaved changes, use :q! to discard them", "error");
          return await backend.close();
        case "o":
        case "open":
        case "e":
        case "edit":
          if (this.dirty && !force) return this.message("unsaved changes, use :o! to discard them", "error");
          return arg ? await this.open(this.resolve(arg)) : await this.openFile(force);
        case "n":
        case "new":
          if (this.dirty && !force) return this.message("unsaved changes, use :new! to discard them", "error");
          return this.load(null, "");
        case "reload":
        case "rl":
          return await this.reload();
        case "export-docx":
        case "docx":
        case "export":
          return await this.exportDocx(arg);
        case "goto":
        case "g":
          return this.gotoLine(Number(arg));
        case "help":
        case "h":
          return this.message(
            ":w [path]  :wq  :q[!]  :o [path]  :new  :reload  :export-docx [path]  :<line>",
          );
        default:
          if (/^\d+$/.test(name)) return this.gotoLine(Number(name));
          this.message(`no such command: ${name}`, "error");
      }
    } catch (err) {
      this.message(String(err), "error");
    }
  }

  private resolve(path: string): string {
    if (path.startsWith("/")) return path;
    if (path.startsWith("~/")) return path; // the backend does not expand ~; keep it visible in errors
    return this.path ? `${dirname(this.path)}/${path}` : path;
  }

  private gotoLine(n: number) {
    if (!n) return;
    const line = this.view.state.doc.line(Math.max(1, Math.min(n, this.view.state.doc.lines)));
    this.view.dispatch({ selection: EditorSelection.cursor(line.from), scrollIntoView: true });
  }

  // ── Files ──────────────────────────────────────────────────────────────────

  private load(path: string | null, text: string) {
    this.view.setState(this.createState(text));
    this.path = path;
    this.savedDoc = this.view.state.doc;
    this.dirty = false;
    this.diskConflict = false;
    this.updateTitle();
    this.renderStatus();
    this.view.focus();
    if (path) void backend.watch(path).catch((e) => this.message(`not watching file: ${e}`, "error"));
  }

  async open(path: string) {
    const text = await backend.readText(path);
    this.load(path, text);
    this.message(`opened ${basename(path)}`);
  }

  async openFile(force = false) {
    if (this.dirty && !force) return this.message("unsaved changes, use :o! to discard them", "error");
    const path = await backend.pickOpen();
    if (path) await this.open(path);
  }

  async save(path?: string): Promise<boolean> {
    const target = path ? this.resolve(path) : (this.path ?? (await backend.pickSave("untitled.md", "md")));
    if (!target) return false;
    const doc = this.view.state.doc;
    await backend.writeText(target, doc.toString());
    const isNew = target !== this.path;
    this.path = target;
    this.savedDoc = doc;
    this.dirty = false;
    this.diskConflict = false;
    if (isNew) void backend.watch(target);
    this.updateTitle();
    this.renderStatus();
    this.message(`written ${basename(target)} (${doc.lines} lines)`);
    return true;
  }

  async reload() {
    if (!this.path) return this.message("no file to reload", "error");
    const text = await backend.readText(this.path);
    this.applyDiskText(text);
    this.message(`reloaded ${basename(this.path)}`);
  }

  // Applied as an edit rather than a fresh document, so the selection stays
  // put and `u` can undo what the other program wrote.
  private applyDiskText(text: string) {
    const current = this.view.state.doc.toString();
    if (text !== current) {
      this.view.dispatch({
        changes: diffChange(current, text),
        annotations: isolateHistory.of("full"),
        userEvent: "reload",
      });
    }
    this.savedDoc = this.view.state.doc;
    this.dirty = false;
    this.diskConflict = false;
    this.updateTitle();
    this.renderStatus();
  }

  private async onDiskChange() {
    if (!this.path) return;
    let text: string;
    try {
      text = await backend.readText(this.path);
    } catch {
      return; // Mid-rename or deleted; a later event will tell.
    }
    if (text === this.view.state.doc.toString()) {
      // Our own save, or someone wrote what we already have.
      if (this.dirty) this.applyDiskText(text);
      return;
    }
    if (this.dirty) {
      this.diskConflict = true;
      this.message("file changed on disk: :reload to take it, :w to overwrite it", "error");
      return;
    }
    this.applyDiskText(text);
    this.message(`${basename(this.path)} changed on disk, reloaded (u to undo)`);
  }

  async exportDocx(path?: string) {
    const target = path
      ? this.resolve(path)
      : this.path
        ? this.path.replace(/\.(md|markdown)$/i, "") + ".docx"
        : await backend.pickSave("untitled.docx", "docx");
    if (!target) return;
    // Loaded on first export: the docx library is most of the bundle.
    const { markdownToDocx } = await import("./export/docx.ts");
    const bytes = await markdownToDocx(this.view.state.doc.toString());
    await backend.writeBytes(target, bytes);
    this.message(`exported ${basename(target)} (${(bytes.length / 1024).toFixed(0)} KB)`);
  }

  clipboardRead() {
    return backend.clipboardRead();
  }

  clipboardWrite(text: string) {
    return backend.clipboardWrite(text);
  }

  // macOS conveniences alongside the Helix bindings.
  private appShortcut(e: KeyboardEvent) {
    if (!e.metaKey || e.ctrlKey || e.altKey) return;
    const key = e.key.toLowerCase();
    let action: (() => unknown) | null = null;
    if (key === "s" && !e.shiftKey) action = () => this.save();
    else if (key === "o") action = () => this.openFile();
    else if (key === "e" && e.shiftKey) action = () => this.exportDocx();
    if (!action) return;
    e.preventDefault();
    e.stopPropagation();
    void action();
  }
}

const app = new App();
const initial = await backend.initialFile().catch(() => null);
if (initial) await app.open(initial).catch((e) => app.message(String(e), "error"));
else app.view.focus();

// Exposed for debugging from the devtools console.
Object.assign(window, { app, commands });
