// Export styles: how the docx export (and the export preview) looks. A style
// is a TOML file of the keys below, each optional:
//
//   inherits = "default"        # the style it starts from (default: "default")
//   description = "Our letterhead colors"
//
//   [colors]
//   heading = "#203864"
//
//   [rules]
//   total-rows = "Total"
//
// FIELDS is the one description of every key: its section, type, default
// and doc. Validation, completion, the starter file `:export-style-new`
// writes and the reference (`:export-help`, the README) all come from it.

import { parse as parseToml } from "smol-toml";

export type FieldType = "color" | "font" | "size" | "inches" | "boolean" | "choice" | "text";

export interface Field {
  section: string;
  name: string;
  type: FieldType;
  doc: string;
  /** For a choice. */
  choices?: string[];
}

export type Value = string | number | boolean;

/** A style with every key set: "section.name" → value. Colors are "RRGGBB". */
export type ExportStyle = Record<string, Value>;

const f = (section: string, name: string, type: FieldType, doc: string, choices?: string[]): Field => ({
  section,
  name,
  type,
  doc,
  choices,
});

export const SECTIONS: Record<string, string> = {
  page: "Paper and margins",
  fonts: "Font families; a font missing on the reader's computer falls back to one Word picks",
  sizes: "Font sizes, in points",
  colors: "Colors, as \"#RRGGBB\"",
  rules: "How markdown turns into styled Word elements",
};

export const FIELDS: Field[] = [
  f("page", "size", "choice", "Paper size", ["letter", "a4"]),
  f("page", "margin-top", "inches", "Top margin, in inches"),
  f("page", "margin-bottom", "inches", "Bottom margin, in inches"),
  f("page", "margin-left", "inches", "Left margin, in inches"),
  f("page", "margin-right", "inches", "Right margin, in inches"),

  f("fonts", "body", "font", "Paragraphs, lists and tables"),
  f("fonts", "headings", "font", "The title, subtitle and headings"),
  f("fonts", "code", "font", "`Inline code`"),

  f("sizes", "body", "size", "Paragraphs and lists"),
  f("sizes", "title", "size", "The `#` title"),
  f("sizes", "subtitle", "size", "The subtitle (see rules.subtitle)"),
  f("sizes", "heading", "size", "`##` headings"),
  f("sizes", "subheading", "size", "`###` headings and below"),
  f("sizes", "table", "size", "Table text"),
  f("sizes", "metadata", "size", "Metadata blocks (see rules.metadata-blocks)"),
  f("sizes", "footer", "size", "The footer"),

  f("colors", "text", "color", "Body text, and bold in the middle of a sentence"),
  f("colors", "title", "color", "The `#` title"),
  f("colors", "subtitle", "color", "The subtitle"),
  f("colors", "subtitle-rule", "color", "The line under the subtitle"),
  f("colors", "heading", "color", "`##` headings"),
  f("colors", "subheading", "color", "`###` headings and below"),
  f("colors", "label", "color", "Bold opening a paragraph, list item or table row (see rules.bold-labels)"),
  f("colors", "accent", "color", "Bullets and list numbers"),
  f("colors", "muted", "color", "Metadata blocks and the footer"),
  f("colors", "rule", "color", "Lines under headings, table borders and the line over the footer"),
  f("colors", "table-header", "color", "Background of a table's header row"),
  f("colors", "table-header-text", "color", "Text of a table's header row"),
  f("colors", "table-band", "color", "Background of every other body row (see rules.table-bands)"),
  f("colors", "table-total", "color", "Background of total rows (see rules.total-rows)"),
  f("colors", "table-total-text", "color", "Text of total rows"),

  f("rules", "subtitle", "boolean", "The first `##` after the title is a subtitle under it, not a section. A document turns it off with `subtitle: false` in its front matter"),
  f("rules", "bold-labels", "boolean", "Bold opening a paragraph, list item or table row is a label, in colors.label; bold elsewhere stays colors.text"),
  f("rules", "metadata-blocks", "boolean", "A paragraph whose every line is `**Label:** value` keeps its lines, smaller and in colors.muted"),
  f("rules", "total-rows", "text", "Table rows holding bold text that starts with this word are total rows; empty for none"),
  f("rules", "table-bands", "boolean", "Every other body row of a table gets colors.table-band"),
  f("rules", "heading-rules", "boolean", "A line under `##` headings, in colors.rule"),
];

