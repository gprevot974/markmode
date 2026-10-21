// Live preview: markdown is styled in place and its syntax characters are
// hidden, except on lines that hold a selection, which show their raw source
// so every character stays reachable by Helix motions.

import { type EditorState, type Range as DecoRange, RangeSet, StateEffect, StateField, type Text } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import type { SyntaxNode } from "@lezer/common";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  GutterMarker,
  gutterLineClass,
  ViewPlugin,
  type ViewUpdate,
  WidgetType,
} from "@codemirror/view";
import { type CellLabel, measureColumns, renderTableLine, splitRow } from "./table.ts";
import { describeDirective, fitWidths, parseDirective, parseWidths, widthsDirective, widthsLineAbove } from "../directives.ts";
import { PROPERTIES } from "../frontmatter.ts";
import { documentPath, imageUrl } from "../images.ts";
import { footnoteLabel, footnoteNumbers } from "./footnoteSyntax.ts";
import { MathWidget, mathBlocks, texOf } from "./math.ts";

/**
 * One-based numbers of lines touched by a selection. A range's end is
 * exclusive: the cursor on an empty line covers its line break, which ends at
 * the next line's start, but that next line is not selected.
 */
export function activeLines(state: EditorState): Set<number> {
  const lines = new Set<number>();
  for (const r of state.selection.ranges) {
    const first = state.doc.lineAt(r.from).number;
    const last = state.doc.lineAt(r.to > r.from ? r.to - 1 : r.to).number;
    for (let n = first; n <= last && lines.size < 10_000; n++) lines.add(n);
  }
  return lines;
}

const hide = Decoration.replace({});

class TextWidget extends WidgetType {
  readonly text: string;
  readonly cls: string;
  readonly title: string;
  constructor(text: string, cls: string, title = "") {
    super();
    this.text = text;
    this.cls = cls;
    this.title = title;
  }
  eq(other: TextWidget) {
    return other.text === this.text && other.cls === this.cls && other.title === this.title;
  }
  toDOM() {
    const span = document.createElement("span");
    span.className = this.cls;
    span.textContent = this.text;
    if (this.title) span.title = this.title;
    return span;
  }
}

// Footnotes are numbered in the order they are first referred to, as in the export.
const footnoteCache = new WeakMap<Text, { numbers: Map<string, number>; notes: Map<string, string> }>();

function footnotesOf(doc: Text) {
  let found = footnoteCache.get(doc);
  if (!found) {
    const text = doc.toString();
    const notes = new Map<string, string>();
    for (const m of text.matchAll(/^ {0,3}\[\^([^\]\s]+)\]:[ \t]?(.*)$/gm)) notes.set(m[1], m[2]);
    found = { numbers: footnoteNumbers(text), notes };
    footnoteCache.set(doc, found);
  }
  return found;
}

// ── Export rules ─────────────────────────────────────────────────────────────
// The export preview (`:export-preview`) styles what the export styles: the
// classes below mark it always, and window classes and variables
// (preview/exportLook.ts) give it the style's look. Only which rows are
// total rows depends on the style itself.

export const setTotalRows = StateEffect.define<string>();

const totalRows = StateField.define<string>({
  create: () => "Total",
  update: (word, tr) => tr.effects.reduce((w, e) => (e.is(setTotalRows) ? e.value : w), word),
});

/**
 * The line of the subtitle: the first `##` after the `#` title, unless the
 * document says it has none, in its front matter or with a directive.
 */
function subtitleLine(state: EditorState): number | null {
  let title = false;
  for (let node = syntaxTree(state).topNode.firstChild; node; node = node.nextSibling) {
    if (node.name === "FrontMatter" && /^subtitle:\s*(?:false|no)\s*$/im.test(state.doc.sliceString(node.from, node.to))) return null;
    if (node.name === "CommentBlock" && parseDirective(state.doc.lineAt(node.from).text)?.key === "no-subtitle") return null;
    if (node.name === "ATXHeading1") title = true;
    else if (node.name === "ATXHeading2" && title) return state.doc.lineAt(node.from).number;
  }
  return null;
}

