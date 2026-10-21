// Renders a GFM pipe table to HTML, with inline markdown in cells: whole, or
// one row at a time with the column widths of the whole table, so that each
// line of the source can show as rendered or raw on its own.

/** Where each cell's text is in a row's source, without its padding. */
function cellSpans(row: string): { from: number; to: number }[] {
  let start = 0;
  let end = row.length;
  while (start < end && /\s/.test(row[start])) start++;
  while (end > start && /\s/.test(row[end - 1])) end--;
  if (row[start] === "|") start++;
  if (end > start && row[end - 1] === "|" && row[end - 2] !== "\\") end--;
  const spans: { from: number; to: number }[] = [];
  let cell = start;
  for (let i = start; i <= end; i++) {
    if (i < end && (row[i] !== "|" || row[i - 1] === "\\")) continue;
    let from = cell;
    let to = i;
    while (from < to && /\s/.test(row[from])) from++;
    while (to > from && /\s/.test(row[to - 1])) to--;
    spans.push({ from, to });
    cell = i + 1;
  }
  return spans;
}

export function splitRow(row: string): string[] {
  return cellSpans(row).map((s) => row.slice(s.from, s.to));
}

/** A jump label (`gw`) to paint over the word at `at`, an offset in the row's source. */
export interface CellLabel {
  at: number;
  text: string;
}

// Labels are marked in a cell's markdown before it renders, then painted over
// the two characters after each mark, as the editor paints them over text.
const MARK = "\uE000";
const MARK_END = "\uE001";

function markLabels(row: string, labels: CellLabel[]): string[] {
  return cellSpans(row).map(({ from, to }) => {
    let cell = row.slice(from, to);
    const inCell = labels.map((l, i) => [l.at - from, i]).filter(([at]) => at >= 0 && at < to - from);
    for (const [at, i] of inCell.sort((a, b) => b[0] - a[0])) cell = cell.slice(0, at) + MARK + i + MARK_END + cell.slice(at);
    return cell;
  });
}

function paintLabels(root: HTMLElement, labels: CellLabel[]) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const marked: Text[] = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) if (n.nodeValue!.includes(MARK)) marked.push(n as Text);
  for (let node of marked) {
    for (let at = node.nodeValue!.indexOf(MARK); at >= 0; at = node.nodeValue!.indexOf(MARK)) {
      const end = node.nodeValue!.indexOf(MARK_END, at);
      const label = labels[Number(node.nodeValue!.slice(at + 1, end))];
      const word = node.splitText(at);
      word.deleteData(0, end + 1 - at);
      node = word.splitText(Math.min(2, word.length));
      const span = document.createElement("span");
      span.className = "hx-jump";
      span.dataset.label = label?.text ?? "";
      word.replaceWith(span);
      span.append(word);
    }
  }
}

type Align = "left" | "center" | "right" | "";

function alignOf(sep: string): Align {
  const left = sep.startsWith(":");
  const right = sep.endsWith(":");
  return left && right ? "center" : right ? "right" : left ? "left" : "";
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Bold, italic, code, strikethrough and links; enough for table cells. */
export function renderInline(md: string): string {
  const codes: string[] = [];
  let html = escapeHtml(md).replace(/`([^`]+)`/g, (_, c: string) => {
    codes.push(`<code>${c}</code>`);
    return `\u0000${codes.length - 1}\u0000`;
  });
  html = html
    .replace(/\*\*([^*]+)\*\*|__([^_]+)__/g, (_, a?: string, b?: string) => `<strong>${a ?? b}</strong>`)
    .replace(/\*([^*]+)\*|\b_([^_]+)_\b/g, (_, a?: string, b?: string) => `<em>${a ?? b}</em>`)
    .replace(/~~([^~]+)~~/g, "<del>$1</del>")
    .replace(/\[([^\]]+)\]\(([^)\s]+)[^)]*\)/g, '<a href="$2">$1</a>')
    .replace(/\\\|/g, "|");
  return html.replace(/\u0000(\d+)\u0000/g, (_, i: string) => codes[Number(i)]);
}

const rowsOf = (source: string) => source.split("\n").filter((l) => l.trim());

function fillRow(tr: HTMLTableRowElement, cells: string[], aligns: Align[], tag: "th" | "td") {
  cells.forEach((c, i) => {
    const cell = document.createElement(tag);
    cell.innerHTML = renderInline(c);
    if (aligns[i]) cell.style.textAlign = aligns[i];
    tr.appendChild(cell);
  });
}

// An all-empty header row is a common way to write a header-less table.
const hasHeader = (rows: string[]) => splitRow(rows[0]).some((c) => c);

export function renderTable(source: string): HTMLTableElement {
  const rows = rowsOf(source);
  const table = document.createElement("table");
  table.className = "md-table";
  const aligns = rows.length > 1 ? splitRow(rows[1]).map(alignOf) : [];
  if (hasHeader(rows)) fillRow(table.createTHead().insertRow(), splitRow(rows[0]), aligns, "th");
  const tbody = table.createTBody();
  for (const row of rows.slice(2)) fillRow(tbody.insertRow(), splitRow(row), aligns, "td");
  return table;
}

/**
 * The width of each column, as a fraction of the table's, as the browser lays
 * out the whole table in a box `width` pixels wide, in `font`, inside
 * `container` (which must be in the document). Null when nothing is laid out.
 */
export function measureColumns(source: string, container: HTMLElement, width: number, font: string): number[] | null {
  const table = renderTable(source);
  const box = document.createElement("div");
  box.style.cssText = "position: absolute; visibility: hidden; left: 0; top: 0";
  box.style.width = `${width}px`;
  box.style.font = font;
  box.appendChild(table);
  container.appendChild(box);
  try {
    const total = table.getBoundingClientRect().width;
    if (!total) return null;
    let widest: HTMLTableRowElement | null = null;
    for (const tr of table.rows) if (!widest || tr.cells.length > widest.cells.length) widest = tr;
    if (!widest?.cells.length) return null;
    return [...widest.cells].map((c) => c.getBoundingClientRect().width / total);
  } finally {
    box.remove();
  }
}

/**
 * Line `index` of a table's source: a one-row table with the given column
 * widths, or, for the delimiter row and an empty header, a thin rule.
 */
export function renderTableLine(source: string, index: number, columns: number[] | null, labels: CellLabel[] = []): HTMLElement {
  const rows = rowsOf(source);
  if (index === 1 || (index === 0 && !hasHeader(rows))) {
    const rule = document.createElement("div");
    rule.className = "md-table-rule";
    return rule;
  }
  const cells = markLabels(rows[index] ?? "", labels);
  const aligns = rows.length > 1 ? splitRow(rows[1]).map(alignOf) : [];
  const table = document.createElement("table");
  table.className = index === 0 ? "md-table md-table-head" : index % 2 ? "md-table md-table-even" : "md-table";
  const count = Math.max(cells.length, columns?.length ?? 0);
  const colgroup = table.appendChild(document.createElement("colgroup"));
  for (let i = 0; i < count; i++) {
    const col = colgroup.appendChild(document.createElement("col"));
    col.style.width = columns?.[i] ? `${(columns[i] * 100).toFixed(3)}%` : `${100 / count}%`;
  }
  const tr = table.insertRow();
  fillRow(tr, cells, aligns, index === 0 ? "th" : "td");
  // A handle on each border between columns, to drag.
  for (const cell of [...tr.cells].slice(0, count - 1)) {
    const handle = document.createElement("div");
    handle.className = "md-col-handle";
    cell.appendChild(handle);
  }
  if (labels.length) paintLabels(table, labels);
  return table;
}
