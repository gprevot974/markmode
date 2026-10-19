import { Annotation, EditorSelection, EditorState, type Extension, Text, Transaction } from "@codemirror/state";
import { EditorView, drawSelection, keymap, lineNumbers, type ViewUpdate } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, isolateHistory } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { languages } from "@codemirror/language-data";

import { config } from "./config.ts";
import { backend } from "./backend.ts";
import { helixState, modeField, nextBoundaryIn, type Mode } from "./helix/state.ts";
import { helixKeys } from "./helix/dispatcher.ts";
import { normalKeys, insertKeys, mergeKeys } from "./helix/keymap.ts";
import { selectionDecorations } from "./helix/cursor.ts";
import { cursorLines } from "./helix/cursorline.ts";
import { jumpLabels } from "./helix/jumplabels.ts";
import { commands, type Host, type WindowCommand } from "./helix/commands.ts";
import { livePreview } from "./preview/livePreview.ts";
import { spellcheck } from "./spell.ts";
import { kanagawa } from "./theme/kanagawa.ts";
import { currentTheme, endThemePreview, initTheme, previewTheme, setTheme, themeNames } from "./theme/appearance.ts";
import { applyHelixConfig } from "./helixConfig.ts";
import { openPrompt, type Completion, type PromptOptions } from "./ui/prompt.ts";
import { openPicker, type OpenHow } from "./ui/picker.ts";
import { renderInfobox } from "./ui/infobox.ts";
import { Layout, type Split, type SplitDir, type Tile } from "./ui/layout.ts";
import { findTypable, matchTypables, typables } from "./typable.ts";
import {
  defaultFormat,
  describeFormat,
  encodings,
  fromDisk,
  lineEndings,
  sameFormat,
  toDisk,
  type Encoding,
  type FileFormat,
  type LineEnding,
} from "./fileformat.ts";

const $ = (id: string) => document.getElementById(id)!;
const basename = (p: string) => p.split("/").pop() ?? p;
const dirname = (p: string) => p.slice(0, p.lastIndexOf("/")) || "/";

/** The smallest single change turning `a` into `b`, so selections survive a reload. */
function diffChange(a: string, b: string) {
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let end = 0;
  while (end < a.length - start && end < b.length - start && a[a.length - 1 - end] === b[b.length - 1 - end]) end++;
  return { from: start, to: a.length - end, insert: b.slice(start, b.length - end) };
}

/** How long after the last edit the crash-recovery copies are written. */
const RECOVERY_DELAY = 1000;

/** What a crash-recovery copy holds. */
interface RecoveryCopy {
  path: string | null;
  text: string;
  format: FileFormat;
  time: number;
}

/** Marks an edit replayed from another window showing the same document. */
const synced = Annotation.define<boolean>();

/** A buffer: an open file or a scratch document. */
class Doc {
  private static nextId = 1;
  readonly id = Doc.nextId++;
  path: string | null;
  /** The editor state while no window shows the document; windows hold the live one. */
  state: EditorState;
  savedDoc: Text;
  /** Encoding and line endings, kept from the file; changed with :encoding and :line-ending. */
  format: FileFormat;
  savedFormat: FileFormat;
  /** The file changed on disk while there were unsaved edits here. */
  diskConflict = false;
  lastAccess = 0;
  reloadTimer: number | undefined;

  constructor(path: string | null, state: EditorState, format: FileFormat) {
    this.path = path;
    this.state = state;
    this.savedDoc = state.doc;
    this.format = this.savedFormat = format;
  }
}

/** A window (Helix's view): an editor on one document, with its own statusline. */
class Win implements Tile {
  readonly el = document.createElement("div");
  parent: Split | null = null;
  doc: Doc;
  readonly view: EditorView;
  readonly sl: Record<"mode" | "file" | "sels" | "format" | "pos", HTMLElement>;

  constructor(doc: Doc, state: EditorState, onTransactions: (win: Win, trs: readonly Transaction[]) => void) {
    this.doc = doc;
    this.el.className = "window";
    const editor = document.createElement("div");
    editor.className = "win-editor";
    const status = document.createElement("div");
    status.className = "statusline";
    const span = (cls: string) => {
      const el = document.createElement("span");
      el.className = cls;
      status.appendChild(el);
      return el;
    };
    this.sl = {
      mode: span("sl-mode"),
      file: span("sl-file"),
      sels: span("sl-sels"),
      format: span("sl-format"),
      pos: span("sl-pos"),
    };
    this.sl.file.after(Object.assign(document.createElement("span"), { className: "sl-spacer" }));
    this.el.append(editor, status);
    this.view = new EditorView({
      state,
      parent: editor,
      dispatchTransactions: (trs, view) => {
        view.update(trs);
        onTransactions(this, trs);
      },
    });
  }
}

