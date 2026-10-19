// Live preview: markdown is styled in place and its syntax characters are
// hidden, except on lines that hold a selection, which show their raw source
// so every character stays reachable by Helix motions.

import { type EditorState, type Range as DecoRange, RangeSet, StateField } from "@codemirror/state";
import { syntaxTree, ensureSyntaxTree } from "@codemirror/language";
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
import { renderTable } from "./table.ts";

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
  constructor(text: string, cls: string) {
    super();
    this.text = text;
    this.cls = cls;
  }
  eq(other: TextWidget) {
    return other.text === this.text && other.cls === this.cls;
  }
  toDOM() {
    const span = document.createElement("span");
    span.className = this.cls;
    span.textContent = this.text;
    return span;
  }
}

const bullet = Decoration.replace({ widget: new TextWidget("•", "md-bullet") });
const taskOpen = Decoration.replace({ widget: new TextWidget("☐", "md-task") });
const taskDone = Decoration.replace({ widget: new TextWidget("☑", "md-task md-task-done") });

const MARKS: Record<string, string> = {
  StrongEmphasis: "md-strong",
  Emphasis: "md-em",
  Strikethrough: "md-strike",
  InlineCode: "md-code",
  Link: "md-link",
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
            decos.push(Decoration.line({ class: `md-h md-h${heading[1]}` }).range(line.from));
            pos = line.to + 1;
          }
          return;
        }
        if (MARKS[name]) {
          if (node.to > node.from) decos.push(Decoration.mark({ class: MARKS[name] }).range(node.from, node.to));
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
            return;
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
// Tables become rendered HTML tables. They span lines, so their decorations
// must come from a state field rather than a view plugin.

class TableWidget extends WidgetType {
  readonly source: string;
  constructor(source: string) {
    super();
    this.source = source;
  }
  eq(other: TableWidget) {
    return other.source === this.source;
  }
  toDOM() {
    const wrap = document.createElement("div");
    wrap.className = "md-table-wrap";
    wrap.appendChild(renderTable(this.source));
    return wrap;
  }
  // Let clicks through so CodeMirror moves the cursor onto the table, which reveals its source.
  ignoreEvent() {
    return false;
  }
}

function buildTables(state: EditorState): DecorationSet {
  const tree = ensureSyntaxTree(state, state.doc.length, 200) ?? syntaxTree(state);
  const active = activeLines(state);
  const decos: DecoRange<Decoration>[] = [];
  tree.iterate({
    enter(node) {
      if (node.name !== "Table") return;
      const first = state.doc.lineAt(node.from);
      const last = state.doc.lineAt(node.to);
      for (let n = first.number; n <= last.number; n++) if (active.has(n)) return false;
      const source = state.doc.sliceString(first.from, last.to);
      decos.push(
        Decoration.replace({ widget: new TableWidget(source), block: true }).range(first.from, last.to),
      );
      return false;
    },
  });
  return Decoration.set(decos, true);
}

const tablePreview = StateField.define<DecorationSet>({
  create: buildTables,
  update(deco, tr) {
    if (tr.docChanged || tr.selection || syntaxTree(tr.startState) !== syntaxTree(tr.state)) {
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
  const tree = ensureSyntaxTree(state, state.doc.length, 200) ?? syntaxTree(state);
  const marks: DecoRange<GutterMarker>[] = [];
  const eachLine = (from: number, to: number, cls: string) => {
    for (let pos = from; pos <= to; ) {
      const line = state.doc.lineAt(pos);
      marks.push(lineClass(cls).range(line.from));
      pos = line.to + 1;
    }
  };
  tree.iterate({
    enter(node) {
      const heading = /^(?:ATX|Setext)Heading(\d)$/.exec(node.name);
      if (heading) eachLine(node.from, node.to, `gutter-h${heading[1]}`);
      else if (node.name === "FencedCode" || node.name === "CodeBlock") eachLine(node.from, node.to, "gutter-code");
      else if (node.name === "HorizontalRule") eachLine(node.from, node.from, "gutter-hr");
      else return;
      return false;
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

export const livePreview = [inlinePreview, tablePreview, gutterClasses];
