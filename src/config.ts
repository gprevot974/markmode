// Defaults, in the shape of Helix's config.toml. At startup, the settings of
// ~/.config/helix/config.toml that apply to this editor replace them (see
// helixConfig.ts), and its key remaps are added to these.

import type { KeyTrie } from "./helix/keymap.ts";
import type { ThemeChoice } from "./theme/appearance.ts";

export const config = {
  // Read ~/.config/helix/config.toml and use its theme, options and keys.
  readHelixConfig: true,

  // "auto" (or "kanagawa") follows the macOS appearance: wave when dark, lotus
  // when light; "dark" or "light" pins one; any other name is a Helix theme.
  // `:theme` overrides it.
  theme: "auto" as ThemeChoice,

  // [editor]
  cursorline: true,
  // Line numbers in the margin: off for prose, where a paragraph is one line.
  // gutters = ["line-numbers", ...] in config.toml turns them on.
  lineNumbers: false,
  // Underline misspelled words, using the macOS spell checker and its languages
  spellcheck: true,
  softWrap: true,
  // Where :reflow wraps lines
  textWidth: 80,
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
