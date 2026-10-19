// Draws Helix's block cursor outside insert mode. CodeMirror's own cursor is a
// bar between characters, so the block is a styled character instead (or a
// small block widget at a line end, where there is no character to style).

import { type EditorState, type Range as DecoRange } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate, WidgetType } from "@codemirror/view";
import { modeField, nextBoundaryIn } from "./state.ts";

class EolCursor extends WidgetType {
  readonly primary: boolean;
  constructor(primary: boolean) {
    super();
    this.primary = primary;
  }
  eq(other: EolCursor) {
    return other.primary === this.primary;
  }
  toDOM() {
    const span = document.createElement("span");
    span.className = `hx-cursor hx-cursor-eol${this.primary ? " hx-cursor-primary" : ""}`;
    span.textContent = "​";
    return span;
  }
}

function build(state: EditorState): DecorationSet {
  if (state.field(modeField) === "insert") return Decoration.none;
  const { doc, selection } = state;
  const decos: DecoRange<Decoration>[] = [];
  selection.ranges.forEach((r, i) => {
    const primary = i === selection.mainIndex;
    const pos = r.head > r.anchor ? r.head - 1 : r.head;
    const atEol = pos >= doc.length || doc.sliceString(pos, pos + 1) === "\n";
    if (atEol) {
      decos.push(Decoration.widget({ widget: new EolCursor(primary), side: 1 }).range(pos));
    } else {
      const cls = `hx-cursor${primary ? " hx-cursor-primary" : ""}`;
      decos.push(Decoration.mark({ class: cls }).range(pos, nextBoundaryIn(doc, pos)));
    }
  });
  return Decoration.set(decos, true);
}

export const blockCursor = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = build(view.state);
    }
    update(u: ViewUpdate) {
      if (u.docChanged || u.selectionSet || u.startState.field(modeField) !== u.state.field(modeField)) {
        this.decorations = build(u.state);
      }
    }
  },
  { decorations: (v) => v.decorations },
);