const META = /^\s*\*\*[^*]+:\*\*/;

const PROPERTY_LABELS: Record<string, string> = {
  title: "Title",
  subtitle: "Subtitle",
  author: "Author",
  description: "Description",
  subject: "Subject",
  keywords: "Keywords",
  footer: "Footer",
  style: "Export style",
};

const propertyLabel = (key: string) => PROPERTY_LABELS[key] ?? key;

/** A front matter line, as shown when the cursor is elsewhere: a label and its value. */
class PropertyWidget extends WidgetType {
  readonly key: string;
  readonly value: string;
  /** The longest label of the front matter, in characters: the labels' column is that wide. */
  readonly column: number;
  constructor(key: string, value: string, column: number) {
    super();
    this.key = key;
    this.value = value;
    this.column = column;
  }
  eq(other: PropertyWidget) {
    return other.key === this.key && other.value === this.value && other.column === this.column;
  }
  toDOM() {
    const span = document.createElement("span");
    span.className = "md-property";
    const key = span.appendChild(document.createElement("span"));
    key.className = "md-property-key";
    key.textContent = propertyLabel(this.key);
    key.style.minWidth = `calc(${this.column}ch + 1.5em)`;
    if (!PROPERTIES.some((p) => p.key === this.key)) key.title = "Not used by this editor";
    const value = span.appendChild(document.createElement("span"));
    value.className = "md-property-value";
    value.textContent = this.key === "subtitle" && /^(?:false|no)$/i.test(this.value) ? "none: the first ## is a section" : this.value.replace(/^(["'])(.*)\1$/, "$2");
    return span;
  }
}

/** An image, shown in its place; the source stays editable on the cursor's line, above it. */
class ImageWidget extends WidgetType {
  readonly src: string;
  readonly alt: string;
  readonly base: string | null;
  constructor(src: string, alt: string, base: string | null) {
    super();
    this.src = src;
    this.alt = alt;
    this.base = base;
  }
  eq(other: ImageWidget) {
    return other.src === this.src && other.alt === this.alt && other.base === this.base;
  }
  toDOM(view: EditorView) {
    const box = document.createElement("span");
    box.className = "md-image";
    const img = box.appendChild(document.createElement("img"));
    img.alt = this.alt;
    img.title = this.alt;
    // The line grows when the image arrives: measure it again then.
    img.onload = () => view.requestMeasure();
    img.onerror = () => this.missing(box, view);
    imageUrl(this.src, this.base).then(
      (url) => (img.src = url),
      () => this.missing(box, view),
    );
    return box;
  }
  private missing(box: HTMLElement, view: EditorView) {
    box.className = "md-image md-image-missing";
    box.textContent = `${this.alt || "image"} (${this.src} not found)`;
    view.requestMeasure();
  }
  get estimatedHeight() {
    return 200;
  }
}

const propertiesCaption = Decoration.replace({ widget: new TextWidget("Properties", "md-fm-caption") });

const bullet = Decoration.replace({ widget: new TextWidget("•", "md-bullet") });
const taskOpen = Decoration.replace({ widget: new TextWidget("☐", "md-task") });
const taskDone = Decoration.replace({ widget: new TextWidget("☑", "md-task md-task-done") });

const MARKS: Record<string, string> = {
  StrongEmphasis: "md-strong",
  Emphasis: "md-em",
  Strikethrough: "md-strike",
  InlineCode: "md-code",
  Link: "md-link",
  WikiLink: "md-link",
  Autolink: "md-link",
  URL: "md-url",
  CommentBlock: "md-comment",
  Comment: "md-comment",
  HTMLTag: "md-comment",
};

function buildInline(view: EditorView): DecorationSet {
  const { state } = view;
  const doc = state.doc;
  const active = activeLines(state);
  const isActive = (pos: number) => active.has(doc.lineAt(pos).number);
  const decos: DecoRange<Decoration>[] = [];
  const subtitle = subtitleLine(state);

  for (const { from, to } of view.visibleRanges) {
    syntaxTree(state).iterate({
      from,
      to,
      enter(node) {
        const name = node.name;
        const heading = /^(?:ATX|Setext)Heading(\d)$/.exec(name);
        if (heading) {
          for (let pos = node.from; pos <= node.to; ) {
            const line = doc.lineAt(pos);
            const sub = line.number === subtitle ? " md-subtitle" : "";
            decos.push(Decoration.line({ class: `md-h md-h${heading[1]}${sub}` }).range(line.from));
            pos = line.to + 1;
          }
          return;
        }
        // Front matter: each line a property, shown as a label and its value.
        if (name === "FrontMatter") {
          const keys = [...doc.sliceString(node.from, node.to).matchAll(/^([A-Za-z][\w-]*)\s*:/gm)].map((m) => m[1]);
          const column = Math.max(0, ...keys.map((k) => propertyLabel(k).length));
          for (let pos = node.from; pos <= node.to; ) {
            const line = doc.lineAt(pos);
            const edge = pos === node.from ? " md-fm-first" : line.to >= node.to ? " md-fm-last" : "";
            const fence = edge && /^(?:---|\.\.\.)\s*$/.test(line.text);
            decos.push(Decoration.line({ class: `md-frontmatter${edge}` }).range(line.from));
            const field = /^([A-Za-z][\w-]*)\s*:\s*(.*?)\s*$/.exec(line.text);
            if (!isActive(pos) && line.length) {
              // The opening fence names the card; the closing one just ends it.
              if (fence && pos === node.from) decos.push(propertiesCaption.range(line.from, line.to));
              else if (fence) decos.push(hide.range(line.from, line.to));
              else if (field) decos.push(Decoration.replace({ widget: new PropertyWidget(field[1], field[2], column) }).range(line.from, line.to));
            }
            pos = line.to + 1;
          }
          return false;
        }
        // Metadata blocks: a paragraph whose every line is "**Label:** value".
        if (name === "Paragraph" && node.node.parent?.name === "Document") {
          const first = doc.lineAt(node.from);
          const last = doc.lineAt(node.to);
          if (last.number > first.number) {
            const lines = [];
            for (let n = first.number; n <= last.number; n++) lines.push(doc.line(n));
            if (lines.every((l) => META.test(l.text))) for (const l of lines) decos.push(Decoration.line({ class: "md-meta" }).range(l.from));
          }
        }
        // Math in a line of text: typeset, but for on the cursor's line.
        if (name === "InlineMath") {
          if (isActive(node.from)) decos.push(Decoration.mark({ class: "md-math-source" }).range(node.from, node.to));
          else {
            const source = doc.sliceString(node.from, node.to);
            decos.push(Decoration.replace({ widget: new MathWidget(texOf(source), source.startsWith("$$")) }).range(node.from, node.to));
          }
          return false;
        }
        if (name === "BlockMath") return false;
        // Footnotes: a reference shows as its number, its note's label as the number too.
        if (name === "FootnoteRef" || name === "FootnoteLabel") {
          const ref = name === "FootnoteRef";
          const label = footnoteLabel(doc.sliceString(node.from, node.to));
          const { numbers, notes } = footnotesOf(doc);
          const n = numbers.get(label);
          if (isActive(node.from)) decos.push(Decoration.mark({ class: ref ? "md-footnote-ref" : "md-footnote-label" }).range(node.from, node.to));
          else {
            const widget = new TextWidget(n ? String(n) : label, ref ? "md-footnote-ref" : "md-footnote-label", ref ? (notes.get(label) ?? "no note for this footnote") : "");
            decos.push(Decoration.replace({ widget }).range(node.from, node.to));
          }
          return false;
        }
        if (name === "FootnoteDefinition") {
          for (let pos = node.from; pos <= node.to; ) {
            const line = doc.lineAt(pos);
            decos.push(Decoration.line({ class: "md-footnote" }).range(line.from));
            pos = line.to + 1;
          }
        }
        // Directives (`<!-- footer: ... -->`) show as labels.
        if (name === "CommentBlock" && !isActive(node.from)) {
          const line = doc.lineAt(node.from);
          const directive = node.to <= line.to ? parseDirective(line.text) : null;
          if (directive) {
            decos.push(Decoration.replace({ widget: new TextWidget(describeDirective(directive), "md-directive") }).range(line.from, line.to));
            return;
          }
        }
        if (MARKS[name]) {
          // Bold opening a paragraph is a label, which the export colors.
          const lead = name === "StrongEmphasis" && node.node.parent?.name === "Paragraph" && node.node.parent.from === node.from;
          if (node.to > node.from) decos.push(Decoration.mark({ class: lead ? "md-strong md-lead" : MARKS[name] }).range(node.from, node.to));
          // Inside a link, the URL is hidden along with its brackets.
          if (name !== "URL" || node.node.parent?.name !== "Link") return;
        }

        switch (name) {
          case "Blockquote":
          case "FencedCode":
          case "CodeBlock": {
            const cls = name === "Blockquote" ? "md-quote" : "md-codeblock";
            for (let pos = node.from; pos <= node.to; ) {
              const line = doc.lineAt(pos);
              decos.push(Decoration.line({ class: cls }).range(line.from));
              pos = line.to + 1;
            }
            // The fences' backticks hide like other syntax; the language stays,
            // as a label in the block's corner rather than a first line of code.
            if (name === "FencedCode") {
              if (!isActive(node.from)) decos.push(Decoration.line({ class: "md-codefence" }).range(node.from));
              for (let child = node.node.firstChild; child; child = child.nextSibling) {
                if (child.name === "CodeInfo") decos.push(Decoration.mark({ class: "md-codeinfo" }).range(child.from, child.to));
                else if (child.name === "CodeMark" && !isActive(child.from)) decos.push(hide.range(child.from, child.to));
              }
            }
            return;
          }
          case "Image": {
            const url = node.node.getChild("URL");
            if (!url) break;
            const src = doc.sliceString(url.from, url.to);
            const [open, close] = node.node.getChildren("LinkMark");
            const alt = close ? doc.sliceString(open.to, close.from) : "";
            const widget = new ImageWidget(src, alt, state.facet(documentPath));
            if (isActive(node.from)) {
              decos.push(Decoration.widget({ widget, side: 1 }).range(node.to));
              break;
            }
            decos.push(Decoration.replace({ widget }).range(node.from, node.to));
            return false;
          }
          case "HorizontalRule":
            decos.push(Decoration.line({ class: "md-hr" }).range(doc.lineAt(node.from).from));
            if (!isActive(node.from)) decos.push(hide.range(node.from, node.to));
            return;
        }

        if (isActive(node.from)) return;
        const parent = node.node.parent?.name;
        switch (name) {
          case "HeaderMark": {
            // Also hide the space after "#".
            const end = doc.sliceString(node.to, node.to + 1) === " " ? node.to + 1 : node.to;
            if (parent?.startsWith("ATX")) decos.push(hide.range(node.from, end));
            break;
          }
          case "EmphasisMark":
          case "StrikethroughMark":
          case "Escape":
            if (name === "Escape") decos.push(hide.range(node.from, node.from + 1));
            else decos.push(hide.range(node.from, node.to));
            break;
          case "CodeMark":
            if (parent === "InlineCode") decos.push(hide.range(node.from, node.to));
            break;
          case "LinkMark":
          case "URL":
          case "LinkTitle":
          case "LinkLabel":
            if (parent === "Link" || parent === "Image") decos.push(hide.range(node.from, node.to));
            break;
          case "WikiLinkMark":
            decos.push(hide.range(node.from, node.to));
            break;
          case "QuoteMark": {
            const end = doc.sliceString(node.to, node.to + 1) === " " ? node.to + 1 : node.to;
            decos.push(hide.range(node.from, end));
            break;
          }
          case "ListMark": {
            const mark = doc.sliceString(node.from, node.to);
            if (/^[-*+]$/.test(mark)) decos.push(bullet.range(node.from, node.to));
            else decos.push(Decoration.mark({ class: "md-listmark" }).range(node.from, node.to));
            break;
          }
          case "TaskMarker": {
            const done = /x/i.test(doc.sliceString(node.from, node.to));
            decos.push((done ? taskDone : taskOpen).range(node.from, node.to));
            break;
          }
        }
      },
    });
  }
  return Decoration.set(decos, true);
}

const inlinePreview = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = buildInline(view);
    }
    update(u: ViewUpdate) {
      if (
        u.docChanged ||
        u.selectionSet ||
        u.viewportChanged ||
        syntaxTree(u.startState) !== syntaxTree(u.state)
      ) {
        this.decorations = buildInline(u.view);
      }
    }
  },
  { decorations: (v) => v.decorations },
);

