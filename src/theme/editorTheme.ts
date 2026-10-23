// The editor's look, whatever the theme: its fonts, the centered column of
// text, the line numbers, and the colors of code in fenced blocks and other
// files. Colors are the theme's CSS variables (helixTheme.ts), so a theme
// applies by setting them on the root element.

import { EditorView } from "@codemirror/view";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags as t } from "@lezer/highlight";

const layout = EditorView.theme(
  {
    "&": { color: "var(--fg)", backgroundColor: "var(--bg)", height: "100%" },
    // Set here rather than in style.css: CodeMirror's base theme is more specific.
    ".cm-scroller": {
      fontFamily: "var(--prose-font)",
      fontSize: "var(--text-size)",
      lineHeight: "1.65",
    },
    // A centered column of readable width; CodeMirror otherwise lets it grow.
    ".cm-content": { caretColor: "var(--fg-muted)", flex: "0 1 var(--measure)", margin: "0 auto", minWidth: "0" },
    ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--fg-muted)", borderLeftWidth: "2px" },
    "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground":
      { backgroundColor: "var(--sel-primary)" },
    ".cm-activeLine": { backgroundColor: "transparent" },
    // Line numbers sit just left of the text: the gutter takes the free space on
    // the left, the text the free space on the right, so the pair stays centered.
    ".cm-gutters": {
      marginLeft: "auto",
      backgroundColor: "transparent",
      border: "none",
      color: "var(--gutter)",
      fontFamily: "var(--mono-font)",
      fontSize: "calc(13px * var(--zoom, 1))",
    },
    ".cm-gutters ~ .cm-content": { marginLeft: "0" },
    ".cm-lineNumbers .cm-gutterElement": {
      lineHeight: "calc(var(--text-size) * 1.65)",
      padding: "0 1.1rem 0 0.4rem",
      minWidth: "3ch",
    },
    ".cm-activeLineGutter": { backgroundColor: "transparent", color: "var(--gutter-active)" },
    ".cm-panels": { backgroundColor: "var(--bg-dim)", color: "var(--fg)" },
  },
);

// Code inside fenced blocks, plus the few markdown tokens that are not
// handled by the live preview's own classes.
const highlight = HighlightStyle.define([
  { tag: t.keyword, color: "var(--keyword)" },
  { tag: [t.name, t.deleted, t.character, t.macroName], color: "var(--fg)" },
  { tag: [t.function(t.variableName), t.labelName], color: "var(--function)" },
  { tag: [t.propertyName], color: "var(--property)" },
  { tag: [t.color, t.constant(t.name), t.standard(t.name)], color: "var(--constant)" },
  { tag: [t.definition(t.name), t.separator], color: "var(--fg)" },
  { tag: [t.typeName, t.className, t.namespace], color: "var(--type)" },
  { tag: [t.number, t.bool, t.atom], color: "var(--number)" },
  { tag: [t.operator, t.operatorKeyword], color: "var(--operator)" },
  { tag: [t.url, t.escape, t.regexp, t.link], color: "var(--special)" },
  { tag: [t.meta, t.comment], color: "var(--fg-dim)", fontStyle: "italic" },
  { tag: [t.string, t.special(t.string), t.inserted], color: "var(--string)" },
  { tag: t.invalid, color: "var(--error)" },
  { tag: t.processingInstruction, color: "var(--fg-dim)" },
  { tag: t.contentSeparator, color: "var(--gutter)" },
  { tag: t.quote, color: "var(--quote)" },
]);

export const editorTheme = [layout, syntaxHighlighting(highlight)];
