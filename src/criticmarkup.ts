// Comments in CriticMarkup: a note `{>>like this<<}`, optionally right after
// the text it is about, which is then highlighted: `{==this text==}{>>a
// note<<}`. A highlight can also stand alone. Neither may span a blank line.
// Kept free of editor code so the docx export (and its command-line script)
// can use it.

export interface Markup {
  from: number;
  to: number;
  /** The highlight, `{==` to `==}`, when there is one. */
  highlight: [number, number] | null;
  /** The note, `{>>` to `<<}`, when there is one. */
  note: [number, number] | null;
}

const INNER = String.raw`(?:(?!\n[ \t]*\n)[\s\S])*?`;
const MARKUP = new RegExp(String.raw`(\{==${INNER}==\})?\{>>${INNER}<<\}|\{==${INNER}==\}`, "g");

/** The comments and highlights in `text`, with positions offset by `offset`. */
export function findMarkup(text: string, offset = 0): Markup[] {
  const found: Markup[] = [];
  for (const m of text.matchAll(MARKUP)) {
    const from = offset + m.index;
    const to = from + m[0].length;
    if (m[0].startsWith("{==") && !m[0].endsWith("<<}")) found.push({ from, to, highlight: [from, to], note: null });
    else {
      const split = m[1] ? from + m[1].length : from;
      found.push({ from, to, highlight: m[1] ? [from, split] : null, note: [split, to] });
    }
  }
  return found;
}

/** A note's text, without its braces and with the characters that would end it early broken up. */
export const noteMarkup = (text: string) => `{>>${text.trim().replaceAll("<<}", "<< }")}<<}`;

/** The text without its comments: notes go, highlighted text stays. Code is left alone. */
export function stripComments(src: string): string {
  const out: string[] = [];
  let fence: string | null = null;
  let prose: string[] = [];
  const flush = () => {
    if (!prose.length) return;
    const text = prose.join("\n");
    let result = "";
    let last = 0;
    for (const m of findMarkup(text)) {
      let { from, to } = m;
      if (!m.highlight) {
        const lineStart = text.lastIndexOf("\n", from - 1) + 1;
        const lineEnd = text.indexOf("\n", to) < 0 ? text.length : text.indexOf("\n", to);
        const after = text.slice(to, lineEnd).trim();
        // A note alone on its line takes the line with it, so it cannot
        // split a paragraph; one ending a line takes the spaces before it.
        if (!after && !text.slice(lineStart, from).trim()) {
          from = lineStart;
          to = Math.min(text.length, lineEnd + 1);
        } else if (!after) while (from > lineStart && /[ \t]/.test(text[from - 1])) from--;
      }
      result += text.slice(last, from);
      if (m.highlight) result += text.slice(m.highlight[0] + 3, m.highlight[1] - 3);
      last = to;
    }
    out.push(...(result + text.slice(last)).split("\n"));
    prose = [];
  };
  for (const line of src.split("\n")) {
    const marker = /^\s*(`{3,}|~{3,})/.exec(line)?.[1];
    if (fence) {
      out.push(line);
      if (marker && marker[0] === fence[0] && marker.length >= fence.length) fence = null;
    } else if (marker) {
      flush();
      out.push(line);
      fence = marker;
    } else prose.push(line);
  }
  flush();
  return out.join("\n");
}
