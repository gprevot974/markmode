// Directives: single-line HTML comments that set a property of the document
// or of the table under them. Other renderers hide them; the live preview
// shows them as labels, and the docx export follows them.
//
//   <!-- footer: Commercially confidential -->  text left of the page number
//   <!-- author: Name -->                       document author property
//   <!-- description: Project proposal -->      document description property
//   <!-- no-subtitle -->                        first "##" is a real section
//   <!-- widths: 20 30 50 -->                   column widths of the table below

export interface Directive {
  key: string;
  /** Null for a directive without a value (`no-subtitle`). */
  value: string | null;
}

const DIRECTIVE = /^\s*<!--\s*([\w-]+)\s*(?::\s*(.*?))?\s*-->\s*$/;

/** The directive a line holds, if it holds a known one. */
export function parseDirective(line: string): Directive | null {
  const m = DIRECTIVE.exec(line);
  if (!m || !(m[1] in LABELS)) return null;
  return { key: m[1], value: m[2] ?? null };
}

const LABELS: Record<string, string> = {
  footer: "Footer",
  author: "Author",
  description: "Description",
  "no-subtitle": "No subtitle: the first ## is a section",
  widths: "Column widths",
};

/** What the preview shows for a directive. */
export function describeDirective(d: Directive): string {
  if (d.key === "widths") {
    const widths = parseWidths(d.value ?? "");
    return widths ? `${LABELS.widths} ${widths.map((w) => `${Math.round(w * 100)}%`).join(" · ")}` : LABELS.widths;
  }
  return d.value ? `${LABELS[d.key]}: ${d.value}` : LABELS[d.key];
}

/** The widths in a `widths` directive's value, as fractions of the table's width. */
export function parseWidths(value: string): number[] | null {
  const numbers = value
    .split(/[\s,]+/)
    .filter(Boolean)
    .map((n) => parseFloat(n.replace(/%$/, "")));
  if (!numbers.length || numbers.some((n) => !(n > 0))) return null;
  const total = numbers.reduce((a, b) => a + b, 0);
  return numbers.map((n) => n / total);
}

/** Widths for `count` columns: missing ones take the average of the others, extra ones are dropped. */
export function fitWidths(widths: number[], count: number): number[] {
  const given = widths.slice(0, count);
  const mean = given.reduce((a, b) => a + b, 0) / given.length;
  while (given.length < count) given.push(mean);
  const total = given.reduce((a, b) => a + b, 0);
  return given.map((w) => w / total);
}

/** A `widths` directive for fractions: whole percentages that add up to 100. */
export function widthsDirective(fractions: number[]): string {
  const total = fractions.reduce((a, b) => a + b, 0);
  const exact = fractions.map((f) => (f / total) * 100);
  const percents = exact.map(Math.floor);
  // Hand the rounding leftovers to the columns that lost the most.
  const order = exact.map((e, i) => [e - Math.floor(e), i]).sort((a, b) => b[0] - a[0]);
  const left = 100 - percents.reduce((a, b) => a + b, 0);
  for (let k = 0; k < left; k++) percents[order[k % order.length][1]]++;
  return `<!-- widths: ${percents.join(" ")} -->`;
}

/**
 * The one-based number of the line holding the `widths` directive for the
 * table starting on line `first`: the nearest non-blank line above it.
 */
export function widthsLineAbove(lineText: (n: number) => string, first: number): number | null {
  for (let n = first - 1; n >= 1; n--) {
    const text = lineText(n);
    if (!text.trim()) continue;
    return parseDirective(text)?.key === "widths" ? n : null;
  }
  return null;
}