class App implements Host {
  docs: Doc[] = [];
  layout: Layout<Win>;
  active: Win;
  private previous: Win | null = null;
  private clock = 0;
  private home = "";
  private cwd = "";

  constructor() {
    const doc = this.addDoc(null, "");
    this.active = this.createWindow(doc, doc.state);
    this.active.el.classList.add("active");
    this.layout = new Layout($("windows"), this.active);
    document.body.classList.toggle("cursorline", config.cursorline);
    this.renderStatus(this.active);

    backend.onFileChanged((path) => {
      const doc = this.docs.find((d) => d.path === path);
      if (!doc) return;
      clearTimeout(doc.reloadTimer);
      doc.reloadTimer = window.setTimeout(() => void this.onDiskChange(doc), 120);
    });
    backend.onOpenFile((path) => void this.openPath(path).catch((e) => this.message(String(e), "error")));
    backend.onQuitRequested(() => void this.requestQuit());
    backend.onFocusLost(() => {
      if (config.autoSaveOnFocusLost) void this.writeAll(true);
    });
    window.addEventListener("keydown", (e) => this.appShortcut(e), true);
  }

  async init() {
    [this.home, this.cwd] = await Promise.all([
      backend.homeDir().catch(() => ""),
      backend.currentDir().catch(() => ""),
    ]);
  }

  /** The focused editor. */
  get view(): EditorView {
    return this.active.view;
  }

  private createState(doc: string | Text, selection?: EditorSelection): EditorState {
    const extensions: Extension[] = [
      helixState,
      history({ newGroupDelay: 10 * 60_000 }),
      drawSelection(),
      EditorState.allowMultipleSelections.of(true),
      config.lineNumbers ? lineNumbers() : [],
      cursorLines(config.cursorline),
      config.softWrap ? EditorView.lineWrapping : [],
      markdown({ base: markdownLanguage, codeLanguages: languages }),
      livePreview,
      config.spellcheck
        ? spellcheck({
            check: (text) => backend.checkSpelling(text),
            suggest: (word) => backend.spellingSuggestions(word),
            learn: (word) => backend.learnWord(word),
          })
        : [],
      selectionDecorations,
      jumpLabels,
      kanagawa,
      helixKeys(
        this,
        {
          normal: mergeKeys(normalKeys, config.keys.normal),
          insert: mergeKeys(insertKeys, config.keys.insert),
        },
        (keys) => ($("pending").textContent = keys),
        renderInfobox,
      ),
      keymap.of([...defaultKeymap, ...historyKeymap]),
      EditorView.contentAttributes.of({ spellcheck: "false", autocorrect: "off", autocapitalize: "off" }),
      EditorView.updateListener.of((u) => this.onUpdate(u)),
    ];
    const text = typeof doc === "string" ? Text.of(doc.split("\n")) : doc;
    // Start on the first character, like Helix, rather than an empty cursor.
    selection ??= text.length ? EditorSelection.single(0, nextBoundaryIn(text, 0)) : undefined;
    return EditorState.create({ doc: text, extensions, selection });
  }

  // ── Documents ──────────────────────────────────────────────────────────────

  private addDoc(path: string | null, text: string, format = defaultFormat): Doc {
    const doc = new Doc(path, this.createState(text), format);
    this.docs.push(doc);
    if (path) this.watch(path);
    return doc;
  }

  private removeDoc(doc: Doc) {
    this.docs.splice(this.docs.indexOf(doc), 1);
    if (this.recovered.delete(doc)) void backend.recoveryRemove(doc.id).catch(() => {});
    if (doc.path) void backend.unwatch(doc.path);
  }

  private watch(path: string) {
    void backend.watch(path).catch((e) => this.message(`not watching ${basename(path)}: ${e}`, "error"));
  }

  windowsShowing(doc: Doc): Win[] {
    return this.layout?.windows().filter((w) => w.doc === doc) ?? [];
  }

  /** The live state of a document: from a window showing it, else the stored one. */
  stateOf(doc: Doc): EditorState {
    return this.windowsShowing(doc)[0]?.view.state ?? doc.state;
  }

  isDirty(doc: Doc): boolean {
    return !this.stateOf(doc).doc.eq(doc.savedDoc) || !sameFormat(doc.format, doc.savedFormat);
  }

  private docName(doc: Doc, full = false): string {
    if (!doc.path) return "[scratch]";
    if (!full) return basename(doc.path);
    return this.home && doc.path.startsWith(this.home + "/") ? "~" + doc.path.slice(this.home.length) : doc.path;
  }

