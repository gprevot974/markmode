/* Builds a styled .docx from markdown. Ported from the standalone
 * build-docx.js; it runs both in the editor (`:export-docx`) and from the
 * command line:
 *
 *   node scripts/build-docx.ts input.md output.docx
 *
 * How it looks comes from an export style (style.ts): colors, fonts, sizes,
 * the page, and the rules that turn markdown into styled Word elements.
 * The document's properties (title, author, footer, ...) come from its front
 * matter (frontmatter.ts); table column widths from widths directives
 * (directives.ts). CriticMarkup comments ({>>note<<}, {==highlight==}) are
 * left out, and so is raw HTML.
 *
 * Like html.ts it reads the markdown's syntax tree (tree.ts). Equations are
 * typeset by the docx library's TeX converter, as Word equations.
 */

import {
  Document,
  Packer,
  Paragraph,
  type ParagraphChild,
  TextRun,
  ExternalHyperlink,
  ImageRun,
  FootnoteReferenceRun,
  Math as Equation,
  type MathComponent,
  MathRun,
  Table,
  TableRow,
  TableCell,
  WidthType,
  ShadingType,
  BorderStyle,
  AlignmentType,
  HeadingLevel,
  LevelFormat,
  Footer,
  SimpleField,
  Tab,
  convertInchesToTwip,
} from "docx";
import { latexToMath } from "docx/math";
import type { SyntaxNode } from "@lezer/common";
import { stripComments } from "../criticmarkup.ts";
import { fitWidths, parseDirective, parseWidths, widthsLineAbove } from "../directives.ts";
import { frontMatter } from "../frontmatter.ts";
import { defaultStyle, type ExportStyle } from "./style.ts";
import { imageInfo } from "../images.ts";
import { footnoteLabel, footnoteNumbers } from "../preview/footnoteSyntax.ts";
import { texOf } from "../preview/math.ts";
import { between, definitions, exportParser, linkParts, rowCells, tableAligns } from "./tree.ts";

type Alignment = (typeof AlignmentType)[keyof typeof AlignmentType];

const PAGES = { letter: { width: 12240, height: 15840 }, a4: { width: 11906, height: 16838 } };

/** A style's values, ready for the builders: colors, fonts, sizes in half-points, twips. */
class Look {
  readonly style: ExportStyle;
  /** The document's footnotes' numbers, by label. */
  readonly footnotes = new Map<string, number>();
  constructor(style: ExportStyle) {
    this.style = style;
  }
  color = (name: string) => this.style[`colors.${name}`] as string;
  font = (name: string) => this.style[`fonts.${name}`] as string;
  /** Word counts font sizes in half-points. */
  size = (name: string) => Math.round((this.style[`sizes.${name}`] as number) * 2);
  rule = (name: string) => this.style[`rules.${name}`];
  get page() {
    return PAGES[this.style["page.size"] as keyof typeof PAGES];
  }
  margin = (side: string) => convertInchesToTwip(this.style[`page.margin-${side}`] as number);
  /** The width between the margins. */
  get contentWidth() {
    return this.page.width - this.margin("left") - this.margin("right");
  }
  /** The label color for bold opening a block, unless labels are off. */
  get label() {
    return this.rule("bold-labels") ? this.color("label") : undefined;
  }
}

// ── Inline markdown ──────────────────────────────────────────────────────────
//
// Bold does two jobs here, and they get two colors:
//
//   Label     — bold opening a paragraph, list item or table row, naming what
//               follows ("Month 2 — Build and migrate."). Rendered in indigo,
//               so it reads as a mini-heading. Controlled by `leadColor`.
//   Emphasis  — bold mid-sentence, stressing a phrase. Stays body black, so it
//               does not compete with the labels. Controlled by `boldColor`.
//
// The distinction is positional: only bold where the text starts (`leadAt`) is a label.
interface RunOpts {
  size?: number;
  font?: string;
  color?: string;
  bold?: boolean;
  italics?: boolean;
  leadColor?: string;
  boldColor?: string;
  /** Where the text starts, for labels. */
  leadAt?: number;
}

