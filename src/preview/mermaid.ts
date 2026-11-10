// Mermaid diagrams: a fenced code block whose language is `mermaid`. The
// preview draws it, with Mermaid loaded the first time a document has one,
// in the theme's colors; the source shows where the cursor is, with the
// diagram under it. The exports put the drawing in place of the code
// (export/diagrams.ts), in the export style's colors and font.

import { type EditorState, type Range as DecoRange, StateField } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import type { SyntaxNode } from "@lezer/common";
import { Decoration, type DecorationSet, EditorView, WidgetType } from "@codemirror/view";
import { rebuildNow } from "./blockRefresh.ts";

/** The diagram's source when `node` is a Mermaid code block, else null. */
export function mermaidSource(node: SyntaxNode, slice: (from: number, to: number) => string): string | null {
  if (node.name !== "FencedCode") return null;
  const info = node.getChild("CodeInfo");
  if (!info || slice(info.from, info.to).trim().split(/\s/)[0].toLowerCase() !== "mermaid") return null;
  return node
    .getChildren("CodeText")
    .map((t) => slice(t.from, t.to))
    .join("\n");
}

/** Where the exports find a diagram's drawing among the images, by its source. */
export const diagramKey = (source: string) => `mermaid:${source.trim()}`;

/** The colors (any CSS color) and font a diagram is drawn in. */
export interface DiagramLook {
  dark: boolean;
  background: string;
  fill: string;
  border: string;
  line: string;
  text: string;
  font: string;
}

type Mermaid = typeof import("mermaid").default;
let loading: Promise<Mermaid> | null = null;
const loadMermaid = () => (loading ??= import("mermaid").then((m) => m.default));

let queue: Promise<unknown> = Promise.resolve();
let drawn = 0;

/** Thrown for a drawing no longer wanted by the time its turn came. */
class Skipped extends Error {}

/**
 * The SVG of a diagram, drawn in `look`, with its size in pixels as its
 * width and height; throws with Mermaid's message on an error. Diagrams are
 * drawn one at a time, Mermaid's settings being global; `wanted` is asked
 * when one's turn comes. Only in a browser: Mermaid measures text in the page.
 */
export function drawDiagram(source: string, look: DiagramLook, wanted: () => boolean = () => true): Promise<string> {
  const job = queue.then(async () => {
    if (!wanted()) throw new Skipped();
    const mermaid = await loadMermaid();
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      // Labels as SVG text rather than HTML: Word cannot show HTML in an SVG,
      // and a canvas will not draw it into the PNG Word wants beside it.
      htmlLabels: false,
      theme: "base",
      fontFamily: look.font,
      themeVariables: {
        darkMode: look.dark,
        background: look.background,
        primaryColor: look.fill,
        primaryBorderColor: look.border,
        primaryTextColor: look.text,
        lineColor: look.line,
        edgeLabelBackground: look.background,
        textColor: look.text,
        fontFamily: look.font,
      },
    });
    await mermaid.parse(source);
    const id = `md-mermaid-${++drawn}`;
    try {
      const { svg } = await mermaid.render(id, source);
      return sized(svg);
    } finally {
      // Mermaid leaves its scratch element behind when a diagram fails.
      document.getElementById(`d${id}`)?.remove();
    }
  });
  queue = job.catch(() => {});
  return job;
}

/** An SVG at its viewBox's size, rather than as wide as its container. */
function sized(svg: string): string {
  return svg.replace(/<svg\b[^>]*>/, (tag) => {
    const box = /\sviewBox="([^"]*)"/.exec(tag)?.[1].trim().split(/[\s,]+/).map(Number);
    if (box?.length !== 4 || !(box[2] > 0 && box[3] > 0)) return tag;
    const rest = tag.replace(/\s(?:width|height|style)="[^"]*"/g, "").slice(4);
    return `<svg width="${Math.ceil(box[2])}" height="${Math.ceil(box[3])}"${rest}`;
  });
}

/** The theme's colors and the interface font, resolved to values Mermaid can compute with. */
function themeLook(): DiagramLook {
  const probe = document.body.appendChild(document.createElement("span"));
  const color = (name: string) => {
    probe.style.color = `var(${name})`;
    return getComputedStyle(probe).color;
  };
  const look = {
    dark: document.documentElement.dataset.theme !== "light",
    background: color("--bg"),
    fill: color("--bg-raised"),
    border: color("--link"),
    line: color("--fg-dim"),
    text: color("--fg"),
    font: getComputedStyle(document.documentElement).getPropertyValue("--ui-font").trim() || "sans-serif",
  };
  probe.remove();
  return look;
}

const svgUrl = (svg: string) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

/** The last diagrams drawn in the theme, by source, so scrolling back or undoing does not draw them again. */
const cache = new Map<string, string>();
const CACHE_SIZE = 50;

/** The diagrams on screen, drawn again when the theme changes. */
const shown = new Map<HTMLElement, { widget: DiagramWidget; view: EditorView }>();
let watching = false;

