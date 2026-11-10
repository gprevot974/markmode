// The exports' Mermaid diagrams: each one drawn before the export, in the
// export style's colors and font, as an SVG among the document's images
// (by diagramKey), which docx.ts and html.ts show in place of the code. A
// diagram that cannot be drawn stays code. Only in a browser.

import { stripComments } from "../criticmarkup.ts";
import { type DiagramLook, diagramKey, drawDiagram, mermaidSource } from "../preview/mermaid.ts";
import type { ExportStyle } from "./style.ts";
import { exportParser } from "./tree.ts";

/** The sources of the Mermaid diagrams in a markdown text, as the exports read it. */
export function diagramSources(markdown: string): string[] {
  const text = stripComments(markdown);
  const sources: string[] = [];
  exportParser.parse(text).iterate({
    enter(node) {
      if (node.name !== "FencedCode") return;
      const source = mermaidSource(node.node, (a, b) => text.slice(a, b));
      if (source?.trim()) sources.push(source);
      return false;
    },
  });
  return sources;
}

function styleLook(style: ExportStyle): DiagramLook {
  const color = (key: string) => {
    const value = String(style[`colors.${key}`] ?? "").trim();
    return /^[0-9a-f]{6}$/i.test(value) ? `#${value}` : value || "#000000";
  };
  return {
    dark: false,
    background: "#ffffff",
    fill: color("table-band"),
    border: color("accent"),
    line: color("muted"),
    text: color("text"),
    font: String(style["fonts.body"] ?? "sans-serif"),
  };
}

/** Adds a drawing of each Mermaid diagram in `markdown` to `images`. */
export async function addDiagrams(markdown: string, style: ExportStyle, images: Map<string, Uint8Array>): Promise<void> {
  const sources = [...new Set(diagramSources(markdown))];
  if (!sources.length) return;
  const look = styleLook(style);
  await Promise.all(
    sources.map(async (source) => {
      try {
        images.set(diagramKey(source), new TextEncoder().encode(await drawDiagram(source, look)));
      } catch {}
    }),
  );
}
