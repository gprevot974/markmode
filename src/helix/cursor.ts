// Draws selections and Helix's block cursor outside insert mode.
//
// Both are mark decorations on the text rather than CodeMirror's selection
// layer: that layer sits beneath line backgrounds (the cursorline washed it
// out) and inline backgrounds (inline code hid it). The decorations get the
// highest precedence, which makes them the innermost spans, so their colors
// win over the live preview's.

import { type EditorState, Prec, type Range as DecoRange } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
  WidgetType,
} from "@codemirror/view";
import { modeField, nextBoundaryIn } from "./state.ts";

/** A one-cell block standing in for a line break, which has no glyph to style. */
class EolCell extends WidgetType {
  readonly cls: string;
  constructor(cls: string) {
    super();
    this.cls = cls;
  }
  eq(other: EolCell) {
    return other.cls === this.cls;
  }
  toDOM() {
    const span = document.createElement("span");
    span.className = `hx-eol ${this.cls}`;
    span.textContent = "​";
    return span;
  }
}

const markCache = new Map<string, Decoration>();
const mark = (cls: string) => {
  let d = markCache.get(cls);
  if (!d) markCache.set(cls, (d = Decoration.mark({ class: cls })));
  return d;
};

function build(state: EditorState, visible: readonly { from: number; to: number }[]): DecorationSet {
  if (state.field(modeField) === "insert") return Decoration.none;
  const { doc, selection } = state;
  const decos: DecoRange<Decoration>[] = [];
  const text = (from: number, to: number) => doc.sliceString(from, to);

  selection.ranges.forEach((r, i) => {
    const primary = i === selection.mainIndex;
    const cursor = r.head > r.anchor ? r.head - 1 : r.head;
    const cursorEnd = cursor < doc.length ? nextBoundaryIn(doc, cursor) : cursor;
    const selCls = primary ? "hx-sel hx-sel-primary" : "hx-sel";
    const curCls = primary ? "hx-cursor hx-cursor-primary" : "hx-cursor";

    // Selected text, minus the cursor character, clipped to the viewport.
    for (const v of visible) {
      for (const [a, b] of [
        [r.from, Math.min(r.to, cursor)],
        [Math.max(r.from, cursorEnd), r.to],
      ]) {
        const from = Math.max(a, v.from);
        const to = Math.min(b, v.to);
        if (from >= to) continue;
        // Line breaks inside the selection get a visible cell; text gets a mark.
        const slice = text(from, to);
        let start = from;
        for (let nl = slice.indexOf("\n"); nl !== -1; nl = slice.indexOf("\n", nl + 1)) {
          const pos = from + nl;
          if (pos > start) decos.push(mark(selCls).range(start, pos));
          decos.push(Decoration.widget({ widget: new EolCell(selCls), side: 1 }).range(pos));
          start = pos + 1;
        }
        if (to > start) decos.push(mark(selCls).range(start, to));
      }
    }

    if (cursor >= doc.length || text(cursor, cursor + 1) === "\n") {
      decos.push(Decoration.widget({ widget: new EolCell(curCls), side: 1 }).range(cursor));
    } else {
      decos.push(mark(curCls).range(cursor, cursorEnd));
    }
  });
  return Decoration.set(decos, true);
}

export const selectionDecorations = Prec.highest(
  ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) {
        this.decorations = build(view.state, view.visibleRanges);
      }
      update(u: ViewUpdate) {
        if (
          u.docChanged ||
          u.selectionSet ||
          u.viewportChanged ||
          u.startState.field(modeField) !== u.state.field(modeField)
        ) {
          this.decorations = build(u.state, u.view.visibleRanges);
        }
      }
    },
    { decorations: (v) => v.decorations },
  ),
);
