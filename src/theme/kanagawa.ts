// Kanagawa (wave), the theme from your Helix config, for the editor and for
// syntax highlighting inside code blocks.

import { EditorView } from "@codemirror/view";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags as t } from "@lezer/highlight";

export const k = {
  sumiInk0: "#16161D",
  sumiInk1: "#181820",
  sumiInk3: "#1F1F28",
  sumiInk4: "#2A2A37",
  sumiInk5: "#363646",
  sumiInk6: "#54546D",
  waveBlue1: "#223249",
  waveBlue2: "#2D4F67",
  winterGreen: "#2B3328",
  fujiWhite: "#DCD7BA",
  oldWhite: "#C8C093",
  fujiGray: "#727169",
  katanaGray: "#717C7C",
  oniViolet: "#957FB8",
  crystalBlue: "#7E9CD8",
  springViolet2: "#9CABCA",
  springBlue: "#7FB4CA",
  lightBlue: "#A3D4D5",
  waveAqua2: "#7AA89F",
  springGreen: "#98BB6C",
  boatYellow2: "#C0A36E",
  carpYellow: "#E6C384",
  sakuraPink: "#D27E99",
  waveRed: "#E46876",
  peachRed: "#FF5D62",
  surimiOrange: "#FFA066",
  autumnGreen: "#76946A",
  autumnRed: "#C34043",
  roninYellow: "#FF9E3B",
};

const editorTheme = EditorView.theme(
  {
    "&": { color: k.fujiWhite, backgroundColor: k.sumiInk3, height: "100%" },
    // Set here rather than in style.css: CodeMirror's base theme is more specific.
    ".cm-scroller": {
      fontFamily: "var(--prose-font)",
      fontSize: "18px",
      lineHeight: "1.65",
    },
    // A centered column of readable width; CodeMirror otherwise lets it grow.
    ".cm-content": { caretColor: k.oldWhite, flex: "0 1 var(--measure)", margin: "0 auto", minWidth: "0" },
    ".cm-cursor, .cm-dropCursor": { borderLeftColor: k.oldWhite, borderLeftWidth: "2px" },
    "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground":
      { backgroundColor: k.waveBlue1 },
    ".cm-activeLine": { backgroundColor: "transparent" },
    ".cm-gutters": { display: "none" },
    ".cm-panels": { backgroundColor: k.sumiInk1, color: k.fujiWhite },
  },
  { dark: true },
);

// Code inside fenced blocks, plus the few markdown tokens that are not
// handled by the live preview's own classes.
const highlight = HighlightStyle.define([
  { tag: t.keyword, color: k.oniViolet },
  { tag: [t.name, t.deleted, t.character, t.macroName], color: k.fujiWhite },
  { tag: [t.function(t.variableName), t.labelName], color: k.crystalBlue },
  { tag: [t.propertyName], color: k.carpYellow },
  { tag: [t.color, t.constant(t.name), t.standard(t.name)], color: k.surimiOrange },
  { tag: [t.definition(t.name), t.separator], color: k.fujiWhite },
  { tag: [t.typeName, t.className, t.namespace], color: k.waveAqua2 },
  { tag: [t.number, t.bool, t.atom], color: k.sakuraPink },
  { tag: [t.operator, t.operatorKeyword], color: k.boatYellow2 },
  { tag: [t.url, t.escape, t.regexp, t.link], color: k.springBlue },
  { tag: [t.meta, t.comment], color: k.fujiGray, fontStyle: "italic" },
  { tag: [t.string, t.special(t.string), t.inserted], color: k.springGreen },
  { tag: t.invalid, color: k.peachRed },
  { tag: t.processingInstruction, color: k.fujiGray },
  { tag: t.contentSeparator, color: k.sumiInk6 },
  { tag: t.quote, color: k.springViolet2 },
]);

export const kanagawa = [editorTheme, syntaxHighlighting(highlight)];