// ── Tables ───────────────────────────────────────────────────────────────────
// Each line of a table renders as one row of it, with the column widths of the
// whole table, so the cursor moves through a table line by line and only the
// lines it is on show their source, as elsewhere. The decorations depend on
// the whole table, so they come from a state field rather than a view plugin.

// Column widths by table source; a table is measured once, not once a row.
const columnCache = new Map<string, number[]>();

function columnsOf(view: EditorView, source: string): number[] | null {
  const known = columnCache.get(source);
  if (known) return known;
  // Measured outside the content, which CodeMirror watches for changes.
  const line = view.contentDOM.querySelector<HTMLElement>(".cm-line");
  if (!line) return null;
  const style = getComputedStyle(line);
  const width = line.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
  const measured = width > 0 ? measureColumns(source, view.scrollDOM, width, style.font) : null;
  if (measured) {
    if (columnCache.size > 200) columnCache.clear();
    columnCache.set(source, measured);
  }
  return measured;
}

/**
 * Jump labels (`gw`) on words the preview renders itself: the editor's marks
 * cannot reach into a rendered table row, so the row paints them.
 */
export interface PreviewLabel {
  from: number;
  text: string;
}
export const setPreviewLabels = StateEffect.define<PreviewLabel[]>();

const previewLabels = StateField.define<PreviewLabel[]>({
  create: () => [],
  update(labels, tr) {
    for (const e of tr.effects) if (e.is(setPreviewLabels)) return e.value;
    return tr.docChanged ? [] : labels;
  },
});

