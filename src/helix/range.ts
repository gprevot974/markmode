// Helix's selection model on top of plain text offsets.
//
// A range is a pair of gap indices (anchor, head), exactly like CodeMirror's.
// What Helix adds is the block cursor: the cursor *is* a character, the one
// just before the head when the range points forward, or the one at the head
// otherwise. Normal mode keeps every range at least one character wide so
// there is always a character under the cursor.

import { findClusterBreak, type Text } from "@codemirror/state";

export interface Range {
  anchor: number;
  head: number;
}

export const range = (anchor: number, head: number): Range => ({ anchor, head });
export const rangeFrom = (r: Range) => Math.min(r.anchor, r.head);
export const rangeTo = (r: Range) => Math.max(r.anchor, r.head);
export const sameRange = (a: Range, b: Range) => a.anchor === b.anchor && a.head === b.head;

export function nextBoundary(text: string, pos: number): number {
  return pos >= text.length ? text.length : findClusterBreak(text, pos, true);
}

export function prevBoundary(text: string, pos: number): number {
  return pos <= 0 ? 0 : findClusterBreak(text, pos, false);
}

/** The position of the character under the block cursor. */
export function cursor(text: string, r: Range): number {
  return r.head > r.anchor ? prevBoundary(text, r.head) : r.head;
}

/** A one-character range on `pos`, or an empty one at the end of the text. */
export function point(text: string, pos: number): Range {
  return range(pos, nextBoundary(text, pos));
}

/** Widens empty ranges to cover the character after them. */
export function minWidth1(text: string, r: Range): Range {
  return r.anchor === r.head ? point(text, r.head) : r;
}

/** Port of Helix's `Range::put_cursor`. */
export function putCursor(text: string, r: Range, pos: number, extend: boolean): Range {
  if (!extend) return point(text, pos);
  let anchor = r.anchor;
  if (r.head >= r.anchor && pos < r.anchor) anchor = nextBoundary(text, r.anchor);
  else if (r.head < r.anchor && pos >= r.anchor) anchor = prevBoundary(text, r.anchor);
  return anchor <= pos ? range(anchor, nextBoundary(text, pos)) : range(anchor, pos);
}

/** Zero-based [first, last] line numbers a range touches, like Helix's `line_range`. */
export function lineRange(doc: Text, r: Range): [number, number] {
  const from = rangeFrom(r);
  const to = rangeTo(r);
  const last = to > from ? to - 1 : to;
  return [doc.lineAt(from).number - 1, doc.lineAt(last).number - 1];
}

/** Start offset of a zero-based line; one past the last line means the end of the text. */
export function lineToPos(doc: Text, line: number): number {
  return line >= doc.lines ? doc.length : doc.line(line + 1).from;
}
