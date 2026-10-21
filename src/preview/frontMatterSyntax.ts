// Front matter in the markdown syntax tree: without this, its opening "---"
// parses as a horizontal rule and its last line as a setext heading.

import type { Input } from "@lezer/common";
import type { MarkdownConfig } from "@lezer/markdown";
import { frontMatter } from "../frontmatter.ts";

/** Front matter longer than this is not looked for. */
const MAX_LENGTH = 20_000;

export const frontMatterSyntax: MarkdownConfig = {
  defineNodes: [{ name: "FrontMatter", block: true }, "FrontMatterMark"],
  parseBlock: [
    {
      name: "FrontMatter",
      before: "HorizontalRule",
      parse(cx, line) {
        if (cx.lineStart !== 0 || !line.text.startsWith("---")) return false;
        // Where it ends decides whether it is one, before any line is consumed.
        const input = (cx as unknown as { input: Input }).input;
        const block = frontMatter(input.read(0, Math.min(input.length, MAX_LENGTH)));
        if (!block) return false;
        const marks = [cx.elt("FrontMatterMark", 0, line.text.length)];
        while (cx.nextLine() && cx.lineStart + line.text.length < block.to);
        marks.push(cx.elt("FrontMatterMark", cx.lineStart, block.to));
        cx.nextLine();
        cx.addElement(cx.elt("FrontMatter", 0, block.to, marks));
        return true;
      },
    },
  ],
};
