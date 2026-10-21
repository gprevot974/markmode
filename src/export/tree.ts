// The markdown parser both exports read documents with: the editor's, with
// the same additions (front matter, wiki-links, footnotes, math).

import { GFM, parser as markdownParser } from "@lezer/markdown";
import type { SyntaxNode, Tree } from "@lezer/common";
import { frontMatterSyntax } from "../preview/frontMatterSyntax.ts";
import { wikiLinkSyntax } from "../preview/wikiLinkSyntax.ts";
import { footnoteLabel, footnoteSyntax } from "../preview/footnoteSyntax.ts";
import { mathSyntax } from "../preview/math.ts";

export const exportParser = markdownParser.configure([GFM, frontMatterSyntax, wikiLinkSyntax, footnoteSyntax, mathSyntax]);

export interface Reference {
  url: string;
  title: string;
}

/** A document's reference link definitions, by lowercased label, and its footnotes' definitions, by label. */
export function definitions(tree: Tree, text: string) {
  const slice = (from: number, to: number) => text.slice(from, to);
  const references = new Map<string, Reference>();
  const notes = new Map<string, SyntaxNode>();
  for (let node = tree.topNode.firstChild; node; node = node.nextSibling) {
    if (node.name === "LinkReference") {
      const label = node.getChild("LinkLabel");
      const url = node.getChild("URL");
      const title = node.getChild("LinkTitle");
      if (label && url) {
        references.set(slice(label.from + 1, label.to - 1).toLowerCase(), { url: slice(url.from, url.to), title: title ? slice(title.from + 1, title.to - 1) : "" });
      }
    }
    if (node.name === "FootnoteDefinition") notes.set(footnoteLabel(slice(node.from, node.to)), node);
  }
  return { references, notes };
}

/** A link's or image's text, target and title; null for a reference link with no definition. */
export function linkParts(node: SyntaxNode, text: string, references: Map<string, Reference>) {
  const slice = (from: number, to: number) => text.slice(from, to);
  const marks = node.getChildren("LinkMark");
  const textFrom = marks[0]?.to ?? node.from;
  const textTo = marks[1]?.from ?? node.to;
  const url = node.getChild("URL");
  const title = node.getChild("LinkTitle");
  if (url) return { textFrom, textTo, href: slice(url.from, url.to), title: title ? slice(title.from + 1, title.to - 1) : "" };
  const label = node.getChild("LinkLabel");
  const ref = references.get((label ? slice(label.from + 1, label.to - 1) : slice(textFrom, textTo)).toLowerCase());
  return ref ? { textFrom, textTo, href: ref.url, title: ref.title } : null;
}

/** The content between a node's first and last marks (`**`, `~~`, `` ` ``). */
export function between(node: SyntaxNode, mark: string): [number, number] {
  const marks = node.getChildren(mark);
  const first = marks[0];
  const last = marks[marks.length - 1];
  return first && last && last !== first ? [first.to, last.from] : [node.from, node.to];
}

/** A table row's cells, empty ones included (the tree has none for those): what lies between its pipes. */
export function rowCells(row: SyntaxNode): (SyntaxNode | null)[] {
  const pipes = row.getChildren("TableDelimiter").map((d) => d.from);
  const edges = [row.from, ...pipes, row.to];
  // Nothing comes before a leading pipe, or after a trailing one.
  const first = pipes[0] === row.from ? 1 : 0;
  const last = pipes.length && pipes[pipes.length - 1] === row.to - 1 ? edges.length - 2 : edges.length - 1;
  const out: (SyntaxNode | null)[] = [];
  for (let i = first; i < last; i++) {
    out.push(row.getChildren("TableCell").find((c) => c.from >= edges[i] && c.to <= edges[i + 1]) ?? null);
  }
  return out;
}

/** A table's column alignments, from its delimiter row. */
export function tableAligns(table: SyntaxNode, text: string): ("" | "center" | "right")[] {
  const delimiter = table.getChild("TableDelimiter");
  if (!delimiter) return [];
  return text
    .slice(delimiter.from, delimiter.to)
    .replace(/^\s*\|/, "")
    .replace(/\|\s*$/, "")
    .split("|")
    .map((c) => (/^\s*:-+:\s*$/.test(c) ? "center" : /-:\s*$/.test(c) ? "right" : ""));
}
