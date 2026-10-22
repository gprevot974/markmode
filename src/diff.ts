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
  const ua = units(a);
  const ub = units(b);
  const startsA = offsets(ua);
  const startsB = offsets(ub);
  const changes: Change[] = [];
  const push = (a0: number, a1: number, b0: number, b1: number) => {
    const [fromA, toA, fromB, toB] = [startsA[a0], startsA[a1], startsB[b0], startsB[b1]];
    if (fromA === toA || fromB === toB || a1 - a0 > 1 || b1 - b0 > 1) {
      // Lines with no partner on the other side, or a block too large to pair up, change as a whole.
      if (fromA !== toA || fromB !== toB) changes.push(new Change(fromA, toA, fromB, toB));
      return;
    }
    for (const d of charDiff(a.slice(fromA, toA), b.slice(fromB, toB), { scanLimit: 500, timeout: 50 })) {
      changes.push(new Change(d.fromA + fromA, d.toA + fromA, d.fromB + fromB, d.toB + fromB));
    }
  };
  for (const c of lineChanges(ua, ub)) {
    if (c.a0 === c.a1 || c.b0 === c.b1) push(c.a0, c.a1, c.b0, c.b1);
    else {
      // A rewritten line next to added or removed ones: only the rewrite gets a character diff.
      let a0 = c.a0;
      let b0 = c.b0;
      for (const [i, j] of pairSimilarLines(ua.slice(c.a0, c.a1), ub.slice(c.b0, c.b1))) {
        push(a0, c.a0 + i, b0, c.b0 + j);
        push(c.a0 + i, c.a0 + i + 1, c.b0 + j, c.b0 + j + 1);
        a0 = c.a0 + i + 1;
        b0 = c.b0 + j + 1;
      }
      push(a0, c.a1, b0, c.b1);
    }
  }
  return changes;
}

/** Above this many pairs of lines in a changed block, no lines are paired up. */
const PAIR_LIMIT = 40_000;

/** Lines count as a rewrite of each other when at least this share of their words is shared. */
const SIMILAR = 0.5;

const words = (line: string) => new Set(line.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []);

/**
 * Pairs of lines (indexes in `a` and `b`) where one is a rewrite of the other,
 * in order, choosing the pairs that share the most words.
 */
export function pairSimilarLines(a: string[], b: string[]): [number, number][] {
  const n = a.length;
  const m = b.length;
  if (n * m > PAIR_LIMIT) return [];
  const wa = a.map(words);
  const wb = b.map(words);
  const sim = (i: number, j: number) => {
    let shared = 0;
    for (const w of wa[i]) if (wb[j].has(w)) shared++;
    const total = wa[i].size + wb[j].size;
    const score = total ? (2 * shared) / total : 0;
    return score >= SIMILAR ? score : 0;
  };
  // best[i][j]: the most similarity pairing the lines from i of `a` with those from j of `b`.
  const best = Array.from({ length: n + 1 }, () => new Float64Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      const s = sim(i, j);
      best[i][j] = Math.max(best[i + 1][j], best[i][j + 1], s ? s + best[i + 1][j + 1] : 0);
    }
  }
  const pairs: [number, number][] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    const s = sim(i, j);
    if (s && best[i][j] === s + best[i + 1][j + 1]) {
      pairs.push([i++, j++]);
    } else if (best[i][j] === best[i + 1][j]) i++;
    else j++;
  }
  return pairs;
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
