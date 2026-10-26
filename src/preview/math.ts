// Math, as pandoc and GitHub write it: `$x^2$` in a line of text, and
// `$$ ... $$` as a block of its own. The preview typesets it with KaTeX,
// loaded the first time a document has math; the source shows where the
// cursor is, with the typeset formula under it for a block.

import type { MarkdownConfig } from "@lezer/markdown";
import { type EditorState, type Range as DecoRange, StateField } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import { Decoration, type DecorationSet, EditorView, WidgetType } from "@codemirror/view";
import { rebuildNow } from "./blockRefresh.ts";

const DOLLAR = 36;

export const mathSyntax: MarkdownConfig = {
  defineNodes: [{ name: "BlockMath", block: true }, "InlineMath", "MathMark"],
  parseBlock: [
    {
      name: "BlockMath",
      before: "FencedCode",
      parse(cx, line) {
        if (line.indent > 3 || !line.text.startsWith("$$", line.pos)) return false;
        const from = cx.lineStart + line.pos;
        const marks = [cx.elt("MathMark", from, from + 2)];
        const first = line.text.slice(line.pos + 2);
        let to: number;
        // `$$ x $$` on one line.
        const closed = /\$\$\s*$/.exec(first);
        if (closed && first.trim().length > 2) {
          to = cx.lineStart + line.pos + 2 + closed.index + 2;
          marks.push(cx.elt("MathMark", to - 2, to));
        } else {
          to = cx.lineStart + line.text.length;
          while (cx.nextLine()) {
            to = cx.lineStart + line.text.length;
            const end = /\$\$\s*$/.exec(line.text);
            if (end) {
              marks.push(cx.elt("MathMark", cx.lineStart + end.index, cx.lineStart + end.index + 2));
              to = cx.lineStart + end.index + 2;
              break;
            }
          }
        }
        cx.nextLine();
        cx.addElement(cx.elt("BlockMath", from, to, marks));
        return true;
      },
    },
  ],
  parseInline: [
    {
      name: "InlineMath",
      before: "Escape",
      parse(cx, next, pos) {
        if (next !== DOLLAR) return -1;
        // $$...$$ within text, or $...$: the opening $ not followed by a
        // space, the closing one not after a space nor before a digit ("$5 and $10" is not math).
        const display = cx.char(pos + 1) === DOLLAR;
        const open = display ? 2 : 1;
        const rest = cx.slice(pos + open, Math.min(cx.end, pos + 2000));
        const m = display ? /^([^$]+?)\$\$/.exec(rest) : /^(?=\S)((?:\\.|[^$\\])*?\S)\$(?!\d)/.exec(rest);
        if (!m || (!display && /^\s/.test(m[1]))) return -1;
        const end = pos + open + m[0].length;
        return cx.addElement(cx.elt("InlineMath", pos, end, [cx.elt("MathMark", pos, pos + open), cx.elt("MathMark", end - open, end)]));
      },
    },
  ],
};

/** The TeX of a math node's source, without its dollars. */
export const texOf = (source: string) => source.replace(/^\s*\$\$?|\$\$?\s*$/g, "").trim();

type Katex = typeof import("katex").default;
let katex: Katex | null = null;
let loading: Promise<Katex> | null = null;

function loadKatex(): Promise<Katex> {
  loading ??= Promise.all([import("katex"), import("katex/dist/katex.min.css")]).then(([m]) => (katex = m.default));
  return loading;
}

/** Typesets `tex` into `el`; an error shows as the source, marked. */
function typeset(el: HTMLElement, tex: string, display: boolean, view: EditorView) {
  const render = (k: Katex) => {
    try {
      k.render(tex, el, { displayMode: display, throwOnError: true, output: "html" });
      el.title = "";
    } catch (err) {
      el.textContent = tex;
      el.classList.add("md-math-error");
      el.title = String(err).replace(/^ParseError: /, "");
    }
  };
  if (katex) render(katex);
  else {
    el.textContent = tex;
    void loadKatex().then((k) => {
      render(k);
      view.requestMeasure();
    });
  }
}

export class MathWidget extends WidgetType {
  readonly tex: string;
  readonly display: boolean;
  constructor(tex: string, display: boolean) {
    super();
    this.tex = tex;
    this.display = display;
  }
  eq(other: MathWidget) {
    return other.tex === this.tex && other.display === this.display;
  }
  toDOM(view: EditorView) {
    const el = document.createElement(this.display ? "div" : "span");
    el.className = this.display ? "md-math md-math-block" : "md-math";
    typeset(el, this.tex, this.display, view);
    return el;
  }
  get estimatedHeight() {
    return this.display ? 48 : -1;
  }
}

// Math blocks span lines, which only a state field's decorations may replace.
function buildBlocks(state: EditorState): DecorationSet {
  const decos: DecoRange<Decoration>[] = [];
  const sel = state.selection.ranges;
  syntaxTree(state).iterate({
    enter(node) {
      if (node.name !== "BlockMath") return node.name === "Document" || node.name === "Blockquote" || node.name.endsWith("List") || node.name === "ListItem";
      const widget = new MathWidget(texOf(state.sliceDoc(node.from, node.to)), true);
      const first = state.doc.lineAt(node.from);
      const last = state.doc.lineAt(node.to);
      const editing = sel.some((r) => r.to >= first.from && r.from <= last.to);
      if (editing) {
        for (let n = first.number; n <= last.number; n++) decos.push(Decoration.line({ class: "md-math-source" }).range(state.doc.line(n).from));
        decos.push(Decoration.widget({ widget, block: true, side: 1 }).range(last.to));
      } else decos.push(Decoration.replace({ widget, block: true }).range(first.from, last.to));
      return false;
    },
  });
  return Decoration.set(decos, true);
}

export const mathBlocks = StateField.define<DecorationSet>({
  create: buildBlocks,
  update(deco, tr) {
    if (rebuildNow(tr, true)) return buildBlocks(tr.state);
    return tr.docChanged ? deco.map(tr.changes) : deco;
  },
  provide: (f) => EditorView.decorations.from(f),
});
