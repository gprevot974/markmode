// Mirrors the parts of ~/.config/helix/config.toml that apply to this editor.
// Key bindings use the same names and shape as config.toml.

import type { KeyTrie } from "./helix/keymap.ts";

export const config = {
  // [editor]
  cursorline: true,
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
