// What `C-x` offers in insert mode where the export is configured: the keys
// and values of a style file, and the document properties in front matter.

import { PROPERTIES } from "../frontmatter.ts";
import { fuzzyFilter } from "../ui/fuzzy.ts";
import { FIELDS, SECTIONS, fieldKey, findField, type Field } from "./style.ts";

export interface Candidate {
  label: string;
  /** Replaces the line from `from` to the cursor. */
  insert: string;
  from: number;
  detail?: string;
}

const FONTS = [
  "Aptos",
  "Arial",
  "Calibri",
  "Cambria",
  "Candara",
  "Consolas",
  "Courier New",
  "Garamond",
  "Georgia",
  "Helvetica",
  "Lato",
  "Menlo",
  "Open Sans",
  "Palatino Linotype",
  "Roboto",
  "Segoe UI",
  "Source Sans Pro",
  "Times New Roman",
  "Verdana",
];

const filter = (typed: string, items: Candidate[]) => fuzzyFilter(typed, items, (c) => c.label);

/** The colors already in a style file, to reuse its palette. */
function colorsIn(text: string): string[] {
  return [...new Set([...text.matchAll(/"#([0-9a-f]{6})"/gi)].map((m) => `#${m[1].toUpperCase()}`))];
}

function valueCandidates(field: Field, from: number, typed: string, ctx: { text: string; styles: string[]; current: string | null }) {
  const quoted = (v: string, detail?: string): Candidate => ({ label: v, insert: JSON.stringify(v), from, detail });
  let out: Candidate[] = [];
  switch (field.type) {
    case "choice":
      out = field.choices!.map((c) => quoted(c));
      break;
    case "boolean":
      out = ["true", "false"].map((v) => ({ label: v, insert: v, from }));
      break;
    case "font":
      out = FONTS.map((v) => quoted(v));
      break;
    case "color":
      out = colorsIn(ctx.text).map((c) => quoted(c, "in this file"));
      break;
  }
  if (ctx.current !== null && !out.some((c) => c.label === ctx.current)) {
    out.unshift({ label: ctx.current, insert: field.type === "color" || field.type === "font" || field.type === "text" || field.type === "choice" ? JSON.stringify(ctx.current) : ctx.current, from, detail: "inherited" });
  }
  return filter(typed.replace(/^"/, ""), out);
}

/**
 * Candidates at column `col` of line `index` in a style file. `inherited`
 * gives a key's value in the style it inherits, offered first.
 */
export function styleCompletions(
  text: string,
  index: number,
  col: number,
  styles: string[],
  inherited: (key: string) => string | null,
): Candidate[] {
  const lines = text.split("\n");
  const before = lines[index].slice(0, col);
  let section = "";
  for (let i = index - 1; i >= 0; i--) {
    const m = /^\s*\[([\w-]+)\]/.exec(lines[i]);
    if (m) {
      section = m[1];
      break;
    }
  }

  const header = /^(\s*\[)([\w-]*)$/.exec(before);
  if (header) {
    const from = header[1].length;
    return filter(
      header[2],
      Object.entries(SECTIONS).map(([name, doc]) => ({ label: name, insert: `${name}]`, from, detail: doc })),
    );
  }

  const key = /^(\s*)([\w-]*)$/.exec(before);
  if (key) {
    const from = key[1].length;
    const set = new Set(
      lines
        .slice(index + 1)
        .concat(lines.slice(0, index))
        .map((l) => /^\s*([\w-]+)\s*=/.exec(l)?.[1]),
    );
    const keys: Candidate[] = section
      ? FIELDS.filter((x) => x.section === section).map((x) => ({ label: x.name, insert: `${x.name} = `, from, detail: x.doc }))
      : [
          { label: "inherits", insert: "inherits = ", from, detail: "The style this one starts from" },
          { label: "description", insert: "description = ", from, detail: "Shown in the style picker" },
        ];
    // Keys the section already has go last.
    return filter(key[2], keys).sort((a, b) => Number(section && set.has(a.label)) - Number(section && set.has(b.label)));
  }

  const value = /^(\s*([\w-]+)\s*=\s*)(.*)$/.exec(before);
  if (!value) return [];
  const from = value[1].length;
  if (!section && value[2] === "inherits") {
    return filter(value[3].replace(/^"/, ""), styles.map((s) => ({ label: s, insert: JSON.stringify(s), from })));
  }
  const field = findField(`${section}.${value[2]}`);
  if (!field) return [];
  return valueCandidates(field, from, value[3], { text, styles, current: inherited(fieldKey(field)) });
}

/** Candidates at column `col` of a front matter line. */
export function propertyCompletions(line: string, col: number, styles: string[]): Candidate[] {
  const before = line.slice(0, col);
  const key = /^([\w-]*)$/.exec(before);
  if (key) return filter(key[1], PROPERTIES.map((p) => ({ label: p.key, insert: `${p.key}: `, from: 0, detail: p.doc })));
  const value = /^([\w-]+):\s*/.exec(before);
  if (!value) return [];
  const property = PROPERTIES.find((p) => p.key === value[1]);
  const from = value[0].length;
  const typed = before.slice(from);
  if (property?.values === "style") return filter(typed, styles.map((s) => ({ label: s, insert: s, from })));
  if (property?.values === "boolean") return filter(typed, ["false", "true"].map((v) => ({ label: v, insert: v, from })));
  return [];
}