  /** Most recently used documents first. */
  private recentDocs(): Doc[] {
    return [...this.docs].sort((a, b) => b.lastAccess - a.lastAccess);
  }

  /** Shows a document in a window, keeping the one it replaces as a buffer. */
  show(win: Win, doc: Doc) {
    const old = win.doc;
    if (old === doc) return;
    if (!this.windowsShowing(old).some((w) => w !== win)) old.state = win.view.state;
    // Another window already editing it has the live text; this one gets its
    // own state on that text, kept in step by `afterTransactions`.
    const live = this.windowsShowing(doc)[0];
    win.doc = doc;
    win.view.setState(live ? this.createState(live.view.state.doc, live.view.state.selection) : doc.state);
    doc.lastAccess = ++this.clock;
    this.renderStatus(win);
    if (win === this.active) this.updateTitle();
  }

  async openPath(path: string, how: OpenHow = "replace") {
    let doc = this.docs.find((d) => d.path === path);
    if (!doc) {
      let file = { text: "", format: defaultFormat };
      try {
        const disk = await backend.readText(path);
        file = fromDisk(disk.text, disk.format);
      } catch (err) {
        // A path that does not exist yet becomes a new file on the first write.
        if (!/os error 2|not found/i.test(String(err))) throw err;
        this.message(`new file ${basename(path)}`);
      }
      doc = this.addDoc(path, file.text, file.format);
    }
    const win = how === "replace" ? this.active : this.split(how === "vsplit" ? "row" : "column");
    this.replace(win, doc);
    this.focus(win);
  }

  /** Shows a document; an empty, untouched scratch buffer it replaces goes away, as in Helix. */
  replace(win: Win, doc: Doc) {
    const previous = win.doc;
    this.show(win, doc);
    if (!previous.path && !this.stateOf(previous).doc.length && !this.windowsShowing(previous).length) {
      this.removeDoc(previous);
    }
  }

  async openFile() {
    const path = await backend.pickOpen();
    if (path) await this.openPath(path);
  }

  private newScratch(win: Win) {
    this.show(win, this.addDoc(null, ""));
    this.focus(win);
  }

  private closeBuffer(doc: Doc, force: boolean): boolean {
    if (!force && this.isDirty(doc)) {
      this.message(`${this.docName(doc)} has unsaved changes, use :bc! to discard them`, "error");
      return false;
    }
    const showing = this.windowsShowing(doc);
    this.removeDoc(doc);
    const fallback = this.recentDocs()[0] ?? this.addDoc(null, "");
    for (const w of showing) this.show(w, fallback);
    return true;
  }

  private closeOtherBuffers(force: boolean) {
    const keep = this.active.doc;
    let kept = 0;
    for (const doc of [...this.docs]) {
      if (doc === keep) continue;
      if (!force && this.isDirty(doc)) kept++;
      else this.closeBuffer(doc, true);
    }
    if (kept) this.message(`${kept} buffer${kept > 1 ? "s" : ""} with unsaved changes kept, use :bco! to discard them`, "error");
  }

  private closeAllBuffers(force: boolean) {
    const dirty = this.docs.filter((d) => this.isDirty(d));
    if (!force && dirty.length) return this.unsavedError(dirty, ":bca!");
    for (const doc of [...this.docs]) this.closeBuffer(doc, true);
  }

  gotoBuffer(which: "next" | "previous" | "last") {
    const current = this.active.doc;
    let target: Doc | undefined;
    if (which === "last") target = this.recentDocs().find((d) => d !== current);
    else {
      const i = this.docs.indexOf(current);
      target = this.docs[(i + (which === "next" ? 1 : -1) + this.docs.length) % this.docs.length];
    }
    if (!target || target === current) return this.message("no other buffer");
    this.show(this.active, target);
  }

  private unsavedError(dirty: Doc[], escape: string) {
    const names = dirty.map((d) => this.docName(d)).join(", ");
    this.message(`${dirty.length} unsaved buffer${dirty.length > 1 ? "s" : ""} (${names}), use ${escape} to discard`, "error");
  }

  // ── Windows ────────────────────────────────────────────────────────────────

  private createWindow(doc: Doc, state: EditorState): Win {
    const win = new Win(doc, state, (w, trs) => this.afterTransactions(w, trs));
    win.el.addEventListener("focusin", () => this.setActive(win));
    win.el.addEventListener("mousedown", () => this.setActive(win));
    return win;
  }

  /** Replays edits into the other windows showing the same document. */
  private afterTransactions(win: Win, trs: readonly Transaction[]) {
    if (trs.some((tr) => tr.docChanged)) this.scheduleRecovery();
    for (const tr of trs) {
      if (!tr.docChanged || tr.annotation(synced)) continue;
      for (const other of this.windowsShowing(win.doc)) {
        if (other === win) continue;
        // Undo stays per window: each one undoes its own edits.
        other.view.dispatch({ changes: tr.changes, annotations: [synced.of(true), Transaction.addToHistory.of(false)] });
      }
    }
  }