class TableLineWidget extends WidgetType {
  readonly source: string;
  readonly index: number;
  readonly labels: CellLabel[];
  /** From the table's `widths` directive. */
  readonly widths: number[] | null;
  constructor(source: string, index: number, labels: CellLabel[], widths: number[] | null) {
    super();
    this.source = source;
    this.index = index;
    this.labels = labels;
    this.widths = widths;
  }
  eq(other: TableLineWidget) {
    return (
      other.source === this.source &&
      other.index === this.index &&
      other.labels.length === this.labels.length &&
      other.labels.every((l, i) => l.at === this.labels[i].at && l.text === this.labels[i].text) &&
      String(other.widths) === String(this.widths)
    );
  }
  toDOM(view: EditorView) {
    const columns = this.widths
      ? fitWidths(this.widths, splitRow(this.source.split("\n")[0]).length)
      : columnsOf(view, this.source);
    const dom = renderTableLine(this.source, this.index, columns, this.labels);
    dom.querySelectorAll<HTMLElement>(".md-col-handle").forEach((handle, i) =>
      handle.addEventListener("mousedown", (e) => resizeColumns(view, dom, i, e)),
    );
    return dom;
  }
  // Let clicks through so CodeMirror moves the cursor onto the line, which
  // reveals its source; the column borders are the widget's to drag.
  ignoreEvent(e: Event) {
    return e.target instanceof Element && !!e.target.closest(".md-col-handle");
  }
}

