// Text motions ported from helix-core (movement.rs, search.rs). They are pure
// functions of the text so they can be unit tested without an editor.

import type { Text } from "@codemirror/state";
import {
  type Range,
  range,
  cursor,
  nextBoundary,
  prevBoundary,
  putCursor,
  rangeFrom,
  rangeTo,
  lineRange,
  lineToPos,
  sameRange,
} from "./range.ts";

// ── Character categories ─────────────────────────────────────────────────────

type Category = "eol" | "space" | "word" | "punct" | "unknown";

const isEol = (ch: string) => ch === "\n" || ch === "\r";
const WORD = /[\p{L}\p{N}\p{M}_]/u;
const PUNCT = /[\p{P}\p{S}]/u;

function categorize(ch: string): Category {
  if (isEol(ch)) return "eol";
  if (/\s/.test(ch)) return "space";
  if (WORD.test(ch)) return "word";
  if (PUNCT.test(ch)) return "punct";
  return "unknown";
}

const isWordBoundary = (a: string, b: string) => categorize(a) !== categorize(b);

// Long words (WORDs) treat words and punctuation as one category.
function isLongWordBoundary(a: string, b: string): boolean {
  const ca = categorize(a);
  const cb = categorize(b);
  if ((ca === "word" && cb === "punct") || (ca === "punct" && cb === "word")) return false;
  return ca !== cb;
}

const isSpace = (ch: string) => /\s/.test(ch);

// ── Word motions ─────────────────────────────────────────────────────────────

export type WordTarget =
  | "nextWordStart"
  | "nextWordEnd"
  | "prevWordStart"
  | "prevWordEnd"
  | "nextLongWordStart"
  | "nextLongWordEnd"
  | "prevLongWordStart"
  | "prevLongWordEnd";

const isPrevTarget = (t: WordTarget) => t.startsWith("prev");
const isLongTarget = (t: WordTarget) => t.includes("Long");

function reachedTarget(target: WordTarget, prev: string, next: string): boolean {
  const boundary = isLongTarget(target) ? isLongWordBoundary(prev, next) : isWordBoundary(prev, next);
  if (!boundary) return false;
  switch (target) {
    case "nextWordStart":
    case "nextLongWordStart":
      return isEol(next) || !isSpace(next);
    case "nextWordEnd":
    case "nextLongWordEnd":
    case "prevWordStart":
    case "prevLongWordStart":
      return !isSpace(prev) || isEol(next);
    case "prevWordEnd":
    case "prevLongWordEnd":
      return !isSpace(next) || isEol(prev);
  }
}

// One step of Helix's `CharHelpers::range_to_target`. The iterator walks
// backwards for "prev" targets, so `next` and `prev` swap meaning.
function rangeToTarget(text: string, target: WordTarget, origin: Range): Range {
  const back = isPrevTarget(target);
  let pos = origin.head;
  const next = (): string | undefined =>
    back ? (pos > 0 ? text[--pos] : undefined) : pos < text.length ? text[pos++] : undefined;
  const prev = (): string | undefined =>
    back ? (pos < text.length ? text[pos++] : undefined) : pos > 0 ? text[--pos] : undefined;
  const advance = (h: number) => (back ? Math.max(0, h - 1) : h + 1);

  let anchor = origin.anchor;
  let head = origin.head;
  let prevCh = prev();
  if (prevCh !== undefined) next();

  // Skip any initial newline characters.
  let ch: string | undefined;
  while ((ch = next()) !== undefined) {
    if (isEol(ch)) {
      prevCh = ch;
      head = advance(head);
    } else {
      prev();
      break;
    }
  }
  if (prevCh !== undefined && isEol(prevCh)) anchor = head;

  const headStart = head;
  while ((ch = next()) !== undefined) {
    if (prevCh === undefined || reachedTarget(target, prevCh, ch)) {
      if (head === headStart) anchor = head;
      else break;
    }
    prevCh = ch;
    head = advance(head);
  }
  return range(anchor, head);
}

