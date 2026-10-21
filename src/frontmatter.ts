// Front matter: the YAML block at the top of a markdown file, between "---"
// lines, as Pandoc, Obsidian and static site generators read it. The editor
// reads the document properties below from it; other keys are left alone.
// Only flat `key: value` lines are read, which is all these need.
//
//   ---
//   title: Project proposal
//   author: Jane Doe
//   style: acme
//   ---

export interface Property {
  key: string;
  doc: string;
  /** What the value completes to. */
  values?: "boolean" | "style";
}

/** The keys the editor uses. */
export const PROPERTIES: Property[] = [
  { key: "title", doc: "The document's title property; without it, the `#` heading's text" },
  { key: "subtitle", doc: "false: the first `##` is a section, not a subtitle under the title", values: "boolean" },
  { key: "author", doc: "The document's author property" },
  { key: "description", doc: "The document's description property (Comments, in Word)" },
  { key: "subject", doc: "The document's subject property" },
  { key: "keywords", doc: "The document's keywords property, separated by commas" },
  { key: "footer", doc: "Footer text, left of the page number" },
  { key: "style", doc: "The export style (:export-style picks one)", values: "style" },
];

export type FieldValue = string | boolean;

export interface FrontMatter {
  /** Offsets of the block, from its opening "---" to the end of its closing line. */
  from: number;
  to: number;
  /** Zero-based index of the first line after the block. */
  endLine: number;
  fields: Record<string, FieldValue>;
}

const FENCE = /^---[ \t]*$/;
const CLOSE = /^(?:---|\.\.\.)[ \t]*$/;
const FIELD = /^([A-Za-z][\w-]*)[ \t]*:(?:[ \t]+(.*?))?[ \t]*$/;

function readValue(raw: string): FieldValue {
  const text = raw.replace(/[ \t]+#.*$/, "");
  if (/^(?:true|yes)$/i.test(text)) return true;
  if (/^(?:false|no)$/i.test(text)) return false;
  const quoted = /^"(.*)"$|^'(.*)'$/.exec(text);
  if (quoted) {
    if (quoted[2] !== undefined) return quoted[2].replace(/''/g, "'");
    try {
      return JSON.parse(text);
    } catch {
      return quoted[1];
    }
  }
  return text;
}

/** The front matter at the top of `text`, if it has one. */
export function frontMatter(text: string): FrontMatter | null {
  if (!text.startsWith("---")) return null;
  const lines = text.split("\n");
  if (!FENCE.test(lines[0].replace(/\r$/, ""))) return null;
  const fields: Record<string, FieldValue> = {};
  let offset = lines[0].length + 1;
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].replace(/\r$/, "");
    if (CLOSE.test(line)) return { from: 0, to: offset + lines[i].length, endLine: i + 1, fields };
    const m = FIELD.exec(line);
    if (m && m[2] !== undefined) fields[m[1]] = readValue(m[2]);
    offset += lines[i].length + 1;
  }
  return null;
}

/** A value as YAML: bare when that reads back the same, else in double quotes. */
function writeValue(value: FieldValue): string {
  if (typeof value === "boolean") return String(value);
  const bare = /^[^\s"'#&*!|>%@`{}[\],?:-][^#]*$/.test(value) && !/:\s|\s$/.test(value);
  return bare && readValue(value) === value ? value : JSON.stringify(value);
}

export interface Change {
  from: number;
  to: number;
  insert: string;
}

/** The change setting `key` in the front matter of `text`, adding the block if needed; null removes the key. */
export function setProperty(text: string, key: string, value: FieldValue | null): Change | null {
  const block = frontMatter(text);
  const line = value === null ? "" : `${key}: ${writeValue(value)}`;
  if (!block) return value === null ? null : { from: 0, to: 0, insert: `---\n${line}\n---\n\n` };
  const lines = text.split("\n");
  let offset = lines[0].length + 1;
  let count = 0;
  let found: Change | null = null;
  for (let i = 1; i < block.endLine - 1; i++) {
    const m = FIELD.exec(lines[i].replace(/\r$/, ""));
    if (m) count++;
    if (m?.[1] === key) {
      found =
        value === null
          ? { from: offset, to: offset + lines[i].length + 1, insert: "" }
          : { from: offset, to: offset + lines[i].replace(/\r$/, "").length, insert: line };
    }
    offset += lines[i].length + 1;
  }
  if (!found) return value === null ? null : { from: offset, to: offset, insert: line + "\n" };
  // The last key gone, the block goes too, with the blank line after it.
  if (value === null && count === 1 && block.endLine - 1 === 2) {
    const after = text.slice(block.to + 1).match(/^[ \t]*\r?\n/)?.[0].length ?? 0;
    return { from: 0, to: Math.min(text.length, block.to + 1 + after), insert: "" };
  }
  return found;
}