/** The rendered rows of the table a row is part of, as far as they are drawn. */
function rowsOfTable(row: HTMLElement): HTMLTableElement[] {
  const line = row.closest(".cm-line");
  if (!line) return [];
  const lines: Element[] = [line];
  for (let l: Element | null = line; l && !l.classList.contains("md-table-first"); ) {
    l = l.previousElementSibling;
    if (l?.classList.contains("md-table-line")) lines.unshift(l);
    else break;
  }
  for (let l: Element | null = line; l && !l.classList.contains("md-table-last"); ) {
    l = l.nextElementSibling;
    if (l?.classList.contains("md-table-line")) lines.push(l);
    else break;
  }
  return lines.flatMap((l) => [...l.querySelectorAll<HTMLTableElement>(":scope > table.md-table")]);
}

const MIN_COLUMN = 0.05;

/** Drags the border right of column `i`, between it and the next, then writes the widths into the document. */
function resizeColumns(view: EditorView, row: HTMLElement, i: number, down: MouseEvent) {
  down.preventDefault();
  const tables = rowsOfTable(row);
  const width = row.getBoundingClientRect().width;
  const cols = [...row.querySelectorAll("col")].map((c) => parseFloat(c.style.width) / 100);
  if (!width || i + 1 >= cols.length) return;
  const [a, b] = [cols[i], cols[i + 1]];
  let moved = false;
  document.body.classList.add("md-col-resizing");
  const move = (e: MouseEvent) => {
    const d = Math.max(MIN_COLUMN - a, Math.min(b - MIN_COLUMN, (e.clientX - down.clientX) / width));
    moved ||= Math.abs(e.clientX - down.clientX) > 2;
    cols[i] = a + d;
    cols[i + 1] = b - d;
    for (const t of tables) t.querySelectorAll("col").forEach((c, k) => (c.style.width = `${(cols[k] * 100).toFixed(3)}%`));
  };
  const up = () => {
    window.removeEventListener("mousemove", move);
    window.removeEventListener("mouseup", up);
    document.body.classList.remove("md-col-resizing");
    const line = row.closest(".cm-line");
    if (moved && line) setTableWidths(view, view.posAtDOM(line), cols);
  };
  window.addEventListener("mousemove", move);
  window.addEventListener("mouseup", up);
}

