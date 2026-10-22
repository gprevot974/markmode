// Pasting and dropping images: the image is saved next to the document, in the
// images folder (`[images] folder`, assets/ by default), and linked where the
// cursor is, or where it was dropped. An image dropped from the document's own
// folder (or one below it) is linked where it is rather than copied.

import { imageType } from "./images.ts";

/** An image to put in a document: bytes pasted or dragged from the page, or a file dropped from Finder. */
export type ImageSource = { name: string; data: Blob } | { path: string };

const EXTENSIONS: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/svg+xml": "svg",
  "image/bmp": "bmp",
  "image/avif": "avif",
};

/** Whether a file name is one of an image the preview shows. */
export const isImageName = (name: string) => imageType(name) !== "";

const pad = (n: number) => String(n).padStart(2, "0");

/** A name for a pasted image that comes without one, as a screenshot does: pasted-2026-10-22-143005.png. */
export function pastedName(type: string, date = new Date()): string {
  const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  const time = `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
  return `pasted-${day}-${time}.${EXTENSIONS[type] ?? "png"}`;
}

/** The images among pasted or dropped files. Generic names ("image.png", as WebKit gives a screenshot) are replaced. */
export function imageFiles(data: DataTransfer | null, date = new Date()): ImageSource[] {
  // WebKit lists some pasted images among the items only.
  const files = data?.files.length
    ? [...data.files]
    : [...(data?.items ?? [])].filter((i) => i.kind === "file").flatMap((i) => i.getAsFile() ?? []);
  return files
    .filter((f) => EXTENSIONS[f.type] || isImageName(f.name))
    .map((f) => ({ name: f.name && !/^image\.\w+$/i.test(f.name) ? f.name : pastedName(f.type, date), data: f }));
}

/**
 * A file name for `name` in a folder already holding `taken`: characters that
 * are awkward in a link become dashes, and a name in use gets -2, -3, ...
 */
export function freeName(name: string, taken: Iterable<string>): string {
  const used = new Set([...taken].map((n) => n.toLowerCase()));
  const clean = name.replace(/[\s/\\:*?"<>|()[\]#%]+/g, "-").replace(/^[-.]+|-+(?=\.[^.]*$)|-+$/g, "") || "image.png";
  const dot = clean.lastIndexOf(".");
  const [stem, ext] = dot > 0 ? [clean.slice(0, dot), clean.slice(dot)] : [clean, ""];
  let candidate = clean;
  for (let i = 2; used.has(candidate.toLowerCase()); i++) candidate = `${stem}-${i}${ext}`;
  return candidate;
}

/** `path` relative to the directory `dir`, both absolute; null when it is not inside it. */
export function inside(dir: string, path: string): string | null {
  const prefix = dir.endsWith("/") ? dir : `${dir}/`;
  return path.startsWith(prefix) ? path.slice(prefix.length) : null;
}

/** The text a file name stands for, as alt text: "team-photo.jpg" → "team photo"; none for a pasted image's made-up name. */
export const altText = (name: string) =>
  /^pasted-[\d-]+(?:-\d+)?\.\w+$/.test(name) ? "" : name.replace(/\.[^.]*$/, "").replace(/[-_]+/g, " ").trim();

/**
 * The images among `names` (the files of an images folder) that none of
 * `texts` (the workspace's markdown) mentions. The file name anywhere counts,
 * as written or escaped as in a link, so an image in use is never called
 * unused, at the cost of keeping one whose name only appears in the prose.
 */
export function unusedImages(names: string[], texts: string[]): string[] {
  const escaped = (name: string) => [name, encodeURI(name), encodeURIComponent(name), imageLink(name, "").slice(4, -1)];
  return names.filter((name) => !escaped(name).some((form) => texts.some((t) => t.includes(form))));
}

/** Markdown showing the image at `rel`; spaces and parentheses, which would end the link, are escaped. */
export function imageLink(rel: string, alt: string): string {
  const dest = rel.replace(/[ ()<>]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `![${alt.replace(/[[\]]/g, "\\$&")}](${dest})`;
}
