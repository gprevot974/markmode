// Markdown → a standalone HTML page, in an export style: the same colors,
// fonts, sizes and rules as the docx export (docx.ts) and the export preview.
// It holds everything it shows, images included, so it can be sent as one
// file; printing it from a browser gives a PDF on the style's page, with its
// margins and footer. Math is MathML, which browsers typeset themselves.
//
// Like docx.ts it reads the markdown's syntax tree (tree.ts).

import type { SyntaxNode } from "@lezer/common";
import katex from "katex";
import { stripComments } from "../criticmarkup.ts";
import { fitWidths, parseDirective, parseWidths, widthsLineAbove } from "../directives.ts";
import { frontMatter } from "../frontmatter.ts";
import { footnoteLabel, footnoteNumbers } from "../preview/footnoteSyntax.ts";
import { texOf } from "../preview/math.ts";
import { slug } from "../links.ts";
import { imageType } from "../images.ts";
import { defaultStyle, type ExportStyle } from "./style.ts";
import { between, definitions, exportParser, linkParts as partsOf, rowCells, tableAligns } from "./tree.ts";

const escape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Bytes as base64, in the browser and in Node. */
function base64(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 0x8000) out += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(out);
}

/** A link target that is safe to put in a page: no `javascript:` and the like. */
function safeHref(url: string): string {
  const bare = url.trim().replace(/^<(.*)>$/, "$1");
  return /^[a-z][\w+.-]*:/i.test(bare) && !/^(?:https?|mailto|tel):/i.test(bare) ? "#" : bare;
}

/**
 * The page for a markdown text. `images`: the bytes of the local images it
 * shows, by their `src` (images.ts's loadImages), put in the page itself.
 */