  private setActive(win: Win) {
    if (win === this.active) return;
    this.previous = this.active;
    this.active.el.classList.remove("active");
    win.el.classList.add("active");
    this.active = win;
    win.doc.lastAccess = ++this.clock;
    this.renderStatus(this.previous);
    this.renderStatus(win);
    this.updateTitle();
  }

  private focus(win: Win) {
    this.setActive(win);
    win.view.focus();
  }

  /** Splits the current window; the new one shows the same document and becomes current. */
  private split(dir: SplitDir): Win {
    const from = this.active;
    const { state } = from.view;
    const win = this.createWindow(from.doc, this.createState(state.doc, state.selection));
    this.layout.split(from, win, dir);
    win.view.dispatch({ effects: from.view.scrollSnapshot() });
    this.focus(win);
    return win;
  }

  private closeWindow(win: Win, force: boolean) {
    const wins = this.layout.windows();
    if (wins.length === 1) return this.quitAll(force);
    if (!this.windowsShowing(win.doc).some((w) => w !== win)) win.doc.state = win.view.state;
    const next = this.previous && this.previous !== win && wins.includes(this.previous) ? this.previous : wins.find((w) => w !== win)!;
    this.layout.remove(win);
    win.view.destroy();
    this.focus(next);
    this.previous = null;
  }

  private onlyWindow() {
    const keep = this.active;
    for (const w of this.layout.windows()) {
      if (w === keep) continue;
      if (!this.windowsShowing(w.doc).some((o) => o !== w)) w.doc.state = w.view.state;
      this.layout.remove(w);
      w.view.destroy();
    }
    this.previous = null;
    this.focus(keep);
  }

  windowCommand(cmd: WindowCommand) {
    const win = this.active;
    const dirs = { left: "left", down: "down", up: "up", right: "right" } as const;
    const [, verb, dir] = /^(jump|swap)_view_(left|down|up|right)$/.exec(cmd) ?? [];
    if (verb) {
      const other = this.layout.neighbor(win, dirs[dir as keyof typeof dirs]);
      if (!other) return;
      if (verb === "jump") return this.focus(other);
      this.layout.swap(win, other);
      return this.focus(win);
    }
    switch (cmd) {
      case "rotate_view": {
        const wins = this.layout.windows();
        return this.focus(wins[(wins.indexOf(win) + 1) % wins.length]);
      }
      case "hsplit":
      case "vsplit":
        this.split(cmd === "vsplit" ? "row" : "column");
        return;
      case "hsplit_new":
      case "vsplit_new":
        return this.newScratch(this.split(cmd === "vsplit_new" ? "row" : "column"));
      case "transpose_view":
        this.layout.transpose(win);
        return this.focus(win);
      case "wclose":
        return this.closeWindow(win, false);
      case "wonly":
        return this.onlyWindow();
    }
  }

  // ── Status ─────────────────────────────────────────────────────────────────

  private onUpdate(u: ViewUpdate) {
    const win = this.layout?.windows().find((w) => w.view === u.view);
    if (!win) return;
    this.renderStatus(win);
    if (u.docChanged && win.doc === this.active.doc) this.updateTitle();
  }

  private renderStatus(win: Win) {
    const { state } = win.view;
    const mode: Mode = state.field(modeField);
    win.el.classList.remove("mode-normal", "mode-insert", "mode-select");
    win.el.classList.add(`mode-${mode}`);
    win.sl.mode.textContent = { normal: "NOR", insert: "INS", select: "SEL" }[mode];
    win.sl.file.textContent = this.docName(win.doc, true);
    win.sl.file.classList.toggle("dirty", this.isDirty(win.doc));
    win.sl.format.textContent = describeFormat(win.doc.format);
    const sel = state.selection;
    win.sl.sels.textContent = sel.ranges.length > 1 ? `${sel.mainIndex + 1}/${sel.ranges.length} sels` : "";
    const main = sel.main;
    const pos = mode !== "insert" && main.head > main.anchor ? main.head - 1 : main.head;
    const line = state.doc.lineAt(pos);
    win.sl.pos.textContent = `${line.number}:${pos - line.from + 1}`;
  }

  private renderAllStatus() {
    for (const w of this.layout.windows()) this.renderStatus(w);
    this.updateTitle();
  }

  private updateTitle() {
    const doc = this.active.doc;
    void backend.setTitle(`${this.isDirty(doc) ? "● " : ""}${doc.path ? basename(doc.path) : "scratch"}`);
  }

