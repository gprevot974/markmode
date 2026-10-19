// Helix's `goto_word` (`gw`, bound to Enter in your config): the first two
// letters of every word in view are replaced by a label; typing a label
// selects that word.

import { EditorSelection, type EditorState, Prec, type Range as DecoRange, StateEffect, StateField } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import { Decoration, type DecorationSet, EditorView } from "@codemirror/view";
import type { Host } from "./commands.ts";
import { activeLines } from "../preview/livePreview.ts";
import { nextBoundaryIn } from "./state.ts";

interface Label {
  from: number;
  to: number;
  label: string;
}

interface JumpState {
  labels: Label[];
  typed: string;
}

const setJump = StateEffect.define<JumpState | null>();

// The label is painted over the word's first two characters, which stay laid
// out but transparent: with proportional type, replacing the letters would
// change the line's width and make it reflow. Once the first character is
// typed, only the second one is left to show, as in Helix.
const labelMark = (text: string) => Decoration.mark({ class: "hx-jump", attributes: { "data-label": text } });

function labelDecorations(state: EditorState, { labels, typed }: JumpState): DecorationSet {
  const decos: DecoRange<Decoration>[] = [];
  for (const l of labels) {
    const end = nextBoundaryIn(state.doc, nextBoundaryIn(state.doc, l.from));
    decos.push(labelMark(l.label.slice(typed.length)).range(l.from, end));
  }
  return Decoration.set(decos, true);
}

// Highest precedence makes the marks the innermost spans, so the label takes
// the font of its word (bold, heading) and no inner span can recolor the text.
export const jumpLabels = Prec.highest(
  StateField.define<DecorationSet>({
    create: () => Decoration.none,
    update(deco, tr) {
      for (const e of tr.effects) {
        if (e.is(setJump)) return e.value ? labelDecorations(tr.state, e.value) : Decoration.none;
      }
      return tr.docChanged ? Decoration.none : deco;
    },
    provide: (f) => EditorView.decorations.from(f),
  }),
);

const ALPHABET = "abcdefghijklmnopqrstuvwxyz";
const WORD = /[\p{L}\p{N}_][\p{L}\p{N}\p{M}_]+/gu;

/** Whether the live preview hides `pos` (a link's URL, a rendered table). */
function hiddenByPreview(state: EditorState, pos: number, activeLines: Set<number>): boolean {
  for (let node = syntaxTree(state).resolveInner(pos, 1); node.parent; node = node.parent) {
    if (node.name === "Table") {
      const first = state.doc.lineAt(node.from).number;
      const last = state.doc.lineAt(node.to).number;
      for (let n = first; n <= last; n++) if (activeLines.has(n)) return false;
      return true;
    }
    if (["URL", "LinkTitle", "LinkLabel"].includes(node.name) && node.parent?.name === "Link") {
      return !activeLines.has(state.doc.lineAt(pos).number);
    }
  }
  return false;
}

function wordsInView(view: EditorView): { from: number; to: number }[] {
  const { state } = view;
  const main = state.selection.main;
  const active = activeLines(state);
  const words: { from: number; to: number }[] = [];
  for (const { from, to } of view.visibleRanges) {
    const slice = view.state.sliceDoc(from, to);
    for (const m of slice.matchAll(WORD)) {
      const start = from + m.index;
      const end = start + m[0].length;
      // The word the cursor is already on is not a jump target.
      if (start <= main.head && main.head <= end && start <= main.anchor && main.anchor <= end) continue;
      if (hiddenByPreview(state, start, active)) continue;
      words.push({ from: start, to: end });
    }
  }
  // Nearest words get the easiest labels, those after the cursor first on ties.
  const at = main.head;
  return words.sort((a, b) => Math.abs(a.from - at) - Math.abs(b.from - at) || b.from - a.from);
}

type ReadChar = (label: string, cb: (ch: string) => void, onCancel?: () => void) => void;

export function startJump(view: EditorView, extend: boolean, readChar: ReadChar, host: Host) {
  const words = wordsInView(view).slice(0, ALPHABET.length ** 2);
  if (!words.length) return host.message("no words in view");
  const labels = words.map((w, i) => ({
    ...w,
    label: ALPHABET[Math.floor(i / ALPHABET.length)] + ALPHABET[i % ALPHABET.length],
  }));
  const clear = () => view.dispatch({ effects: setJump.of(null) });
  view.dispatch({ effects: setJump.of({ labels, typed: "" }) });

  readChar(
    "gw",
    (first) => {
      const remaining = labels.filter((l) => l.label[0] === first);
      if (!remaining.length) return clear();
      view.dispatch({ effects: setJump.of({ labels: remaining, typed: first }) });
      readChar(
        `gw${first}`,
        (second) => {
          clear();
          const hit = remaining.find((l) => l.label[1] === second);
          if (!hit) return;
          const main = view.state.selection.main;
          const target = extend
            ? EditorSelection.range(main.anchor, hit.to)
            : EditorSelection.range(hit.from, hit.to);
          view.dispatch({
            selection: EditorSelection.create([target]),
            scrollIntoView: true,
            userEvent: "select",
          });
        },
        clear,
      );
    },
    clear,
  );
}
