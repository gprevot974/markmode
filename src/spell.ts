// Spell-check: misspelled words get a wavy underline. The checking itself is
// done by the system (the macOS spell checker, through the backend), first on
// the whole document, then on the lines that change once typing pauses. Code,
// URLs and HTML comments are skipped, and so is the word being typed.

import { EditorSelection, StateEffect } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import type { SyntaxNode } from "@lezer/common";
import { Decoration, type DecorationSet, type EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import { modeField } from "./helix/state.ts";
import type { Command } from "./helix/commands.ts";
import { openMenu } from "./ui/menu.ts";

export interface SpellChecker {
  check(text: string): Promise<[number, number][]>;
  suggest(word: string): Promise<string[]>;
  learn(word: string): Promise<void>;
}

let checker: SpellChecker | null = null;
const ignored = new Set<string>();
const instances = new Set<SpellPlugin>();

const DELAY = 400;
const CHUNK = 20_000;

const SKIP = new Set([
  "InlineCode",
  "FencedCode",
  "CodeBlock",
  "URL",
  "Autolink",
  "HTMLTag",
  "HTMLBlock",
  "Comment",
  "CommentBlock",
  "LinkLabel",
]);

const misspelled = Decoration.mark({ class: "hx-misspelled" });
const refreshed = StateEffect.define<null>();

interface Span {
  from: number;
  to: number;
}

class SpellPlugin {
  decorations: DecorationSet = Decoration.none;
  readonly view: EditorView;
  /** Ranges still to check, kept in step with edits. */
  private pending: Span[];
  /** The range being checked right now, also kept in step with edits. */
  private inflight: Span | null = null;
  private timer: number | undefined;
  private running = false;
  private destroyed = false;

  constructor(view: EditorView) {
    this.view = view;
    this.pending = [{ from: 0, to: view.state.doc.length }];
    instances.add(this);
    this.schedule(50);
  }

  update(u: ViewUpdate) {
    if (u.docChanged) {
      this.decorations = this.decorations.map(u.changes);
      const map = (r: Span) => ({ from: u.changes.mapPos(r.from, -1), to: u.changes.mapPos(r.to, 1) });
      this.pending = this.pending.map(map);
      if (this.inflight) this.inflight = map(this.inflight);
      u.changes.iterChangedRanges((_fa, _ta, from, to) => this.pending.push({ from, to }));
      this.schedule();
    } else if (u.startState.field(modeField) !== u.state.field(modeField)) {
      // The word at the insert cursor was skipped while typing; check it now.
      const line = u.state.doc.lineAt(u.startState.selection.main.head);
      this.pending.push({ from: line.from, to: line.to });
      this.schedule(0);
    }
  }

  schedule(delay = DELAY) {
    clearTimeout(this.timer);
    this.timer = window.setTimeout(() => void this.run(), delay);
  }

  private async run() {
    if (!checker || this.destroyed) return;
    if (this.running) return this.schedule();
    this.running = true;
    try {
      while (this.pending.length && !this.destroyed) {
        const { state } = this.view;
        const doc = state.doc;
        this.pending.sort((a, b) => a.from - b.from);
        const next = this.pending.shift()!;
        const from = doc.lineAt(Math.min(next.from, doc.length)).from;
        let to = doc.lineAt(Math.min(next.to, doc.length)).to;
        if (to - from > CHUNK) {
          const cut = doc.lineAt(from + CHUNK).to;
          if (cut < to) this.pending.push({ from: cut + 1, to });
          to = Math.min(to, cut);
        }
        this.pending = this.pending.filter((p) => p.from < from || p.to > to);
        this.inflight = { from, to };
        const found = await checker.check(doc.sliceString(from, to));
        const span = this.inflight;
        this.inflight = null;
        if (this.destroyed) return;
        if (this.view.state.doc !== doc) {
          // Edited meanwhile: try again with the range moved along with the text.
          this.pending.push(span);
          continue;
        }
        const insert = state.field(modeField) === "insert";
        const head = state.selection.main.head;
        const marks = found
          .map(([start, length]) => ({ from: from + start, to: from + start + length }))
          .filter((w) => !(insert && w.from <= head && head <= w.to))
          .filter((w) => !ignored.has(doc.sliceString(w.from, w.to).toLowerCase()))
          .filter((w) => !skipped(this.view, w.from))
          .map((w) => misspelled.range(w.from, w.to));
        this.decorations = this.decorations.update({
          filter: (f, t) => t < from || f > to,
          filterFrom: from,
          filterTo: to,
          add: marks,
          sort: true,
        });
        this.view.dispatch({ effects: refreshed.of(null) });
      }
    } finally {
      this.running = false;
    }
  }

  destroy() {
    this.destroyed = true;
    clearTimeout(this.timer);
    instances.delete(this);
  }
}

function skipped(view: EditorView, pos: number): boolean {
  for (let node: SyntaxNode | null = syntaxTree(view.state).resolveInner(pos, 1); node; node = node.parent) {
    if (SKIP.has(node.name)) return true;
  }
  return false;
}

const spellPlugin = ViewPlugin.fromClass(SpellPlugin, { decorations: (p) => p.decorations });

export function spellcheck(c: SpellChecker) {
  checker = c;
  return spellPlugin;
}

/** Misspelled words in a view, in document order. */
export function misspellings(view: EditorView): Span[] {
  const out: Span[] = [];
  const deco = view.plugin(spellPlugin)?.decorations;
  deco?.between(0, view.state.doc.length, (from, to) => void out.push({ from, to }));
  return out;
}

function forget(word: string) {
  for (const p of instances) {
    const { doc } = p.view.state;
    p.decorations = p.decorations.update({ filter: (f, t) => doc.sliceString(f, t).toLowerCase() !== word });
    p.view.dispatch({ effects: refreshed.of(null) });
  }
}

// ── Commands ─────────────────────────────────────────────────────────────────

function cursorOf(view: EditorView): number {
  const main = view.state.selection.main;
  return view.state.field(modeField) !== "insert" && main.head > main.anchor ? main.head - 1 : main.head;
}

const gotoMisspelling =
  (forward: boolean): Command =>
  ({ view, host }) => {
    const words = misspellings(view);
    if (!words.length) return host.message("no misspelled words");
    const at = cursorOf(view);
    let target = forward ? words.find((w) => w.from > at) : [...words].reverse().find((w) => w.to <= at);
    if (!target) {
      target = forward ? words[0] : words[words.length - 1];
      host.message("wrapped around");
    }
    view.dispatch({ selection: EditorSelection.single(target.from, target.to), scrollIntoView: true });
  };

export const spellCommands: Record<string, Command> = {
  goto_next_misspelling: gotoMisspelling(true),
  goto_prev_misspelling: gotoMisspelling(false),
  spelling_suggestions: async ({ view, host }) => {
    const at = cursorOf(view);
    const word = misspellings(view).find((w) => w.from <= at && at < w.to);
    if (!word || !checker) return host.message("no misspelled word under the cursor");
    const text = view.state.sliceDoc(word.from, word.to);
    const guesses = (await checker.suggest(text)).slice(0, 9);
    const replace = (g: string) => () => {
      // The menu holds the focus, so the text cannot have changed under it.
      view.dispatch({
        changes: { from: word.from, to: word.to, insert: g },
        selection: EditorSelection.single(word.from, word.from + g.length),
        userEvent: "input.spelling",
      });
    };
    const coords = view.coordsAtPos(word.from);
    openMenu(
      [
        ...guesses.map((g, i) => ({ key: String(i + 1), label: g, action: replace(g) })),
        {
          key: "a",
          label: `Add "${text}" to the dictionary`,
          action: async () => {
            await checker!.learn(text);
            ignored.add(text.toLowerCase());
            forget(text.toLowerCase());
          },
        },
        {
          key: "i",
          label: `Ignore "${text}"`,
          action: () => {
            ignored.add(text.toLowerCase());
            forget(text.toLowerCase());
          },
        },
      ],
      { left: coords?.left ?? 0, top: coords?.bottom ?? 0 },
      () => view.focus(),
    );
  },
};