  message(text: string, kind: "info" | "error" = "info") {
    const el = $("message");
    el.textContent = text;
    el.classList.toggle("error", kind === "error");
  }

  // ── Prompt and pickers ─────────────────────────────────────────────────────

  prompt(label: string, opts: Omit<PromptOptions, "label">) {
    openPrompt({ label, ...opts }, () => this.view.focus());
  }

  /** `:` with completion of command names and, for commands taking one, paths. */
  commandLine() {
    this.prompt(":", {
      onSubmit: (line) => void this.runTypable(line).finally(endThemePreview),
      onCancel: endThemePreview,
      // `:theme <name>` shows the theme as it is typed or tabbed to, as in Helix.
      onChange: (line) => {
        const name = /^\s*theme\s+(\S+)\s*$/.exec(line)?.[1];
        if (name) previewTheme(name);
        else endThemePreview();
      },
      complete: (line) => this.completeCommandLine(line),
      docFor: (line) => findTypable(line.trim().split(/\s+/)[0].replace(/!$/, ""))?.doc,
    });
  }

  private async completeCommandLine(line: string): Promise<Completion[]> {
    const space = line.indexOf(" ");
    if (space === -1) {
      return matchTypables(line).map((t) => ({
        insert: t.name,
        from: 0,
        label: [t.name, ...t.aliases].join(", "),
        doc: t.doc,
      }));
    }
    const typable = findTypable(line.slice(0, space).replace(/!$/, ""));
    const arg = line.slice(space + 1);
    const choices = (names: string[]) =>
      names.filter((n) => n.startsWith(arg)).map((n) => ({ insert: n, from: space + 1, label: n }));
    if (typable?.args === "theme") return choices(await themeNames());
    if (typable?.args === "encoding") return choices(encodings);
    if (typable?.args === "line-ending") return choices(lineEndings);
    if (typable?.args !== "path") return [];
    const slash = arg.lastIndexOf("/");
    const dirPart = arg.slice(0, slash + 1);
    const prefix = arg.slice(slash + 1);
    const dir = this.resolve(dirPart || ".");
    const entries = await backend.listDir(dir).catch(() => []);
    return entries
      .filter((e) => e.name.toLowerCase().startsWith(prefix.toLowerCase()))
      .filter((e) => prefix.startsWith(".") || !e.name.startsWith("."))
      .map((e) => {
        const name = e.isDir ? `${e.name}/` : e.name;
        return { insert: dirPart + name, from: space + 1, label: name, partial: e.isDir };
      });
  }

  /** Where relative paths and the pickers start: the current file's directory. */
  private baseDir(): string {
    const path = this.active.doc.path;
    if (path) return dirname(path);
    return this.cwd && this.cwd !== "/" ? this.cwd : this.home || "/";
  }

  /** Files under the workspace root (the nearest `.git` above), or under the current file's directory. */
  async filePicker(inCurrentDir: boolean) {
    const base = this.baseDir();
    const root = inCurrentDir ? base : await backend.workspaceRoot(base).catch(() => base);
    const join = (rel: string) => (root.endsWith("/") ? root : root + "/") + rel;
    const shown = this.home && root.startsWith(this.home) ? "~" + root.slice(this.home.length) : root;
    openPicker<string>(
      {
        title: shown || "/",
        items: backend.listFiles(root),
        text: (rel) => rel,
        async preview(rel) {
          try {
            return { text: (await backend.readText(join(rel))).text };
          } catch (err) {
            return { text: String(err) };
          }
        },
        onSelect: (rel, how) => void this.openPath(join(rel), how).catch((e) => this.message(String(e), "error")),
      },
      () => this.view.focus(),
    );
  }

  bufferPicker() {
    openPicker<Doc>(
      {
        title: "buffers",
        items: this.recentDocs(),
        text: (doc) => this.docName(doc, true),
        prefix: (doc) => `${doc.id} ${this.isDirty(doc) ? "+" : " "}${doc === this.active.doc ? "*" : " "}`,
        preview: (doc) => {
          const state = this.stateOf(doc);
          const main = state.selection.main;
          const cursor = main.head > main.anchor ? main.head - 1 : main.head;
          return { text: state.doc.toString(), line: state.doc.lineAt(cursor).number };
        },
        onSelect: (doc, how) => {
          if (!this.docs.includes(doc)) return;
          const win = how === "replace" ? this.active : this.split(how === "vsplit" ? "row" : "column");
          this.show(win, doc);
          this.focus(win);
        },
      },
      () => this.view.focus(),
    );
  }

  // ── Typable commands ───────────────────────────────────────────────────────

