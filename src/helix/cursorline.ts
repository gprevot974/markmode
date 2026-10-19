// The cursorline and the highlighted line number follow Helix's block cursors.
// CodeMirror's own versions follow the selection head, which after `x` sits at
// the start of the next line.

import { type EditorState, RangeSet, StateField } from "@codemirror/state";
import { Decoration, EditorView, GutterMarker, gutterLineClass } from "@codemirror/view";
import { modeField, setMode } from "./state.ts";

/** Start positions of the lines holding a cursor, in order. */
function cursorLineStarts(state: EditorState): number[] {
  const insert = state.field(modeField) === "insert";
  const starts = new Set<number>();
  for (const r of state.selection.ranges) {
    const cursor = !insert && r.head > r.anchor ? r.head - 1 : r.head;
    starts.add(state.doc.lineAt(cursor).from);
  }
  return [...starts].sort((a, b) => a - b);
}

class ActiveLineGutter extends GutterMarker {
  constructor() {
    super();
    this.elementClass = "cm-activeLineGutter";
  }
}

const activeGutter = new ActiveLineGutter();
const activeLine = Decoration.line({ class: "cm-activeLine" });

export function cursorLines(highlightLine: boolean) {
  return StateField.define<number[]>({
    create: cursorLineStarts,
    update(starts, tr) {
      const modeChanged = tr.effects.some((e) => e.is(setMode));
      return tr.docChanged || tr.selection || modeChanged ? cursorLineStarts(tr.state) : starts;
    },
    provide: (f) => [
      gutterLineClass.from(f, (starts) => RangeSet.of(starts.map((s) => activeGutter.range(s)))),
      highlightLine
        ? EditorView.decorations.from(f, (starts) => Decoration.set(starts.map((s) => activeLine.range(s))))
        : [],
    ],
  });
}
