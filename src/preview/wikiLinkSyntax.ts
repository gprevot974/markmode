// Wiki-links in the markdown syntax tree: `[[note]]`, `[[note#Heading]]`,
// `[[note|shown text]]`. WikiLinkMark covers the brackets, and with shown
// text, the target and its `|` too, so the preview hides what it covers.

import type { MarkdownConfig } from "@lezer/markdown";

const OPEN = 91; // [

export const wikiLinkSyntax: MarkdownConfig = {
  defineNodes: ["WikiLink", "WikiLinkMark"],
  parseInline: [
    {
      name: "WikiLink",
      before: "Link",
      parse(cx, next, pos) {
        if (next !== OPEN || cx.char(pos + 1) !== OPEN) return -1;
        const rest = cx.slice(pos + 2, Math.min(cx.end, pos + 400));
        const m = /^([^\[\]\n|]+?)(?:\|([^\[\]\n]+?))?\]\]/.exec(rest);
        if (!m) return -1;
        const end = pos + 2 + m[0].length;
        const marks = m[2]
          ? [cx.elt("WikiLinkMark", pos, pos + 3 + m[1].length), cx.elt("WikiLinkMark", end - 2, end)]
          : [cx.elt("WikiLinkMark", pos, pos + 2), cx.elt("WikiLinkMark", end - 2, end)];
        return cx.addElement(cx.elt("WikiLink", pos, end, marks));
      },
    },
  ],
};