export const fieldKey = (field: Field) => `${field.section}.${field.name}`;

export function findField(key: string): Field | undefined {
  return FIELDS.find((field) => fieldKey(field) === key);
}

// ── Built-in styles ──────────────────────────────────────────────────────────

/** Every key, in a neutral slate and blue. The other styles start from it. */
const DEFAULT: ExportStyle = {
  "page.size": "letter",
  "page.margin-top": 0.85,
  "page.margin-bottom": 0.8,
  "page.margin-left": 0.75,
  "page.margin-right": 0.75,

  "fonts.body": "Calibri",
  "fonts.headings": "Calibri",
  "fonts.code": "Consolas",

  "sizes.body": 10.5,
  "sizes.title": 23,
  "sizes.subtitle": 13,
  "sizes.heading": 13.5,
  "sizes.subheading": 11.5,
  "sizes.table": 9.5,
  "sizes.metadata": 10,
  "sizes.footer": 8,

  "colors.text": "1F2328",
  "colors.title": "1E293B",
  "colors.subtitle": "475569",
  "colors.subtitle-rule": "2563EB",
  "colors.heading": "1E293B",
  "colors.subheading": "475569",
  "colors.label": "1E293B",
  "colors.accent": "2563EB",
  "colors.muted": "64748B",
  "colors.rule": "CBD5E1",
  "colors.table-header": "1E293B",
  "colors.table-header-text": "FFFFFF",
  "colors.table-band": "F1F5F9",
  "colors.table-total": "E2E8F0",
  "colors.table-total-text": "1E293B",

  "rules.subtitle": true,
  "rules.bold-labels": true,
  "rules.metadata-blocks": true,
  "rules.total-rows": "Total",
  "rules.table-bands": true,
  "rules.heading-rules": true,
};

/** The built-in styles, as the changes each makes to the default. */
export const BUILT_IN: Record<string, { doc: string; keys: Partial<ExportStyle> }> = {
  default: { doc: "Slate headings and tables, blue accents", keys: {} },
  plain: {
    doc: "Black and gray, no fills: for printing, or for restyling in Word",
    keys: {
      "colors.text": "000000",
      "colors.title": "000000",
      "colors.subtitle": "404040",
      "colors.subtitle-rule": "000000",
      "colors.heading": "000000",
      "colors.subheading": "000000",
      "colors.label": "000000",
      "colors.accent": "000000",
      "colors.muted": "595959",
      "colors.rule": "BFBFBF",
      "colors.table-header": "F2F2F2",
      "colors.table-header-text": "000000",
      "colors.table-total": "F2F2F2",
      "colors.table-total-text": "000000",
      "rules.table-bands": false,
    },
  },
};

export const defaultStyle = (): ExportStyle => ({ ...DEFAULT });

// ── Reading style files ──────────────────────────────────────────────────────

export interface StyleFile {
  inherits: string | null;
  description: string | null;
  keys: Partial<ExportStyle>;
  /** What is wrong in the file; the keys concerned are left out. */
  errors: string[];
}

const HEX = /^#?([0-9a-f]{6})$/i;

/** A value checked against its field: the value to use, or an error. */
export function checkValue(field: Field, value: unknown): { value: Value } | { error: string } {
  const key = fieldKey(field);
  switch (field.type) {
    case "color": {
      const m = typeof value === "string" ? HEX.exec(value.trim()) : null;
      return m ? { value: m[1].toUpperCase() } : { error: `${key}: a color like "#203864"` };
    }
    case "size":
    case "inches":
      return typeof value === "number" && value > 0 && value < (field.type === "size" ? 200 : 5)
        ? { value }
        : { error: `${key}: a number of ${field.type === "size" ? "points" : "inches"}` };
    case "boolean":
      return typeof value === "boolean" ? { value } : { error: `${key}: true or false` };
    case "choice":
      return typeof value === "string" && field.choices!.includes(value)
        ? { value }
        : { error: `${key}: one of ${field.choices!.join(", ")}` };
    case "font":
      return typeof value === "string" && value.trim() ? { value: value.trim() } : { error: `${key}: a font name` };
    case "text":
      return typeof value === "string" ? { value } : { error: `${key}: text in quotes` };
  }
}

