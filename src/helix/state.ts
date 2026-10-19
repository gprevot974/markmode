// Editor-wide Helix state that lives in the CodeMirror state: the mode, and a
// filter that keeps selections one character wide outside insert mode.

import {
  EditorSelection,
  EditorState,
  StateEffect,
  StateField,
  findClusterBreak,
  type Text,
  type Transaction,
} from "@codemirror/state";

export type Mode = "normal" | "insert" | "select";

export const setMode = StateEffect.define<Mode>();

export const modeField = StateField.define<Mode>({
  create: () => "normal",
  update(mode, tr) {
    for (const e of tr.effects) if (e.is(setMode)) mode = e.value;
    return mode;
  },
});

function modeAfter(tr: Transaction): Mode {
  let mode = tr.startState.field(modeField);
  for (const e of tr.effects) if (e.is(setMode)) mode = e.value;
  return mode;
}

/** Next grapheme boundary without materializing the whole document. */
export function nextBoundaryIn(doc: Text, pos: number): number {
  if (pos >= doc.length) return doc.length;
  const slice = doc.sliceString(pos, Math.min(doc.length, pos + 32));
  return pos + findClusterBreak(slice, 0, true);
}

// Whatever produced the selection (a click, undo, a command), outside insert
// mode an empty range becomes the character after it, so the block cursor
// always sits on something.
const minWidthFilter = EditorState.transactionFilter.of((tr) => {
  if (!tr.selection && !tr.docChanged && !tr.effects.some((e) => e.is(setMode))) return tr;
  if (modeAfter(tr) === "insert") return tr;
  const sel = tr.newSelection;
  const doc = tr.newDoc;
  if (sel.ranges.every((r) => !r.empty || r.head >= doc.length)) return tr;
  const ranges = sel.ranges.map((r) =>
    r.empty && r.head < doc.length
      ? EditorSelection.range(r.head, nextBoundaryIn(doc, r.head), r.goalColumn)
      : r,
  );
  return [tr, { selection: EditorSelection.create(ranges, sel.mainIndex), sequential: true }];
});

export const helixState = [modeField, minWidthFilter];
