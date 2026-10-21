// Images: where an image a document links to is, its bytes as a URL the
// preview can show, and its size, for the export.

import { Facet } from "@codemirror/state";

/** The path of the document an editor shows, which relative image paths start from. */
export const documentPath = Facet.define<string | null, string | null>({ combine: (values) => values[0] ?? null });

const TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  bmp: "image/bmp",
  avif: "image/avif",
};

/** An image's media type, from its file name; empty for one this does not know. */
export const imageType = (path: string) => TYPES[path.replace(/[?#].*$/, "").slice(path.lastIndexOf(".") + 1).toLowerCase()] ?? "";

/** Addresses the webview loads itself. */
export const isRemote = (src: string) => /^(?:https?|data|blob):/i.test(src);

/** The absolute path of a local image, from the document's path; null for a remote one. */
export function imagePath(src: string, docPath: string | null): string | null {
  if (isRemote(src)) return null;
  let path = src.replace(/^<(.*)>$/, "$1").replace(/^file:\/\//i, "").replace(/[?#].*$/, "");
  try {
    path = decodeURI(path);
  } catch {}
  if (!path.startsWith("/")) {
    const dir = docPath ? docPath.slice(0, docPath.lastIndexOf("/")) : "";
    path = `${dir}/${path}`;
  }
  const parts: string[] = [];
  for (const seg of path.split("/")) {
    if (seg === "..") parts.pop();
    else if (seg !== "." && seg !== "") parts.push(seg);
  }
  return "/" + parts.join("/");
}

const urls = new Map<string, Promise<string>>();
let read: (path: string) => Promise<Uint8Array> = () => Promise.reject(new Error("no image reader"));

/** How image files are read: the backend's. */
export function setImageReader(reader: typeof read) {
  read = reader;
}

/** A URL for the image at `src`, read once and kept for the session. */
export function imageUrl(src: string, docPath: string | null): Promise<string> {
  const path = imagePath(src, docPath);
  if (!path) return Promise.resolve(src);
  let url = urls.get(path);
  if (!url) {
    const type = imageType(path);
    url = read(path).then((bytes) => URL.createObjectURL(new Blob([bytes as BlobPart], { type })));
    // A failed read is tried again next time: the file may appear.
    url.catch(() => urls.delete(path));
    urls.set(path, url);
  }
  return url;
}

export interface ImageInfo {
  type: "png" | "jpg" | "gif" | "bmp" | "svg";
  width: number;
  height: number;
}

/** The format and pixel size of a PNG, JPEG, GIF, BMP or SVG, which Word takes; null for others. */
export function imageInfo(b: Uint8Array): ImageInfo | null {
  const be16 = (i: number) => (b[i] << 8) | b[i + 1];
  const be32 = (i: number) => ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;
  const le16 = (i: number) => b[i] | (b[i + 1] << 8);
  const le32 = (i: number) => (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)) >>> 0;
  if (b.length > 24 && be32(0) === 0x89504e47) return { type: "png", width: be32(16), height: be32(20) };
  if (b.length > 10 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return { type: "gif", width: le16(6), height: le16(8) };
  if (b.length > 26 && b[0] === 0x42 && b[1] === 0x4d) return { type: "bmp", width: le32(18), height: Math.abs(le32(22) | 0) };
  if (b.length > 4 && b[0] === 0xff && b[1] === 0xd8) {
    // The frame header (SOF0 to SOF15, but not DHT, JPG or DAC) holds the size.
    for (let i = 2; i + 9 < b.length; ) {
      if (b[i] !== 0xff) return null;
      const marker = b[i + 1];
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { type: "jpg", width: be16(i + 7), height: be16(i + 5) };
      }
      i += 2 + be16(i + 2);
    }
  }
  return svgInfo(b);
}

// CSS pixels in each unit an SVG's size may be given in.
const UNITS: Record<string, number> = { "": 1, px: 1, pt: 4 / 3, pc: 16, in: 96, cm: 96 / 2.54, mm: 96 / 25.4 };

/** An SVG's size: its width and height, else its viewBox's. */
function svgInfo(b: Uint8Array): ImageInfo | null {
  const head = new TextDecoder().decode(b.subarray(0, 4096));
  const tag = /<svg\b[^>]*>/i.exec(head)?.[0];
  if (!tag) return null;
  const attr = (name: string) => new RegExp(`\\s${name}\\s*=\\s*["']([^"']*)["']`, "i").exec(tag)?.[1];
  const length = (value?: string) => {
    const m = value && /^\s*([\d.]+)\s*(px|pt|pc|in|cm|mm)?\s*$/i.exec(value);
    return m ? Number(m[1]) * UNITS[(m[2] ?? "").toLowerCase()] : 0;
  };
  const box = attr("viewBox")?.trim().split(/[\s,]+/).map(Number);
  let width = length(attr("width"));
  let height = length(attr("height"));
  if (box?.length === 4 && box[2] > 0 && box[3] > 0) {
    if (!width && !height) [width, height] = [box[2], box[3]];
    else if (!height) height = (width * box[3]) / box[2];
    else if (!width) width = (height * box[2]) / box[3];
  }
  return width && height ? { type: "svg", width: Math.round(width), height: Math.round(height) } : null;
}

/**
 * A PNG of each SVG image, by its `src`, at twice its size: Word wants one
 * beside an SVG, for the programs that cannot show SVG. Only in a browser.
 */
export async function rasterizeSvgs(images: Map<string, Uint8Array>): Promise<Map<string, Uint8Array>> {
  const out = new Map<string, Uint8Array>();
  await Promise.all(
    [...images].map(async ([src, bytes]) => {
      const info = imageInfo(bytes);
      if (info?.type !== "svg") return;
      try {
        out.set(src, await rasterize(bytes, info.width * 2, info.height * 2));
      } catch {}
    }),
  );
  return out;
}

async function rasterize(svg: Uint8Array, width: number, height: number): Promise<Uint8Array> {
  const url = URL.createObjectURL(new Blob([svg as BlobPart], { type: "image/svg+xml" }));
  try {
    const img = new Image(width, height);
    img.src = url;
    await img.decode();
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    canvas.getContext("2d")!.drawImage(img, 0, 0, width, height);
    const png = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!png) throw new Error("no PNG");
    return new Uint8Array(await png.arrayBuffer());
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** The `src` of each image in a markdown text. */
export function imageSources(markdown: string): string[] {
  return [...markdown.matchAll(/!\[[^\]\n]*\]\(\s*(<[^>\n]+>|[^)\s]+)/g)].map((m) => m[1]);
}

/** The bytes of each local image a markdown text shows, by its `src`; images that cannot be read are left out. */
export async function loadImages(markdown: string, docPath: string | null, readFile: (path: string) => Promise<Uint8Array>): Promise<Map<string, Uint8Array>> {
  const images = new Map<string, Uint8Array>();
  await Promise.all(
    [...new Set(imageSources(markdown))].map(async (src) => {
      const path = imagePath(src, docPath);
      if (!path) return;
      try {
        images.set(src, await readFile(path));
      } catch {}
    }),
  );
  return images;
}