  async runTypable(cmdline: string) {
    const [rawName, ...args] = cmdline.trim().split(/\s+/);
    if (!rawName) return;
    const force = rawName.endsWith("!");
    const name = force ? rawName.slice(0, -1) : rawName;
    const arg = args.join(" ") || undefined;
    if (/^\d+$/.test(name)) return this.gotoLine(Number(name));
    const typable = findTypable(name);
    if (!typable) return this.message(`no such command: ${name}`, "error");
    const doc = this.active.doc;
    try {
      switch (typable.name) {
        case "write":
          await this.save(doc, arg);
          return;
        case "write-all":
          await this.writeAll(false);
          return;
        case "write-quit":
          if (await this.save(doc, arg)) await this.closeWindow(this.active, force);
          return;
        case "write-quit-all":
          if (await this.writeAll(false)) await this.quitAll(force);
          return;
        case "quit":
          return await this.closeWindow(this.active, force);
        case "quit-all":
          return await this.quitAll(force);
        case "open":
          return arg ? await this.openPath(this.resolve(arg)) : await this.openFile();
        case "new":
          return this.newScratch(this.active);
        case "vsplit":
        case "hsplit":
          if (arg) await this.openPath(this.resolve(arg), typable.name);
          else this.split(typable.name === "vsplit" ? "row" : "column");
          return;
        case "vsplit-new":
        case "hsplit-new":
          return this.newScratch(this.split(typable.name === "vsplit-new" ? "row" : "column"));
        case "buffer-close":
          this.closeBuffer(doc, force);
          return;
        case "buffer-close-others":
          return this.closeOtherBuffers(force);
        case "buffer-close-all":
          return this.closeAllBuffers(force);
        case "buffer-next":
          return this.gotoBuffer("next");
        case "buffer-previous":
          return this.gotoBuffer("previous");
        case "reload":
          return await this.reload(doc);
        case "reload-all":
          for (const d of this.docs) if (d.path) await this.reload(d);
          return;
        case "export-docx":
          return await this.exportDocx(arg);
        case "encoding":
          if (!arg) return this.message(`encoding: ${doc.format.encoding}${doc.format.bom ? " with BOM" : ""}`);
          if (!encodings.includes(arg as Encoding)) return this.message(`encoding: ${encodings.join(", ")}`, "error");
          // UTF-16 cannot be told apart from other bytes without its BOM.
          doc.format = { ...doc.format, encoding: arg as Encoding, bom: arg.startsWith("utf-16") || (arg === "utf-8" && doc.format.bom) };
          return this.renderAllStatus();
        case "line-ending":
          if (!arg) return this.message(`line ending: ${doc.format.lineEnding}`);
          if (!lineEndings.includes(arg as LineEnding)) return this.message("line-ending: lf or crlf", "error");
          doc.format = { ...doc.format, lineEnding: arg as LineEnding };
          return this.renderAllStatus();
        case "config-open": {
          const path = await backend.helixConfigPath();
          if (!path) return this.message("no Helix config here", "error");
          await this.openPath(path);
          return this.message(
            skippedKeys.length
              ? `skipped bindings, using commands this editor lacks: ${skippedKeys.join("; ")}`
              : "every binding in it is in use (changes apply on the next start)",
          );
        }
        case "theme":
          if (!arg) return this.message(`theme: ${currentTheme()}`);
          return await setTheme(arg);
        case "goto":
          return this.gotoLine(Number(arg));
        case "help":
          return this.message(typables.map((t) => `:${t.aliases[0] ?? t.name}`).join("  ") + "  :<line>");
      }
    } catch (err) {
      this.message(String(err), "error");
    }
  }

  /** Absolute path for what was typed: `~` is home, relative paths start at the current file. */
  private resolve(path: string): string {
    let out: string;
    if (path === "~" || path.startsWith("~/")) out = this.home + path.slice(1);
    else if (path.startsWith("/")) out = path;
    else out = `${this.baseDir()}/${path}`;
    // Normalize "." and ".." segments.
    const parts: string[] = [];
    for (const seg of out.split("/")) {
      if (seg === "..") parts.pop();
      else if (seg !== "." && seg !== "") parts.push(seg);
    }
    return "/" + parts.join("/");
  }

  private gotoLine(n: number) {
    if (!n) return;
    const { doc } = this.view.state;
    const line = doc.line(Math.max(1, Math.min(n, doc.lines)));
    this.view.dispatch({ selection: EditorSelection.cursor(line.from), scrollIntoView: true });
  }

  private async quitAll(force: boolean) {
    const dirty = this.docs.filter((d) => this.isDirty(d));
    if (!force && dirty.length) return this.unsavedError(dirty, ":q!");
    await backend.exit();
  }

