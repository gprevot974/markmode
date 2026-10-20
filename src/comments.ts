// Comments in the margin of the text, kept in the file itself as CriticMarkup
// (see criticmarkup.ts), so that an agent reading the file reads them too:
// leave notes, ask the agent to address them, then review its changes. On
// lines without a selection the markup is hidden: highlighted text gets a
// background and a note reads as an aside. On lines with one, the source shows.

import { type EditorState, type Range as DecoRange, EditorSelection, type SelectionRange } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import { Decoration, type DecorationSet, type EditorView, ViewPlugin, type ViewUpdate, WidgetType } from "@codemirror/view";
import { activeLines } from "./preview/livePreview.ts";
import { findMarkup, noteMarkup, type Markup } from "./criticmarkup.ts";
import type { Command } from "./helix/commands.ts";

const CODE = new Set(["InlineCode", "FencedCode", "CodeBlock", "CodeText"]);

function inCode(state: EditorState, pos: number): boolean {
  for (let node: { name: string; parent: unknown } | null = syntaxTree(state).resolveInner(pos, 1); node; node = node.parent as typeof node) {
    if (CODE.has(node.name)) return true;
  }
  return false;
}

/** The comments and highlights in a part of the document (whole lines), outside code. */
function markupIn(state: EditorState, from = 0, to = state.doc.length): Markup[] {
  const start = state.doc.lineAt(from).from;
  const end = state.doc.lineAt(to).to;
  return findMarkup(state.sliceDoc(start, end), start).filter((m) => !inCode(state, m.from));
}

class NoteMark extends WidgetType {
  eq() {
    return true;
  }
  toDOM() {
    const span = document.createElement("span");
    span.className = "md-note-mark";
    span.textContent = "✎";
    return span;
  }
}

const hide = Decoration.replace({});
const noteStart = Decoration.replace({ widget: new NoteMark() });
const note = Decoration.mark({ class: "md-note" });
const noteSource = Decoration.mark({ class: "md-note md-note-source" });
const highlight = Decoration.mark({ class: "md-highlight" });

function build(view: EditorView): DecorationSet {
  const { state } = view;
  const active = activeLines(state);
  const decos: DecoRange<Decoration>[] = [];
  for (const { from, to } of view.visibleRanges) {
    for (const m of markupIn(state, from, to)) {
      const first = state.doc.lineAt(m.from).number;
      const last = state.doc.lineAt(m.to).number;
      let shown = false;
      for (let n = first; n <= last && !shown; n++) shown = active.has(n);
      if (m.highlight) {
        const [a, b] = m.highlight;
        if (shown) decos.push(highlight.range(a, b));
        else {
          decos.push(hide.range(a, a + 3), hide.range(b - 3, b));
          if (b - 3 > a + 3) decos.push(highlight.range(a + 3, b - 3));
        }
      }
      if (m.note) {
        const [a, b] = m.note;
        if (shown) decos.push(noteSource.range(a, b));
        else {
          decos.push(noteStart.range(a, a + 3), hide.range(b - 3, b));
          if (b - 3 > a + 3) decos.push(note.range(a + 3, b - 3));
        }
      }
    }
  }
  return Decoration.set(decos, true);
}

export const comments = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = build(view);
    }
    update(u: ViewUpdate) {
      if (u.docChanged || u.selectionSet || u.viewportChanged || syntaxTree(u.startState) !== syntaxTree(u.state)) {
        this.decorations = build(u.view);
      }
    }
  },
  { decorations: (v) => v.decorations },
);

// ── Commands ─────────────────────────────────────────────────────────────────

const touching = (m: Markup, r: SelectionRange) => m.from <= Math.max(r.from, r.to - 1) && m.to > r.from;

/**
 * Asks for a note. With text selected, the note is about that text, which is
 * highlighted; with only the cursor, it goes at the end of the line.
 */
const addComment: Command = ({ view, host }) =>
  host.prompt("comment:", {
    onSubmit(text) {
      if (!text.trim()) return;
      const { state } = view;
      const changes: { from: number; insert: string }[] = [];
      const lineEnds = new Set<number>();
      for (const r of state.selection.ranges) {
        let from = r.from;
        let to = r.to;
        const s = state.sliceDoc(from, to);
        from += s.length - s.trimStart().length;
        to -= s.length - s.trimEnd().length;
        if (to - from > 1) {
          changes.push({ from, insert: "{==" }, { from: to, insert: "==}" + noteMarkup(text) });
          continue;
        }
        const line = state.doc.lineAt(r.from);
        if (lineEnds.has(line.to)) continue;
        lineEnds.add(line.to);
        changes.push({ from: line.to, insert: (/\S$/.test(line.text) ? " " : "") + noteMarkup(text) });
      }
      view.dispatch({ changes, userEvent: "input.comment", scrollIntoView: true });
      host.message("comment added (space C removes it, ]c goes to the next one)");
    },
  });

/** Removes the comments under the selections; highlighted text stays. */
const removeComment: Command = ({ view, host }) => {
  const { state } = view;
  const found = markupIn(state).filter((m) => state.selection.ranges.some((r) => touching(m, r)));
  if (!found.length) return host.message("no comment under the cursor");
  const changes: { from: number; to: number }[] = [];
  for (const m of found) {
    if (m.highlight) changes.push({ from: m.highlight[0], to: m.highlight[0] + 3 }, { from: m.highlight[1] - 3, to: m.highlight[1] });
    if (m.note) {
      // With the space that separated it from the text.
      const before = m.highlight || state.sliceDoc(m.note[0] - 1, m.note[0]) !== " " ? 0 : 1;
      changes.push({ from: m.note[0] - before, to: m.note[1] });
    }
  }
  view.dispatch({ changes, userEvent: "delete.comment" });
  host.message(`removed ${found.length} comment${found.length > 1 ? "s" : ""}`);
};

function gotoComment(forward: boolean): Command {
  return ({ view, host, count }) => {
    const { state } = view;
    const main = state.selection.main;
    const all = markupIn(state);
    const candidates = forward ? all.filter((m) => m.from > main.from) : all.filter((m) => m.from < main.from).reverse();
    const target = candidates[Math.min(count, candidates.length) - 1];
    if (!target) return host.message(all.length ? `no ${forward ? "next" : "previous"} comment` : "no comments");
    view.dispatch({ selection: EditorSelection.single(target.from, target.to), scrollIntoView: true, userEvent: "select" });
  };
}

export const commentCommands: Record<string, Command> = {
  add_comment: addComment,
  remove_comment: removeComment,
  goto_next_comment: gotoComment(true),
  goto_prev_comment: gotoComment(false),
};
