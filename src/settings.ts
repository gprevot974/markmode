// Your settings: ~/.config/markmode/config.toml, read at startup. It has the
// shape of Helix's config.toml (theme, [editor], [keys]) plus this editor's
// own options, and it applies over your Helix config, which applies over the
// defaults in config.ts. `:config-open` opens it, writing this template first
// when there is none.

import { config } from "./config.ts";
import { applyHelixConfig } from "./helixConfig.ts";

type Table = Record<string, unknown>;

const isTable = (v: unknown): v is Table => typeof v === "object" && v !== null && !Array.isArray(v);

/** Whether to read ~/.config/helix/config.toml, by the settings; `read-helix-config` at the top. */
export function readsHelixConfig(settings: Table | null): boolean {
  const value = settings?.["read-helix-config"];
  return typeof value === "boolean" ? value : config.readHelixConfig;
}

/** Applies the settings over the defaults (and the Helix config); returns the bindings skipped. */
export function applySettings(settings: Table): string[] {
  config.readHelixConfig = readsHelixConfig(settings);
  const skipped = applyHelixConfig(settings);
  const editor = isTable(settings.editor) ? settings.editor : {};
  if (typeof editor.spellcheck === "boolean") config.spellcheck = editor.spellcheck;
  const images = isTable(settings.images) ? settings.images : {};
  if (typeof images.folder === "string") config.imageFolder = images.folder.trim().replace(/^\.?\/+|\/+$/g, "");
  return skipped;
}

/** What `:config-open` writes when there is no config.toml yet: every setting, commented out. */
export const SETTINGS_TEMPLATE = `# Markmode settings. Uncomment a line to change it; changes apply on the next
# start. They apply over ~/.config/helix/config.toml, which has the same shape.

# Read your Helix config.toml: its theme, editor options and key remaps.
# read-helix-config = true

# "auto" follows the macOS appearance (kanagawa wave when dark, lotus when
# light); "dark" or "light" pins one; any other name is a Helix theme.
# theme = "auto"
# theme = { light = "catppuccin_latte", dark = "catppuccin_mocha" }

[editor]
# Underline misspelled words, with the macOS spell checker and its languages.
# spellcheck = true
# Highlight the lines holding a cursor.
# cursorline = true
# Line numbers in the margin: off for prose, where a paragraph is one line.
# gutters = ["line-numbers"]
# Wrap long lines at the window's edge.
# soft-wrap = { enable = true }
# Where :reflow wraps lines.
# text-width = 80
# Save modified files when the window loses focus.
# auto-save = { focus-lost = true }

[images]
# Where pasted and dropped images go, next to the document.
# folder = "assets"

# [keys.normal]
# ret = "goto_word"

# [keys.insert]
# j = { k = "normal_mode" }

# [export]
# The export style of documents that name none (see :export-style-default).
# style = "default"
`;