/** Port of Helix's `word_move`: the selection `w`, `b`, `e` and friends produce. */
export function wordMove(text: string, r: Range, count: number, target: WordTarget): Range {
  const back = isPrevTarget(target);
  if ((back && r.head === 0) || (!back && r.head === text.length)) return r;

  let current: Range;
  if (back) {
    current =
      r.anchor < r.head
        ? range(r.head, prevBoundary(text, r.head))
        : range(nextBoundary(text, r.head), r.head);
  } else {
    current =
      r.anchor < r.head
        ? range(prevBoundary(text, r.head), r.head)
        : range(r.head, nextBoundary(text, r.head));
  }
  for (let i = 0; i < count; i++) {
    const next = rangeToTarget(text, target, current);
    if (sameRange(next, current)) break;
    current = next;
  }
  return current;
}

/** The select-mode variant: keep the anchor and move the cursor onto the word's cursor. */
export function extendWord(text: string, r: Range, count: number, target: WordTarget): Range {
  const word = wordMove(text, r, count, target);
  return putCursor(text, r, cursor(text, word), true);
}

// ── Find character (f, t, F, T) ──────────────────────────────────────────────

function findNthNext(text: string, ch: string, pos: number, n: number): number | null {
  if (pos >= text.length || n === 0) return null;
  for (let i = 0; i < n; i++) {
    for (;;) {
      if (pos >= text.length) return null;
      const c = text[pos++];
      if (c === ch) break;
    }
  }
  return pos - 1;
}

function findNthPrev(text: string, ch: string, pos: number, n: number): number | null {
  if (pos === 0 || n === 0) return null;
  for (let i = 0; i < n; i++) {
    for (;;) {
      if (pos <= 0) return null;
      const c = text[--pos];
      if (c === ch) break;
    }
  }
  return pos;
}

export type FindKind = "f" | "t" | "F" | "T";

/** Port of Helix's `find_char_impl`. */
export function findChar(
  text: string,
  r: Range,
  kind: FindKind,
  ch: string,
  count: number,
  extend: boolean,
): Range {
  const start = r.anchor < r.head ? r.head - 1 : r.head;
  const inclusive = kind === "f" || kind === "F";
  let pos: number | null;
  if (kind === "f" || kind === "t") {
    const p = Math.min(start + 1, text.length);
    if (inclusive) pos = findNthNext(text, ch, p, count);
    else {
      const n = text[p] === ch ? count + 1 : count;
      const found = findNthNext(text, ch, p, n);
      pos = found === null ? null : Math.max(0, found - 1);
    }
  } else {
    if (inclusive) pos = findNthPrev(text, ch, start, count);
    else {
      const n = text[Math.max(0, start - 1)] === ch ? count + 1 : count;
      const found = findNthPrev(text, ch, start, n);
      pos = found === null ? null : Math.min(found + 1, text.length);
    }
  }
  if (pos === null) return r;
  const base = extend ? r : range(cursor(text, r), cursor(text, r));
  return putCursor(text, base, pos, true);
}

// ── Line motions ─────────────────────────────────────────────────────────────

/** `x` and `X`: select whole lines, growing by `count` lines when already whole. */
export function extendLine(doc: Text, r: Range, count: number, dir: "below" | "above"): Range {
  const [startLine, endLine] = lineRange(doc, r);
  const start = lineToPos(doc, startLine);
  const end = lineToPos(doc, endLine + 1);
  const whole = rangeFrom(r) === start && rangeTo(r) === end;
  if (dir === "below") {
    const extra = whole ? count : count - 1;
    return range(start, lineToPos(doc, endLine + 1 + extra));
  }
  const extra = whole ? count : count - 1;
  return range(end, lineToPos(doc, Math.max(0, startLine - extra)));
}

/** `X` in Helix 24+: extend to line bounds without growing. */
export function extendToLineBounds(doc: Text, r: Range): Range {
  const [startLine, endLine] = lineRange(doc, r);
  const start = lineToPos(doc, startLine);
  const end = lineToPos(doc, endLine + 1);
  return r.anchor <= r.head ? range(start, end) : range(end, start);
}

/** End of a line's content, before its line break. */
export function lineContentEnd(doc: Text, pos: number): number {
  return doc.lineAt(pos).to;
}

export function firstNonWhitespace(doc: Text, pos: number): number {
  const line = doc.lineAt(pos);
  const indent = /^\s*/.exec(line.text)![0].length;
  return line.from + indent;
}

/** `gl`: the last character of the line, or the line start if it is empty. */
export function lastCharOfLine(text: string, doc: Text, pos: number): number {
  const line = doc.lineAt(pos);
  return line.to > line.from ? prevBoundary(text, line.to) : line.from;
}
