/* Builds a styled .docx from markdown. Ported from the standalone
 * build-docx.js; it runs both in the editor (`:export-docx`) and from the
 * command line:
 *
 *   node scripts/build-docx.ts input.md output.docx
 *
 * CriticMarkup comments ({>>note<<}, {==highlight==}) are left out.
 *
 * Build directives are single-line HTML comments in the markdown:
 *   <!-- footer: Commercially confidential -->  text left of the page number
 *   <!-- no-subtitle -->                        first "##" is a real section
 *   <!-- author: Name -->                       document author property
 *   <!-- description: Project proposal -->      document description property
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

type Alignment = (typeof AlignmentType)[keyof typeof AlignmentType];

// ── Brand palette ────────────────────────────────────────────────────────────
const INDIGO = "203864"; // primary / headings
const PAPRIKA = "DE5220"; // highlight / key figures
const BALTIC = "537490"; // secondary / subheadings
const PASTEL = "A1CAD7"; // accent / total rows
const BALTIC_LIGHT = "D9E1E9"; // borders
const ALT_ROW = "EDF2F6"; // derived light tint for banding
const BODY = "1F1F1F";
const WHITE = "FFFFFF";

const CONTENT_W = 10080; // Letter (12240) minus 1080 margins each side
const FONT = "Calibri";

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
  color?: string;
  bold?: boolean;
  italics?: boolean;
  leadColor?: string;
  boldColor?: string;
}

function runs(text: string, opts: RunOpts = {}): TextRun[] {
  const base = {
    font: FONT,
    size: opts.size ?? 21,
    color: opts.color ?? BODY,
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
      out.push(new TextRun({ ...base, text: tok.slice(1, -1), font: "Consolas", size: base.size - 2 }));
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

const para = (text: string, opts: ParaOpts = {}) =>
  new Paragraph({
    children: runs(text, { leadColor: INDIGO, ...opts }),
    alignment: opts.alignment,
    spacing: { after: opts.after ?? 140, line: 276 },
    keepNext: opts.keepNext,
    indent: opts.indent,
  });

const sectionHeading = (text: string) =>
  new Paragraph({
    children: runs(text, { size: 27, bold: true, color: INDIGO }),
    heading: HeadingLevel.HEADING_1,
    spacing: { before: 360, after: 160 },
    keepNext: true,
    border: {
      bottom: { style: BorderStyle.SINGLE, size: 6, color: BALTIC_LIGHT, space: 6 },
    },
  });

const subHeading = (text: string) =>
  new Paragraph({
    children: runs(text, { size: 23, bold: true, color: BALTIC }),
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

function cell(text: string, o: CellOpts) {
  return new TableCell({
    width: { size: o.width, type: WidthType.DXA },
    shading: o.fill ? { type: ShadingType.CLEAR, fill: o.fill, color: "auto" } : undefined,
    margins: { top: 90, bottom: 90, left: 130, right: 130 },
    children: [
      new Paragraph({
        children: runs(text, {
          size: 19,
          bold: o.bold,
          color: o.color ?? BODY,
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

function buildTable(rows: string[][], aligns: string[]) {
  const nCols = rows[0].length;
  let widths: number[];
  if (nCols === 4) widths = [2160, 2640, 2640, 2640];
  else if (nCols === 2) widths = aligns[1] === "right" ? [8280, 1800] : [4000, 6080];
  else widths = Array(nCols).fill(Math.floor(CONTENT_W / nCols));

  const headerEmpty = rows[0].every((c) => stripMd(c) === "");
  const body = headerEmpty ? rows.slice(1) : rows;

  const trs = body.map((cells, i) => {
    const isHeader = !headerEmpty && i === 0;
    const rowText = cells.join(" ");
    const isTotal = /\*\*Total/i.test(rowText);

    return new TableRow({
      tableHeader: isHeader,
      cantSplit: true,
      children: cells.map((c, j) =>
        cell(c, {
          keepNext: i < body.length - 1,
          width: widths[j],
          fill: isHeader ? INDIGO : isTotal ? PASTEL : (headerEmpty ? i : i - 1) % 2 === 1 ? ALT_ROW : undefined,
          bold: isHeader || isTotal,
          color: isHeader ? WHITE : isTotal ? INDIGO : BODY,
          // Header and total rows are uniformly colored already, so both bold
          // roles collapse to the row color there; body rows get the split.
          leadColor: isHeader ? WHITE : INDIGO,
          boldColor: isHeader ? WHITE : isTotal ? INDIGO : BODY,
          align: aligns[j] === "right" ? AlignmentType.RIGHT : undefined,
        }),
      ),
    });
  });

  const edge = { style: BorderStyle.SINGLE, size: 4, color: BALTIC_LIGHT };
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
export function buildDocument(src: string): Document {
  // Comments are notes for the writers (and their agents), not for readers.
  const lines = stripComments(src).split("\n");
  const children: (Paragraph | Table)[] = [];
  let i = 0;
  let olInstance = 0;
  let seenTitle = false;

  // Build directives are single-line HTML comments: <!-- key --> or <!-- key: value -->.
  const directives: Record<string, string | true> = {};
  for (const l of lines) {
    const m = l.trim().match(/^<!--\s*([\w-]+)\s*(?::\s*(.*?))?\s*-->$/);
    if (m) directives[m[1]] = m[2] ?? true;
  }
  const directive = (key: string) => (typeof directives[key] === "string" ? (directives[key] as string) : "");
  // By default the first "##" after the "#" title is styled as a subtitle.
  // A document whose first "##" is a real section opts out with <!-- no-subtitle -->.
  let seenSubtitle = directives["no-subtitle"] === true;
  // Document title property: the "#" heading, without markdown emphasis.
  const titleLine = lines.find((l) => l.trim().startsWith("# "));
  const docTitle = titleLine ? titleLine.trim().slice(2).replace(/[*_`]/g, "") : "";
  // Footer text left of the page number, e.g. <!-- footer: Commercially confidential -->.
  const footerText = directive("footer");

  function flushParagraph(buf: string[]) {
    if (!buf.length) return;
    const joined = buf.join(" ").replace(/\s+/g, " ").trim();
    if (!joined) return;
    // Metadata block: each line is its own "**Label:** value" — keep the line breaks.
    const allMeta = buf.every((l) => /^\*\*[^*]+:\*\*/.test(l.trim()));
    if (allMeta && buf.length > 1) {
      buf.forEach((l) => children.push(para(l.trim(), { size: 20, color: BALTIC, after: 40 })));
      return;
    }
    children.push(para(joined));
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
          children: runs(line.slice(2), { size: 46, bold: true, color: INDIGO }),
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
            children: runs(line.slice(3), { size: 26, color: BALTIC }),
            spacing: { after: 200 },
            border: {
              bottom: { style: BorderStyle.SINGLE, size: 12, color: PAPRIKA, space: 10 },
            },
          }),
        );
        children.push(new Paragraph({ text: "", spacing: { after: 160 } }));
        seenSubtitle = true;
      } else {
        children.push(sectionHeading(line.slice(3)));
      }
      i++;
      continue;
    }
    if (line.startsWith("### ")) {
      children.push(subHeading(line.slice(4)));
      i++;
      continue;
    }

    // Tables
    if (line.startsWith("|")) {
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
      children.push(buildTable(rows, aligns));
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
            children: runs(item, { leadColor: INDIGO }),
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
    creator: directive("author"),
    title: docTitle,
    description: directive("description"),
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
                run: { color: PAPRIKA },
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
                run: { color: PAPRIKA, bold: true },
              },
            },
          ],
        },
      ],
    },
    styles: {
      default: {
        document: { run: { font: FONT, size: 21, color: BODY } },
      },
      paragraphStyles: [
        {
          // The page number field has no run formatting of its own, so it takes
          // this style's. Its default PAGE field picked up the formatting of the
          // last body paragraph in LibreOffice (e.g. a 4pt table spacer).
          id: "FooterLine",
          name: "Footer Line",
          basedOn: "Normal",
          run: { font: FONT, size: 16, color: BALTIC, bold: true },
        },
      ],
    },
    sections: [
      {
        properties: {
          page: {
            size: { width: 12240, height: 15840 },
            margin: {
              top: convertInchesToTwip(0.85),
              bottom: convertInchesToTwip(0.8),
              left: convertInchesToTwip(0.75),
              right: convertInchesToTwip(0.75),
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
                  top: { style: BorderStyle.SINGLE, size: 4, color: BALTIC_LIGHT, space: 6 },
                },
                tabStops: [{ type: "right", position: CONTENT_W }],
                children: [
                  new TextRun({ text: footerText, font: FONT, size: 16, color: BALTIC, bold: false }),
                  new TextRun({ text: "\t", font: FONT, size: 16 }),
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
export async function markdownToDocx(src: string): Promise<Uint8Array> {
  const blob = await Packer.toBlob(buildDocument(src));
  return new Uint8Array(await blob.arrayBuffer());
}
