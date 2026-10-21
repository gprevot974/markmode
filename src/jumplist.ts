// Helix's jumplist: each window keeps the places it jumped from (with `gg`,
// a search, a picker, ...), and C-o and C-i go back and forth through them.
// Places are selections in a document, moved along as the document is edited.

import { EditorSelection, type ChangeDesc } from "@codemirror/state";

export interface Jump<D> {
  doc: D;
  selection: EditorSelection;
}

/** As in Helix. */
const CAPACITY = 30;

const same = <D>(a: Jump<D>, b: Jump<D>) => a.doc === b.doc && a.selection.eq(b.selection);

export class JumpList<D> {
  jumps: Jump<D>[] = [];
  /** Where the next jump back starts from; past the end when not going through the list. */
  current = 0;

  clone(): JumpList<D> {
    const out = new JumpList<D>();
    out.jumps = [...this.jumps];
    out.current = this.current;
    return out;
  }

  /** Keeps a place jumped from; the places gone back past are dropped, as in a browser's history. */
  push(jump: Jump<D>) {
    this.jumps.length = Math.min(this.current, this.jumps.length);
    const last = this.jumps[this.jumps.length - 1];
    if (!last || !same(last, jump)) {
      this.jumps.push(jump);
      if (this.jumps.length > CAPACITY) this.jumps.shift();
    }
    this.current = this.jumps.length;
  }

  /** The place `count` jumps back from `here`, which is kept to come forward to; null at the start. */
  backward(here: Jump<D>, count: number): Jump<D> | null {
    if (this.current >= this.jumps.length) {
      this.push(here);
      this.current = this.jumps.length - 1;
    }
    let to = this.current - count;
    while (to >= 0 && same(this.jumps[to], here)) to--;
    if (to < 0) return null;
    this.current = to;
    return this.jumps[to];
  }

  /** The place `count` jumps forward; null past the latest. */
  forward(count: number): Jump<D> | null {
    const to = this.current + count;
    if (to >= this.jumps.length) return null;
    this.current = to;
    return this.jumps[to];
  }

  /** Moves the places in `doc` along with an edit to it. */
  map(doc: D, changes: ChangeDesc) {
    // New objects: a split's list starts with the same ones.
    this.jumps = this.jumps.map((j) => (j.doc === doc ? { doc, selection: j.selection.map(changes) } : j));
  }

  /** Forgets the places in a closed document. */
  remove(doc: D) {
    const before = this.jumps.slice(0, this.current).filter((j) => j.doc === doc).length;
    this.jumps = this.jumps.filter((j) => j.doc !== doc);
    this.current = Math.max(0, this.current - before);
  }
}

/** A selection within a document of `length`, for one that may have been kept from a longer text. */
export function clampSelection(sel: EditorSelection, length: number): EditorSelection {
  const ranges = sel.ranges.map((r) => EditorSelection.range(Math.min(r.anchor, length), Math.min(r.head, length)));
  return EditorSelection.create(ranges, sel.mainIndex);
}
