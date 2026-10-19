// Mirrors the parts of ~/.config/helix/config.toml that apply to this editor.
// Key bindings use the same names and shape as config.toml.

import type { KeyTrie } from "./helix/keymap.ts";

export const config = {
  // theme = "kanagawa": "auto" follows the macOS appearance (wave when dark,
  // lotus when light); "dark" or "light" pins one. `:theme` overrides it.
  theme: "auto" as "auto" | "light" | "dark",

  // [editor]
  cursorline: true,
  // line-number = "absolute"; false hides the gutter
  lineNumbers: true,
  // Underline misspelled words, using the macOS spell checker and its languages
  spellcheck: true,
  softWrap: true,
  // [editor.auto-save] focus-lost
  autoSaveOnFocusLost: true,

  keys: {
    insert: {
      j: { k: "normal_mode" },
    } as KeyTrie,
    normal: {
      ret: "goto_word",
      // C-g ran :write-all and lazygit in a terminal; there is no terminal here.
    } as KeyTrie,
  },
};
