import { EditorSelection, EditorState, type Extension, Prec, type StateEffect, Text, Transaction } from "@codemirror/state";
import { EditorView, drawSelection, keymap, lineNumbers, type ViewUpdate } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, isolateHistory } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { languages } from "@codemirror/language-data";
import { LanguageDescription, type LanguageSupport } from "@codemirror/language";

import { parse as parseToml } from "smol-toml";
import { config } from "./config.ts";
import { backend, type DragDrop, isTauri } from "./backend.ts";
import { helixState, modeField, nextBoundaryIn, setMode, type Mode } from "./helix/state.ts";
import { helixKeys } from "./helix/dispatcher.ts";
import { normalKeys, insertKeys, mergeKeys } from "./helix/keymap.ts";
import { selectionDecorations } from "./helix/cursor.ts";
import { cursorLines } from "./helix/cursorline.ts";
import { jumpLabels } from "./helix/jumplabels.ts";
import { commands, pasteText, setSearchPattern, type Host, type WindowCommand } from "./helix/commands.ts";
import { livePreview, setTableWidths, setTotalRows, tableWidths } from "./preview/livePreview.ts";
import { frontMatterSyntax } from "./preview/frontMatterSyntax.ts";
import { wikiLinkSyntax } from "./preview/wikiLinkSyntax.ts";
import { footnoteSyntax } from "./preview/footnoteSyntax.ts";
import { mathSyntax } from "./preview/math.ts";
import { anchorLine, linkAt, MARKDOWN_PATH, resolveWiki } from "./links.ts";
import { documentPath, loadImages, rasterizeSvgs, setImageReader } from "./images.ts";
import { applyExportLook } from "./preview/exportLook.ts";
import { frontMatter, setProperty } from "./frontmatter.ts";
import { describeStyle, starterStyle, type ExportStyle } from "./export/style.ts";
import { configuredStyle, listStyles, resolveStyle, setConfiguredStyle, stylePath, type Resolved, type StyleDirs, type StyleEntry, type StyleFs } from "./export/styles.ts";
import { exportReference } from "./export/reference.ts";
import { propertyCompletions, styleCompletions, type Candidate } from "./export/complete.ts";
import { openMenu } from "./ui/menu.ts";
import { spellcheck } from "./spell.ts";
import { comments } from "./comments.ts";
import { asChange, changesOf, endReview, originalOf, replayed, reviewEffects, reviewing, reviewSlot, startReview } from "./review.ts";
import { describeSnapshot, diffPreview } from "./history.ts";
import { initZoom, setZoom, zoomLevel, zoomStep } from "./ui/zoom.ts";
import { reflow } from "./reflow.ts";
import { type Heading, headings } from "./outline.ts";
import { countNotes, countText, readable, type Readable, type Span } from "./wordCount.ts";
import { MAX_MATCHES, searchRegex, searchText, type SearchMatch } from "./search.ts";
import { clampSelection, type Jump, JumpList } from "./jumplist.ts";
import type { Snapshot, SnapshotKind } from "./backend.ts";
import { kanagawa } from "./theme/kanagawa.ts";
import { currentTheme, endThemePreview, initTheme, previewTheme, setTheme, themeNames } from "./theme/appearance.ts";
import { applyHelixConfig } from "./helixConfig.ts";
import { applySettings, readsHelixConfig, SETTINGS_TEMPLATE } from "./settings.ts";
import { altText, freeName, imageFiles, imageLink, type ImageSource, inside, isImageName, pastedName, unusedImages } from "./imageInput.ts";
import { hideDropHint, showDropHint } from "./ui/dropHint.ts";
import { openPrompt, type Completion, type PromptOptions } from "./ui/prompt.ts";
import { openPicker, type OpenHow } from "./ui/picker.ts";
import { fuzzyFilter } from "./ui/fuzzy.ts";
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
/** `to` from the folder `from`, both absolute: `../notes/a.md`. */
function relativePath(from: string, to: string): string {
  const a = from.split("/").filter(Boolean);
  const b = to.split("/").filter(Boolean);
  let same = 0;
  while (same < a.length && same < b.length - 1 && a[same] === b[same]) same++;
  return [...Array(a.length - same).fill(".."), ...b.slice(same)].join("/");
}

/** The smallest single change turning `a` into `b`, so selections survive a reload. */
function diffChange(a: string, b: string) {
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let end = 0;
  while (end < a.length - start && end < b.length - start && a[a.length - 1 - end] === b[b.length - 1 - end]) end++;
  return { from: start, to: a.length - end, insert: b.slice(start, b.length - end) };
}

/** Files edited as markdown, with the live preview; others (a style's TOML) are plain text. */
const isMarkdownPath = (path: string | null) => !path || /\.(?:md|markdown|mdown|mkd)$/i.test(path);

/** Highlighting for the other files, by language name, loaded when such a file is opened. */
const plainLanguages = new Map<string, LanguageSupport>();
/** Files a link opens in their own app rather than here. */
const EXTERNAL = /\.(?:png|jpe?g|gif|webp|svg|bmp|tiff?|heic|ico|pdf|docx?|xlsx?|pptx?|odt|ods|odp|key|pages|numbers|zip|gz|mp[34]|mov|m4a|wav|webm|html?)$/i;

/** Cmd-click (Ctrl-click elsewhere) on a link follows it, as `gf` does. */
const followOnClick = (host: { followLink(view: EditorView, pos: number): void }) =>
  EditorView.domEventHandlers({
    mousedown(e, view) {
      if (!(navigator.platform.startsWith("Mac") ? e.metaKey : e.ctrlKey) || e.button !== 0) return false;
      const pos = view.posAtCoords({ x: e.clientX, y: e.clientY });
      if (pos === null || !linkAt(view.state, pos)) return false;
      e.preventDefault();
      host.followLink(view, pos);
      return true;
    },
  });

interface ImageHost {
  insertImages(view: EditorView, images: ImageSource[], pos?: number): Promise<void>;
  pasteFromSystem(view: EditorView, text: string): Promise<void>;
}

/** Images pasted with Cmd-V, or dropped where the page sees the drop (the browser), go into the document. */
const imageInput = (host: ImageHost) =>
  Prec.highest(
    EditorView.domEventHandlers({
      paste(e, view) {
        const images = imageFiles(e.clipboardData);
        if (images.length) {
          e.preventDefault();
          void host.insertImages(view, images);
          return true;
        }
        // The webview leaves some images out of the event: ask the system when
        // there is no text, or only a file name (Finder copies a file as its name).
        const text = e.clipboardData?.getData("text/plain") ?? "";
        const fileName = isImageName(text.trim()) && !text.includes("\n");
        if (!isTauri || (text && !fileName)) return false;
        e.preventDefault();
        void host.pasteFromSystem(view, text);
        return true;
      },
      drop(e, view) {
        const images = imageFiles(e.dataTransfer);
        if (!images.length) return false;
        e.preventDefault();
        void host.insertImages(view, images, view.posAtCoords({ x: e.clientX, y: e.clientY }) ?? undefined);
        return true;
      },
    }),
  );

const languageOf = (path: string) => LanguageDescription.matchFilename(languages, basename(path));

async function loadLanguage(path: string) {
  const found = languageOf(path);
  if (found && !plainLanguages.has(found.name)) plainLanguages.set(found.name, await found.load().catch(() => []) as LanguageSupport);
}

/** At most this many files are read for the headings picker across files (`space S`). */
const MAX_HEADING_FILES = 2000;

/** How long after the last edit the crash-recovery copies are written. */
const RECOVERY_DELAY = 1000;

