// Typable commands (`:w`, `:o`, ...): names, aliases and docs, used both to
// run them and to complete them in the command line.

import { fuzzyFilter } from "./ui/fuzzy.ts";

export interface Typable {
  name: string;
  aliases: string[];
  doc: string;
  /** What the argument completes to. */
  args?: "path" | "theme" | "encoding" | "line-ending" | "zoom" | "table-widths" | "export-style" | "style-name";
}

export const typables: Typable[] = [
  { name: "write", aliases: ["w"], doc: "Write changes to disk. Accepts an optional path (:write notes.md)", args: "path" },
  { name: "write-quit", aliases: ["wq", "x"], doc: "Write changes to disk and close the current window. Accepts an optional path", args: "path" },
  { name: "write-all", aliases: ["wa"], doc: "Write changes from all buffers to disk" },
  { name: "write-quit-all", aliases: ["wqa", "xa"], doc: "Write changes from all buffers to disk and close the app" },
  { name: "quit", aliases: ["q"], doc: "Close the current window; the last one closes the app. :quit! discards unsaved changes" },
  { name: "quit-all", aliases: ["qa"], doc: "Close the app. :quit-all! discards unsaved changes" },
  { name: "open", aliases: ["o", "e", "edit"], doc: "Open a file from disk into the current window. Without a path, shows a file dialog", args: "path" },
  { name: "new", aliases: ["n"], doc: "Create a new scratch buffer" },
  { name: "vsplit", aliases: ["vs"], doc: "Open the file (or the current buffer) in a vertical split", args: "path" },
  { name: "hsplit", aliases: ["hs", "sp"], doc: "Open the file (or the current buffer) in a horizontal split", args: "path" },
  { name: "vsplit-new", aliases: ["vnew"], doc: "Open a scratch buffer in a vertical split" },
  { name: "hsplit-new", aliases: ["hnew"], doc: "Open a scratch buffer in a horizontal split" },
  { name: "buffer-close", aliases: ["bc", "bclose"], doc: "Close the current buffer. :buffer-close! discards its changes" },
  { name: "buffer-close-others", aliases: ["bco", "bcloseother"], doc: "Close all buffers but the current one" },
  { name: "buffer-close-all", aliases: ["bca", "bcloseall"], doc: "Close all buffers" },
  { name: "buffer-next", aliases: ["bn", "bnext"], doc: "Goto next buffer" },
  { name: "buffer-previous", aliases: ["bp", "bprev"], doc: "Goto previous buffer" },
  { name: "reload", aliases: ["rl"], doc: "Discard changes and reload from the file on disk" },
  { name: "reload-all", aliases: ["rla"], doc: "Discard changes and reload all buffers from disk" },
  { name: "export-docx", aliases: ["docx", "export"], doc: "Export a styled .docx next to the file, or to the given path", args: "path" },
  { name: "export-html", aliases: ["html"], doc: "Export a standalone .html page next to the file, or to the given path: the export style, images included; print it for a PDF", args: "path" },
  { name: "export-style", aliases: [], doc: "Pick the export style of the document, or name it (:export-style acme), in its front matter; reset removes it", args: "export-style" },
  { name: "export-style-default", aliases: [], doc: "Set the export style of documents that name none, in ~/.config/markmode/config.toml. Without an argument, shows it", args: "style-name" },
  { name: "export-style-new", aliases: [], doc: "Start an export style, from the document's: :export-style-new acme, or :export-style-new acme project to share it in the project" },
  { name: "export-style-open", aliases: [], doc: "Open the file of the document's export style, or of the one named, beside it", args: "style-name" },
  { name: "export-preview", aliases: [], doc: "Toggle showing documents as their export style looks: fonts, colors and page width" },
  { name: "export-help", aliases: [], doc: "Open the reference of document properties, export styles and their keys" },
  { name: "encoding", aliases: [], doc: "Set the encoding the file is saved in (utf-8, utf-16le, utf-16be, windows-1252). Without an argument, shows it", args: "encoding" },
  { name: "line-ending", aliases: [], doc: "Set the line endings the file is saved with: lf or crlf. Without an argument, shows them", args: "line-ending" },
  { name: "config-open", aliases: [], doc: "Open your settings, ~/.config/markmode/config.toml (written with every setting commented out when there is none), and list the bindings this editor skips" },
  { name: "config-open-helix", aliases: [], doc: "Open your Helix config.toml, which applies under your settings" },
  { name: "config-reload", aliases: [], doc: "Apply your settings and Helix config.toml again, without a restart" },
  { name: "theme", aliases: [], doc: "Change the theme: auto (Kanagawa, following macOS), light, dark, or any Helix theme by name. Without an argument, shows the current one", args: "theme" },
  { name: "history", aliases: [], doc: "Pick an earlier version of the file, kept on each open, save and outside change, to bring back" },
  { name: "reset-diff-change", aliases: ["diffget", "diffg"], doc: "Reject the outside changes under the selections, bringing back the text from before" },
  { name: "accept-all-changes", aliases: [], doc: "Accept every outside change under review" },
  { name: "reject-all-changes", aliases: [], doc: "Reject every outside change under review" },
  { name: "images-clean", aliases: [], doc: "List the images in the document's images folder (assets/) that no markdown file in the workspace mentions; images-clean! moves them to the Trash" },
  { name: "word-count", aliases: ["wc"], doc: "Count the words a reader sees (markup, link targets, comments and math left out) in the selection or the document, with characters, footnotes and reading time" },
  { name: "reflow", aliases: [], doc: "Hard-wrap the selected lines (with only the cursor, its paragraph) to the given width, or to text-width (80)" },
  { name: "table-widths", aliases: [], doc: "Set the column widths of the table at the cursor (:table-widths 20 30 50), in a widths directive above it. Without an argument, writes the widths it shows; reset removes them", args: "table-widths" },
  { name: "zoom", aliases: [], doc: "Make the text bigger or smaller: in, out, reset or a percentage (also Cmd-=, Cmd--, Cmd-0)", args: "zoom" },
  { name: "goto", aliases: ["g"], doc: "Goto line number" },
  { name: "help", aliases: ["h"], doc: "List the typable commands" },
];

export function findTypable(name: string): Typable | undefined {
  return typables.find((t) => t.name === name || t.aliases.includes(name));
}

/** Commands matching what has been typed: prefix matches of a name or alias first, then fuzzy matches, best first. */
export function matchTypables(typed: string): Typable[] {
  const prefix = (t: Typable) => [t.name, ...t.aliases].some((n) => n.startsWith(typed));
  return [...typables.filter(prefix), ...fuzzyFilter(typed, typables.filter((t) => !prefix(t)), (t) => t.name)];
}
