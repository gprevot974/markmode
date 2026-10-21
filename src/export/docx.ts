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
 * left out.
 */

import {
  Document,
  Packer,
  Paragraph,
  TextRun,
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
  convertInchesToTwip,
} from "docx";
import { stripComments } from "../criticmarkup.ts";
import { fitWidths, parseDirective, parseWidths, widthsLineAbove } from "../directives.ts";
import { frontMatter } from "../frontmatter.ts";
import { defaultStyle, type ExportStyle } from "./style.ts";

type Alignment = (typeof AlignmentType)[keyof typeof AlignmentType];

const PAGES = { letter: { width: 12240, height: 15840 }, a4: { width: 11906, height: 16838 } };

/** A style's values, ready for the builders: colors, fonts, sizes in half-points, twips. */
class Look {
  readonly style: ExportStyle;
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

// ── Inline markdown (**bold**, *italic*, `code`) ─────────────────────────────
//
// Bold does two jobs here, and they get two colors:
//
//   Label     — bold opening a paragraph, list item or table row, naming what
//               follows ("Month 2 — Build and migrate."). Rendered in indigo,
//               so it reads as a mini-heading. Controlled by `leadColor`.
//   Emphasis  — bold mid-sentence, stressing a phrase. Stays body black, so it
//               does not compete with the labels. Controlled by `boldColor`.
//
// The distinction is positional: only a bold run at offset 0 is a label.
interface RunOpts {
  size?: number;
  font?: string;
  color?: string;
  bold?: boolean;
  italics?: boolean;
  leadColor?: string;
  boldColor?: string;
}

function runs(look: Look, text: string, opts: RunOpts = {}): TextRun[] {
  const base = {
    font: opts.font ?? look.font("body"),
    size: opts.size ?? look.size("body"),
    color: opts.color ?? look.color("text"),
    bold: opts.bold ?? false,
    italics: opts.italics ?? false,
  };
  const out: TextRun[] = [];
  const re = /(\*\*[^*]+\*\*|\*[^*\n]+\*|`[^`]+`)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(new TextRun({ ...base, text: text.slice(last, m.index) }));
    const tok = m[0];
    if (tok.startsWith("**")) {
      const isLabel = m.index === 0 && opts.leadColor;
      out.push(
        new TextRun({
          ...base,
          text: tok.slice(2, -2),
          bold: true,
          color: isLabel ? opts.leadColor : (opts.boldColor ?? base.color),
        }),
      );
    } else if (tok.startsWith("`")) {
      out.push(new TextRun({ ...base, text: tok.slice(1, -1), font: look.font("code"), size: base.size - 2 }));
    } else {
      out.push(new TextRun({ ...base, text: tok.slice(1, -1), italics: true }));
    }
    last = m.index + tok.length;
  }
  if (last < text.length) out.push(new TextRun({ ...base, text: text.slice(last) }));
  return out.length ? out : [new TextRun({ ...base, text: "" })];
}