function watchTheme() {
  if (watching) return;
  watching = true;
  let pending = 0;
  new MutationObserver(() => {
    clearTimeout(pending);
    pending = window.setTimeout(() => {
      cache.clear();
      for (const [el, { widget, view }] of shown) widget.draw(el, view);
    }, 50);
  }).observe(document.documentElement, { attributes: true, attributeFilter: ["style", "data-theme"] });
}

/** The drawing each element waits for: an earlier one arriving late is dropped. */
const latest = new WeakMap<HTMLElement, number>();
let requests = 0;

export class DiagramWidget extends WidgetType {
  readonly source: string;
  /** Under its source, being edited, rather than in its place. */
  readonly editing: boolean;
  constructor(source: string, editing: boolean) {
    super();
    this.source = source;
    this.editing = editing;
  }
  eq(other: DiagramWidget) {
    return other.source === this.source && other.editing === this.editing;
  }
  toDOM(view: EditorView) {
    const el = document.createElement("div");
    el.className = "md-diagram";
    this.draw(el, view);
    return el;
  }
  // Drawn into the element already there, which keeps the last drawing while a new one is made.
  updateDOM(dom: HTMLElement, view: EditorView) {
    this.draw(dom, view);
    return true;
  }
  destroy(dom: HTMLElement) {
    shown.delete(dom);
  }
  get estimatedHeight() {
    return 200;
  }

  draw(el: HTMLElement, view: EditorView) {
    watchTheme();
    shown.set(el, { widget: this, view });
    const request = ++requests;
    latest.set(el, request);
    const cached = cache.get(this.source);
    if (cached) return this.show(el, cached, view);
    if (!el.firstChild) el.textContent = "drawing the diagram…";
    drawDiagram(this.source, themeLook(), () => el.isConnected && latest.get(el) === request).then(
      (svg) => {
        cache.delete(this.source);
        cache.set(this.source, svg);
        if (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value!);
        if (latest.get(el) === request) this.show(el, svg, view);
      },
      (err) => {
        if (err instanceof Skipped || latest.get(el) !== request) return;
        this.failed(el, String(err?.message ?? err).trim(), view);
      },
    );
  }

  private show(el: HTMLElement, svg: string, view: EditorView) {
    const img = document.createElement("img");
    img.alt = "Mermaid diagram";
    img.onload = () => view.requestMeasure();
    img.src = svgUrl(svg);
    el.className = "md-diagram";
    el.title = "";
    el.replaceChildren(img);
  }

  /** In place of the code, the code shown with the error; under it, being edited, the error alone. */
  private failed(el: HTMLElement, message: string, view: EditorView) {
    el.className = "md-diagram md-diagram-error";
    el.title = message;
    const note = document.createElement("div");
    note.className = "md-diagram-message";
    note.textContent = message.split("\n").find((l) => l.trim()) ?? "not a diagram";
    if (this.editing) el.replaceChildren(note);
    else {
      const code = document.createElement("pre");
      code.textContent = this.source;
      el.replaceChildren(code, note);
    }
    view.requestMeasure();
  }
}

/** Whether the selection touches a code block: then it shows its source. */
function editingBlock(state: EditorState, from: number, to: number) {
  const first = state.doc.lineAt(from).from;
  const last = state.doc.lineAt(to).to;
  return state.selection.ranges.some((r) => r.to >= first && r.from <= last);
}

/** Whether the inline preview leaves this code block to the diagram in its place. */
export function diagramReplaces(state: EditorState, node: SyntaxNode): boolean {
  return !!mermaidSource(node, (a, b) => state.sliceDoc(a, b))?.trim() && !editingBlock(state, node.from, node.to);
}

// Diagrams span lines, which only a state field's decorations may replace.
function buildDiagrams(state: EditorState): DecorationSet {
  const decos: DecoRange<Decoration>[] = [];
  syntaxTree(state).iterate({
    enter(node) {
      if (node.name !== "FencedCode") return node.name === "Document" || node.name === "Blockquote" || node.name.endsWith("List") || node.name === "ListItem";
      const source = mermaidSource(node.node, (a, b) => state.sliceDoc(a, b));
      if (source === null || !source.trim()) return false;
      const first = state.doc.lineAt(node.from);
      const last = state.doc.lineAt(node.to);
      const editing = editingBlock(state, node.from, node.to);
      const widget = new DiagramWidget(source, editing);
      if (editing) decos.push(Decoration.widget({ widget, block: true, side: 1 }).range(last.to));
      else decos.push(Decoration.replace({ widget, block: true }).range(first.from, last.to));
      return false;
    },
  });
  return Decoration.set(decos, true);
}

export const mermaidBlocks = StateField.define<DecorationSet>({
  create: buildDiagrams,
  update(deco, tr) {
    if (rebuildNow(tr, true)) return buildDiagrams(tr.state);
    return tr.docChanged ? deco.map(tr.changes) : deco;
  },
  provide: (f) => EditorView.decorations.from(f),
});
