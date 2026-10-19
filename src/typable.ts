// Typable commands (`:w`, `:o`, ...): names, aliases and docs, used both to
// run them and to complete them in the command line.

export interface Typable {
  name: string;
  aliases: string[];
  doc: string;
  /** What the argument completes to. */
  args?: "path" | "theme" | "encoding" | "line-ending";
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
  { name: "encoding", aliases: [], doc: "Set the encoding the file is saved in (utf-8, utf-16le, utf-16be, windows-1252). Without an argument, shows it", args: "encoding" },
  { name: "line-ending", aliases: [], doc: "Set the line endings the file is saved with: lf or crlf. Without an argument, shows them", args: "line-ending" },
  { name: "config-open", aliases: [], doc: "Open your Helix config.toml, and list the bindings in it this editor skips" },
  { name: "theme", aliases: [], doc: "Change the theme: auto (Kanagawa, following macOS), light, dark, or any Helix theme by name. Without an argument, shows the current one", args: "theme" },
  { name: "goto", aliases: ["g"], doc: "Goto line number" },
  { name: "help", aliases: ["h"], doc: "List the typable commands" },
];

export function findTypable(name: string): Typable | undefined {
  return typables.find((t) => t.name === name || t.aliases.includes(name));
}

/** Commands matching what has been typed: prefix matches first, then subsequence matches. */
export function matchTypables(typed: string): Typable[] {
  const prefix = (t: Typable) => [t.name, ...t.aliases].some((n) => n.startsWith(typed));
  const subseq = (n: string) => {
    let i = 0;
    for (const c of n) if (c === typed[i]) i++;
    return i === typed.length;
  };
  return [
    ...typables.filter(prefix),
    ...typables.filter((t) => !prefix(t) && subseq(t.name)),
  ];
}
