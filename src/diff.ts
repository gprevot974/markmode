// A diff for prose. CodeMirror's merge package compares characters, which on
// prose pairs up unrelated sentences: a deleted paragraph next to a rewritten
// one comes out as one tangled change. This compares whole lines first
// (Myers' algorithm), then characters only within the lines that changed, so
// changes keep to the paragraphs they are in.

import { Change, diff as charDiff } from "@codemirror/merge";

/** Lines with their line breaks: equal units are equal text, even at the end. */
export const units = (s: string) => s.match(/[^\n]*\n|[^\n]+$/g) ?? [];

/** Above this many line comparisons, the lines between the common start and end count as one change. */
const BUDGET = 20_000_000;

/** A run of changed lines: `a0` to `a1` (exclusive) in one text became `b0` to `b1` in the other. */
export interface LineChange {
  a0: number;
  a1: number;
  b0: number;
  b1: number;
}

export function proseDiff(a: string, b: string): Change[] {
  const startsA = offsets(units(a));
  const startsB = offsets(units(b));
  const changes: Change[] = [];
  for (const c of lineChanges(units(a), units(b))) {
    const [fromA, toA, fromB, toB] = [startsA[c.a0], startsA[c.a1], startsB[c.b0], startsB[c.b1]];
    if (fromA === toA || fromB === toB) changes.push(new Change(fromA, toA, fromB, toB));
    else {
      for (const d of charDiff(a.slice(fromA, toA), b.slice(fromB, toB), { scanLimit: 500, timeout: 50 })) {
        changes.push(new Change(d.fromA + fromA, d.toA + fromA, d.fromB + fromB, d.toB + fromB));
      }
    }
  }
  return changes;
}

/** The lines that differ between two lists of lines. */
export function lineChanges(ua: string[], ub: string[]): LineChange[] {
  const ids = new Map<string, number>();
  const id = (s: string) => {
    let n = ids.get(s);
    if (n === undefined) ids.set(s, (n = ids.size));
    return n;
  };
  const ia = ua.map(id);
  const ib = ub.map(id);

  // Unchanged lines at both ends need no search.
  let pre = 0;
  while (pre < ia.length && pre < ib.length && ia[pre] === ib[pre]) pre++;
  let post = 0;
  while (post < ia.length - pre && post < ib.length - pre && ia[ia.length - 1 - post] === ib[ib.length - 1 - post]) post++;
  const midA = ia.slice(pre, ia.length - post);
  const midB = ib.slice(pre, ib.length - post);
  const maxD = Math.min(midA.length + midB.length, Math.floor(BUDGET / Math.max(1, midA.length + midB.length)));
  const matches = (lineMatches(midA, midB, maxD) ?? []).map(([x, y]): [number, number] => [x + pre, y + pre]);

  const changes: LineChange[] = [];
  let ai = pre;
  let bi = pre;
  for (const [x, y] of [...matches, [ia.length - post, ib.length - post]]) {
    if (x > ai || y > bi) changes.push({ a0: ai, a1: x, b0: bi, b1: y });
    ai = x + 1;
    bi = y + 1;
  }
  return changes;
}

function offsets(units: string[]): number[] {
  const starts = [0];
  for (const u of units) starts.push(starts[starts.length - 1] + u.length);
  return starts;
}

/**
 * Pairs of equal lines (indexes in `a` and `b`) in a shortest edit script,
 * by Myers' algorithm; null when that takes more than `maxD` edits.
 */
export function lineMatches(a: number[], b: number[], maxD: number): [number, number][] | null {
  const n = a.length;
  const m = b.length;
  const off = n + m + 1;
  const v = new Int32Array(2 * off + 1);
  // The furthest x on each diagonal before each step, for walking back.
  const trace: Int32Array[] = [];
  for (let d = 0; d <= maxD; d++) {
    trace.push(v.slice(off - d - 1, off + d + 2));
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && v[off + k - 1] < v[off + k + 1]) ? v[off + k + 1] : v[off + k - 1] + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x++;
        y++;
      }
      v[off + k] = x;
      if (x >= n && y >= m) return walkBack(trace, d, n, m);
    }
  }
  return null;
}

function walkBack(trace: Int32Array[], depth: number, n: number, m: number): [number, number][] {
  const matches: [number, number][] = [];
  let x = n;
  let y = m;
  for (let d = depth; d > 0; d--) {
    const before = trace[d];
    const at = (k: number) => before[k + d + 1];
    const k = x - y;
    const prevK = k === -d || (k !== d && at(k - 1) < at(k + 1)) ? k + 1 : k - 1;
    const prevX = at(prevK);
    // After the edit: one line down (an insertion) or across (a deletion).
    const startX = prevK === k + 1 ? prevX : prevX + 1;
    while (x > startX) {
      x--;
      y--;
      matches.push([x, y]);
    }
    x = prevX;
    y = prevX - prevK;
  }
  while (x > 0 && y > 0) {
    x--;
    y--;
    matches.push([x, y]);
  }
  return matches.reverse();
}