const stripMd = (s: string) => s.replace(/\*\*/g, "").replace(/`/g, "").trim();

// ── Block builders ───────────────────────────────────────────────────────────
interface ParaOpts extends RunOpts {
  alignment?: Alignment;
  after?: number;
  keepNext?: boolean;
  indent?: { left?: number; hanging?: number };
}

const para = (look: Look, text: string, opts: ParaOpts = {}) =>
  new Paragraph({
    children: runs(look, text, { leadColor: look.label, ...opts }),
    alignment: opts.alignment,
    spacing: { after: opts.after ?? 140, line: 276 },
    keepNext: opts.keepNext,
    indent: opts.indent,
  });

const sectionHeading = (look: Look, text: string) =>
  new Paragraph({
    children: runs(look, text, { font: look.font("headings"), size: look.size("heading"), bold: true, color: look.color("heading") }),
    heading: HeadingLevel.HEADING_1,
    spacing: { before: 360, after: 160 },
    keepNext: true,
    border: look.rule("heading-rules")
      ? { bottom: { style: BorderStyle.SINGLE, size: 6, color: look.color("rule"), space: 6 } }
      : undefined,
  });

const subHeading = (look: Look, text: string) =>
  new Paragraph({
    children: runs(look, text, {
      font: look.font("headings"),
      size: look.size("subheading"),
      bold: true,
      color: look.color("subheading"),
    }),
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

function cell(look: Look, text: string, o: CellOpts) {
  return new TableCell({
    width: { size: o.width, type: WidthType.DXA },
    shading: o.fill ? { type: ShadingType.CLEAR, fill: o.fill, color: "auto" } : undefined,
    margins: { top: 90, bottom: 90, left: 130, right: 130 },
    children: [
      new Paragraph({
        children: runs(look, text, {
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

/** `set`: fractions from a widths directive. */
function buildTable(look: Look, rows: string[][], aligns: string[], set: number[] | null) {
  const nCols = rows[0].length;
  const CONTENT_W = look.contentWidth;
  let widths: number[];
  if (set) widths = fitWidths(set, nCols).map((f) => Math.round(f * CONTENT_W));
  // Shares tuned for the letter page, for the tables proposals mostly have.
  else if (nCols === 4) widths = [2160, 2640, 2640, 2640].map((w) => Math.round((w / 10080) * CONTENT_W));
  else if (nCols === 2) widths = (aligns[1] === "right" ? [8280, 1800] : [4000, 6080]).map((w) => Math.round((w / 10080) * CONTENT_W));
  else widths = Array(nCols).fill(Math.floor(CONTENT_W / nCols));

  const headerEmpty = rows[0].every((c) => stripMd(c) === "");
  const word = (look.rule("total-rows") as string).trim();
  const total = word ? new RegExp(`\\*\\*${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "i") : null;
  const [header, headerText] = [look.color("table-header"), look.color("table-header-text")];
  const [totalFill, totalText, text] = [look.color("table-total"), look.color("table-total-text"), look.color("text")];
  const band = (n: number) => look.rule("table-bands") && n % 2 === 1;
  const body = headerEmpty ? rows.slice(1) : rows;

  const trs = body.map((cells, i) => {
    const isHeader = !headerEmpty && i === 0;
    const rowText = cells.join(" ");
    const isTotal = !!total && total.test(rowText);

    return new TableRow({
      tableHeader: isHeader,
      cantSplit: true,
      children: cells.map((c, j) =>
        cell(look, c, {
          keepNext: i < body.length - 1,
          width: widths[j],
          fill: isHeader ? header : isTotal ? totalFill : band(headerEmpty ? i : i - 1) ? look.color("table-band") : undefined,
          bold: isHeader || isTotal,
          color: isHeader ? headerText : isTotal ? totalText : text,
          // Header and total rows are uniformly colored already, so both bold
          // roles collapse to the row color there; body rows get the split.
          leadColor: isHeader ? headerText : isTotal ? totalText : look.label,
          boldColor: isHeader ? headerText : isTotal ? totalText : text,
          align: aligns[j] === "right" ? AlignmentType.RIGHT : undefined,
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

// ── Markdown parsing ─────────────────────────────────────────────────────────
export function buildDocument(src: string, style: ExportStyle = defaultStyle()): Document {
  const look = new Look(style);
  const CONTENT_W = look.contentWidth;
  // Comments are notes for the writers (and their agents), not for readers.
  const text = stripComments(src);
  const lines = text.split("\n");
  const children: (Paragraph | Table)[] = [];
  const front = frontMatter(text);
  let i = front?.endLine ?? 0;
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
  const titleLine = lines.slice(i).find((l) => l.trim().startsWith("# "));
  const docTitle = property("title") || (titleLine ? titleLine.trim().slice(2).replace(/[*_`]/g, "") : "");
  const footerText = property("footer");

  function flushParagraph(buf: string[]) {
    if (!buf.length) return;
    const joined = buf.join(" ").replace(/\s+/g, " ").trim();
    if (!joined) return;
    // Metadata block: each line is its own "**Label:** value" — keep the line breaks.
    const allMeta = look.rule("metadata-blocks") && buf.every((l) => /^\*\*[^*]+:\*\*/.test(l.trim()));
    if (allMeta && buf.length > 1) {
      const muted = look.color("muted");
      buf.forEach((l) => children.push(para(look, l.trim(), { size: look.size("metadata"), color: muted, after: 40 })));
      return;
    }
    children.push(para(look, joined));
  }

  while (i < lines.length) {
    const line = lines[i].trim();

    if (line === "") {
      i++;
      continue;
    }

    // Horizontal rules act as section separators; headings already carry the rule.
    if (/^---+$/.test(line)) {
      i++;
      continue;
    }

    // Single-line HTML comments (e.g. build directives) are not rendered.
    if (/^<!--.*-->$/.test(line)) {
      i++;
      continue;
    }

    // Headings
    if (line.startsWith("# ")) {
      children.push(
        new Paragraph({
          children: runs(look, line.slice(2), { font: look.font("headings"), size: look.size("title"), bold: true, color: look.color("title") }),
          spacing: { after: 60 },
        }),
      );
      seenTitle = true;
      i++;
      continue;
    }
    if (line.startsWith("## ")) {
      if (seenTitle && !seenSubtitle) {
        children.push(
          new Paragraph({
            children: runs(look, line.slice(3), { font: look.font("headings"), size: look.size("subtitle"), color: look.color("subtitle") }),
            spacing: { after: 200 },
            border: {
              bottom: { style: BorderStyle.SINGLE, size: 12, color: look.color("subtitle-rule"), space: 10 },
            },
          }),
        );
        children.push(new Paragraph({ text: "", spacing: { after: 160 } }));
        seenSubtitle = true;
      } else {
        children.push(sectionHeading(look, line.slice(3)));
      }
      i++;
      continue;
    }
    if (line.startsWith("### ")) {
      children.push(subHeading(look, line.slice(4)));
      i++;
      continue;
    }

    // Tables
    if (line.startsWith("|")) {
      const widthsAt = widthsLineAbove((n) => lines[n - 1], i + 1);
      const set = widthsAt ? parseWidths(parseDirective(lines[widthsAt - 1])?.value ?? "") : null;
      const block: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith("|")) {
        block.push(lines[i].trim());
        i++;
      }
      const split = (r: string) =>
        r
          .replace(/^\|/, "")
          .replace(/\|$/, "")
          .split("|")
          .map((c) => c.trim());
      const sep = block[1] ?? "";
      const aligns = split(sep).map((s) => (s.endsWith(":") && !s.startsWith(":") ? "right" : "left"));
      const rows = block.filter((_, n) => n !== 1).map(split);
      children.push(buildTable(look, rows, aligns, set));
      // A tiny run rather than an empty paragraph: same visual gap, a third of
      // the vertical cost.
      children.push(
        new Paragraph({
          children: [new TextRun({ text: "", size: 8 })],
          spacing: { after: 150 },
        }),
      );
      continue;
    }

    // Lists. Items are gathered first so the last one can carry the trailing gap
    // itself — an empty spacer paragraph costs a whole line, and across a dozen
    // lists that was pushing the closing block onto a page of its own.
    const bullet = /^[-*] /.test(line);
    if (bullet || /^\d+\. /.test(line)) {
      const marker = bullet ? /^[-*] / : /^\d+\. /;
      if (!bullet) olInstance++;
      const items: string[] = [];
      while (i < lines.length && marker.test(lines[i].trim())) {
        let item = lines[i].trim().replace(marker, "");
        i++;
        while (i < lines.length && /^\s{2,}\S/.test(lines[i]) && !marker.test(lines[i].trim())) {
          item += " " + lines[i].trim();
          i++;
        }
        items.push(item);
      }
      const instance = olInstance;
      items.forEach((item, n) =>
        children.push(
          new Paragraph({
            children: runs(look, item, { leadColor: look.label }),
            numbering: bullet
              ? { reference: "bullets", level: 0 }
              : { reference: "numbers", level: 0, instance },
            spacing: { after: n === items.length - 1 ? 200 : 90, line: 276 },
          }),
        ),
      );
      continue;
    }

    // Paragraph
    const buf: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      !/^---+$/.test(lines[i].trim()) &&
      !lines[i].trim().startsWith("#") &&
      !lines[i].trim().startsWith("|") &&
      !/^[-*] /.test(lines[i].trim()) &&
      !/^\d+\. /.test(lines[i].trim())
    ) {
      buf.push(lines[i].trim());
      i++;
    }
    flushParagraph(buf);
  }

  // ── Document ───────────────────────────────────────────────────────────────
  return new Document({
    creator: property("author"),
    title: docTitle,
    description: property("description"),
    subject: property("subject") || undefined,
    keywords: property("keywords") || undefined,
    numbering: {
      config: [
        {
          reference: "bullets",
          levels: [
            {
              level: 0,
              format: LevelFormat.BULLET,
              text: "•",
              alignment: AlignmentType.LEFT,
              style: {
                paragraph: { indent: { left: 400, hanging: 220 } },
                run: { color: look.color("accent") },
              },
            },
          ],
        },
        {
          reference: "numbers",
          levels: [
            {
              level: 0,
              format: LevelFormat.DECIMAL,
              text: "%1.",
              alignment: AlignmentType.LEFT,
              style: {
                paragraph: { indent: { left: 400, hanging: 220 } },
                run: { color: look.color("accent"), bold: true },
              },
            },
          ],
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
export async function markdownToDocx(src: string, style?: ExportStyle): Promise<Uint8Array> {
  const blob = await Packer.toBlob(buildDocument(src, style));
  return new Uint8Array(await blob.arrayBuffer());
}