/** What a crash-recovery copy holds. */
interface RecoveryCopy {
  path: string | null;
  text: string;
  format: FileFormat;
  time: number;
}

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
  readonly sl: Record<"mode" | "file" | "sels" | "words" | "format" | "pos", HTMLElement>;
  /** Where C-o goes back to. */
  jumps = new JumpList<Doc>();

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
      words: span("sl-words"),
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
  /** ~/.config/markmode. */
  private configDir = "";
  /** `:export-preview`: windows show their document in its export style. */
  private exportPreview = false;
  private exportPreviewTimer: number | undefined;

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
    backend.onDragDrop((e) => this.onDragDrop(e));
    backend.onQuitRequested(() => void this.requestQuit());
    backend.onFocusLost(() => {
      if (config.autoSaveOnFocusLost) void this.writeAll(true);
    });
    window.addEventListener("keydown", (e) => this.appShortcut(e), true);
  }

  async init() {
    [this.home, this.cwd, this.configDir] = await Promise.all([
      backend.homeDir().catch(() => ""),
      backend.currentDir().catch(() => ""),
      backend.configDir().catch(() => ""),
    ]);
  }

  /** The focused editor. */
  get view(): EditorView {
    return this.active.view;
  }

  /** A new editor state; `original` is the text from before the outside changes under review. */
  private createState(doc: string | Text, path: string | null, selection?: EditorSelection, original: Text | null = null): EditorState {
    const prose = isMarkdownPath(path);
    const plain = prose ? null : plainLanguages.get(languageOf(path!)?.name ?? "");
    const extensions: Extension[] = [
      helixState,
      history({ newGroupDelay: 10 * 60_000 }),
      drawSelection(),
      EditorState.allowMultipleSelections.of(true),
      config.lineNumbers ? lineNumbers() : [],
      cursorLines(config.cursorline),
      config.softWrap ? EditorView.lineWrapping : [],
      prose ? [markdown({ base: markdownLanguage, codeLanguages: languages, extensions: [frontMatterSyntax, wikiLinkSyntax, footnoteSyntax, mathSyntax] }), livePreview, followOnClick(this), imageInput(this), documentPath.of(path)] : (plain ?? []),
      comments,
      reviewSlot(original),
      config.spellcheck && prose
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

  private addDoc(path: string | null, text: string, format = defaultFormat, original: Text | null = null): Doc {
    const doc = new Doc(path, this.createState(text, path, undefined, original), format);
    this.docs.push(doc);
    if (path) this.watch(path);
    return doc;
  }

  private removeDoc(doc: Doc) {
    void this.syncBaseline(doc);
    this.docs.splice(this.docs.indexOf(doc), 1);
    if (this.recovered.delete(doc)) void backend.recoveryRemove(doc.id).catch(() => {});
    if (doc.path) void backend.unwatch(doc.path);
    for (const w of this.layout?.windows() ?? []) w.jumps.remove(doc);
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

  /** Shows a document in a window, keeping the one it replaces as a buffer. Switching documents is a jump, as in Helix. */
  show(win: Win, doc: Doc, jump = true) {
    const old = win.doc;
    if (old === doc) return;
    if (jump && this.docs.includes(old)) win.jumps.push({ doc: old, selection: win.view.state.selection });
    if (!this.windowsShowing(old).some((w) => w !== win)) old.state = win.view.state;
    // Another window already editing it has the live text; this one gets its
    // own state on that text, kept in step by `afterTransactions`.
    const live = this.windowsShowing(doc)[0];
    win.doc = doc;
    win.view.setState(live ? this.createState(live.view.state.doc, doc.path, live.view.state.selection, reviewOriginal(live.view.state)) : doc.state);
    doc.lastAccess = ++this.clock;
    this.renderStatus(win);
    if (win === this.active) this.updateTitle();
    if (this.exportPreview) this.scheduleExportPreview();
  }

  async openPath(path: string, how: OpenHow = "replace") {
    let doc = this.docs.find((d) => d.path === path);
    if (!doc) {
      let file = { text: "", format: defaultFormat };
      let exists = true;
      try {
        const disk = await backend.readText(path);
        file = fromDisk(disk.text, disk.format);
      } catch (err) {
        exists = false;
        // A path that does not exist yet becomes a new file on the first write.
        if (!/os error 2|not found/i.test(String(err))) throw err;
        this.message(`new file ${basename(path)}`);
      }
      doc = await this.addFileDoc(path, file.text, file.format, exists);
      const changes = changesOf(doc.state).length;
      if (changes) this.message(`${basename(path)} changed since it was last open here: ${reviewHint(changes)}`);
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

  /**
   * Saves images next to the document, in the images folder, and links them at
   * `pos`, or where the cursor is. One already in the document's folder is
   * linked where it is.
   */
  async insertImages(view: EditorView, images: ImageSource[], pos?: number) {
    const win = this.layout.windows().find((w) => w.view === view);
    const path = win?.doc.path;
    if (!win || !path) return this.message("save the document first: pasted images go next to it", "error");
    const dir = dirname(path);
    const folder = config.imageFolder;
    const target = folder ? `${dir}/${folder}` : dir;
    let taken: string[] | null = null;
    const links: string[] = [];
    let saved = 0;
    for (const image of images) {
      const name = "path" in image ? basename(image.path) : image.name;
      const near = "path" in image ? inside(dir, image.path) : null;
      if (near) {
        links.push(imageLink(near, altText(name)));
        continue;
      }
      taken ??= (await backend.listDir(target).catch(() => [])).map((e) => e.name);
      const free = freeName(name, taken);
      taken.push(free);
      const bytes = "path" in image ? await backend.readBytes(image.path) : new Uint8Array(await image.data.arrayBuffer());
      await backend.createDir(target);
      await backend.writeBytes(`${target}/${free}`, bytes);
      links.push(imageLink(folder ? `${folder}/${free}` : free, altText(free)));
      saved++;
    }
    const text = links.join("\n");
    const insertMode = view.state.field(modeField) === "insert";
    if (pos !== undefined) {
      view.dispatch({
        changes: { from: pos, insert: text },
        selection: insertMode ? EditorSelection.cursor(pos + text.length) : EditorSelection.single(pos, pos + text.length),
        userEvent: "input.drop",
      });
    } else if (insertMode) {
      view.dispatch(view.state.replaceSelection(text), { userEvent: "input.paste", scrollIntoView: true });
    } else {
      pasteText(view, text);
    }
    this.focus(win);
    const n = images.length > 1 ? `${images.length} images` : "image";
    this.message(saved ? `${n} saved in ${folder || "the document's folder"}/` : `${n} linked`);
  }

  /**
   * The images in the document's images folder that no markdown file in the
   * workspace mentions (open buffers as they are, unsaved changes included);
   * with `trash`, moves them to the Trash, where they can be put back from.
   */
  private async cleanImages(trash: boolean) {
    const path = this.active.doc.path;
    const folder = config.imageFolder;
    if (!path) return this.message("images-clean: save the document first", "error");
    if (!folder) return this.message("images-clean: no images folder ([images] folder in your settings)", "error");
    const dir = `${dirname(path)}/${folder}`;
    const names = (await backend.listDir(dir).catch(() => []))
      .filter((e) => !e.isDir && isImageName(e.name))
      .map((e) => e.name);
    if (!names.length) return this.message(`no images in ${folder}/`);
    const root = await backend.workspaceRoot(dirname(path)).catch(() => dirname(path));
    const base = root.endsWith("/") ? root : `${root}/`;
    const files = (await backend.listFiles(root)).filter((rel) => MARKDOWN_PATH.test(rel)).map((rel) => base + rel);
    const texts = await Promise.all(files.map(async (p) => (await this.styleFs.read(p)) ?? ""));
    for (const doc of this.docs) {
      if (doc.path && MARKDOWN_PATH.test(doc.path) && !files.includes(doc.path)) texts.push(this.stateOf(doc).doc.toString());
    }
    const unused = unusedImages(names, texts);
    if (!unused.length) return this.message(`every image in ${folder}/ is used`);
    const n = unused.length > 1 ? `${unused.length} images` : "1 image";
    if (!trash) return this.message(`${n} in ${folder}/ no markdown file uses: ${unused.join(", ")} (:images-clean! moves them to the Trash)`);
    const paths = unused.map((name) => `${dir}/${name}`);
    // Kept aside too, so a link that comes back (a version from the history,
    // an undo) brings its image back: see readImage.
    await backend.imagesSetAside(paths);
    // A folder left with nothing in it (but Finder's .DS_Store) goes as a whole.
    const left = (await backend.listDir(dir)).filter((e) => !unused.includes(e.name) && e.name !== ".DS_Store");
    await backend.trashFiles(left.length ? paths : [dir]);
    this.message(`moved ${left.length ? n : `${folder}/, with ${n},`} to the Trash: ${unused.join(", ")}`);
  }

  /** Pastes what the paste event left out: images copied in Finder, or an image (a screenshot); else the text. */
  async pasteFromSystem(view: EditorView, text: string) {
    try {
      const files = (await backend.clipboardFiles()).filter(isImageName);
      if (files.length) return await this.insertImages(view, files.map((path) => ({ path })));
      const png = await backend.clipboardImage();
      if (png.length) return await this.insertImages(view, [{ name: pastedName("image/png"), data: new Blob([png as BlobPart]) }]);
    } catch (err) {
      return this.message(`paste: ${err}`, "error");
    }
    if (!text) return this.message("nothing to paste: the clipboard holds no text or image");
    if (view.state.field(modeField) === "insert") view.dispatch(view.state.replaceSelection(text), { userEvent: "input.paste", scrollIntoView: true });
    else pasteText(view, text);
  }

  private dragPaths: string[] = [];

  /** Files dragged from Finder: a hint while they are over the window, then the drop. */
  private onDragDrop(e: DragDrop) {
    if (e.type === "enter") this.dragPaths = e.paths;
    if (e.type === "leave" || e.type === "drop") {
      hideDropHint();
      this.dragPaths = [];
    }
    if (e.type === "leave") return;
    if (e.type === "drop") {
      void this.onFileDrop(e.paths, e.x, e.y).catch((err) => this.message(String(err), "error"));
      return;
    }
    const { win, images, others, pos } = this.dropPlan(this.dragPaths, e.x, e.y);
    const path = win.doc.path;
    const parts: string[] = [];
    if (images.length && !path) parts.push("save the document first to insert images");
    else if (images.length) {
      const copied = images.filter((p) => !inside(dirname(path!), p)).length;
      const n = images.length > 1 ? `${images.length} images` : "image";
      parts.push(`insert ${n}${copied ? ` (${copied < images.length ? "some " : ""}copied to ${config.imageFolder || "the document's folder"}/)` : ""}`);
    }
    if (others.length) parts.push(`open ${others.length > 1 ? `${others.length} files` : basename(others[0])}`);
    const text = parts.join(", ");
    const coords = pos !== null && path ? win.view.coordsAtPos(pos) : null;
    showDropHint(
      win.el.getBoundingClientRect(),
      text.charAt(0).toUpperCase() + text.slice(1),
      coords && { left: coords.left - 1, top: coords.top, height: coords.bottom - coords.top },
    );
  }

  /** What dropping `paths` at (x, y) does: the window under it, the images linked there (and where), the files opened. */
  private dropPlan(paths: string[], x: number, y: number) {
    const under = document.elementFromPoint(x, y);
    const win = this.layout.windows().find((w) => w.el.contains(under)) ?? this.active;
    const images = isMarkdownPath(win.doc.path) ? paths.filter(isImageName) : [];
    const others = paths.filter((p) => !images.includes(p));
    const pos = images.length ? win.view.posAtCoords({ x, y }, false) : null;
    return { win, images, others, pos };
  }

  /** Files dropped from Finder: images go into the markdown document under the pointer, other files open. */
  private async onFileDrop(paths: string[], x: number, y: number) {
    const { win, images, others, pos } = this.dropPlan(paths, x, y);
    if (images.length) await this.insertImages(win.view, images.map((path) => ({ path })), pos ?? undefined);
    if (others.length) this.focus(win);
    for (const path of others) {
      if (EXTERNAL.test(path)) await backend.openExternal(path);
      else await this.openPath(path);
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

  /**
   * Replays edits, and changes to the review, into the other windows showing
   * the same document. Ends the review once no change is left to review.
   */
  private afterTransactions(win: Win, trs: readonly Transaction[]) {
    if (trs.some((tr) => tr.docChanged)) this.scheduleRecovery();
    let reviewed = false;
    for (const tr of trs) {
      if (tr.docChanged && !tr.annotation(replayed)) {
        for (const w of this.layout?.windows() ?? []) w.jumps.map(win.doc, tr.changes);
      }
      const effects = reviewEffects(tr);
      reviewed ||= tr.docChanged || effects.length > 0;
      if ((!tr.docChanged && !effects.length) || tr.annotation(replayed)) continue;
      for (const other of this.windowsShowing(win.doc)) {
        if (other === win) continue;
        // Undo stays per window: each one undoes its own edits.
        other.view.dispatch({ changes: tr.changes, effects, annotations: [replayed.of(true), Transaction.addToHistory.of(false)] });
      }
    }
    if (reviewed) this.scheduleRecovery();
    const { state } = win.view;
    if (reviewed && reviewing(state) && !changesOf(state).length) queueMicrotask(() => this.endReview(win.doc));
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
    const win = this.createWindow(from.doc, this.createState(state.doc, from.doc.path, state.selection, reviewOriginal(state)));
    win.jumps = from.jumps.clone();
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
    // A style edited, or another one named, shows as it is typed.
    if (u.docChanged && this.exportPreview && (!isMarkdownPath(win.doc.path) || u.changes.touchesRange(0, 2000))) this.scheduleExportPreview();
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
    this.renderWords(win);
  }

  // ── Word counts ────────────────────────────────────────────────────────────

  private readables = new WeakMap<Text, { text: string; readable: Readable; words: number }>();
  private wordsTimer: number | undefined;

  /** What a reader sees of a document, worked out once for each version of it. */
  private readableOf(doc: Text) {
    let r = this.readables.get(doc);
    if (!r) {
      const text = doc.toString();
      const shown = readable(text);
      r = { text, readable: shown, words: countText(text, shown).words };
      this.readables.set(doc, r);
    }
    return r;
  }

  /** The selections, unless there is only a cursor (Helix's is one character wide). */
  private selected(state: EditorState): Span[] | undefined {
    const ranges = state.selection.ranges.filter((r) => r.to - r.from > 1);
    return ranges.length ? ranges.map((r): Span => [r.from, r.to]) : undefined;
  }

  /**
   * The status line's word count: the document's, or the selection's of it.
   * A long document is counted once typing pauses; the last count stays meanwhile.
   */
  private renderWords(win: Win) {
    const { state } = win.view;
    if (!isMarkdownPath(win.doc.path)) return void (win.sl.words.textContent = "");
    // About 3 ms at this length.
    if (!this.readables.has(state.doc) && state.doc.length > 30_000) {
      clearTimeout(this.wordsTimer);
      this.wordsTimer = window.setTimeout(() => {
        for (const w of this.layout.windows()) this.renderWords(w);
      }, 300);
      return;
    }
    const { text, readable, words: all } = this.readableOf(state.doc);
    const n = (count: number) => count.toLocaleString("en-US");
    const ranges = this.selected(state);
    const words = (count: number) => `${n(count)} word${count === 1 ? "" : "s"}`;
    win.sl.words.textContent = ranges ? `${n(countText(text, readable, ranges).words)} of ${words(all)}` : words(all);
  }

  /** `:word-count`: the counts of the document, or of the selection, in full. */
  private wordCount() {
    const state = this.view.state;
    const { text, readable } = this.readableOf(state.doc);
    const n = (count: number) => count.toLocaleString("en-US");
    const ranges = this.selected(state);
    const c = countText(text, readable, ranges);
    const parts = [`${n(c.words)} words`, `${n(c.characters)} characters (${n(c.charactersNoSpaces)} without spaces)`];
    if (!ranges && readable.noteCount) {
      const notes = countNotes(text, readable);
      parts.push(`${n(notes.words)} more in ${readable.noteCount} footnote${readable.noteCount === 1 ? "" : "s"}`);
    }
    // At 230 words a minute, as adults read on average.
    parts.push(`about ${Math.max(1, Math.round(c.words / 230))} min to read`);
    this.message(`${ranges ? "selection: " : ""}${parts.join(", ")}`);
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
      fuzzyFilter(arg, names, (n) => n).map((n) => ({ insert: n, from: space + 1, label: n }));
    if (typable?.args === "theme") return choices(await themeNames());
    if (typable?.args === "encoding") return choices(encodings);
    if (typable?.args === "line-ending") return choices(lineEndings);
    if (typable?.args === "zoom") return choices(["in", "out", "reset", "100", "125", "150"]);
    if (typable?.args === "table-widths") return choices(["reset"]);
    if (typable?.args === "export-style" || typable?.args === "style-name") {
      const names = (await listStyles(this.styleFs, await this.styleDirs(this.active.doc))).map((e) => e.name);
      return choices(typable.args === "export-style" ? [...names, "reset"] : names);
    }
    if (typable?.args !== "path") return [];
    const slash = arg.lastIndexOf("/");
    const dirPart = arg.slice(0, slash + 1);
    const prefix = arg.slice(slash + 1);
    const dir = this.resolve(dirPart || ".");
    const entries = await backend.listDir(dir).catch(() => []);
    const shown = entries.filter((e) => prefix.startsWith(".") || !e.name.startsWith("."));
    return fuzzyFilter(prefix, shown, (e) => e.name)
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
        case "export-style":
          if (!arg) return await this.stylePicker();
          return await this.setDocStyle(arg === "reset" ? null : arg);
        case "export-style-default":
          return await this.setDefaultStyle(arg ?? "");
        case "export-style-new":
          return await this.newStyle(arg ?? "");
        case "export-style-open":
          return await this.openStyle(arg ?? "");
        case "export-preview":
          this.exportPreview = !this.exportPreview;
          await this.refreshExportPreview();
          return this.message(this.exportPreview ? "export preview: on" : "export preview: off");
        case "export-help":
          this.show(this.active, this.addDoc(null, `# Export reference\n\n${exportReference()}`));
          return this.message("the export reference, as a scratch buffer");
        case "export-docx":
          return await this.exportDocx(arg);
        case "export-html":
          return await this.exportDocx(arg, "html");
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
          if (!this.configDir) return this.message("config-open: no config directory here", "error");
          const path = `${this.configDir}/config.toml`;
          if ((await this.styleFs.read(path)) === null) {
            await backend.createDir(this.configDir);
            await backend.writeText(path, SETTINGS_TEMPLATE);
          }
          await this.openPath(path);
          return this.message(
            skippedKeys.length
              ? `skipped bindings, using commands this editor lacks: ${skippedKeys.join("; ")}`
              : "changes apply on the next start",
          );
        }
        case "config-open-helix": {
          const path = await backend.helixConfigPath();
          if (!path) return this.message("no Helix config here", "error");
          await this.openPath(path);
          return this.message(config.readHelixConfig ? "changes apply on the next start" : "not read: read-helix-config = false in your settings");
        }
        case "zoom": {
          if (!arg) return this.message(`zoom ${Math.round(zoomLevel() * 100)}%`);
          const percent = Number(arg.replace(/%$/, ""));
          if (arg === "in" || arg === "out" || arg === "reset") return this.zoom(arg);
          if (!percent) return this.message("zoom: in, out, reset or a percentage", "error");
          return this.zoom(percent / 100);
        }
        case "history":
          return this.historyPicker();
        case "images-clean":
          return await this.cleanImages(force);
        case "word-count":
          return this.wordCount();
        case "reflow": {
          const width = arg ? Number(arg) : config.textWidth;
          if (!(width > 0)) return this.message("reflow: a width in characters", "error");
          return this.reflow(width);
        }
        case "table-widths": {
          const view = this.view;
          const pos = view.state.selection.main.head > view.state.selection.main.anchor ? view.state.selection.main.head - 1 : view.state.selection.main.head;
          let widths: number[] | null;
          if (arg === "reset") widths = null;
          else if (arg) {
            const numbers = arg.split(/[\s,]+/).map((n) => parseFloat(n.replace(/%$/, "")));
            if (numbers.some((n) => !(n > 0))) return this.message("table-widths: widths as numbers, like 20 30 50", "error");
            widths = numbers;
          } else widths = tableWidths(view, pos);
          if (!setTableWidths(view, pos, widths)) return this.message("table-widths: the cursor is not in a table", "error");
          return;
        }
        case "reset-diff-change":
          return await this.runCommand("reject_change");
        case "accept-all-changes":
          return await this.runCommand("accept_all_changes");
        case "reject-all-changes":
          return await this.runCommand("reject_all_changes");
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

  /**
   * Rewraps the lines under the selections; a selection that is only the
   * cursor takes its paragraph (Helix takes the line, which here is often a
   * whole paragraph anyway).
   */
  private reflow(width: number) {
    const { state } = this.view;
    const doc = state.doc;
    const blank = (n: number) => !doc.line(n).text.trim();
    const spans: [number, number][] = [];
    for (const r of state.selection.ranges) {
      let first = doc.lineAt(r.from).number;
      let last = doc.lineAt(r.to > r.from + 1 ? r.to - 1 : r.from).number;
      if (r.to - r.from <= 1) {
        while (first > 1 && !blank(first - 1)) first--;
        while (last < doc.lines && !blank(last + 1)) last++;
      }
      const prev = spans[spans.length - 1];
      if (prev && first <= prev[1] + 1) prev[1] = Math.max(prev[1], last);
      else spans.push([first, last]);
    }
    const changes = spans
      .map(([first, last]) => {
        const from = doc.line(first).from;
        const to = doc.line(last).to;
        return { from, to, insert: reflow(doc.sliceString(from, to), width) };
      })
      .filter((c) => c.insert !== doc.sliceString(c.from, c.to));
    if (!changes.length) return this.message(`already within ${width} characters`);
    this.view.dispatch({ changes, userEvent: "input.reflow", scrollIntoView: true });
  }

  /** Runs a key command from the command line. */
  private async runCommand(name: string) {
    await commands[name]({ view: this.view, host: this, count: 1, hasCount: false, readChar: () => {} });
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
    this.pushJump(this.view, this.view.state.selection);
    this.view.dispatch({ selection: EditorSelection.cursor(line.from), scrollIntoView: true });
  }

  private async quitAll(force: boolean) {
    const dirty = this.docs.filter((d) => this.isDirty(d));
    if (!force && dirty.length) return this.unsavedError(dirty, ":q!");
    await this.exit();
  }

  /** Quits, keeping what each file is reviewed against for the next start. */
  private async exit() {
    await Promise.all(this.docs.map((d) => this.syncBaseline(d)));
    await backend.exit();
  }

  /** The close button, Cmd-W or Cmd-Q: asks before dropping unsaved changes. */
  private async requestQuit() {
    const dirty = this.docs.filter((d) => this.isDirty(d));
    if (!dirty.length) return this.exit();
    const answer = await backend.askUnsaved(dirty.map((d) => this.docName(d)));
    if (answer === "discard") return this.exit();
    if (answer === "save" && (await this.writeAll(false))) return this.exit();
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
    for (const doc of this.docs) await this.syncBaseline(doc);
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
        doc = copy.path ? await this.addFileDoc(copy.path, disk.text, disk.format, true) : this.addDoc(null, disk.text, disk.format);
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
    this.snapshot(target, text.toString(), "saved");
    this.scheduleRecovery();
    this.renderAllStatus();
    const settings = this.configDir && target === `${this.configDir}/config.toml`;
    this.message(`written ${basename(target)} (${text.lines} lines)${settings ? ", settings apply on the next start" : ""}`);
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
    const changes = this.applyDiskText(doc, text, format);
    this.message(`reloaded ${basename(doc.path)}${changes ? `: ${reviewHint(changes)}` : ""}`);
  }

  /** Takes the file's text as it is on disk; returns the number of changes to review. */
  private applyDiskText(doc: Doc, text: string, format: FileFormat): number {
    const changes = this.takeText(doc, text, "reload");
    doc.savedDoc = this.stateOf(doc).doc;
    doc.format = doc.savedFormat = format;
    doc.diskConflict = false;
    this.scheduleRecovery();
    this.renderAllStatus();
    return changes;
  }

  /**
   * Replaces a document's text with an edit rather than a fresh document, so
   * selections stay put and `u` can undo it, and opens a review of what it
   * changed (unless one is open already, which then takes in these changes).
   * Returns the number of changes to review.
   */
  private takeText(doc: Doc, text: string, userEvent: string): number {
    const state = this.stateOf(doc);
    const current = state.doc;
    if (text !== current.toString()) {
      const effects: StateEffect<unknown>[] = [asChange.of(null)];
      // Through the current window when it shows the document: `u` undoes it there.
      const wins = this.windowsShowing(doc).sort((a, b) => Number(b === this.active) - Number(a === this.active));
      const [first, ...others] = wins;
      if (!reviewing(state)) {
        effects.push(startReview(current));
        for (const w of others) w.view.dispatch({ effects: startReview(current) });
      }
      const spec = { changes: diffChange(current.toString(), text), effects, annotations: isolateHistory.of("full"), userEvent };
      if (first) first.view.dispatch(spec);
      else doc.state = doc.state.update(spec).state;
    }
    const after = this.stateOf(doc);
    if (reviewing(after) && !changesOf(after).length) this.endReview(doc);
    return changesOf(this.stateOf(doc)).length;
  }

  private endReview(doc: Doc) {
    const wins = this.windowsShowing(doc);
    for (const w of wins) if (reviewing(w.view.state)) w.view.dispatch({ effects: endReview() });
    if (!wins.length && reviewing(doc.state)) doc.state = doc.state.update({ effects: endReview() }).state;
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
    if (text !== this.stateOf(doc).doc.toString()) this.snapshot(doc.path, text, "outside");
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
    const changes = this.applyDiskText(doc, text, format);
    this.message(`${name} changed on disk: ${reviewHint(changes)}`);
  }

  // ── Version history ────────────────────────────────────────────────────────

  /**
   * A buffer for a file just read. What changed in it since it was last seen
   * here (or since the changes still pending when the app quit) is up for review.
   */
  private async addFileDoc(path: string, text: string, format: FileFormat, exists: boolean): Promise<Doc> {
    if (!isMarkdownPath(path)) await loadLanguage(path);
    const seen = exists ? ((await backend.historyBaseline(path).catch(() => null)) ?? (await this.lastVersion(path))) : null;
    const original = seen !== null && seen !== text ? Text.of(seen.split("\n")) : null;
    const doc = this.addDoc(path, text, format, original);
    if (text) this.snapshot(path, text, original ? "outside" : "opened");
    if (original && !changesOf(doc.state).length) doc.state = doc.state.update({ effects: endReview() }).state;
    if (seen !== null) this.baselines.set(doc, original ?? doc.savedDoc);
    this.scheduleRecovery();
    return doc;
  }

  /** Baselines as last written, by document. */
  private baselines = new Map<Doc, Text>();

  /**
   * Writes down what the file's changes are reviewed against (see
   * history.rs): the text from before the changes under review, or else the
   * file as last seen here. Reopening it reviews what differs, so changes
   * left pending at quitting stay pending.
   */
  private async syncBaseline(doc: Doc) {
    if (!doc.path) return;
    const state = this.stateOf(doc);
    const baseline = reviewing(state) ? originalOf(state) : doc.savedDoc;
    const written = this.baselines.get(doc);
    if (written === baseline || written?.eq(baseline)) return;
    this.baselines.set(doc, baseline);
    await backend.historySetBaseline(doc.path, baseline.toString()).catch(() => this.baselines.delete(doc));
  }

  /** The text the file had when this app last saw it, from the version history. */
  private async lastVersion(path: string): Promise<string | null> {
    try {
      const [latest] = await backend.historyList(path);
      return latest ? await backend.historyRead(path, latest.id) : null;
    } catch {
      return null;
    }
  }

  private snapshot(path: string, text: string, kind: SnapshotKind) {
    void backend.historyAdd(path, text, kind).catch((e) => this.message(`no version history for ${basename(path)}: ${e}`, "error"));
  }

  /**
   * The versions kept of the current file, previewed as what changed since.
   * Enter brings one back as an edit to review; C-s and C-v open it beside.
   */
  historyPicker() {
    const doc = this.active.doc;
    const path = doc.path;
    if (!path) return this.message("a scratch buffer has no history", "error");
    const read = (s: Snapshot) => backend.historyRead(path, s.id);
    openPicker<Snapshot>(
      {
        title: `versions of ${basename(path)}`,
        items: backend.historyList(path),
        text: (s) => describeSnapshot(s),
        preview: async (s) => diffPreview(await read(s), this.stateOf(doc).doc.toString()),
        onSelect: (s, how) =>
          void read(s)
            .then((text) => this.restoreVersion(doc, s, text, how))
            .catch((e) => this.message(String(e), "error")),
      },
      () => this.view.focus(),
    );
  }

  private restoreVersion(doc: Doc, s: Snapshot, text: string, how: OpenHow) {
    if (!this.docs.includes(doc)) return;
    const when = describeSnapshot(s).split("  ")[0];
    if (how !== "replace") {
      const win = this.split(how === "vsplit" ? "row" : "column");
      this.show(win, this.addDoc(null, text));
      return this.message(`the version of ${basename(doc.path ?? "")} from ${when}, as a scratch buffer`);
    }
    if (this.active.doc !== doc) this.show(this.active, doc);
    const changes = this.takeText(doc, text, "restore");
    this.renderAllStatus();
    if (!changes) return this.message("that version is the current text");
    this.message(`brought back the version from ${when}: ${reviewHint(changes)}; :w writes it`);
  }

  // ── Headings ───────────────────────────────────────────────────────────────

  /**
   * `space s`: the headings of the current document, to jump to a section.
   * `space S`: the headings of every markdown file under the workspace root,
   * as `space f` lists them.
   */
  async headingPicker(workspace: boolean) {
    const doc = this.active.doc;
    if (!workspace) {
      const text = this.stateOf(doc).doc.toString();
      openPicker<Heading>(
        {
          title: `headings of ${this.docName(doc)}`,
          items: headings(text),
          text: (h) => h.title,
          tree: { depth: (h) => h.path.length - 1, parent: (h) => h.parent },
          preview: (h) => ({ text, line: h.line }),
          onSelect: (h, how) => this.gotoHeading(doc, h.line, how),
        },
        () => this.view.focus(),
      );
      return;
    }
    const base = this.baseDir();
    const root = await backend.workspaceRoot(base).catch(() => base);
    const join = (rel: string) => (root.endsWith("/") ? root : root + "/") + rel;
    // Each file, then its headings under it.
    type Entry = { path: string; rel: string; text: string; heading: Heading | null; file: Entry | null };
    const entries = new Map<Heading, Entry>();
    const items = async (): Promise<Entry[]> => {
      const files = (await backend.listFiles(root)).filter((rel) => /\.(?:md|markdown|mdx?)$/i.test(rel)).slice(0, MAX_HEADING_FILES);
      const read = await Promise.all(
        files.map(async (rel) => {
          const path = join(rel);
          const open = this.docs.find((d) => d.path === path);
          if (open) return { path, rel, text: this.stateOf(open).doc.toString() };
          try {
            const disk = await backend.readText(path);
            return { path, rel, text: fromDisk(disk.text, disk.format).text };
          } catch {
            return { path, rel, text: "" };
          }
        }),
      );
      return read.flatMap((f) => {
        const file: Entry = { ...f, heading: null, file: null };
        const under = headings(f.text).map((heading) => {
          const entry = { ...f, heading, file };
          entries.set(heading, entry);
          return entry;
        });
        return [file, ...under];
      });
    };
    openPicker<Entry>(
      {
        title: `headings under ${this.home && root.startsWith(this.home) ? "~" + root.slice(this.home.length) : root}`,
        items: items(),
        text: (e) => e.heading?.title ?? e.rel,
        tree: {
          depth: (e) => (e.heading ? e.heading.path.length : 0),
          parent: (e) => (e.heading ? (e.heading.parent ? entries.get(e.heading.parent)! : e.file) : null),
        },
        rowClass: (e) => (e.heading ? "" : "pk-group"),
        preview: (e) => ({ text: e.text, line: e.heading?.line ?? 1 }),
        onSelect: (e, how) => {
          const line = e.heading?.line ?? 1;
          const open = this.docs.find((d) => d.path === e.path);
          if (open && open === this.active.doc) return this.gotoHeading(open, line, how);
          void this.openPath(e.path, how)
            .then(() => e.heading && this.selectLine(this.active, line))
            .catch((err) => this.message(String(err), "error"));
        },
      },
      () => this.view.focus(),
    );
  }

  // ── Links ──────────────────────────────────────────────────────────────────

  /**
   * `gf` and Cmd-click: opens what the link at `pos` (else under the
   * cursor) points to. A markdown file opens here, at the heading its anchor
   * names; an address, or a file this editor does not edit, opens in its app.
   * A wiki-link finds its note by name under the workspace root; one not
   * found yet is a new note beside the document.
   */
  async followLink(view: EditorView, pos?: number) {
    const win = this.layout.windows().find((w) => w.view === view);
    if (win && win !== this.active) this.focus(win);
    const { state } = view;
    const sel = state.selection.main;
    const target = linkAt(state, pos ?? (state.field(modeField) !== "insert" && sel.head > sel.anchor ? sel.head - 1 : sel.head));
    if (!target) return this.message("no link under the cursor", "error");
    if (target.kind === "footnote") {
      const text = state.doc.toString();
      const label = target.label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const m = (target.note ? new RegExp(`\\[\\^${label}\\](?!:)`) : new RegExp(`^ {0,3}\\[\\^${label}\\]:[ \\t]?`, "m")).exec(text);
      if (!m) return this.message(target.note ? "nothing refers to this footnote" : `no note for footnote ${target.label}`, "error");
      const at = m.index + (target.note ? 0 : m[0].length);
      this.pushJump(view, state.selection);
      view.dispatch({ selection: EditorSelection.cursor(at), effects: EditorView.scrollIntoView(at, { y: "center" }), userEvent: "select" });
      return;
    }
    try {
      if (target.kind === "url") return await backend.openExternal(target.url);
      const dir = this.baseDir();
      let path: string;
      if (target.kind === "wiki") {
        const root = await backend.workspaceRoot(dir).catch(() => dir);
        const prefix = root.endsWith("/") ? root : root + "/";
        const files = await backend.listFiles(root).catch(() => []);
        const rel = target.name ? resolveWiki(target.name, files, dir.startsWith(prefix) ? dir.slice(prefix.length) : "") : null;
        path = rel ? prefix + rel : target.name ? this.resolve(MARKDOWN_PATH.test(target.name) ? target.name : `${target.name}.md`) : this.active.doc.path!;
      } else if (!target.path) {
        // `#heading`: in this document.
        if (!this.active.doc.path) return this.gotoAnchor(target.anchor);
        path = this.active.doc.path;
      } else {
        path = this.resolve(target.path);
        if (!/\.[^/]+$/.test(path)) path += ".md";
      }
      if (EXTERNAL.test(path)) return await backend.openExternal(path);
      const here = path === this.active.doc.path;
      if (!here) {
        this.pushJump(this.view, this.view.state.selection);
        await this.openPath(path);
      }
      this.gotoAnchor(target.anchor, here);
    } catch (err) {
      this.message(String(err), "error");
    }
  }

  /** Moves to the heading `anchor` names in the current document; `jump` keeps where it was in the jumplist. */
  private gotoAnchor(anchor: string, jump = true) {
    if (!anchor) return;
    const line = anchorLine(this.view.state.doc.toString(), anchor);
    if (line === null) return this.message(`no heading #${anchor}`, "error");
    if (jump) this.pushJump(this.view, this.view.state.selection);
    this.selectLine(this.active, line);
  }

  // ── Global search ──────────────────────────────────────────────────────────

  /**
   * `space /`: the lines matching a regex in the files under the workspace
   * root, as the pattern is typed. Buffers with unsaved changes are searched
   * as they are here, not as on disk. The chosen match is selected, and
   * becomes the pattern `n` and `N` look for.
   */
  async globalSearch() {
    const base = this.baseDir();
    const root = await backend.workspaceRoot(base).catch(() => base);
    const dir = root.endsWith("/") ? root : root + "/";
    // The pattern the listed matches are for.
    let pattern = "";
    openPicker<SearchMatch>(
      {
        title: `search ${this.home && root.startsWith(this.home) ? "~" + root.slice(this.home.length) : root}`,
        items: [],
        search: async (p) => {
          const re = searchRegex(p);
          const found = await backend.searchFiles(root, p);
          pattern = p;
          const unsaved = this.docs.filter((d) => d.path?.startsWith(dir) && this.isDirty(d));
          if (!unsaved.length) return found;
          const rels = new Set(unsaved.map((d) => d.path!.slice(dir.length)));
          const here = unsaved.flatMap((d) => searchText(d.path!.slice(dir.length), this.stateOf(d).doc.toString(), re));
          return [...found.filter((m) => !rels.has(m.path)), ...here].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : a.line - b.line));
        },
        text: (m) => m.text,
        matched: (m) => [m.from, m.to],
        found: (n) => (n >= MAX_MATCHES ? `first ${MAX_MATCHES} matches` : n === 1 ? "1 match" : `${n} matches`),
        prefix: (m) => `${m.path}:${m.line}`,
        preview: async (m) => {
          const open = this.docs.find((d) => d.path === dir + m.path);
          if (open) return { text: this.stateOf(open).doc.toString(), line: m.line };
          try {
            const disk = await backend.readText(dir + m.path);
            return { text: fromDisk(disk.text, disk.format).text, line: m.line };
          } catch (err) {
            return { text: String(err) };
          }
        },
        onSelect: (m, how) => {
          if (how === "replace") this.pushJump(this.view, this.view.state.selection);
          void this.openPath(dir + m.path, how)
            .then(() => this.selectMatch(this.active, m.line, pattern))
            .catch((err) => this.message(String(err), "error"));
        },
      },
      () => this.view.focus(),
    );
  }

  /** Selects the first match of `pattern` on line `n`, or the line's start without one. */
  private selectMatch(win: Win, n: number, pattern: string) {
    const { doc } = win.view.state;
    const line = doc.line(Math.max(1, Math.min(n, doc.lines)));
    let m: RegExpExecArray | null = null;
    try {
      m = searchRegex(pattern).exec(line.text);
    } catch {}
    if (pattern) setSearchPattern(pattern);
    const from = line.from + (m?.index ?? 0);
    win.view.dispatch({
      selection: m?.[0] ? EditorSelection.range(from, from + m[0].length) : EditorSelection.cursor(from),
      effects: EditorView.scrollIntoView(from, { y: "center" }),
      userEvent: "select",
    });
  }

  private gotoHeading(doc: Doc, line: number, how: OpenHow) {
    if (!this.docs.includes(doc)) return;
    this.pushJump(this.view, this.view.state.selection);
    const win = how === "replace" ? this.active : this.split(how === "vsplit" ? "row" : "column");
    this.show(win, doc);
    this.selectLine(win, line);
    this.focus(win);
  }

  /** Puts the cursor at the start of a line, with the line near the top of the window: the start of a section. */
  private selectLine(win: Win, n: number) {
    const { doc } = win.view.state;
    const line = doc.line(Math.max(1, Math.min(n, doc.lines)));
    win.view.dispatch({
      selection: EditorSelection.cursor(line.from),
      effects: EditorView.scrollIntoView(line.from, { y: "start", yMargin: 48 }),
      userEvent: "select",
    });
  }

  // ── Jumplist ───────────────────────────────────────────────────────────────

  pushJump(view: EditorView, before: EditorSelection) {
    const win = this.layout.windows().find((w) => w.view === view);
    if (win) win.jumps.push({ doc: win.doc, selection: before });
  }

  jumpBackward(count: number) {
    const win = this.active;
    const jump = win.jumps.backward({ doc: win.doc, selection: win.view.state.selection }, count);
    if (!jump) return this.message("no earlier jump");
    this.goJump(win, jump);
  }

  jumpForward(count: number) {
    const win = this.active;
    const jump = win.jumps.forward(count);
    if (!jump) return this.message("no later jump");
    this.goJump(win, jump);
  }

  saveSelection() {
    const win = this.active;
    win.jumps.push({ doc: win.doc, selection: win.view.state.selection });
    this.message("selection saved to the jumplist");
  }

  private goJump(win: Win, jump: Jump<Doc>) {
    if (!this.docs.includes(jump.doc)) return;
    this.show(win, jump.doc, false);
    const { view } = win;
    const selection = clampSelection(jump.selection, view.state.doc.length);
    const head = selection.main.head;
    const visible = view.visibleRanges.some((r) => head >= r.from && head <= r.to);
    view.dispatch({
      selection,
      effects: visible ? [] : EditorView.scrollIntoView(head, { y: "center" }),
      userEvent: "select",
    });
  }

  // ── Export styles ──────────────────────────────────────────────────────────

  /** Style files, read from their buffer when one is open, so edits apply before they are saved. */
  private styleFs: StyleFs = {
    read: async (path) => {
      const open = this.docs.find((d) => d.path === path);
      if (open) return this.stateOf(open).doc.toString();
      return backend.readText(path).then(
        (f) => f.text,
        () => null,
      );
    },
    list: (dir) =>
      backend.listDir(dir).then(
        (entries) => entries.filter((e) => !e.isDir).map((e) => e.name),
        () => [],
      ),
  };

  /** Where a document's styles are: its project's `.markmode` and ~/.config/markmode. */
  private async styleDirs(doc: Doc): Promise<StyleDirs> {
    const dir = doc.path ? dirname(doc.path) : null;
    const root = dir ? await backend.workspaceRoot(dir).catch(() => dir) : null;
    return { project: root ? `${root === "/" ? "" : root}/.markmode` : null, user: this.configDir || null };
  }

  /** The name a document's style goes by: its front matter's, else the configured one. */
  private async styleNameOf(doc: Doc, dirs: StyleDirs): Promise<string> {
    const { doc: text } = this.stateOf(doc);
    const named = frontMatter(text.sliceString(0, 20_000))?.fields.style;
    return typeof named === "string" && named.trim() ? named.trim() : await configuredStyle(this.styleFs, dirs);
  }

  private async styleOf(doc: Doc): Promise<Resolved & { name: string }> {
    const dirs = await this.styleDirs(doc);
    const name = await this.styleNameOf(doc, dirs);
    return { ...(await resolveStyle(name, this.styleFs, dirs)), name };
  }

  /** Names the style in the document's front matter; null removes it. */
  private async setDocStyle(name: string | null) {
    const view = this.view;
    if (!isMarkdownPath(this.active.doc.path)) return this.message("export-style: not a markdown file", "error");
    if (name) {
      const known = await listStyles(this.styleFs, await this.styleDirs(this.active.doc));
      if (!known.some((e) => e.name === name)) return this.message(`no export style named ${name} (:export-style-new ${name} starts one)`, "error");
    }
    const change = setProperty(view.state.doc.toString(), "style", name);
    if (change) view.dispatch({ changes: change, userEvent: "input.export-style" });
    this.message(name ? `export style: ${name}` : "export style: the default one");
  }

  private async stylePicker() {
    const win = this.active;
    const doc = win.doc;
    const dirs = await this.styleDirs(doc);
    const current = await this.styleNameOf(doc, dirs);
    const entries = await listStyles(this.styleFs, dirs);
    openPicker<StyleEntry>(
      {
        title: "export style",
        items: [...entries.filter((e) => e.name === current), ...entries.filter((e) => e.name !== current)],
        prefix: (e) => (e.name === current ? "● " : "  ") + e.scope.padEnd(9),
        text: (e) => (e.description ? `${e.name}  ${e.description}` : e.name),
        preview: async (e) => {
          const resolved = await resolveStyle(e.name, this.styleFs, dirs);
          const where = e.path ? `# ${e.path}` : "# built in";
          return { text: `${where}\n${resolved.errors.map((x) => `# ! ${x}\n`).join("")}\n${describeStyle(resolved.style)}` };
        },
        onSelect: (e) => void this.setDocStyle(e.name),
        // The window shows each style as the selection reaches it, preview on or not.
        onHighlight: (e) => {
          if (e) void this.showLook(win, resolveStyle(e.name, this.styleFs, dirs).then((r) => r.style));
        },
        onClose: () => void this.refreshExportPreview(),
      },
      () => this.view.focus(),
    );
  }

  private async setDefaultStyle(name: string) {
    const dirs = await this.styleDirs(this.active.doc);
    if (!name) {
      const configured = await configuredStyle(this.styleFs, dirs);
      return this.message(`export style of documents that name none: ${configured}`);
    }
    if (!this.configDir) return this.message("export-style-default: no config directory here", "error");
    const known = await listStyles(this.styleFs, dirs);
    if (!known.some((e) => e.name === name)) return this.message(`no export style named ${name}`, "error");
    const path = `${this.configDir}/config.toml`;
    const text = (await this.styleFs.read(path)) ?? "";
    await backend.createDir(this.configDir);
    await backend.writeText(path, setConfiguredStyle(text, name));
    const open = this.docs.find((d) => d.path === path);
    if (open) await this.onDiskChange(open);
    this.message(`export style of documents that name none: ${name}, in ${this.docName({ path } as Doc, true)}`);
    if (this.exportPreview) await this.refreshExportPreview();
  }

  private async newStyle(arg: string) {
    const [name, where] = arg.split(/\s+/);
    if (!name || !/^[\w-]+$/.test(name)) return this.message("export-style-new: a name of letters, digits and dashes", "error");
    if (where && where !== "project") return this.message("export-style-new: the name, then project for the project's styles", "error");
    const doc = this.active.doc;
    const dirs = await this.styleDirs(doc);
    const dir = where ? dirs.project : dirs.user;
    if (!dir) return this.message(`export-style-new: no ${where ? "project" : "config"} directory here`, "error");
    const path = stylePath(dir, name);
    if ((await this.styleFs.read(path)) !== null) return this.message(`${name} exists: :export-style-open ${name}`, "error");
    const from = await this.styleOf(doc);
    const parent = from.found ? from.name : "default";
    await backend.createDir(`${dir}/styles`);
    await backend.writeText(path, starterStyle(parent, from.style));
    await this.openPath(path, "vsplit");
    this.message(`new style ${name}, from ${parent}; :export-style ${name} uses it`);
  }

  private async openStyle(arg: string) {
    const doc = this.active.doc;
    const dirs = await this.styleDirs(doc);
    const name = arg || (await this.styleNameOf(doc, dirs));
    const entry = (await listStyles(this.styleFs, dirs)).find((e) => e.name === name);
    if (!entry) return this.message(`no export style named ${name}`, "error");
    if (!entry.path) return this.message(`${name} is built in: :export-style-new <name> starts a style from it`, "error");
    await this.openPath(entry.path, isMarkdownPath(doc.path) ? "vsplit" : "replace");
  }

  private scheduleExportPreview() {
    clearTimeout(this.exportPreviewTimer);
    this.exportPreviewTimer = window.setTimeout(() => void this.refreshExportPreview(), 150);
  }

  /** Counts the looks asked for by window, so a style resolved late does not replace a later one. */
  private lookGen = new WeakMap<Win, number>();

  /** Gives each window the look of its document's export style, or of the theme with the preview off. */
  private async refreshExportPreview() {
    for (const win of this.layout.windows()) {
      const on = this.exportPreview && isMarkdownPath(win.doc.path);
      await this.showLook(win, on ? this.styleOf(win.doc).then((r) => r.style) : null);
    }
  }

  private async showLook(win: Win, style: Promise<ExportStyle> | null) {
    const gen = (this.lookGen.get(win) ?? 0) + 1;
    this.lookGen.set(win, gen);
    const resolved = await style;
    if (gen !== this.lookGen.get(win)) return;
    applyExportLook(win.el, resolved);
    if (resolved) win.view.dispatch({ effects: setTotalRows.of(resolved["rules.total-rows"] as string) });
    win.view.requestMeasure();
  }

  /**
   * `C-x`: keys and values for a style file, or for the front matter of a
   * document. In insert mode it completes what is typed before the cursor; in
   * normal mode, the line's value, or else its key (keeping the value), or
   * else the key typed on it.
   */
  async complete(view: EditorView) {
    const win = this.layout.windows().find((w) => w.view === view) ?? this.active;
    const doc = win.doc;
    const { state } = view;
    const insert = state.field(modeField) === "insert";
    // In normal mode, the character under the block cursor (the end of a forward selection is past it).
    const sel = state.selection.main;
    const head = !insert && sel.head > sel.anchor ? sel.head - 1 : sel.head;
    const line = state.doc.lineAt(head);
    const dirs = await this.styleDirs(doc);
    const styles = (await listStyles(this.styleFs, dirs)).map((e) => e.name);

    // A link's target: after `[[`, or `](`.
    if (insert && isMarkdownPath(doc.path)) {
      const before = line.text.slice(0, head - line.from);
      const wiki = /\[\[([^\[\]|#\n]*)$/.exec(before);
      const link = /\]\(([^()\s]*)$/.exec(before);
      if (wiki || link) return this.completeLink(view, head, wiki ? "wiki" : "path", (wiki ?? link)![1]);
    }

    let at: (col: number) => Candidate[];
    if (doc.path && /\/styles\/[^/]+\.toml$/.test(doc.path)) {
      const text = state.doc.toString();
      const parent = /^\s*inherits\s*=\s*"([^"]+)"/m.exec(text)?.[1] ?? "default";
      // A style inheriting its own name inherits the one this file hides.
      const self = doc.path;
      const fs: StyleFs = { ...this.styleFs, read: (p) => (p === self ? Promise.resolve(null) : this.styleFs.read(p)) };
      const inherited = (await resolveStyle(parent, fs, dirs)).style;
      const valueOf = (key: string) => {
        const value = inherited[key];
        if (value === undefined) return null;
        return key.startsWith("colors.") ? `#${value}` : String(value);
      };
      // The line as it is up to `col`, for the key and value patterns.
      at = (col) => {
        const lines = text.split("\n");
        lines[line.number - 1] = line.text.slice(0, col);
        return styleCompletions(lines.join("\n"), line.number - 1, col, styles, valueOf);
      };
    } else {
      const block = isMarkdownPath(doc.path) ? frontMatter(state.doc.sliceString(0, 20_000)) : null;
      // Between the fences: the closing one is line `endLine`.
      if (!block || line.number < 2 || line.number >= block.endLine) {
        return this.message("no completions here: C-x completes links, front matter and style files");
      }
      at = (col) => propertyCompletions(line.text.slice(0, col), col, styles);
    }

    // Where to complete: [column to complete at, column the completion replaces up to].
    const tries: [number, number][] = [];
    if (insert) tries.push([head - line.from, head - line.from]);
    else {
      const key = /^(\s*)([\w-]+\s*[:=][ \t]*)/.exec(line.text);
      const header = /^\s*\[/.exec(line.text);
      if (key) {
        const comment = /\s+#[^"]*$/.exec(line.text)?.[0].length ?? 0;
        tries.push([key[0].length, line.length - comment], [key[1].length, key[0].length]);
      } else if (header) tries.push([header[0].length, line.length]);
      else tries.push([line.length, line.length]);
    }
    let candidates: Candidate[] = [];
    let to = 0;
    for (const [col, end] of tries) {
      candidates = at(col);
      to = end;
      if (candidates.length) break;
    }
    if (!candidates.length) return this.message("no completions here");

    const keys = "123456789abcdefghijklmnopqrstuvwxyz";
    const coords = view.coordsAtPos(insert ? head : line.from + Math.min(to, line.length));
    openMenu(
      candidates.slice(0, keys.length).map((c, i) => ({
        key: keys[i],
        label: c.detail ? `${c.label}  —  ${c.detail}` : c.label,
        action: () => {
          const end = line.from + c.from + c.insert.length;
          // A key with nothing after it waits for its value: type it in insert mode.
          const typing = insert || (c.insert.endsWith(" ") && to >= line.length);
          view.dispatch({
            changes: { from: line.from + c.from, to: line.from + to, insert: c.insert },
            selection: typing ? { anchor: end } : { anchor: end - 1, head: end },
            effects: typing && !insert ? setMode.of("insert") : [],
            userEvent: "input.complete",
          });
        },
      })),
      { left: coords?.left ?? 0, top: coords?.bottom ?? 0 },
      () => view.focus(),
    );
  }

  /**
   * `C-x` after `[[` or `](`: the workspace's notes, by name for a
   * wiki-link, or its files by path from the document's folder for a link.
   */
  private async completeLink(view: EditorView, head: number, kind: "wiki" | "path", typed: string) {
    const dir = this.baseDir();
    const root = await backend.workspaceRoot(dir).catch(() => dir);
    const prefix = root.endsWith("/") ? root : root + "/";
    const files = (await backend.listFiles(root).catch(() => [] as string[])).filter((f) => kind === "path" || MARKDOWN_PATH.test(f));
    let names: string[];
    if (kind === "wiki") {
      // A note's name, or its path where another note has the same name.
      const bare = files.map((f) => f.replace(MARKDOWN_PATH, ""));
      const base = (f: string) => f.slice(f.lastIndexOf("/") + 1).toLowerCase();
      names = bare.map((f) => (bare.filter((g) => base(g) === base(f)).length > 1 ? f : f.slice(f.lastIndexOf("/") + 1)));
    } else names = files.map((f) => relativePath(dir, prefix + f).replace(/ /g, "%20"));
    const own = this.active.doc.path;
    names = names.filter((_, i) => prefix + files[i] !== own);
    const found = fuzzyFilter(typed, names, (n) => n);
    if (!found.length) return this.message(`no ${kind === "wiki" ? "notes" : "files"} match ${typed}`);
    const close = kind === "wiki" ? "]]" : ")";
    const keys = "123456789abcdefghijklmnopqrstuvwxyz";
    const coords = view.coordsAtPos(head);
    openMenu(
      found.slice(0, keys.length).map((name, i) => ({
        key: keys[i],
        label: name,
        action: () => {
          const after = view.state.sliceDoc(head, head + close.length) === close ? "" : close;
          const from = head - typed.length;
          view.dispatch({
            changes: { from, to: head, insert: name + after },
            selection: { anchor: from + name.length + close.length },
            userEvent: "input.complete",
          });
        },
      })),
      { left: coords?.left ?? 0, top: coords?.bottom ?? 0 },
      () => view.focus(),
    );
  }

  /** The jumplist of the current window, latest first; Enter goes there. */
  jumplistPicker() {
    const win = this.active;
    const jumps = [...win.jumps.jumps].reverse().filter((j) => this.docs.includes(j.doc));
    const lineOf = (j: Jump<Doc>) => {
      const { doc } = this.stateOf(j.doc);
      return doc.lineAt(Math.min(j.selection.main.head, doc.length));
    };
    openPicker<Jump<Doc>>(
      {
        title: "jumplist",
        items: jumps,
        text: (j) => {
          const line = lineOf(j);
          return `${this.docName(j.doc)}:${line.number}  ${line.text.trim().slice(0, 100)}`;
        },
        preview: (j) => ({ text: this.stateOf(j.doc).doc.toString(), line: lineOf(j).number }),
        onSelect: (j, how) => {
          this.pushJump(this.view, this.view.state.selection);
          const target = how === "replace" ? this.active : this.split(how === "vsplit" ? "row" : "column");
          this.goJump(target, j);
          this.focus(target);
        },
      },
      () => this.view.focus(),
    );
  }

  // ── Zoom ───────────────────────────────────────────────────────────────────

  zoom(how: "in" | "out" | "reset" | number) {
    if (how === "in" || how === "out") zoomStep(how === "in" ? 1 : -1);
    else setZoom(how === "reset" ? 1 : how);
    for (const w of this.layout.windows()) {
      w.view.requestMeasure();
      w.view.dispatch({ effects: EditorView.scrollIntoView(w.view.state.selection.main.head, { y: "center" }) });
    }
    this.message(`zoom ${Math.round(zoomLevel() * 100)}%`);
  }

  /** `:export-docx`, and `:export-html` with `format` "html": next to the file, or to `path`. */
  async exportDocx(path?: string, format: "docx" | "html" = "docx") {
    const doc = this.active.doc;
    const target = path
      ? this.resolve(path)
      : doc.path
        ? doc.path.replace(/\.(md|markdown)$/i, "") + "." + format
        : await backend.pickSave(`untitled.${format}`, format);
    if (!target) return;
    const resolved = await this.styleOf(doc);
    if (!resolved.found) return this.message(`no export style named ${resolved.name} (:export-style lists them)`, "error");
    const text = this.stateOf(doc).doc.toString();
    const images = await loadImages(text, doc.path, readImage);
    let size: number;
    // Loaded on first export: the docx library is most of the bundle.
    if (format === "docx") {
      const { markdownToDocx } = await import("./export/docx.ts");
      const bytes = await markdownToDocx(text, resolved.style, images, await rasterizeSvgs(images));
      await backend.writeBytes(target, bytes);
      size = bytes.length;
    } else {
      const { markdownToHtml } = await import("./export/html.ts");
      const html = markdownToHtml(text, resolved.style, images);
      await backend.writeText(target, html);
      size = new TextEncoder().encode(html).length;
    }
    const done = `exported ${basename(target)} (${(size / 1024).toFixed(0)} KB) in the ${resolved.name} style`;
    if (resolved.errors.length) this.message(`${done}, skipping: ${resolved.errors.join("; ")}`, "error");
    else this.message(done);
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
    else if (key === "=" || key === "+") action = () => this.zoom("in");
    else if (key === "-") action = () => this.zoom("out");
    else if (key === "0") action = () => this.zoom("reset");
    else if (key === "o") action = () => this.openFile();
    else if (key === "e" && e.shiftKey) action = () => this.exportDocx();
    if (!action) return;
    e.preventDefault();
    e.stopPropagation();
    void Promise.resolve(action()).catch((err) => this.message(String(err), "error"));
  }
}

// The settings come first: the theme and the keymaps depend on them. Yours
// apply over the Helix config, which they can also turn off.
const startupErrors: string[] = [];
let skippedKeys: string[] = [];
const settings = await readSettings();
if (readsHelixConfig(settings)) {
  try {
    const toml = await backend.helixConfig();
    if (toml) skippedKeys = applyHelixConfig(toml);
  } catch (err) {
    startupErrors.push(`Helix config: ${err}`);
  }
}
if (settings) skippedKeys.push(...applySettings(settings));
const themeError = await initTheme(config.theme);
if (themeError) startupErrors.push(themeError);
initZoom();
setImageReader(readImage);
const app = new App();
await app.init();
const recovered = await app.restoreRecovered();
const initial = await backend.initialFile().catch(() => null);
if (initial) await app.openPath(initial).catch((e) => app.message(String(e), "error"));
else if (recovered) app.replace(app.active, recovered);
app.view.focus();
if (startupErrors.length) app.message(startupErrors.join("; "), "error");
else reportSkippedKeys(skippedKeys);

/** Reads an image; one :images-clean! cleaned up comes back when a link to it is shown again. */
async function readImage(path: string): Promise<Uint8Array> {
  try {
    return await backend.readBytes(path);
  } catch (err) {
    const back = await backend.imageBringBack(path).catch(() => false);
    if (back) app.message(`brought back ${basename(dirname(path))}/${basename(path)}, cleaned up earlier`);
    // Read again even when not brought back here: another read may just have.
    return backend.readBytes(path).catch(() => Promise.reject(err));
  }
}

/** ~/.config/markmode/config.toml, parsed; null when there is none, or when it is broken (said at startup). */
async function readSettings(): Promise<Record<string, unknown> | null> {
  const dir = await backend.configDir().catch(() => "");
  if (!dir) return null;
  const path = `${dir}/config.toml`;
  let text: string;
  try {
    text = (await backend.readText(path)).text;
  } catch (err) {
    if (!/os error 2|not found/i.test(String(err))) startupErrors.push(String(err));
    return null;
  }
  try {
    return parseToml(text) as Record<string, unknown>;
  } catch (err) {
    startupErrors.push(`${path}: ${err instanceof Error ? err.message : err} (:config-open opens it)`);
    return null;
  }
}

function reviewOriginal(state: EditorState): Text | null {
  return reviewing(state) ? originalOf(state) : null;
}

function reviewHint(changes: number): string {
  if (!changes) return "no changes";
  const n = `${changes} change${changes > 1 ? "s" : ""}`;
  return `${n} to review (]g goes to the next, space g a accepts, space g r rejects, u undoes all)`;
}

/** Says once which Helix bindings were left out, and again only when that changes. */
function reportSkippedKeys(skipped: string[]) {
  const KEY = "markmode.skipped-keys";
  const list = skipped.join("; ");
  try {
    if (localStorage.getItem(KEY) === list) return;
    localStorage.setItem(KEY, list);
  } catch {
    // Said every time, then.
  }
  if (list) app.message(`skipped bindings using commands this editor lacks (${list}); :config-open lists them`);
}

// Exposed for debugging from the devtools console, and for the browser tests.
Object.assign(window, { app, commands, backend });
