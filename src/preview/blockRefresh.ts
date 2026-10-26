// The preview's block-level decorations (tables, math blocks, the line
// numbers' classes) come from a pass over every block of the document, which
// on a large file costs several milliseconds each. Typing within a line only
// maps them through the change; they are rebuilt right after the frame is
// painted, off the path from key press to screen. A change to which lines hold
// the cursor (Enter, a click), the parser getting further, or anything else
// still rebuilds them at once.

import { type EditorState, StateEffect, type Transaction } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import { type EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";

export const refreshBlocks = StateEffect.define<null>();

/** The numbers of the lines the selections touch, in order. */
function selectionLines(state: EditorState): number[] {
  return state.selection.ranges.flatMap((r) => [state.doc.lineAt(r.from).number, state.doc.lineAt(r.to).number]);
}

/**
 * Whether the decorations must be rebuilt for this transaction; when not,
 * mapping them through its changes does until the refresh. `selection`: they
 * depend on which lines hold a selection.
 */
export function rebuildNow(tr: Transaction, selection: boolean): boolean {
  if (tr.effects.some((e) => e.is(refreshBlocks))) return true;
  if (!tr.docChanged) return syntaxTree(tr.startState) !== syntaxTree(tr.state) || (selection && !!tr.selection);
  if (!selection) return false;
  const before = selectionLines(tr.startState);
  const after = selectionLines(tr.state);
  return before.length !== after.length || before.some((n, i) => n !== after[i]);
}

/** Asks for the refresh after a change is painted, and on showing a state, which may have changed elsewhere. */
export const blockRefresher = ViewPlugin.fromClass(
  class {
    private pending = false;
    private destroyed = false;
    private readonly view: EditorView;
    constructor(view: EditorView) {
      this.view = view;
      this.schedule();
    }
    update(update: ViewUpdate) {
      if (update.docChanged) this.schedule();
    }
    schedule() {
      if (this.pending) return;
      this.pending = true;
      requestAnimationFrame(() =>
        setTimeout(() => {
          this.pending = false;
          if (!this.destroyed) this.view.dispatch({ effects: refreshBlocks.of(null) });
        }),
      );
    }
    destroy() {
      this.destroyed = true;
    }
  },
);