/** A run's formatting, as it builds up through nested emphasis. */
interface Format {
  font: string;
  size: number;
  color: string;
  bold: boolean;
  italics: boolean;
  strike: boolean;
  underline?: boolean;
}

const run = (f: Format, text: string, extra: { font?: string; size?: number; italics?: boolean; break?: number } = {}) =>
  new TextRun({ font: f.font, size: f.size, color: f.color, bold: f.bold, italics: f.italics, strike: f.strike || undefined, underline: f.underline ? {} : undefined, text, ...extra });

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", mdash: "—", ndash: "–", hellip: "…", copy: "©" };

function entity(source: string): string {
  const name = source.slice(1, -1);
  if (name.startsWith("#")) {
    const code = /^#x/i.test(name) ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
    return Number.isFinite(code) ? String.fromCodePoint(code) : source;
  }
  return ENTITIES[name] ?? source;
}

/** An equation, typeset from its TeX; the TeX itself where the converter fails. */
function equation(tex: string) {
  try {
    return new Equation({ children: latexToMath(tex) as MathComponent[] });
  } catch {
    return new Equation({ children: [new MathRun(tex)] });
  }
}

/** A list item's `[ ]` or `[x]`, drawn as a box in the accent color, in place of its bullet. */
const taskBox = (look: Look, done: boolean) =>
  new TextRun({ children: [done ? "☑" : "☐", new Tab()], font: "Segoe UI Symbol", size: look.size("body"), color: look.color("accent") });

// ── Block builders ───────────────────────────────────────────────────────────
interface ParaOpts {
  alignment?: Alignment;
  after?: number;
  keepNext?: boolean;
  indent?: { left?: number; hanging?: number };
}

/** Where the blocks being built sit: in how many quotes, under which list item. */
interface Place {
  quotes: number;
  /** The depth of the list item they are in, -1 outside lists. */
  level: number;
}

const TOP: Place = { quotes: 0, level: -1 };
/** Each list level's text indent, and each quote's. */
const LIST_INDENT = 400;
const LEVEL_INDENT = 360;
const QUOTE_INDENT = 280;
// Each level's bullet and number, as nested lists go deeper.
const BULLETS = ["•", "◦", "▪"];
const NUMBERS = [
  [LevelFormat.DECIMAL, "%1."],
  [LevelFormat.LOWER_LETTER, "%2."],
  [LevelFormat.LOWER_ROMAN, "%3."],
] as const;
const LEVELS = BULLETS.length;
const indentOf = (place: Place) => (place.level >= 0 ? LIST_INDENT + place.level * LEVEL_INDENT : 0) + place.quotes * QUOTE_INDENT;

const sectionHeading = (look: Look, children: ParagraphChild[]) =>
  new Paragraph({
    children,
    heading: HeadingLevel.HEADING_1,
    spacing: { before: 360, after: 160 },
    keepNext: true,
    border: look.rule("heading-rules")
      ? { bottom: { style: BorderStyle.SINGLE, size: 6, color: look.color("rule"), space: 6 } }
      : undefined,
  });

const subHeading = (children: ParagraphChild[]) =>
  new Paragraph({
    children,
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 260, after: 110 },
    keepNext: true,
  });

interface CellOpts {
  width: number;
  fill?: string;
  bold?: boolean;
  color?: string;
  leadColor?: string;
  boldColor?: string;
  align?: Alignment;
  keepNext?: boolean;
}

/** A table cell's content, from its node (null for an empty cell). */
type CellRuns = (cell: SyntaxNode | null, opts: RunOpts) => ParagraphChild[];

function cell(look: Look, node: SyntaxNode | null, render: CellRuns, o: CellOpts) {
  return new TableCell({
    width: { size: o.width, type: WidthType.DXA },
    shading: o.fill ? { type: ShadingType.CLEAR, fill: o.fill, color: "auto" } : undefined,
    margins: { top: 90, bottom: 90, left: 130, right: 130 },
    children: [
      new Paragraph({
        children: render(node, {
          size: look.size("table"),
          bold: o.bold,
          color: o.color ?? look.color("text"),
          leadColor: o.leadColor,
          boldColor: o.boldColor,
        }),
        alignment: o.align,
        spacing: { after: 0, line: 252 },
        // Holds the table together on one page. Without it Word/LibreOffice
        // will happily strand the Total row of the fee table on the next page,
        // away from the figures it totals.
        keepNext: o.keepNext,
      }),
    ],
  });
}

