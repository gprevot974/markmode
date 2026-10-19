// Text objects (`mi`, `ma`), bracket matching (`mm`) and surround (`ms`,
// `mr`, `md`). Plain-text versions of Helix's: no tree-sitter, which suits
// prose fine.

import type { Text } from "@codemirror/state";
import { type Range, range, cursor } from "./range.ts";

const WORD = /[\p{L}\p{N}\p{M}_]/u;
const isWordChar = (ch: string | undefined) => ch !== undefined && WORD.test(ch);
const isLongWordChar = (ch: string | undefined) => ch !== undefined && !/\s/.test(ch);
const isBlankSpace = (ch: string | undefined) => ch === " " || ch === "\t";

const OPEN_TO_CLOSE: Record<string, string> = { "(": ")", "[": "]", "{": "}", "<": ">" };
const CLOSE_TO_OPEN: Record<string, string> = { ")": "(", "]": "[", "}": "{", ">": "<" };

/** Normalizes either side of a pair to its (open, close) characters. */
export function pairFor(ch: string): [string, string] {
  if (OPEN_TO_CLOSE[ch]) return [ch, OPEN_TO_CLOSE[ch]];
  if (CLOSE_TO_OPEN[ch]) return [CLOSE_TO_OPEN[ch], ch];
  return [ch, ch];
}

// ── Words ────────────────────────────────────────────────────────────────────

export function wordObject(text: string, r: Range, around: boolean, long: boolean): Range {
  const isW = long ? isLongWordChar : isWordChar;
  const pos = cursor(text, r);
  const ch = text[pos];
  // On whitespace: select the run of blanks.
  if (!isW(ch)) {
    if (!isBlankSpace(ch)) return r;
    let s = pos;
    let e = pos;
    while (isBlankSpace(text[s - 1])) s--;
    while (isBlankSpace(text[e])) e++;
    return range(s, e);
  }
  let start = pos;
  let end = pos;
  while (start > 0 && isW(text[start - 1])) start--;
  while (end < text.length && isW(text[end])) end++;
  if (around) {
    // Prefer trailing whitespace; fall back to leading, like Helix.
    if (isBlankSpace(text[end])) while (isBlankSpace(text[end])) end++;
    else while (isBlankSpace(text[start - 1])) start--;
  }
  return range(start, end);
}

// ── Paragraphs ───────────────────────────────────────────────────────────────

export function paragraphObject(doc: Text, r: Range, around: boolean): Range {
  const text = doc.toString();
  const pos = cursor(text, r);
  const blank = (n: number) => doc.line(n).text.trim() === "";
  let first = doc.lineAt(pos).number;
  const kind = blank(first);
  let last = first;
  while (first > 1 && blank(first - 1) === kind) first--;
  while (last < doc.lines && blank(last + 1) === kind) last++;
  if (around && !kind) while (last < doc.lines && blank(last + 1)) last++;
  const end = last < doc.lines ? doc.line(last + 1).from : doc.length;
  return range(doc.line(first).from, end);
}

// ── Pairs ────────────────────────────────────────────────────────────────────

/** Positions of the open and close characters of the pair enclosing `pos`. */
export function findEnclosingPair(text: string, pos: number, ch: string): [number, number] | null {
  const [open, close] = pairFor(ch);
  if (open === close) return findQuotePair(text, pos, open);

  // Standing on the open or close character counts as inside that pair.
  let start: number | null = null;
  if (text[pos] === open) start = pos;
  else {
    let depth = 0;
    const from = text[pos] === close ? pos - 1 : pos;
    for (let i = from; i >= 0; i--) {
      if (text[i] === close && i !== pos) depth++;
      else if (text[i] === open) {
        if (depth === 0) {
          start = i;
          break;
        }
        depth--;
      }
    }
  }
  if (start === null) return null;
  const end = matchForward(text, start, open, close);
  return end === null || end < pos ? null : [start, end];
}

function matchForward(text: string, start: number, open: string, close: string): number | null {
  let depth = 0;
  for (let i = start + 1; i < text.length; i++) {
    if (text[i] === open) depth++;
    else if (text[i] === close) {
      if (depth === 0) return i;
      depth--;
    }
  }
  return null;
}

function matchBackward(text: string, end: number, open: string, close: string): number | null {
  let depth = 0;
  for (let i = end - 1; i >= 0; i--) {
    if (text[i] === close) depth++;
    else if (text[i] === open) {
      if (depth === 0) return i;
      depth--;
    }
  }
  return null;
}

// Quotes (and any other symmetric character) pair up within a line: an odd
// number of them before the cursor means the cursor is inside a pair.
function findQuotePair(text: string, pos: number, q: string): [number, number] | null {
  const lineStart = text.lastIndexOf("\n", pos - 1) + 1;
  let lineEnd = text.indexOf("\n", pos);
  if (lineEnd === -1) lineEnd = text.length;
  const before: number[] = [];
  for (let i = lineStart; i < pos; i++) if (text[i] === q) before.push(i);
  if (text[pos] === q && before.length % 2 === 0) {
    const close = text.indexOf(q, pos + 1);
    return close !== -1 && close < lineEnd ? [pos, close] : null;
  }
  if (before.length % 2 === 0) return null;
  const open = before[before.length - 1];
  const close = text[pos] === q ? pos : text.indexOf(q, pos);
  return close !== -1 && close < lineEnd ? [open, close] : null;
}

const ANY_PAIR = ["(", "[", "{", '"', "'", "`"];

/** The smallest pair of any kind around the cursor, for `mim` / `mam`. */
export function findClosestPair(text: string, pos: number): [number, number] | null {
  let best: [number, number] | null = null;
  for (const ch of ANY_PAIR) {
    const p = findEnclosingPair(text, pos, ch);
    if (p && (!best || p[1] - p[0] < best[1] - best[0])) best = p;
  }
  return best;
}

export function pairObject(text: string, r: Range, ch: string, around: boolean): Range {
  const pos = cursor(text, r);
  const pair = ch === "m" ? findClosestPair(text, pos) : findEnclosingPair(text, pos, ch);
  if (!pair) return r;
  const [open, close] = pair;
  return around ? range(open, close + 1) : range(open + 1, close);
}

/** `mm`: the matching bracket of the one under the cursor, or of the enclosing pair. */
export function matchBracket(text: string, pos: number): number | null {
  const ch = text[pos];
  if (OPEN_TO_CLOSE[ch]) return matchForward(text, pos, ch, OPEN_TO_CLOSE[ch]);
  if (CLOSE_TO_OPEN[ch]) return matchBackward(text, pos, CLOSE_TO_OPEN[ch], ch);
  const pair = findClosestPair(text, pos);
  return pair ? pair[1] : null;
}
