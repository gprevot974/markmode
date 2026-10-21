// The export preview: a window shows its document as the export style looks,
// on a page as wide as the style's, through classes and variables on the
// window that style.css reads (the `.export-preview` rules).

import type { ExportStyle } from "../export/style.ts";

const SERIF = /cambria|georgia|times|garamond|palatino|charter|baskerville|serif/i;
const MONO = /consolas|courier|menlo|monaco|mono|code/i;

/** The font, then a common one of the same kind, for a font this computer lacks. */
function fontStack(font: string): string {
  const fallback = MONO.test(font) ? "Menlo, monospace" : SERIF.test(font) ? "Georgia, serif" : "Helvetica Neue, Arial, sans-serif";
  return `"${font.replace(/"/g, "")}", ${fallback}`;
}

const PAGE_WIDTH = { letter: 8.5, a4: 8.27 };

const RULES = ["subtitle", "bold-labels", "metadata-blocks", "table-bands", "heading-rules"];

/** Gives a window the look of `style`, or with null, gives it back the editor theme's. */
export function applyExportLook(el: HTMLElement, style: ExportStyle | null) {
  el.classList.toggle("export-preview", !!style);
  for (const rule of RULES) el.classList.toggle(`x-${rule}`, !!style?.[`rules.${rule}`]);
  const vars: Record<string, string> = {};
  if (style) {
    const color = (name: string) => `#${style[`colors.${name}`]}`;
    for (const name of [
      "text",
      "title",
      "subtitle",
      "subtitle-rule",
      "heading",
      "subheading",
      "label",
      "accent",
      "muted",
      "rule",
      "table-header",
      "table-header-text",
      "table-band",
      "table-total",
      "table-total-text",
    ]) {
      vars[`--x-${name}`] = color(name);
    }
    const body = style["sizes.body"] as number;
    // Sizes relative to the body text, which keeps the editor's size (and zoom).
    for (const name of ["title", "subtitle", "heading", "subheading", "table", "metadata", "footnote"]) {
      vars[`--x-${name}-size`] = `${(style[`sizes.${name}`] as number) / body}em`;
    }
    const inches = PAGE_WIDTH[style["page.size"] as keyof typeof PAGE_WIDTH] - (style["page.margin-left"] as number) - (style["page.margin-right"] as number);
    // As many words to a line as on paper: the text width in body-size ems.
    vars["--x-measure"] = `${(inches * 72) / body}em`;
    vars["--x-body-font"] = fontStack(style["fonts.body"] as string);
    vars["--x-heading-font"] = fontStack(style["fonts.headings"] as string);
    vars["--x-code-font"] = fontStack(style["fonts.code"] as string);
  }
  for (const name of [...el.style].filter((n) => n.startsWith("--x-"))) el.style.removeProperty(name);
  for (const [name, value] of Object.entries(vars)) el.style.setProperty(name, value);
}