function tableAt(state: EditorState, pos: number) {
  for (let node: SyntaxNode | null = syntaxTree(state).resolveInner(pos, 1); node; node = node.parent) {
    if (node.name === "Table") return node;
  }
  return null;
}

/**
 * The column widths of the table at `pos`, as fractions: its `widths`
 * directive's, or as laid out. Null when `pos` is not in a table.
 */
export function tableWidths(view: EditorView, pos: number): number[] | null {
  const { state } = view;
  const table = tableAt(state, pos);
  if (!table) return null;
  const first = state.doc.lineAt(table.from);
  const count = splitRow(first.text).length;
  const at = widthsLineAbove((n) => state.doc.line(n).text, first.number);
  const set = at ? parseWidths(parseDirective(state.doc.line(at).text)?.value ?? "") : null;
  if (set) return fitWidths(set, count);
  const measured = columnsOf(view, state.doc.sliceString(first.from, state.doc.lineAt(table.to).to));
  return measured ? fitWidths(measured, count) : Array(count).fill(1 / count);
}

/**
 * Writes the column widths of the table at `pos` into the `widths` directive
 * above it (adding one), or with null, removes it. False when `pos` is not in a table.
 */
export function setTableWidths(view: EditorView, pos: number, fractions: number[] | null): boolean {
  const { state } = view;
  const table = tableAt(state, pos);
  if (!table) return false;
  const first = state.doc.lineAt(table.from);
  const at = widthsLineAbove((n) => state.doc.line(n).text, first.number);
  const text = fractions && widthsDirective(fractions);
  if (at) {
    const line = state.doc.line(at);
    view.dispatch({
      changes: text ? { from: line.from, to: line.to, insert: text } : { from: line.from, to: line.to + 1 },
      userEvent: "input.table-widths",
    });
  } else if (text) {
    view.dispatch({ changes: { from: first.from, insert: text + "\n" }, userEvent: "input.table-widths" });
  }
  return true;
}

// Blocks that can hold other blocks. The fields below look only at blocks,
// never inside paragraphs, and do not wait for the parser to reach the end of
// the document: on a large file either would cost tens of milliseconds a key
// press. The parts parsed later come in with the next syntax tree.
const CONTAINERS = new Set(["Document", "BulletList", "OrderedList", "ListItem", "Blockquote"]);