/** `rows`: each row's cells and their source; `set`: fractions from a widths directive. */
function buildTable(look: Look, rows: { cells: (SyntaxNode | null)[]; text: string[] }[], aligns: string[], set: number[] | null, render: CellRuns) {
  const nCols = Math.max(...rows.map((r) => r.cells.length));
  const CONTENT_W = look.contentWidth;
  let widths: number[];
  if (set) widths = fitWidths(set, nCols).map((f) => Math.round(f * CONTENT_W));
  // Shares tuned for the letter page, for the tables proposals mostly have.
  else if (nCols === 4) widths = [2160, 2640, 2640, 2640].map((w) => Math.round((w / 10080) * CONTENT_W));
  else if (nCols === 2) widths = (aligns[1] === "right" ? [8280, 1800] : [4000, 6080]).map((w) => Math.round((w / 10080) * CONTENT_W));
  else widths = Array(nCols).fill(Math.floor(CONTENT_W / nCols));

  const headerEmpty = rows[0].text.every((c) => stripMd(c) === "");
  const word = (look.rule("total-rows") as string).trim();
  const total = word ? new RegExp(`\\*\\*${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "i") : null;
  const [header, headerText] = [look.color("table-header"), look.color("table-header-text")];
  const [totalFill, totalText, text] = [look.color("table-total"), look.color("table-total-text"), look.color("text")];
  const band = (n: number) => look.rule("table-bands") && n % 2 === 1;
  const body = headerEmpty ? rows.slice(1) : rows;

  const trs = body.map((row, i) => {
    const isHeader = !headerEmpty && i === 0;
    const isTotal = !!total && total.test(row.text.join(" "));
    const cells = Array.from({ length: nCols }, (_, j) => row.cells[j] ?? null);

    return new TableRow({
      tableHeader: isHeader,
      cantSplit: true,
      children: cells.map((c, j) =>
        cell(look, c, render, {
          keepNext: i < body.length - 1,
          width: widths[j],
          fill: isHeader ? header : isTotal ? totalFill : band(headerEmpty ? i : i - 1) ? look.color("table-band") : undefined,
          bold: isHeader || isTotal,
          color: isHeader ? headerText : isTotal ? totalText : text,
          // Header and total rows are uniformly colored already, so both bold
          // roles collapse to the row color there; body rows get the split.
          leadColor: isHeader ? headerText : isTotal ? totalText : look.label,
          boldColor: isHeader ? headerText : isTotal ? totalText : text,
          align: aligns[j] === "right" ? AlignmentType.RIGHT : aligns[j] === "center" ? AlignmentType.CENTER : undefined,
        }),
      ),
    });
  });

  const edge = { style: BorderStyle.SINGLE, size: 4, color: look.color("rule") };
  return new Table({
    columnWidths: widths,
    width: { size: CONTENT_W, type: WidthType.DXA },
    borders: {
      top: edge,
      bottom: edge,
      left: edge,
      right: edge,
      insideHorizontal: edge,
      insideVertical: edge,
    },
    rows: trs,
  });
}

const stripMd = (s: string) => s.replace(/\*\*/g, "").replace(/`/g, "").trim();

/** Images taller than this are scaled down, as well as those wider than the page's text. */
const MAX_IMAGE_INCHES = 7;

/**
 * An image on a line of its own, at its size up to the text's width; its
 * description where Word cannot show it. An SVG needs a PNG beside it
 * (`raster`), for the programs that cannot show SVG.
 */
function imageParagraph(look: Look, alt: string, bytes: Uint8Array | undefined, raster: Uint8Array | undefined, place: Place) {
  const info = bytes && imageInfo(bytes);
  const indent = indentOf(place);
  if (!bytes || !info || !info.width || !info.height || (info.type === "svg" && !raster)) {
    return new Paragraph({
      children: [new TextRun({ text: alt ? `[${alt}]` : "[image]", italics: true, color: look.color("muted"), font: look.font("body"), size: look.size("body") })],
      spacing: { after: 140, line: 276 },
      indent: indent ? { left: indent } : undefined,
    });
  }
  // Word sizes images in pixels at 96 to the inch.
  const scale = Math.min(1, (((look.contentWidth - indent) / 1440) * 96) / info.width, (MAX_IMAGE_INCHES * 96) / info.height);
  const transformation = { width: Math.round(info.width * scale), height: Math.round(info.height * scale) };
  const altText = { name: alt || "image", description: alt, title: alt };
  return new Paragraph({
    children: [
      info.type === "svg"
        ? new ImageRun({ type: "svg", data: bytes, fallback: { type: "png", data: raster! }, transformation, altText })
        : new ImageRun({ type: info.type, data: bytes, transformation, altText }),
    ],
    spacing: { before: 120, after: 200 },
    indent: indent ? { left: indent } : undefined,
  });
}

/**
 * `images`: the bytes of the local images the text shows, by their `src`
 * (images.ts's loadImages); `rasters`: a PNG of each SVG among them
 * (rasterizeSvgs), without which an SVG shows as its description.
 */
export function buildDocument(
  src: string,
  style: ExportStyle = defaultStyle(),
  images: Map<string, Uint8Array> = new Map(),
  rasters: Map<string, Uint8Array> = new Map(),
): Document {
  const look = new Look(style);
  const CONTENT_W = look.contentWidth;
  // Comments are notes for the writers (and their agents), not for readers.
  const text = stripComments(src);
  const tree = exportParser.parse(text);
  const lines = text.split("\n");
  const slice = (from: number, to: number) => text.slice(from, to);
  const lineOf = (pos: number) => text.slice(0, pos).split("\n").length;
  /** The first position from `pos` that is not a space or tab. */
  const skipSpace = (pos: number, to: number) => {
    while (pos < to && (text[pos] === " " || text[pos] === "\t")) pos++;
    return pos;
  };
  const children: (Paragraph | Table)[] = [];
  const front = frontMatter(text);

  // Footnotes become Word footnotes, numbered by first reference.
  const { references, notes } = definitions(tree, text);
  for (const [label, n] of footnoteNumbers(text)) if (notes.has(label)) look.footnotes.set(label, n);
  let olInstance = 0;
  let seenTitle = false;

  const directives: Record<string, string | true> = {};
  for (const l of lines) {
    const d = parseDirective(l);
    if (d) directives[d.key] = d.value ?? true;
  }
  // A property from the front matter, or from the directive it replaces.
  const property = (key: string) => {
    const value = front?.fields[key] ?? directives[key];
    return typeof value === "string" ? value : "";
  };
  // With rules.subtitle, the first "##" after the "#" title is styled as a
  // subtitle. A document whose first "##" is a real section opts out with
  // `subtitle: false` (or the older <!-- no-subtitle -->).
  let seenSubtitle = !look.rule("subtitle") || front?.fields.subtitle === false || directives["no-subtitle"] === true;
  // Document title property: the "#" heading, without markdown emphasis.
  const titleLine = lines.slice(front?.endLine ?? 0).find((l) => l.trim().startsWith("# "));
  const docTitle = property("title") || (titleLine ? titleLine.trim().slice(2).replace(/[*_`]/g, "") : "");
  const footerText = property("footer");

  // ── Inline ─────────────────────────────────────────────────────────────────

  /** The runs for the inline content of `node` between `from` and `to`. */
  function runs(node: SyntaxNode, from: number, to: number, opts: RunOpts = {}): ParagraphChild[] {
    const format: Format = {
      font: opts.font ?? look.font("body"),
      size: opts.size ?? look.size("body"),
      color: opts.color ?? look.color("text"),
      bold: opts.bold ?? false,
      italics: opts.italics ?? false,
      strike: false,
    };
    const out = inline(node, from, to, format, opts);
    return out.length ? out : [run(format, "")];
  }

  function inline(node: SyntaxNode, from: number, to: number, f: Format, opts: RunOpts): ParagraphChild[] {
    const out: ParagraphChild[] = [];
    // Line breaks within a paragraph are spaces.
    const plain = (s: string) => {
      const t = s.replace(/[ \t]*\n[ \t]*/g, " ");
      if (t) out.push(run(f, t));
    };
    let pos = from;
    for (let child = node.firstChild; child; child = child.nextSibling) {
      if (child.to <= from || child.from >= to) continue;
      if (child.from > pos) plain(slice(pos, child.from));
      out.push(...inlineNode(child, f, opts));
      pos = Math.max(pos, child.to);
    }
    if (pos < to) plain(slice(pos, to));
    return out;
  }

  function inlineNode(node: SyntaxNode, f: Format, opts: RunOpts): ParagraphChild[] {
    const within = (mark: string, g: Format) => {
      const [a, b] = between(node, mark);
      return inline(node, a, b, g, opts);
    };
    switch (node.name) {
      case "EmphasisMark":
      case "CodeMark":
      case "LinkMark":
      case "StrikethroughMark":
      case "HeaderMark":
      case "QuoteMark":
      case "ListMark":
      case "TaskMarker":
      case "Comment":
      case "ProcessingInstruction":
        return [];
      case "Escape":
        return [run(f, slice(node.from + 1, node.to))];
      case "Entity":
        return [run(f, entity(slice(node.from, node.to)))];
      case "HardBreak":
        return [run(f, "", { break: 1 })];
      case "HTMLTag":
        return /^<br\s*\/?>$/i.test(slice(node.from, node.to)) ? [run(f, "", { break: 1 })] : [];
      case "Emphasis":
        return within("EmphasisMark", { ...f, italics: true });
      case "StrongEmphasis": {
        const isLabel = opts.leadColor && node.from === opts.leadAt;
        return within("EmphasisMark", { ...f, bold: true, color: isLabel ? opts.leadColor! : (opts.boldColor ?? f.color) });
      }
      case "Strikethrough":
        return within("StrikethroughMark", { ...f, strike: true });
      case "InlineCode": {
        const [a, b] = between(node, "CodeMark");
        return [run(f, slice(a, b).replace(/\n/g, " "), { font: look.font("code"), size: f.size - 2 })];
      }
      case "URL":
      case "Autolink": {
        const url = node.name === "URL" ? node : node.getChild("URL");
        if (!url) return [run(f, slice(node.from, node.to))];
        const target = slice(url.from, url.to);
        const href = /^www\./i.test(target) ? `https://${target}` : /^[\w.+-]+@[\w-]+\.[\w.-]+$/.test(target) ? `mailto:${target}` : target;
        return [hyperlink(href, [run(linked(f), target)])];
      }
      case "Link": {
        const parts = linkParts(node, text, references);
        if (!parts) return inline(node, node.from, node.to, f, opts);
        const label = inline(node, parts.textFrom, parts.textTo, f, { ...opts, leadColor: undefined });
        const url = parts.href.trim().replace(/^<(.*)>$/, "$1");
        // A web address stays a link; others (local files, anchors) keep their text.
        if (!/^(?:https?|mailto):/i.test(url)) return label;
        return [hyperlink(url, inline(node, parts.textFrom, parts.textTo, linked(f), { ...opts, leadColor: undefined, boldColor: look.color("accent") }))];
      }
      case "Image": {
        // An image within text: its description (an image on its own line is placed).
        const parts = linkParts(node, text, references);
        const alt = parts ? slice(parts.textFrom, parts.textTo) : "";
        return alt ? [run(f, alt, { italics: true })] : [];
      }
      case "WikiLink": {
        const [target, shown] = slice(node.from + 2, node.to - 2).split("|");
        return [run(f, (shown ?? target.replace(/#/, " › ")).trim())];
      }
      case "FootnoteRef": {
        const n = look.footnotes.get(footnoteLabel(slice(node.from, node.to)));
        return [n ? new FootnoteReferenceRun(n) : run(f, slice(node.from, node.to))];
      }
      case "InlineMath":
        return [equation(texOf(slice(node.from, node.to)))];
      default:
        return inline(node, node.from, node.to, f, opts);
    }
  }

  const hyperlink = (link: string, kids: ParagraphChild[]) => new ExternalHyperlink({ link, children: kids });
  /** How link text looks. */
  const linked = (f: Format): Format => ({ ...f, color: look.color("accent"), underline: true });

  // ── Blocks ─────────────────────────────────────────────────────────────────

  /** A paragraph of text in a place: indented, and barred on the left in quotes. */
  function paragraph(kids: ParagraphChild[], place: Place, o: ParaOpts = {}) {
    const indent = indentOf(place);
    return new Paragraph({
      children: kids,
      alignment: o.alignment,
      spacing: { after: o.after ?? 140, line: 276 },
      keepNext: o.keepNext,
      indent: o.indent ?? (indent ? { left: indent } : undefined),
      border: place.quotes ? { left: { style: BorderStyle.SINGLE, size: 12, color: look.color("rule"), space: 10 } } : undefined,
    });
  }

  /** What text in a place looks like: muted in quotes. */
  const textOpts = (place: Place, leadAt: number): RunOpts =>
    place.quotes ? { color: look.color("muted"), leadAt } : { leadColor: look.label, leadAt };

  function blocks(node: SyntaxNode, place: Place) {
    for (let child = node.firstChild; child; child = child.nextSibling) block(child, place);
  }

  function block(node: SyntaxNode, place: Place) {
    const name = node.name;
    const heading = /^(?:ATX|Setext)Heading(\d)$/.exec(name);
    if (heading) return headingBlock(node, Number(heading[1]));
    switch (name) {
      case "Paragraph":
        return paragraphBlock(node, place);
      case "Blockquote":
        return blocks(node, { ...place, quotes: place.quotes + 1 });
      case "BulletList":
      case "OrderedList":
        return list(node, place, true);
      case "FencedCode":
      case "CodeBlock":
        return children.push(codeBlock(node, place));
      case "BlockMath":
        return children.push(new Paragraph({ children: [equation(texOf(slice(node.from, node.to)))], alignment: AlignmentType.CENTER, spacing: { before: 120, after: 160 } }));
      case "Table":
        return tableBlock(node);
      // Left out: rules act as section separators, and headings already carry
      // the rule; HTML has no Word equivalent.
      default:
        if (/^(?:FrontMatter|LinkReference|FootnoteDefinition|HorizontalRule|HTMLBlock|CommentBlock|ProcessingInstructionBlock)$/.test(name)) return;
        if (node.firstChild) blocks(node, place);
    }
  }

  function headingBlock(node: SyntaxNode, level: number) {
    const marks = node.getChildren("HeaderMark");
    const atx = node.name.startsWith("ATX");
    // ATX: after "# " and before closing #s; setext: the text line.
    const from = atx ? skipSpace(marks[0]?.to ?? node.from, node.to) : node.from;
    const to = atx ? (marks.length > 1 ? marks[marks.length - 1].from : node.to) : (marks[0]?.from ?? node.to);
    const font = look.font("headings");
    if (level === 1) {
      seenTitle = true;
      children.push(new Paragraph({ children: runs(node, from, to, { font, size: look.size("title"), bold: true, color: look.color("title") }), spacing: { after: 60 } }));
    } else if (level === 2 && seenTitle && !seenSubtitle) {
      seenSubtitle = true;
      children.push(
        new Paragraph({
          children: runs(node, from, to, { font, size: look.size("subtitle"), color: look.color("subtitle") }),
          spacing: { after: 200 },
          border: { bottom: { style: BorderStyle.SINGLE, size: 12, color: look.color("subtitle-rule"), space: 10 } },
        }),
      );
      children.push(new Paragraph({ text: "", spacing: { after: 160 } }));
    } else if (level === 2) {
      children.push(sectionHeading(look, runs(node, from, to, { font, size: look.size("heading"), bold: true, color: look.color("heading") })));
    } else {
      children.push(subHeading(runs(node, from, to, { font, size: look.size("subheading"), bold: true, color: look.color("subheading") })));
    }
  }

  function paragraphBlock(node: SyntaxNode, place: Place, o: ParaOpts = {}) {
    // An image on its own.
    const only = node.firstChild;
    if (only && only.name === "Image" && !only.nextSibling && only.from === node.from && slice(only.to, node.to).trim() === "") {
      const parts = linkParts(only, text, references);
      if (parts) {
        const src = parts.href.trim();
        return children.push(imageParagraph(look, slice(parts.textFrom, parts.textTo), images.get(src), rasters.get(src), place));
      }
    }
    // Metadata block: each line is its own "**Label:** value"; keep the line breaks.
    const source = slice(node.from, node.to).split("\n");
    if (look.rule("metadata-blocks") && !place.quotes && source.length > 1 && source.every((l) => /^\s*\*\*[^*]+:\*\*/.test(l))) {
      let at = node.from;
      for (const l of source) {
        const from = skipSpace(at, at + l.length);
        children.push(paragraph(runs(node, from, at + l.length, { size: look.size("metadata"), color: look.color("muted"), leadColor: look.label, leadAt: from }), place, { after: 40 }));
        at += l.length + 1;
      }
      return;
    }
    children.push(paragraph(runs(node, node.from, node.to, textOpts(place, node.from)), place, o));
  }

  /**
   * A list, its items numbered at their depth. `closing`: it ends a list at
   * the top, so its last paragraph carries the gap after the list (an empty
   * spacer paragraph costs a whole line).
   */
  function list(node: SyntaxNode, place: Place, closing: boolean) {
    const ordered = node.name === "OrderedList";
    const instance = ordered ? ++olInstance : 0;
    const level = Math.min(place.level + 1, LEVELS - 1);
    const items = node.getChildren("ListItem");
    items.forEach((item, n) => {
      const parts: SyntaxNode[] = [];
      for (let child = item.firstChild; child; child = child.nextSibling) if (child.name !== "ListMark") parts.push(child);
      const inner: Place = { quotes: place.quotes, level };
      parts.forEach((part, k) => {
        const last = closing && n === items.length - 1 && k === parts.length - 1;
        const after = last ? 200 : 90;
        if (k === 0 && (part.name === "Paragraph" || part.name === "Task")) {
          const marker = part.name === "Task" ? part.getChild("TaskMarker") : null;
          const from = marker ? skipSpace(marker.to, part.to) : part.from;
          const box = marker ? [taskBox(look, /x/i.test(slice(marker.from, marker.to)))] : [];
          // A task's box stands where the bullet would, the text at the same indent.
          children.push(
            new Paragraph({
              children: [...box, ...runs(part, from, part.to, textOpts(place, from))],
              numbering: marker ? undefined : ordered ? { reference: "numbers", level, instance } : { reference: "bullets", level },
              spacing: { after, line: 276 },
              indent: place.quotes || marker ? { left: indentOf(inner), hanging: marker ? 280 : 220 } : undefined,
              border: place.quotes ? { left: { style: BorderStyle.SINGLE, size: 12, color: look.color("rule"), space: 10 } } : undefined,
            }),
          );
        } else if (part.name === "BulletList" || part.name === "OrderedList") list(part, inner, last);
        else if (part.name === "Paragraph") paragraphBlock(part, inner, { after });
        else block(part, inner);
      });
    });
  }

  function codeBlock(node: SyntaxNode, place: Place) {
    const code = node.getChildren("CodeText").map((t) => slice(t.from, t.to)).join("\n");
    const format: Format = { font: look.font("code"), size: look.size("body") - 2, color: look.color("text"), bold: false, italics: false, strike: false };
    return new Paragraph({
      children: code.split("\n").map((line, n) => run(format, line, { break: n ? 1 : undefined })),
      spacing: { before: 60, after: 200, line: 252 },
      indent: { left: indentOf(place) + 160 },
      keepLines: true,
      border: { left: { style: BorderStyle.SINGLE, size: 12, color: look.color("rule"), space: 10 } },
    });
  }

  function tableBlock(node: SyntaxNode) {
    const widthsAt = widthsLineAbove((n) => lines[n - 1] ?? "", lineOf(node.from));
    const set = widthsAt ? parseWidths(parseDirective(lines[widthsAt - 1])?.value ?? "") : null;
    const rows = [node.getChild("TableHeader"), ...node.getChildren("TableRow")]
      .filter((r): r is SyntaxNode => !!r)
      .map((r) => {
        const cells = rowCells(r);
        return { cells, text: cells.map((c) => (c ? slice(c.from, c.to) : "")) };
      });
    if (!rows.length) return;
    const render: CellRuns = (c, opts) => (c ? runs(c, c.from, c.to, { ...opts, leadAt: c.from }) : runs(node, 0, 0, opts));
    children.push(buildTable(look, rows, tableAligns(node, text), set, render));
    // A tiny run rather than an empty paragraph: same visual gap, a third of
    // the vertical cost.
    children.push(new Paragraph({ children: [new TextRun({ text: "", size: 8 })], spacing: { after: 150 } }));
  }

  blocks(tree.topNode, TOP);

  const footnotes: Record<number, { children: Paragraph[] }> = {};
  for (const [label, n] of look.footnotes) {
    const note = notes.get(label)!;
    const from = skipSpace(note.getChild("FootnoteLabel")?.to ?? note.from, note.to);
    // Word puts the note's number first; a space keeps it off the text.
    const size = look.size("footnote");
    footnotes[n] = { children: [new Paragraph({ children: [new TextRun({ text: " ", size }), ...runs(note, from, note.to, { size })] })] };
  }

  // ── Document ───────────────────────────────────────────────────────────────
  return new Document({
    footnotes,
    creator: property("author"),
    title: docTitle,
    description: property("description"),
    subject: property("subject") || undefined,
    keywords: property("keywords") || undefined,
    numbering: {
      config: [
        {
          reference: "bullets",
          levels: BULLETS.map((text, level) => ({
            level,
            format: LevelFormat.BULLET,
            text,
            alignment: AlignmentType.LEFT,
            style: {
              paragraph: { indent: { left: LIST_INDENT + level * LEVEL_INDENT, hanging: 220 } },
              run: { color: look.color("accent") },
            },
          })),
        },
        {
          reference: "numbers",
          levels: NUMBERS.map(([format, text], level) => ({
            level,
            format,
            text,
            alignment: AlignmentType.LEFT,
            style: {
              paragraph: { indent: { left: LIST_INDENT + level * LEVEL_INDENT, hanging: 220 } },
              run: { color: look.color("accent"), bold: true },
            },
          })),
        },
      ],
    },
    styles: {
      default: {
        document: { run: { font: look.font("body"), size: look.size("body"), color: look.color("text") } },
      },
      paragraphStyles: [
        {
          // The page number field has no run formatting of its own, so it takes
          // this style's. Its default PAGE field picked up the formatting of the
          // last body paragraph in LibreOffice (e.g. a 4pt table spacer).
          id: "FooterLine",
          name: "Footer Line",
          basedOn: "Normal",
          run: { font: look.font("body"), size: look.size("footer"), color: look.color("muted"), bold: true },
        },
      ],
    },
    sections: [
      {
        properties: {
          page: {
            size: look.page,
            margin: {
              top: look.margin("top"),
              bottom: look.margin("bottom"),
              left: look.margin("left"),
              right: look.margin("right"),
            },
          },
        },
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                style: "FooterLine",
                spacing: { before: 100 },
                border: {
                  top: { style: BorderStyle.SINGLE, size: 4, color: look.color("rule"), space: 6 },
                },
                tabStops: [{ type: "right", position: CONTENT_W }],
                children: [
                  new TextRun({ text: footerText, font: look.font("body"), size: look.size("footer"), color: look.color("muted"), bold: false }),
                  new TextRun({ text: "\t", font: look.font("body"), size: look.size("footer") }),
                  // Formatted by the FooterLine style: the field run itself carries none.
                  new SimpleField("PAGE", "1"),
                ],
              }),
            ],
          }),
        },
        children,
      },
    ],
  });
}

/** The .docx file for a markdown document, as bytes. Works in the browser and in Node. */
export async function markdownToDocx(src: string, style?: ExportStyle, images?: Map<string, Uint8Array>, rasters?: Map<string, Uint8Array>): Promise<Uint8Array> {
  const blob = await Packer.toBlob(buildDocument(src, style, images, rasters));
  return new Uint8Array(await blob.arrayBuffer());
}