export function markdownToHtml(src: string, style: ExportStyle = defaultStyle(), images: Map<string, Uint8Array> = new Map()): string {
  const text = stripComments(src);
  const tree = exportParser.parse(text);
  const lines = text.split("\n");
  const slice = (from: number, to: number) => text.slice(from, to);
  const lineOf = (pos: number) => text.slice(0, pos).split("\n").length;
  const front = frontMatter(text);
  const rule = (name: string) => style[`rules.${name}`];

  const directives: Record<string, string | true> = {};
  for (const l of lines) {
    const d = parseDirective(l);
    if (d) directives[d.key] = d.value ?? true;
  }
  const property = (key: string) => {
    const value = front?.fields[key] ?? directives[key];
    return typeof value === "string" ? value : "";
  };

  // Reference links' definitions, and the footnotes, numbered by first reference.
  const { references, notes } = definitions(tree, text);
  const numbers = new Map([...footnoteNumbers(text)].filter(([label]) => notes.has(label)));

  let seenTitle = false;
  let seenSubtitle = !rule("subtitle") || front?.fields.subtitle === false || directives["no-subtitle"] === true;
  const usedIds = new Set<string>();
  const headingId = (title: string) => {
    let id = slug(title) || "section";
    for (let n = 1; usedIds.has(id); n++) id = `${slug(title)}-${n}`;
    usedIds.add(id);
    return id;
  };

  // ── Inline ─────────────────────────────────────────────────────────────────

  /** The inline content of `node` between `from` and `to`: its text, and its children rendered. */
  function inline(node: SyntaxNode, from = node.from, to = node.to): string {
    let out = "";
    let pos = from;
    for (let child = node.firstChild; child; child = child.nextSibling) {
      if (child.to <= from || child.from >= to) continue;
      if (child.from > pos) out += escape(slice(pos, child.from));
      out += inlineNode(child);
      pos = Math.max(pos, child.to);
    }
    if (pos < to) out += escape(slice(pos, to));
    return out;
  }

  const linkParts = (node: SyntaxNode) => partsOf(node, text, references);

  function inlineNode(node: SyntaxNode): string {
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
        return "";
      case "Escape":
        return escape(slice(node.from + 1, node.to));
      case "Entity":
        return slice(node.from, node.to);
      case "HardBreak":
        return "<br>\n";
      case "HTMLTag":
        return slice(node.from, node.to);
      case "Emphasis": {
        const [a, b] = between(node, "EmphasisMark");
        return `<em>${inline(node, a, b)}</em>`;
      }
      case "StrongEmphasis": {
        const [a, b] = between(node, "EmphasisMark");
        // Bold opening a paragraph, list item or table cell is a label.
        const lead = rule("bold-labels") && node.parent && /^(?:Paragraph|TableCell)$/.test(node.parent.name) && node.parent.from === node.from;
        return `<strong${lead ? ' class="lead"' : ""}>${inline(node, a, b)}</strong>`;
      }
      case "Strikethrough": {
        const [a, b] = between(node, "StrikethroughMark");
        return `<s>${inline(node, a, b)}</s>`;
      }
      case "InlineCode": {
        const [a, b] = between(node, "CodeMark");
        return `<code>${escape(slice(a, b))}</code>`;
      }
      case "URL":
        return `<a href="${escape(safeHref(/^www\./i.test(slice(node.from, node.to)) ? `https://${slice(node.from, node.to)}` : slice(node.from, node.to)))}">${escape(slice(node.from, node.to))}</a>`;
      case "Autolink": {
        const url = node.getChild("URL");
        if (!url) return escape(slice(node.from, node.to));
        const target = slice(url.from, url.to);
        const href = /^[\w.+-]+@[\w-]+\.[\w.-]+$/.test(target) ? `mailto:${target}` : target;
        return `<a href="${escape(safeHref(href))}">${escape(target)}</a>`;
      }
      case "Link": {
        const parts = linkParts(node);
        if (!parts) return inline(node);
        const title = parts.title ? ` title="${escape(parts.title)}"` : "";
        return `<a href="${escape(safeHref(parts.href))}"${title}>${inline(node, parts.textFrom, parts.textTo)}</a>`;
      }
      case "Image": {
        const parts = linkParts(node);
        if (!parts) return escape(slice(node.from, node.to));
        const alt = slice(parts.textFrom, parts.textTo);
        const src = parts.href.trim();
        const bytes = images.get(src);
        const type = imageType(src.replace(/^<(.*)>$/, "$1"));
        const url = bytes && type ? `data:${type};base64,${base64(bytes)}` : safeHref(src);
        const title = parts.title ? ` title="${escape(parts.title)}"` : "";
        return `<img src="${escape(url)}" alt="${escape(alt)}"${title}>`;
      }
      case "WikiLink": {
        const [target, shown] = slice(node.from + 2, node.to - 2).split("|");
        const hash = target.indexOf("#");
        const name = (hash < 0 ? target : target.slice(0, hash)).trim();
        const anchor = hash < 0 ? "" : `#${slug(target.slice(hash + 1))}`;
        const label = shown ?? (hash < 0 ? target : `${name} › ${target.slice(hash + 1).trim()}`);
        return `<a class="wiki" href="${escape(name ? `${name}.md${anchor}` : anchor)}">${escape(label.trim())}</a>`;
      }
      case "FootnoteRef": {
        const label = footnoteLabel(slice(node.from, node.to));
        const n = numbers.get(label);
        return n ? `<sup class="footnote-ref"><a href="#fn-${n}" id="fnref-${n}">${n}</a></sup>` : escape(slice(node.from, node.to));
      }
      case "InlineMath": {
        const source = slice(node.from, node.to);
        return math(texOf(source), source.startsWith("$$"));
      }
      default:
        return inline(node);
    }
  }

  function math(tex: string, display: boolean) {
    return katex.renderToString(tex, { displayMode: display, output: "mathml", throwOnError: false });
  }

  // ── Blocks ─────────────────────────────────────────────────────────────────

  function blocks(node: SyntaxNode): string {
    let out = "";
    for (let child = node.firstChild; child; child = child.nextSibling) out += block(child);
    return out;
  }

  function block(node: SyntaxNode): string {
    const name = node.name;
    const heading = /^(?:ATX|Setext)Heading(\d)$/.exec(name);
    if (heading) {
      const level = Number(heading[1]);
      const marks = node.getChildren("HeaderMark");
      // ATX: after "# " and before closing #s; setext: the text line.
      const from = name.startsWith("ATX") ? (marks[0]?.to ?? node.from) : node.from;
      const to = name.startsWith("ATX") ? (marks.length > 1 ? marks[marks.length - 1].from : node.to) : (marks[0]?.from ?? node.to);
      const content = inline(node, from, to).trim();
      const id = headingId(slice(from, to).replace(/[*_`]/g, ""));
      if (level === 1) seenTitle = true;
      if (level === 2 && seenTitle && !seenSubtitle) {
        seenSubtitle = true;
        return `<p class="subtitle" id="${id}">${content}</p>\n`;
      }
      return `<h${level} id="${id}">${content}</h${level}>\n`;
    }
    switch (name) {
      case "FrontMatter":
      case "LinkReference":
      case "FootnoteDefinition":
      case "CommentBlock":
      case "ProcessingInstructionBlock":
      // The export leaves rules out, as the docx does: headings carry their own.
      case "HorizontalRule":
        return "";
      case "Paragraph": {
        // A metadata block: every line "**Label:** value", kept line by line.
        const source = slice(node.from, node.to).split("\n");
        if (rule("metadata-blocks") && source.length > 1 && source.every((l) => /^\s*\*\*[^*]+:\*\*/.test(l))) {
          return `<p class="meta">${inline(node).replace(/\n/g, "<br>\n")}</p>\n`;
        }
        return `<p>${inline(node)}</p>\n`;
      }
      case "Blockquote":
        return `<blockquote>\n${blocks(node)}</blockquote>\n`;
      case "BulletList":
      case "OrderedList": {
        const tag = name === "BulletList" ? "ul" : "ol";
        const first = node.firstChild?.getChild("ListMark");
        const start = tag === "ol" && first ? parseInt(slice(first.from, first.to)) : 1;
        return `<${tag}${start !== 1 ? ` start="${start}"` : ""}>\n${blocks(node)}</${tag}>\n`;
      }
      case "ListItem": {
        // A tight item's paragraph is its text.
        const parts: string[] = [];
        let task = "";
        for (let child = node.firstChild; child; child = child.nextSibling) {
          if (child.name === "ListMark") continue;
          if (child.name === "Task") {
            const marker = child.getChild("TaskMarker");
            const done = marker && /x/i.test(slice(marker.from, marker.to));
            task = ` class="task${done ? " done" : ""}"`;
            // A drawn box rather than a disabled checkbox, which browsers gray out.
            parts.push(`<span class="box" role="img" aria-label="${done ? "done" : "to do"}"></span>${inline(child, marker?.to ?? child.from, child.to).trim()}`);
          } else if (child.name === "Paragraph") parts.push(inline(child));
          else parts.push(block(child));
        }
        return `<li${task}>${parts.join("\n")}</li>\n`;
      }
      case "FencedCode":
      case "CodeBlock": {
        const info = node.getChild("CodeInfo");
        const lang = info ? slice(info.from, info.to).trim().split(/\s/)[0] : "";
        const code = node.getChildren("CodeText").map((t) => slice(t.from, t.to)).join("\n");
        return `<pre><code${lang ? ` class="language-${escape(lang)}"` : ""}>${escape(code)}</code></pre>\n`;
      }
      case "BlockMath":
        return `<div class="math">${math(texOf(slice(node.from, node.to)), true)}</div>\n`;
      case "Table":
        return table(node);
      case "HTMLBlock":
        return slice(node.from, node.to) + "\n";
      default:
        return node.firstChild ? blocks(node) : "";
    }
  }

  function table(node: SyntaxNode): string {
    const aligns = tableAligns(node, text);
    const cells = (row: SyntaxNode, tag: string) =>
      rowCells(row).map((cell, i) => `<${tag}${aligns[i] ? ` style="text-align:${aligns[i]}"` : ""}>${cell ? inline(cell).trim() : ""}</${tag}>`);
    const header = node.getChild("TableHeader");
    const rows = node.getChildren("TableRow");
    const columns = Math.max(header ? rowCells(header).length : 0, ...rows.map((r) => rowCells(r).length));
    // Column widths from a widths directive above the table.
    const widthsAt = widthsLineAbove((n) => lines[n - 1] ?? "", lineOf(node.from));
    const set = widthsAt ? parseWidths(parseDirective(lines[widthsAt - 1])?.value ?? "") : null;
    const cols = set ? `<colgroup>${fitWidths(set, columns).map((f) => `<col style="width:${(f * 100).toFixed(1)}%">`).join("")}</colgroup>` : "";
    const total = String(style["rules.total-rows"] ?? "").trim();
    const body = rows.map((row, i) => {
      const first = row.getChild("TableCell");
      const isTotal = total && first && new RegExp(`^\\s*\\*\\*\\s*${total.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "i").test(slice(first.from, first.to));
      const cls = isTotal ? ' class="total"' : i % 2 ? ' class="even"' : "";
      return `<tr${cls}>${cells(row, "td").join("")}</tr>`;
    });
    return `<table>${cols}${header ? `<thead><tr>${cells(header, "th").join("")}</tr></thead>` : ""}<tbody>\n${body.join("\n")}\n</tbody></table>\n`;
  }

  const body = blocks(tree.topNode);
  const footnotes = [...numbers]
    .sort((a, b) => a[1] - b[1])
    .map(([label, n]) => {
      const note = notes.get(label)!;
      const marker = note.getChild("FootnoteLabel");
      return `<li id="fn-${n}">${inline(note, marker?.to ?? note.from, note.to).trim()} <a href="#fnref-${n}" class="back" aria-label="Back to the text">↩</a></li>`;
    });

  const titleLine = lines.find((l) => /^# /.test(l.trim()));
  const title = property("title") || (titleLine ? titleLine.trim().slice(2).replace(/[*_`]/g, "") : "");
  const meta = (name: string, value: string) => (value ? `<meta name="${name}" content="${escape(value)}">\n` : "");
  const footer = property("footer");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escape(title)}</title>
${meta("author", property("author"))}${meta("description", property("description"))}${meta("keywords", property("keywords"))}<meta name="generator" content="md-editor">
<style>
${css(style, footer)}
</style>
</head>
<body>
<main>
${body}${footnotes.length ? `<section class="footnotes">\n<ol>\n${footnotes.join("\n")}\n</ol>\n</section>\n` : ""}</main>
${footer ? `<footer>${escape(footer)}</footer>\n` : ""}</body>
</html>
`;
}

// ── The style, as CSS ────────────────────────────────────────────────────────

const PAGE = { letter: { size: "letter", width: 8.5 }, a4: { size: "A4", width: 8.27 } };
const MONO = /consolas|courier|menlo|monaco|mono|code/i;
const SERIF = /cambria|georgia|times|garamond|palatino|charter|baskerville|serif/i;

/** A font, then common ones of its kind, for a reader without it. */
function fontStack(font: string) {
  const fallback = MONO.test(font) ? "Menlo, Consolas, monospace" : SERIF.test(font) ? "Georgia, serif" : "Helvetica Neue, Arial, sans-serif";
  return `"${font.replace(/"/g, "")}", ${fallback}`;
}

const cssString = (s: string) => `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, " ")}"`;

function css(style: ExportStyle, footer: string): string {
  const c = (name: string) => `#${style[`colors.${name}`]}`;
  const pt = (name: string) => `${style[`sizes.${name}`]}pt`;
  const inch = (side: string) => `${style[`page.margin-${side}`]}in`;
  const page = PAGE[style["page.size"] as keyof typeof PAGE] ?? PAGE.letter;
  const measure = page.width - (style["page.margin-left"] as number) - (style["page.margin-right"] as number);
  const on = (name: string) => !!style[`rules.${name}`];
  return `@page {
  size: ${page.size};
  margin: ${inch("top")} ${inch("right")} ${inch("bottom")} ${inch("left")};
  @bottom-left { content: ${cssString(footer)}; font: ${pt("footer")} ${fontStack(style["fonts.body"] as string)}; color: ${c("muted")}; border-top: 0.5pt solid ${c("rule")}; vertical-align: top; padding-top: 4pt; }
  @bottom-right { content: counter(page); font: ${pt("footer")} ${fontStack(style["fonts.body"] as string)}; color: ${c("muted")}; border-top: 0.5pt solid ${c("rule")}; vertical-align: top; padding-top: 4pt; }
}
:root { color-scheme: light; }
html { background: #e8e8eb; }
body { margin: 0; padding: 2rem 1rem; font: ${pt("body")}/1.45 ${fontStack(style["fonts.body"] as string)}; color: ${c("text")}; }
main, body > footer { box-sizing: content-box; max-width: ${measure}in; margin: 0 auto; background: #fff; padding: ${inch("top")} ${inch("right")} ${inch("bottom")} ${inch("left")}; }
main { box-shadow: 0 1px 4px rgb(0 0 0 / 12%); }
body > footer { background: none; padding-top: 0.6rem; padding-bottom: 0; font-size: ${pt("footer")}; color: ${c("muted")}; }
@media print {
  html, body { background: none; padding: 0; }
  main { max-width: none; padding: 0; box-shadow: none; }
  body > footer { display: none; }
}
h1, h2, h3, h4, h5, h6, .subtitle { font-family: ${fontStack(style["fonts.headings"] as string)}; font-weight: 700; break-after: avoid; }
h1 { font-size: ${pt("title")}; color: ${c("title")}; margin: 0 0 0.2em; line-height: 1.15; }
.subtitle { font-size: ${pt("subtitle")}; font-weight: 400; color: ${c("subtitle")}; border-bottom: 1.5pt solid ${c("subtitle-rule")}; padding-bottom: 0.5em; margin: 0 0 1.4em; }
h2 { font-size: ${pt("heading")}; color: ${c("heading")}; margin: 1.6em 0 0.6em;${on("heading-rules") ? ` border-bottom: 0.75pt solid ${c("rule")}; padding-bottom: 0.25em;` : ""} }
h3, h4, h5, h6 { font-size: ${pt("subheading")}; color: ${c("subheading")}; margin: 1.3em 0 0.5em; }
p, ul, ol, blockquote, pre, table, .math { margin: 0 0 0.75em; }
strong { font-weight: 700; }
strong.lead { color: ${c("label")}; }
.meta { font-size: ${pt("metadata")}; color: ${c("muted")}; }
a { color: ${c("accent")}; }
code, pre { font-family: ${fontStack(style["fonts.code"] as string)}; font-size: 0.9em; }
pre { white-space: pre-wrap; padding: 0.6em 0.8em; border-left: 2pt solid ${c("rule")}; break-inside: avoid; }
blockquote { margin-left: 0; padding-left: 1em; border-left: 2pt solid ${c("rule")}; color: ${c("muted")}; }
li { margin: 0.2em 0; }
li.task { list-style: none; margin-left: -1.4em; }
.box { display: inline-block; position: relative; box-sizing: border-box; width: 0.95em; height: 0.95em; margin-right: 0.45em; vertical-align: -0.12em; border: 1pt solid ${c("accent")}; border-radius: 2pt; }
li.done .box { background: ${c("accent")}; }
/* Out of the flow, so the box lines up with the text whether it is checked or not. */
li.done .box::after { content: "✓"; position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; color: #fff; font-size: 0.75em; font-weight: 700; }
img { max-width: 100%; max-height: 9in; }
.math { text-align: center; overflow-x: auto; }
table { border-collapse: collapse; width: 100%; font-size: ${pt("table")}; break-inside: auto; }
tr { break-inside: avoid; }
th, td { border: 0.5pt solid ${c("rule")}; padding: 0.3em 0.55em; text-align: left; vertical-align: top; }
th { background: ${c("table-header")}; color: ${c("table-header-text")}; font-weight: 700; }
${on("table-bands") ? `tr.even td { background: ${c("table-band")}; }\n` : ""}tr.total td { background: ${c("table-total")}; color: ${c("table-total-text")}; font-weight: 700; }
tr.total strong { color: inherit; }
sup.footnote-ref { line-height: 0; }
sup.footnote-ref a { text-decoration: none; }
.footnotes { margin-top: 2em; border-top: 0.5pt solid ${c("rule")}; padding-top: 0.5em; font-size: ${pt("footnote")}; }
.footnotes .back { text-decoration: none; }
* { -webkit-print-color-adjust: exact; print-color-adjust: exact; }`;
}