function buildTables(state: EditorState): DecorationSet {
  const active = activeLines(state);
  const labels = state.field(previewLabels, false) ?? [];
  const word = (state.field(totalRows, false) ?? "Total").trim();
  const total = word ? new RegExp(`\\*\\*${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "i") : null;
  const decos: DecoRange<Decoration>[] = [];
  syntaxTree(state).iterate({
    enter(node) {
      if (node.name !== "Table") return CONTAINERS.has(node.name) ? undefined : false;
      const first = state.doc.lineAt(node.from);
      const last = state.doc.lineAt(node.to);
      const source = state.doc.sliceString(first.from, last.to);
      const at = widthsLineAbove((k) => state.doc.line(k).text, first.number);
      const widths = at ? parseWidths(parseDirective(state.doc.line(at).text)?.value ?? "") : null;
      for (let n = first.number; n <= last.number; n++) {
        const line = state.doc.line(n);
        const edge = n === first.number ? " md-table-first" : n === last.number ? " md-table-last" : "";
        const isTotal = n > first.number + 1 && total?.test(line.text) ? " md-table-total" : "";
        decos.push(Decoration.line({ class: "md-table-line" + edge + isTotal }).range(line.from));
        if (active.has(n) || line.length === 0) continue;
        const onLine = labels.filter((l) => l.from >= line.from && l.from < line.to).map((l) => ({ at: l.from - line.from, text: l.text }));
        decos.push(
          Decoration.replace({ widget: new TableLineWidget(source, n - first.number, onLine, widths) }).range(line.from, line.to),
        );
      }
      return false;
    },
  });
  return Decoration.set(decos, true);
}

const tablePreview = StateField.define<DecorationSet>({
  create: buildTables,
  update(deco, tr) {
    if (
      tr.docChanged ||
      tr.selection ||
      syntaxTree(tr.startState) !== syntaxTree(tr.state) ||
      tr.effects.some((e) => e.is(setPreviewLabels) || e.is(setTotalRows))
    ) {
      return buildTables(tr.state);
    }
    return deco;
  },
  provide: (f) => EditorView.decorations.from(f),
});

// ── Line numbers ─────────────────────────────────────────────────────────────
// Headings and code blocks set their own size and padding; their line numbers
// get a class with matching metrics so they line up with the text.

class LineClass extends GutterMarker {
  constructor(cls: string) {
    super();
    this.elementClass = cls;
  }
  eq(other: GutterMarker) {
    return other.elementClass === this.elementClass;
  }
}

const lineClasses = new Map<string, LineClass>();
const lineClass = (cls: string) => {
  let m = lineClasses.get(cls);
  if (!m) lineClasses.set(cls, (m = new LineClass(cls)));
  return m;
};

function buildGutterClasses(state: EditorState): RangeSet<GutterMarker> {
  const marks: DecoRange<GutterMarker>[] = [];
  const eachLine = (from: number, to: number, cls: string) => {
    for (let pos = from; pos <= to; ) {
      const line = state.doc.lineAt(pos);
      marks.push(lineClass(cls).range(line.from));
      pos = line.to + 1;
    }
  };
  syntaxTree(state).iterate({
    enter(node) {
      const heading = /^(?:ATX|Setext)Heading(\d)$/.exec(node.name);
      if (heading) eachLine(node.from, node.to, `gutter-h${heading[1]}`);
      else if (node.name === "FencedCode" || node.name === "CodeBlock") eachLine(node.from, node.to, "gutter-code");
      else if (node.name === "HorizontalRule") eachLine(node.from, node.from, "gutter-hr");
      else return CONTAINERS.has(node.name) ? undefined : false;
    },
  });
  return RangeSet.of(marks, true);
}

const gutterClasses = StateField.define<RangeSet<GutterMarker>>({
  create: buildGutterClasses,
  update(marks, tr) {
    if (tr.docChanged || syntaxTree(tr.startState) !== syntaxTree(tr.state)) return buildGutterClasses(tr.state);
    return marks;
  },
  provide: (f) => gutterLineClass.from(f),
});

export const livePreview = [previewLabels, totalRows, inlinePreview, tablePreview, mathBlocks, gutterClasses];
