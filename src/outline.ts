// The headings of a markdown text, for the `space s` and `space S` pickers:
// what Helix's symbol pickers list for code, a table of contents for prose.

export interface Heading {
  /** 1 to 6. */
  level: number;
  title: string;
  /** One-based line the heading is on (its text line, for a setext heading). */
  line: number;
  /** The titles of the headings it is under, then its own. */
  path: string[];
  /** The heading it is under. */
  parent: Heading | null;
}

const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const ATX = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/;
const SETEXT = /^ {0,3}(=+|-+)[ \t]*$/;
// Lines that cannot be the text of a setext heading: list items, quotes, tables, indented code.
const NOT_SETEXT_TEXT = /^(?: {4,}|\t| {0,3}(?:[-*+>|]|\d+[.)])(?:\s|$))/;

export function headings(text: string): Heading[] {
  const lines = text.split("\n");
  const out: Heading[] = [];
  const stack: Heading[] = [];
  const add = (level: number, title: string, line: number) => {
    while (stack.length && stack[stack.length - 1].level >= level) stack.pop();
    const parent = stack[stack.length - 1] ?? null;
    const h: Heading = { level, title, line, path: [...stack.map((s) => s.title), title], parent };
    stack.push(h);
    out.push(h);
  };
  let fence: string | null = null;
  let frontMatter = lines[0]?.trim() === "---";
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (frontMatter) {
      if (i > 0 && /^(?:---|\.\.\.)\s*$/.test(line)) frontMatter = false;
      continue;
    }
    const marker = FENCE.exec(line)?.[1];
    if (fence) {
      if (marker && marker[0] === fence[0] && marker.length >= fence.length && !line.slice(line.indexOf(marker) + marker.length).trim()) {
        fence = null;
      }
      continue;
    }
    if (marker) {
      fence = marker;
      continue;
    }
    const atx = ATX.exec(line);
    if (atx) {
      add(atx[1].length, clean(atx[2] ?? ""), i + 1);
      continue;
    }
    // A setext underline under a line of text that starts a paragraph.
    const under = i > 0 ? SETEXT.exec(line) : null;
    const prev = lines[i - 1];
    if (under && prev.trim() && !NOT_SETEXT_TEXT.test(prev) && !ATX.test(prev) && !(i > 1 && lines[i - 2].trim())) {
      add(under[1][0] === "=" ? 1 : 2, clean(prev), i);
    }
  }
  return out;
}

/** A heading's text as read: without emphasis, code and link markup. */
function clean(title: string): string {
  return title
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/(\*\*|__|\*|_|~~|`)(.+?)\1/g, "$2")
    .trim();
}
