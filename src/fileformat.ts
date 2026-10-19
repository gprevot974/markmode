// How a file is laid out on disk, so that saving it changes only what was
// edited. The backend decodes and encodes (encoding, byte order mark); line
// endings are handled here: the editor always works with "\n", and a file
// that used "\r\n" gets it back on saving.

export type Encoding = "utf-8" | "utf-16le" | "utf-16be" | "windows-1252";
export const encodings: Encoding[] = ["utf-8", "utf-16le", "utf-16be", "windows-1252"];
export type LineEnding = "lf" | "crlf";
export const lineEndings: LineEnding[] = ["lf", "crlf"];

/** What the backend reports and takes back. */
export interface DiskFormat {
  encoding: Encoding;
  bom: boolean;
}

export interface FileFormat extends DiskFormat {
  lineEnding: LineEnding;
}

export const defaultFormat: FileFormat = { encoding: "utf-8", bom: false, lineEnding: "lf" };

/**
 * Text as the editor holds it. A file mixing both line endings comes out
 * with the more common one everywhere once saved.
 */
export function fromDisk(text: string, disk: DiskFormat): { text: string; format: FileFormat } {
  const crlf = text.match(/\r\n/g)?.length ?? 0;
  const lf = (text.match(/\n/g)?.length ?? 0) - crlf;
  const lineEnding: LineEnding = crlf > lf ? "crlf" : "lf";
  return { text: crlf ? text.replace(/\r\n/g, "\n") : text, format: { ...disk, lineEnding } };
}

export function toDisk(text: string, format: FileFormat): string {
  return format.lineEnding === "crlf" ? text.replace(/\n/g, "\r\n") : text;
}

export const sameFormat = (a: FileFormat, b: FileFormat) =>
  a.encoding === b.encoding && a.bom === b.bom && a.lineEnding === b.lineEnding;

/** For the statusline: nothing for plain UTF-8 with "\n", as Helix does. */
export function describeFormat(f: FileFormat): string {
  const parts: string[] = [];
  if (f.encoding !== "utf-8" || f.bom) parts.push(f.encoding + (f.bom ? " bom" : ""));
  if (f.lineEnding === "crlf") parts.push("crlf");
  return parts.join(" ");
}
