// Renders a GFM pipe table to an HTML table, with inline markdown in cells.

export function splitRow(row: string): string[] {
  return row
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split(/(?<!\\)\|/)
    .map((c) => c.trim());
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

export function renderTable(source: string): HTMLTableElement {
  const rows = source.split("\n").filter((l) => l.trim());
  const table = document.createElement("table");
  table.className = "md-table";
  const aligns = rows.length > 1 ? splitRow(rows[1]).map(alignOf) : [];
  const header = splitRow(rows[0]);
  const thead = table.createTHead().insertRow();
  // An all-empty header row is a common way to write a header-less table.
  if (header.some((c) => c)) {
    header.forEach((c, i) => {
      const th = document.createElement("th");
      th.innerHTML = renderInline(c);
      if (aligns[i]) th.style.textAlign = aligns[i];
      thead.appendChild(th);
    });
  }
  const tbody = table.createTBody();
  for (const row of rows.slice(2)) {
    const tr = tbody.insertRow();
    splitRow(row).forEach((c, i) => {
      const td = tr.insertCell();
      td.innerHTML = renderInline(c);
      if (aligns[i]) td.style.textAlign = aligns[i];
    });
  }
  return table;
}
