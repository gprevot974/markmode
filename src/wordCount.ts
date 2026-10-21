// Word counts of what a reader sees: the text the exports keep, read with
// their parser (export/tree.ts). Markup, link targets, front matter, comments,
// raw HTML, images and math are left out; footnotes are counted apart.
// Kept free of editor code, like the exports.

import type { SyntaxNode } from "@lezer/common";
import { exportParser } from "./export/tree.ts";
import { findMarkup } from "./criticmarkup.ts";

/** A stretch of the source a reader sees, `[from, to)`. */
export type Span = [number, number];

export interface Readable {
  /** The body's visible text, in order. */
  body: Span[];
  /** The footnotes' visible text, in order. */
  notes: Span[];
  /** How many footnotes there are. */
  noteCount: number;
}

export interface Counts {
  words: number;
  characters: number;
  charactersNoSpaces: number;
}

// Nodes whose text a reader never sees.
const HIDDEN = new Set([
  "FrontMatter",
  "LinkReference",
  "CommentBlock",
  "ProcessingInstructionBlock",
  "HTMLBlock",
  "HorizontalRule",
  "Comment",
  "ProcessingInstruction",
  "HTMLTag",
  "EmphasisMark",
  "CodeMark",
  "CodeInfo",
  "LinkMark",
  "LinkTitle",
  "LinkLabel",
  "StrikethroughMark",
  "HeaderMark",
  "QuoteMark",
  "ListMark",
  "TaskMarker",
  "TableDelimiter",
  "WikiLinkMark",
  "FootnoteRef",
  "FootnoteLabel",
  "Image",
  "InlineMath",
  "BlockMath",
]);

/** The parts of a markdown text a reader sees. */
export function readable(text: string): Readable {
  const tree = exportParser.parse(text);
  const body: Span[] = [];
  const notes: Span[] = [];
  let noteCount = 0;

  function walk(node: SyntaxNode, out: Span[]) {
    const name = node.name;
    if (HIDDEN.has(name)) return;
    // A link's target is not shown; a bare address in the text is.
    if (name === "URL" && node.parent && /^(?:Link|Image|LinkReference)$/.test(node.parent.name)) return;
    if (name === "Escape") return void out.push([node.from + 1, node.to]);
    if (name === "WikiLink") {
      // Its shown text, or the note's name and heading ("note › heading").
      const inner = text.slice(node.from + 2, node.to - 2);
      const bar = inner.indexOf("|");
      if (bar >= 0) return void out.push([node.from + 3 + bar, node.to - 2]);
      const hash = inner.indexOf("#");
      if (hash < 0) return void out.push([node.from + 2, node.to - 2]);
      return void out.push([node.from + 2, node.from + 2 + hash], [node.from + 3 + hash, node.to - 2]);
    }
    if (name === "FootnoteDefinition") {
      noteCount++;
      out = notes;
    }
    let pos = node.from;
    for (let child = node.firstChild; child; child = child.nextSibling) {
      if (child.from > pos) out.push([pos, child.from]);
      walk(child, out);
      pos = Math.max(pos, child.to);
    }
    if (pos < node.to) out.push([pos, node.to]);
  }
  walk(tree.topNode, body);

  // Comments are notes for the writers: a note goes, a highlight's text stays.
  const hidden: Span[] = [];
  for (const m of findMarkup(text)) {
    if (m.note) hidden.push(m.note);
    if (m.highlight) hidden.push([m.highlight[0], m.highlight[0] + 3], [m.highlight[1] - 3, m.highlight[1]]);
  }
  return { body: without(body, hidden), notes: without(notes, hidden), noteCount };
}

/** `spans` with the parts in `holes` taken out; both in order. */
function without(spans: Span[], holes: Span[]): Span[] {
  if (!holes.length) return spans;
  const out: Span[] = [];
  let h = 0;
  for (let [from, to] of spans) {
    while (h < holes.length && holes[h][1] <= from) h++;
    for (let k = h; k < holes.length && holes[k][0] < to; k++) {
      if (holes[k][0] > from) out.push([from, holes[k][0]]);
      from = Math.max(from, holes[k][1]);
    }
    if (from < to) out.push([from, to]);
  }
  return out;
}

/**
 * The text of `spans`, clipped to `range`. Spans that markup alone keeps
 * apart (`**bold**text`) join up; those whitespace, a line break or a
 * wiki-link's `#` keeps apart stay apart.
 */
function textOf(text: string, spans: Span[], range: Span = [0, text.length]): string {
  let out = "";
  let last = -1;
  for (const [a, b] of spans) {
    const from = Math.max(a, range[0]);
    const to = Math.min(b, range[1]);
    if (from >= to) continue;
    if (last >= 0 && /[\s#]/.test(text.slice(last, from))) out += " ";
    out += text.slice(from, to);
    last = to;
  }
  return out;
}

/** Words count as Word counts them: what lies between spaces, holding a letter or digit ("well-known" is one). */
export function counts(shown: string): Counts {
  const flat = shown.replace(/\s+/g, " ").trim();
  return {
    words: flat ? flat.split(" ").filter((w) => /[\p{L}\p{N}]/u.test(w)).length : 0,
    characters: [...flat].length,
    charactersNoSpaces: [...flat.replace(/ /g, "")].length,
  };
}

/** The counts of the body, or, given ranges, of what they hold, footnotes included. */
export function countText(text: string, r: Readable, ranges?: Span[]): Counts {
  if (!ranges) return counts(textOf(text, r.body));
  const spans = [...r.body, ...r.notes].sort((a, b) => a[0] - b[0]);
  return counts(ranges.map((range) => textOf(text, spans, range)).join(" "));
}

/** The footnotes' counts. */
export const countNotes = (text: string, r: Readable): Counts => counts(textOf(text, r.notes));
