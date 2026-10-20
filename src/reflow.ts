// Hard-wrapping paragraphs, as Helix's `:reflow`, aware of markdown: list
// items and block quotes keep their markers, continuation lines are indented
// under the text, and headings, tables, code blocks and HTML stay as they are.

/** A quote and list prefix: `> `, `- `, `1. `, `- [ ] `, and indentation. */
const PREFIX = /^(\s*(?:>\s?)*)((?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?)?/;
const KEEP = /^\s*(?:#{1,6}\s|\||<|(?:[-*_]\s*){3,}$|(?:=+|-+)\s*$)/;
const FENCE = /^\s*(?:>\s?)*(`{3,}|~{3,})/;

/** Rewraps the paragraphs in `text` (whole lines) so lines stay within `width` characters. */
export function reflow(text: string, width: number): string {
  const out: string[] = [];
  let para: string[] = [];
  let fence: string | null = null;
  const flush = () => {
    if (para.length) out.push(...wrap(para, width));
    para = [];
  };
  for (const line of text.split("\n")) {
    const marker = FENCE.exec(line)?.[1];
    if (fence) {
      out.push(line);
      if (marker && marker[0] === fence[0] && marker.length >= fence.length) fence = null;
      continue;
    }
    if (marker) {
      flush();
      out.push(line);
      fence = marker;
      continue;
    }
    const [, quote, item] = PREFIX.exec(line)!;
    const rest = line.slice(quote.length + (item?.length ?? 0));
    // Indented code: four spaces in, not continuing a paragraph.
    const code = !item && !para.length && /^(?: {4,}|\t)/.test(line);
    if (!rest.trim() || KEEP.test(rest) || code) {
      flush();
      out.push(line);
      continue;
    }
    // A list item starts a paragraph of its own.
    if (item) flush();
    para.push(line);
    // A hard line break ends the line where it is.
    if (/ {2}$|\\$/.test(line)) flush();
  }
  flush();
  return out.join("\n");
}

function wrap(lines: string[], width: number): string[] {
  const [, quote, item = ""] = PREFIX.exec(lines[0])!;
  const first = quote + item;
  const next = quote + " ".repeat(item.length);
  const words = lines
    .map((l, i) => (i === 0 ? l.slice(first.length) : l.replace(/^\s*(?:>\s?)*/, "")))
    .join(" ")
    .split(/\s+/)
    .filter(Boolean);
  const hardBreak = /( {2}|\\)$/.exec(lines[lines.length - 1])?.[1] ?? "";
  const out: string[] = [];
  let line = first;
  let empty = true;
  for (const word of words) {
    if (!empty && line.length + 1 + word.length > width) {
      out.push(line);
      line = next;
      empty = true;
    }
    line += (empty ? "" : " ") + word;
    empty = false;
  }
  out.push(line + hardBreak);
  return out;
}
