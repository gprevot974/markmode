// The window layout, as in Helix: a tree of splits whose leaves are windows.
// A "row" split lays its children side by side (after :vsplit), a "column"
// split stacks them (after :hsplit).

export type SplitDir = "row" | "column";
export type Direction = "left" | "right" | "up" | "down";

export interface Tile {
  el: HTMLElement;
  parent: Split | null;
}

export class Split {
  dir: SplitDir;
  children: (Split | Tile)[] = [];
  parent: Split | null = null;
  readonly el = document.createElement("div");
  constructor(dir: SplitDir) {
    this.dir = dir;
  }
}

const isSplit = (n: Split | Tile): n is Split => n instanceof Split;

export class Layout<W extends Tile> {
  root: Split;
  private readonly host: HTMLElement;

  constructor(host: HTMLElement, first: W) {
    this.host = host;
    this.root = new Split("row");
    this.adopt(this.root, first);
    this.root.children.push(first);
    this.render();
  }

  private adopt(parent: Split, node: Split | Tile) {
    node.parent = parent;
  }

  /** Windows in layout order (left to right, top to bottom). */
  windows(): W[] {
    const out: W[] = [];
    const walk = (n: Split | Tile) => (isSplit(n) ? n.children.forEach(walk) : out.push(n as W));
    walk(this.root);
    return out;
  }

  /** Puts `win` after `at`, splitting `at`'s area in direction `dir`. */
  split(at: W, win: W, dir: SplitDir) {
    const parent = at.parent!;
    const index = parent.children.indexOf(at);
    if (parent.dir === dir || parent.children.length === 1) {
      parent.dir = dir;
      parent.children.splice(index + 1, 0, win);
      this.adopt(parent, win);
    } else {
      const split = new Split(dir);
      parent.children[index] = split;
      this.adopt(parent, split);
      split.children = [at, win];
      this.adopt(split, at);
      this.adopt(split, win);
    }
    this.render();
  }

  remove(win: W) {
    const parent = win.parent!;
    parent.children.splice(parent.children.indexOf(win), 1);
    win.parent = null;
    win.el.remove();
    // A split left with one child gives way to it.
    if (parent.children.length === 1) {
      const only = parent.children[0];
      const grand = parent.parent;
      if (grand) {
        grand.children[grand.children.indexOf(parent)] = only;
        this.adopt(grand, only);
      } else if (isSplit(only)) {
        this.root = only;
        only.parent = null;
      }
    }
    this.render();
  }

  /** Flips the split holding `win` between side by side and stacked. */
  transpose(win: W) {
    const parent = win.parent!;
    parent.dir = parent.dir === "row" ? "column" : "row";
    this.render();
  }

  swap(a: W, b: W) {
    const pa = a.parent!;
    const pb = b.parent!;
    const ia = pa.children.indexOf(a);
    const ib = pb.children.indexOf(b);
    pa.children[ia] = b;
    pb.children[ib] = a;
    a.parent = pb;
    b.parent = pa;
    this.render();
  }

  /** The nearest window in a direction, preferring ones that overlap `win` across it. */
  neighbor(win: W, dir: Direction): W | null {
    const r = win.el.getBoundingClientRect();
    let best: W | null = null;
    let bestScore = Infinity;
    for (const w of this.windows()) {
      if (w === win) continue;
      const b = w.el.getBoundingClientRect();
      let gap: number;
      let offset: number;
      if (dir === "left" || dir === "right") {
        gap = dir === "right" ? b.left - r.right : r.left - b.right;
        if (b.bottom <= r.top || b.top >= r.bottom) continue;
        offset = Math.abs(b.top - r.top);
      } else {
        gap = dir === "down" ? b.top - r.bottom : r.top - b.bottom;
        if (b.right <= r.left || b.left >= r.right) continue;
        offset = Math.abs(b.left - r.left);
      }
      if (gap < -2) continue;
      const score = gap * 10_000 + offset;
      if (score < bestScore) {
        bestScore = score;
        best = w;
      }
    }
    return best;
  }

  // Moves only the elements that are out of place: taking an element out of
  // the document resets its scroll position.
  render() {
    const scrolls = this.windows().map((w) => {
      const scroller = w.el.querySelector<HTMLElement>(".cm-scroller");
      return [scroller, scroller?.scrollTop ?? 0] as const;
    });
    const build = (s: Split) => {
      s.el.className = `split split-${s.dir}`;
      const els = s.children.map((c) => {
        if (isSplit(c)) build(c);
        return c.el;
      });
      place(s.el, els);
    };
    build(this.root);
    place(this.host, [this.root.el]);
    for (const [scroller, top] of scrolls) if (scroller && scroller.scrollTop !== top) scroller.scrollTop = top;
  }
}

function place(parent: HTMLElement, wanted: HTMLElement[]) {
  wanted.forEach((el, i) => {
    if (parent.children[i] !== el) parent.insertBefore(el, parent.children[i] ?? null);
  });
  while (parent.children.length > wanted.length) parent.lastElementChild!.remove();
}