  /** The close button, Cmd-W or Cmd-Q: asks before dropping unsaved changes. */
  private async requestQuit() {
    const dirty = this.docs.filter((d) => this.isDirty(d));
    if (!dirty.length) return backend.exit();
    const answer = await backend.askUnsaved(dirty.map((d) => this.docName(d)));
    if (answer === "discard") return backend.exit();
    if (answer === "save" && (await this.writeAll(false))) return backend.exit();
    this.view.focus();
  }

  // ── Crash recovery ─────────────────────────────────────────────────────────

  /** Buffers with a recovery copy on disk, and the text that copy holds. */
  private recovered = new Map<Doc, Text>();
  private recoveryTimer: number | undefined;

  /** Brings the recovery copies up to date once typing pauses. */
  private scheduleRecovery() {
    clearTimeout(this.recoveryTimer);
    this.recoveryTimer = window.setTimeout(() => void this.syncRecovery(), RECOVERY_DELAY);
  }

  private async syncRecovery() {
    for (const doc of this.docs) {
      const text = this.stateOf(doc).doc;
      if (this.isDirty(doc)) {
        if (this.recovered.get(doc) === text) continue;
        this.recovered.set(doc, text);
        const copy: RecoveryCopy = { path: doc.path, text: text.toString(), format: doc.format, time: Date.now() };
        await backend.recoveryWrite(doc.id, JSON.stringify(copy)).catch((e) => {
          this.recovered.delete(doc);
          this.message(`could not keep a recovery copy of ${this.docName(doc)}: ${e}`, "error");
        });
      } else if (this.recovered.delete(doc)) {
        await backend.recoveryRemove(doc.id).catch(() => {});
      }
    }
  }

  /**
   * Reopens the unsaved changes an earlier run left behind when it crashed:
   * each comes back as a modified buffer over the file as it is on disk, so
   * `:w` keeps the changes, `:reload` drops them and `u` shows what they were.
   */
  async restoreRecovered(): Promise<Doc | null> {
    const copies: RecoveryCopy[] = [];
    for (const raw of await backend.recoveryTake().catch(() => [])) {
      try {
        copies.push(JSON.parse(raw));
      } catch {
        // Unreadable: nothing to restore from it.
      }
    }
    const restored: Doc[] = [];
    for (const copy of copies.sort((a, b) => a.time - b.time)) {
      let doc = copy.path ? this.docs.find((d) => d.path === copy.path) : undefined;
      if (!doc) {
        let disk = { text: "", format: copy.format };
        if (copy.path) {
          try {
            const file = await backend.readText(copy.path);
            disk = fromDisk(file.text, file.format);
          } catch {
            // Deleted since: the copy becomes a new file there.
          }
        }
        if (disk.text === copy.text && sameFormat(disk.format, copy.format)) continue;
        doc = this.addDoc(copy.path, disk.text, disk.format);
      }
      const current = this.stateOf(doc).doc.toString();
      doc.state = doc.state.update({ changes: diffChange(current, copy.text), userEvent: "recover" }).state;
      doc.format = copy.format;
      restored.push(doc);
    }
    if (!restored.length) return null;
    await this.syncRecovery();
    const names = restored.map((d) => this.docName(d)).join(", ");
    this.message(`restored unsaved changes from before a crash: ${names} (:w keeps them, :reload drops them)`);
    return restored[restored.length - 1];
  }

  // ── Files ──────────────────────────────────────────────────────────────────

  async save(doc: Doc, path?: string): Promise<boolean> {
    const target = path ? this.resolve(path) : (doc.path ?? (await backend.pickSave("untitled.md", "md")));
    if (!target) return false;
    const text = this.stateOf(doc).doc;
    const format = doc.format;
    await backend.writeText(target, toDisk(text.toString(), format), format);
    if (target !== doc.path) {
      if (doc.path) void backend.unwatch(doc.path);
      doc.path = target;
      this.watch(target);
    }
    doc.savedDoc = text;
    doc.savedFormat = format;
    doc.diskConflict = false;
    this.scheduleRecovery();
    this.renderAllStatus();
    this.message(`written ${basename(target)} (${text.lines} lines)`);
    return true;
  }

  /** Writes every modified buffer that has a file; returns whether nothing is left unsaved. */
  private async writeAll(quiet: boolean): Promise<boolean> {
    const dirty = this.docs.filter((d) => this.isDirty(d));
    const scratch = dirty.filter((d) => !d.path);
    for (const doc of dirty) if (doc.path) await this.save(doc).catch((e) => this.message(String(e), "error"));
    if (dirty.length > scratch.length && !quiet) {
      this.message(`written ${dirty.length - scratch.length} buffer${dirty.length - scratch.length > 1 ? "s" : ""}`);
    }
    if (scratch.length && !quiet) this.message(`${scratch.length} scratch buffer${scratch.length > 1 ? "s have" : " has"} no file, use :w <path>`, "error");
    return scratch.length === 0;
  }