const isTable = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** A style file's text, read and checked. */
export function parseStyleFile(text: string): StyleFile {
  const out: StyleFile = { inherits: null, description: null, keys: {}, errors: [] };
  let toml: Record<string, unknown>;
  try {
    toml = parseToml(text) as Record<string, unknown>;
  } catch (err) {
    out.errors.push(String(err instanceof Error ? err.message : err).split("\n")[0]);
    return out;
  }
  for (const [section, table] of Object.entries(toml)) {
    if (section === "inherits" || section === "description") {
      if (typeof table === "string") out[section] = table;
      else out.errors.push(`${section}: text in quotes`);
      continue;
    }
    if (!(section in SECTIONS)) {
      out.errors.push(`unknown section [${section}]`);
      continue;
    }
    if (!isTable(table)) {
      out.errors.push(`${section}: a [${section}] table`);
      continue;
    }
    for (const [name, value] of Object.entries(table)) {
      const field = findField(`${section}.${name}`);
      if (!field) {
        out.errors.push(`unknown key ${section}.${name}`);
        continue;
      }
      const checked = checkValue(field, value);
      if ("error" in checked) out.errors.push(checked.error);
      else out.keys[fieldKey(field)] = checked.value;
    }
  }
  return out;
}

// ── Writing them ─────────────────────────────────────────────────────────────

function tomlValue(field: Field, value: Value): string {
  if (field.type === "color") return `"#${value}"`;
  if (typeof value === "string") return JSON.stringify(value);
  return String(value);
}

/**
 * A new style file inheriting `parent`: every key, commented out at the
 * value `parent` gives it, with its doc, so it is its own reference.
 */
export function starterStyle(parent: string, resolved: ExportStyle): string {
  const lines = [
    `# An export style. Uncomment a key to change it; the others come from "${parent}".`,
    "# :export-help lists every key; :export-preview shows the style in the editor.",
    "",
    `inherits = "${parent}"`,
    `description = ""`,
  ];
  for (const section of Object.keys(SECTIONS)) {
    lines.push("", `# ${SECTIONS[section]}`, `[${section}]`);
    for (const field of FIELDS.filter((x) => x.section === section)) {
      const choices = field.choices ? ` (${field.choices.join(", ")})` : "";
      lines.push(`# ${field.name} = ${tomlValue(field, resolved[fieldKey(field)])}  # ${field.doc}${choices}`);
    }
  }
  return lines.join("\n") + "\n";
}

/** The reference of every key, as markdown: for `:export-help` and the README. */
export function styleReference(): string {
  const out: string[] = [];
  for (const section of Object.keys(SECTIONS)) {
    out.push(`### [${section}]`, "", SECTIONS[section] + ".", "", "| Key | Default | What it sets |", "| --- | --- | --- |");
    for (const field of FIELDS.filter((x) => x.section === section)) {
      const choices = field.choices ? ` (${field.choices.join(", ")})` : "";
      const value = tomlValue(field, DEFAULT[fieldKey(field)]).replace(/\|/g, "\\|");
      out.push(`| \`${field.name}\` | \`${value}\` | ${field.doc}${choices} |`);
    }
    out.push("");
  }
  return out.join("\n");
}

/** Every value of a resolved style, as TOML: what the style picker previews. */
export function describeStyle(style: ExportStyle): string {
  const lines: string[] = [];
  for (const section of Object.keys(SECTIONS)) {
    lines.push(`[${section}]`);
    for (const field of FIELDS.filter((x) => x.section === section)) lines.push(`${field.name} = ${tomlValue(field, style[fieldKey(field)])}`);
    lines.push("");
  }
  return lines.join("\n");
}
