// Fuzzy matching for the pickers, in the spirit of fzf (Helix uses nucleo):
// the pattern's characters must appear in order; matches at the start of a
// word or path segment, and runs of consecutive matches, score higher.
// Space-separated patterns must all match, and score higher in the order
// typed. Smart case: an uppercase letter in a pattern makes that pattern
// case-sensitive.

export interface Match {
  score: number;
  /** Positions of the matched characters, ascending. */
  indices: number[];
}

const MATCH = 16;
const BONUS_START = 10;
const BONUS_SEGMENT = 9;
const BONUS_WORD = 8;
const BONUS_CAMEL = 7;
const BONUS_CONSECUTIVE = 5;
const GAP_START = -3;
const GAP_EXTEND = -1;
// Each pattern matching after the one before it, as words are typed in order.
const BONUS_ORDER = 4;

function bonusAt(text: string, i: number): number {
  if (i === 0) return BONUS_START;
  const prev = text[i - 1];
  if (prev === "/") return BONUS_SEGMENT;
  if (/[\s_\-.]/.test(prev)) return BONUS_WORD;
  if (/\p{Ll}/u.test(prev) && /\p{Lu}/u.test(text[i])) return BONUS_CAMEL;
  return 0;
}

function matchTerm(term: string, text: string): Match | null {
  const caseSensitive = term !== term.toLowerCase();
  const hay = caseSensitive ? text : text.toLowerCase();
  // Find where the first full match ends, then walk back from there for the
  // tightest start, then score the match forward from that start.
  let ti = 0;
  let end = -1;
  for (let i = 0; i < hay.length; i++) {
    if (hay[i] === term[ti] && ++ti === term.length) {
      end = i;
      break;
    }
  }
  if (end < 0) return null;
  let start = end;
  for (let i = end, pi = term.length - 1; i >= 0 && pi >= 0; i--) {
    if (hay[i] === term[pi]) {
      start = i;
      pi--;
    }
  }
  const indices: number[] = [];
  let score = 0;
  let prev = -1;
  for (let i = start, pi = 0; i <= end && pi < term.length; i++) {
    if (hay[i] !== term[pi]) continue;
    score += MATCH + bonusAt(text, i);
    if (prev >= 0) score += i === prev + 1 ? BONUS_CONSECUTIVE : GAP_START + GAP_EXTEND * (i - prev - 2);
    indices.push(i);
    prev = i;
    pi++;
  }
  // Matches in the file name beat matches in its directories.
  if (indices[0] > text.lastIndexOf("/")) score += BONUS_WORD;
  return { score, indices };
}

export function fuzzyMatch(pattern: string, text: string): Match | null {
  const terms = pattern.split(/\s+/).filter(Boolean);
  if (!terms.length) return { score: 0, indices: [] };
  let score = 0;
  let last = -1;
  const indices = new Set<number>();
  for (const term of terms) {
    const m = matchTerm(term, text);
    if (!m) return null;
    score += m.score;
    if (m.indices[0] > last && last >= 0) score += BONUS_ORDER;
    last = m.indices[0];
    for (const i of m.indices) indices.add(i);
  }
  return { score, indices: [...indices].sort((a, b) => a - b) };
}

/** The items matching `pattern`, best first (shorter on ties); all of them, in order, for an empty pattern. */
export function fuzzyFilter<T>(pattern: string, items: T[], text: (item: T) => string): T[] {
  if (!pattern.trim()) return items;
  const scored: [T, number, number][] = [];
  for (const item of items) {
    const t = text(item);
    const m = fuzzyMatch(pattern, t);
    if (m) scored.push([item, m.score, t.length]);
  }
  return scored.sort((a, b) => b[1] - a[1] || a[2] - b[2]).map(([item]) => item);
}