  async reload(doc: Doc) {
    if (!doc.path) return this.message("no file to reload", "error");
    const disk = await backend.readText(doc.path);
    const { text, format } = fromDisk(disk.text, disk.format);
    this.applyDiskText(doc, text, format);
    this.message(`reloaded ${basename(doc.path)}`);
  }

  // Applied as an edit rather than a fresh document, so selections stay put
  // and `u` can undo what the other program wrote.
  private applyDiskText(doc: Doc, text: string, format: FileFormat) {
    const current = this.stateOf(doc).doc.toString();
    if (text !== current) {
      const spec = { changes: diffChange(current, text), annotations: isolateHistory.of("full"), userEvent: "reload" };
      const win = this.windowsShowing(doc)[0];
      if (win) win.view.dispatch(spec);
      else doc.state = doc.state.update(spec).state;
    }
    doc.savedDoc = this.stateOf(doc).doc;
    doc.format = doc.savedFormat = format;
    doc.diskConflict = false;
    this.scheduleRecovery();
    this.renderAllStatus();
  }

  private async onDiskChange(doc: Doc) {
    if (!doc.path || !this.docs.includes(doc)) return;
    let text: string;
    let format: FileFormat;
    try {
      const disk = await backend.readText(doc.path);
      ({ text, format } = fromDisk(disk.text, disk.format));
    } catch {
      return; // Mid-rename or deleted; a later event will tell.
    }
    const dirty = this.isDirty(doc);
    if (text === this.stateOf(doc).doc.toString()) {
      // Our own save, someone wrote what we already have, or another program
      // changed only the encoding or line endings (taken unless we changed them too).
      if (!dirty || sameFormat(format, doc.format)) this.applyDiskText(doc, text, format);
      return;
    }
    const name = basename(doc.path);
    if (dirty) {
      doc.diskConflict = true;
      this.message(`${name} changed on disk: :reload to take it, :w to overwrite it`, "error");
      return;
    }
    this.applyDiskText(doc, text, format);
    this.message(`${name} changed on disk, reloaded (u to undo)`);
  }

  async exportDocx(path?: string) {
    const doc = this.active.doc;
    const target = path
      ? this.resolve(path)
      : doc.path
        ? doc.path.replace(/\.(md|markdown)$/i, "") + ".docx"
        : await backend.pickSave("untitled.docx", "docx");
    if (!target) return;
    // Loaded on first export: the docx library is most of the bundle.
    const { markdownToDocx } = await import("./export/docx.ts");
    const bytes = await markdownToDocx(this.stateOf(doc).doc.toString());
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
    if (key === "s" && !e.shiftKey) action = () => this.save(this.active.doc);
    else if (key === "o") action = () => this.openFile();
    else if (key === "e" && e.shiftKey) action = () => this.exportDocx();
    if (!action) return;
    e.preventDefault();
    e.stopPropagation();
    void Promise.resolve(action()).catch((err) => this.message(String(err), "error"));
  }
}

// The Helix config comes first: the theme and the keymaps depend on it.
const startupErrors: string[] = [];
let skippedKeys: string[] = [];
if (config.readHelixConfig) {
  try {
    const toml = await backend.helixConfig();
    if (toml) skippedKeys = applyHelixConfig(toml);
  } catch (err) {
    startupErrors.push(`Helix config: ${err}`);
  }
}
const themeError = await initTheme(config.theme);
if (themeError) startupErrors.push(themeError);
const app = new App();
await app.init();
const recovered = await app.restoreRecovered();
const initial = await backend.initialFile().catch(() => null);
if (initial) await app.openPath(initial).catch((e) => app.message(String(e), "error"));
else if (recovered) app.replace(app.active, recovered);
app.view.focus();
if (startupErrors.length) app.message(startupErrors.join("; "), "error");
else reportSkippedKeys(skippedKeys);

/** Says once which Helix bindings were left out, and again only when that changes. */
function reportSkippedKeys(skipped: string[]) {
  const KEY = "md-editor.skipped-keys";
  const list = skipped.join("; ");
  try {
    if (localStorage.getItem(KEY) === list) return;
    localStorage.setItem(KEY, list);
  } catch {
    // Said every time, then.
  }
  if (list) app.message(`Helix config: skipped bindings using commands this editor lacks (${list})`);
}

// Exposed for debugging from the devtools console, and for the browser tests.
Object.assign(window, { app, commands, backend });
