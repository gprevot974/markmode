// Defaults, in the shape of Helix's config.toml. At startup, the settings of
// ~/.config/helix/config.toml that apply to this editor replace them (see
// helixConfig.ts), then those of ~/.config/markmode/config.toml (see
// settings.ts); the key remaps of both are added to these.

import type { KeyTrie } from "./helix/keymap.ts";
import type { ThemeChoice } from "./theme/appearance.ts";

export const config = {
  // Read ~/.config/helix/config.toml and use its theme, options and keys.
  readHelixConfig: true,

  // Look for a newer release on GitHub at startup (`check-for-updates`);
  // `:update` installs it.
  checkForUpdates: true,

  // "auto" is Entre-Deux following the macOS appearance: entre-deux when dark,
  // entre-deux-light when light; "dark" or "light" pins one; "kanagawa" is
  // Kanagawa the same way; any other name is a Helix theme. `:theme`
  // overrides it.
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
  // Hints for newcomers to modal editing: on an empty buffer, and when a key
  // that does nothing is typed in normal mode
  hints: true,

  // [images] folder: where pasted and dropped images go, next to the document
  imageFolder: "assets",

  // Remaps over the default keymap (src/helix/keymap.ts): none. Yours go in
  // [keys.normal] and [keys.insert] of either config.toml.
  keys: {
    insert: {} as KeyTrie,
    normal: {} as KeyTrie,
  },
};

const defaults = structuredClone(config);

/** Back to the defaults, for the config files to apply again (`:config-reload`). */
export function resetConfig() {
  Object.assign(config, structuredClone(defaults));
}
