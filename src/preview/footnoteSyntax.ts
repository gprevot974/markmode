// Footnotes in the markdown syntax tree, as GitHub writes them: a reference
// `[^label]` in the text, and its note `[^label]: text` on a line of its own,
// continued by indented lines.

import type { MarkdownConfig } from "@lezer/markdown";

const DEFINITION = /^\[\^([^\]\s]+)\]:[ \t]?/;

export const footnoteSyntax: MarkdownConfig = {
  defineNodes: ["FootnoteRef", { name: "FootnoteDefinition", block: true }, "FootnoteLabel"],
  parseBlock: [
    {
      name: "FootnoteDefinition",
      before: "LinkReference",
      parse(cx, line) {
        if (line.indent > 3) return false;
        const m = DEFINITION.exec(line.text.slice(line.pos));
        if (!m) return false;
        const from = cx.lineStart + line.pos;
        const label = cx.elt("FootnoteLabel", from, from + m[0].trimEnd().length);
        let text = line.text.slice(line.pos + m[0].length);
        let start = from + m[0].length;
        const parts = [{ text, start }];
        // Indented lines continue the note.
        while (cx.nextLine() && line.text.trim() && line.indent >= 2) {
          parts.push({ text: line.text.slice(line.pos), start: cx.lineStart + line.pos });
        }
        const inline = parts.flatMap((p) => cx.parser.parseInline(p.text, p.start));
        const last = parts[parts.length - 1];
        cx.addElement(cx.elt("FootnoteDefinition", from, last.start + last.text.length, [label, ...inline]));
        return true;
      },
    },
  ],
  parseInline: [
    {
      name: "FootnoteRef",
      before: "Link",
      parse(cx, next, pos) {
        if (next !== 91 /* [ */ || cx.char(pos + 1) !== 94 /* ^ */) return -1;
        const m = /^\[\^([^\]\s]+)\]/.exec(cx.slice(pos, Math.min(cx.end, pos + 100)));
        return m ? cx.addElement(cx.elt("FootnoteRef", pos, pos + m[0].length)) : -1;
      },
    },
  ],
};

/** A footnote's label, from its reference or definition source (`[^note]`, `[^note]:`). */
export const footnoteLabel = (source: string) => /\[\^([^\]\s]+)\]/.exec(source)?.[1] ?? "";

/** The footnotes' numbers, by label: in the order they are first referred to. */
export function footnoteNumbers(text: string): Map<string, number> {
  const numbers = new Map<string, number>();
  for (const m of text.matchAll(/\[\^([^\]\s]+)\](?!:)/g)) if (!numbers.has(m[1])) numbers.set(m[1], numbers.size + 1);
  return numbers;
}
