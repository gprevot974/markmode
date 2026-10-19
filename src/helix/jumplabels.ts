// Helix's `goto_word` (`gw`, bound to Enter in your config): two-letter labels
// over every word in view; typing a label selects that word.

import { EditorSelection, StateEffect, StateField } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, WidgetType } from "@codemirror/view";
import type { Host } from "./commands.ts";

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

class LabelWidget extends WidgetType {
  readonly text: string;
  constructor(text: string) {
    super();
    this.text = text;
  }
  eq(other: LabelWidget) {
    return other.text === this.text;
  }
  toDOM() {
    const span = document.createElement("span");
    span.className = "hx-jump-label";
    span.textContent = this.text;
    return span;
  }
}

export const jumpLabels = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    for (const e of tr.effects) {
      if (!e.is(setJump)) continue;
      if (!e.value) return Decoration.none;
      const { labels, typed } = e.value;
      return Decoration.set(
        labels.map((l) =>
          Decoration.widget({ widget: new LabelWidget(l.label.slice(typed.length)), side: -1 }).range(l.from),
        ),
        true,
      );
    }
    return tr.docChanged ? Decoration.none : deco;
  },
  provide: (f) => EditorView.decorations.from(f),
});

const ALPHABET = "abcdefghijklmnopqrstuvwxyz";
const WORD = /[\p{L}\p{N}_][\p{L}\p{N}\p{M}_]+/gu;

function wordsInView(view: EditorView): { from: number; to: number }[] {
  const main = view.state.selection.main;
  const words: { from: number; to: number }[] = [];
  for (const { from, to } of view.visibleRanges) {
    const slice = view.state.sliceDoc(from, to);
    for (const m of slice.matchAll(WORD)) {
      const start = from + m.index;
      const end = start + m[0].length;
      // The word the cursor is already on is not a jump target.
      if (start <= main.head && main.head <= end && start <= main.anchor && main.anchor <= end) continue;
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
