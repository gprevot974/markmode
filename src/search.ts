// `space /`, global search: what a regex search of the workspace returns. The
// files on disk are searched by the backend (search.rs); this searches text
// held here, the buffers with unsaved changes and the browser stand-in's files,
// the same way.

export interface SearchMatch {
  /** Relative to the root searched. */
  path: string;
  /** One-based. */
  line: number;
  /** The line, its indentation trimmed (a window of it, when long). */
  text: string;
  /** The match in `text`. */
  from: number;
  to: number;
}

const MAX_LINE_CHARS = 300;
/** At most this many matches are listed (search.rs's MAX_MATCHES). */
export const MAX_MATCHES = 2000;

/** Smart case, as Helix: a pattern with no uppercase letter ignores case. Throws on an invalid pattern. */
export function searchRegex(pattern: string): RegExp {
  return new RegExp(pattern, /\p{Lu}/u.test(pattern) ? "u" : "iu");
}

/** The lines of `text` that match, at their first match. */
export function searchText(path: string, text: string, re: RegExp): SearchMatch[] {
  const found: SearchMatch[] = [];
  text.split(/\r?\n/).forEach((line, i) => {
    const m = re.exec(line);
    if (!m || (!m[0] && !line)) return;
    const indent = line.length - line.trimStart().length;
    let a = Math.min(indent, m.index);
    let b = line.length;
    if (b - a > MAX_LINE_CHARS) {
      a = Math.max(a, m.index - 40);
      b = Math.max(a + MAX_LINE_CHARS, m.index + m[0].length);
    }
    found.push({ path, line: i + 1, text: line.slice(a, b).trimEnd(), from: m.index - a, to: Math.min(m.index + m[0].length, b) - a });
  });
  return found;
}
