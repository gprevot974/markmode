// Following links (`gf`, Cmd-click): what the link under the cursor
// points to, and the file and heading that is.

import type { EditorState } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import { headings } from "./outline.ts";

export type LinkTarget =
  /** A web or mail address, for the system to open. */
  | { kind: "url"; url: string }
  /** A file, relative to the document's folder or absolute, and maybe a heading in it. */
  | { kind: "path"; path: string; anchor: string }
  /** A wiki-link: a note found by name in the workspace. */
  | { kind: "wiki"; name: string; anchor: string }
  /** A footnote: from its reference to its note, or (`note`) back. */
  | { kind: "footnote"; label: string; note: boolean };

const URL_SCHEME = /^(?:https?|mailto):/i;

function parse(target: string): LinkTarget | null {
  target = target.trim().replace(/^<(.*)>$/, "$1");
  if (!target) return null;
  if (URL_SCHEME.test(target) || /^www\./i.test(target)) return { kind: "url", url: /^www\./i.test(target) ? `https://${target}` : target };
  if (/^[a-z][\w+.-]*:/i.test(target) && !/^file:/i.test(target)) return null;
  const hash = target.indexOf("#");
  const path = (hash < 0 ? target : target.slice(0, hash)).replace(/^file:\/\//i, "");
  let decoded = path;
  try {
    decoded = decodeURI(path);
  } catch {}
  return { kind: "path", path: decoded, anchor: hash < 0 ? "" : target.slice(hash + 1) };
}

/** The link at `pos`: a markdown link, image, autolink or wiki-link, or else the path-like word there, as Helix's `gf` takes. */
export function linkAt(state: EditorState, pos: number): LinkTarget | null {
  for (let node: ReturnType<ReturnType<typeof syntaxTree>["resolveInner"]> | null = syntaxTree(state).resolveInner(pos, 1); node; node = node.parent) {
    // Anywhere in a note, outside a link in it, goes back to its reference.
    if (node.name === "FootnoteRef" || node.name === "FootnoteLabel" || node.name === "FootnoteDefinition") {
      return { kind: "footnote", label: /\[\^([^\]\s]+)\]/.exec(state.sliceDoc(node.from, node.to))?.[1] ?? "", note: node.name !== "FootnoteRef" };
    }
    if (node.name === "WikiLink") {
      const inner = state.sliceDoc(node.from + 2, node.to - 2).split("|")[0];
      const hash = inner.indexOf("#");
      return { kind: "wiki", name: (hash < 0 ? inner : inner.slice(0, hash)).trim(), anchor: hash < 0 ? "" : inner.slice(hash + 1).trim() };
    }
    if (node.name === "Link" || node.name === "Image" || node.name === "Autolink") {
      const url = node.getChild("URL");
      if (url) return parse(state.sliceDoc(url.from, url.to));
      // A reference link: its definition holds the URL.
      const label = node.getChild("LinkLabel") ?? node;
      const name = state.sliceDoc(label.from, label.to).replace(/^!?\[|\]$/g, "").toLowerCase();
      const def = new RegExp(`^ {0,3}\\[${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\]:\\s*(\\S+)`, "im").exec(state.doc.toString());
      return def ? parse(def[1]) : null;
    }
    if (node.name === "URL") return parse(state.sliceDoc(node.from, node.to));
  }
  // A bare path or address under the cursor.
  const line = state.doc.lineAt(pos);
  const col = pos - line.from;
  const re = /[^\s()<>\[\]"'`]+/g;
  for (let m; (m = re.exec(line.text)); ) {
    if (m.index <= col && col < m.index + m[0].length) {
      const word = m[0].replace(/[.,;:!?]+$/, "");
      return /[/.]/.test(word) ? parse(word) : null;
    }
  }
  return null;
}

/** GitHub's heading anchors: lowercase, punctuation dropped, spaces as hyphens. */
export function slug(title: string): string {
  return title
    .trim()
    .toLowerCase()
    .replace(/[*_`~]/g, "")
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .replace(/\s/g, "-");
}

/** The line of the heading `anchor` names in `text` (by its slug, or its title), or null. */
export function anchorLine(text: string, anchor: string): number | null {
  if (!anchor) return null;
  let wanted = anchor;
  try {
    wanted = decodeURIComponent(anchor);
  } catch {}
  const target = slug(wanted);
  return headings(text).find((h) => slug(h.title) === target)?.line ?? null;
}

const MARKDOWN = /\.(?:md|markdown|mdx?)$/i;

/**
 * The file a wiki-link names, among `files` (paths relative to the workspace
 * root): its name or path, without the extension, ignoring case. The one
 * nearest `fromDir` (relative too) wins, then the shortest path.
 */
export function resolveWiki(name: string, files: string[], fromDir: string): string | null {
  const wanted = name.replace(MARKDOWN, "").toLowerCase();
  const candidates = files.filter((f) => {
    if (!MARKDOWN.test(f)) return false;
    const bare = f.replace(MARKDOWN, "").toLowerCase();
    return bare === wanted || bare.endsWith("/" + wanted);
  });
  const depth = (f: string) => {
    const dir = f.includes("/") ? f.slice(0, f.lastIndexOf("/")) : "";
    if (dir === fromDir) return 0;
    if (fromDir.startsWith(dir) || dir.startsWith(fromDir)) return 1;
    return 2;
  };
  candidates.sort((a, b) => depth(a) - depth(b) || a.split("/").length - b.split("/").length || a.localeCompare(b));
  return candidates[0] ?? null;
}

export { MARKDOWN as MARKDOWN_PATH };
