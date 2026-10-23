// Your Helix config.toml, read at startup and by `:config-reload`: its theme,
// the [editor] options this editor has, and its [keys] remaps. Bindings that
// use commands this editor does not have are skipped as a whole (a sequence
// run halfway would do something else than intended) and listed in a message.

import { config } from "./config.ts";
import { commands } from "./helix/commands.ts";
import { type Binding, type KeyTrie, mergeKeys } from "./helix/keymap.ts";
import { findTypable } from "./typable.ts";
import type { ThemeChoice } from "./theme/appearance.ts";

type Table = Record<string, unknown>;

const isTable = (v: unknown): v is Table => typeof v === "object" && v !== null && !Array.isArray(v);

function supported(name: string): boolean {
  if (name.startsWith(":")) return !!findTypable(name.slice(1).trim().split(/\s+/)[0].replace(/!$/, ""));
  return name in commands;
}

/** The bindings this editor can run; the others go in `skipped`, as "key: command". */
export function usableKeys(trie: Table, skipped: string[], path = ""): KeyTrie {
  const out: KeyTrie = {};
  for (const [key, value] of Object.entries(trie)) {
    const at = path ? `${path} ${key}` : key;
    if (isTable(value)) {
      out[key] = usableKeys(value, skipped, at);
      continue;
    }
    const names = Array.isArray(value) ? value : [value];
    if (!names.every((n): n is string => typeof n === "string")) continue;
    const missing = names.filter((n) => !supported(n));
    if (missing.length) skipped.push(`${at}: ${missing.join(", ")}`);
    else out[key] = value as Binding;
  }
  return out;
}

/** Applies config.toml over the defaults in config.ts; returns what was skipped. */
export function applyHelixConfig(toml: Table): string[] {
  const skipped: string[] = [];
  if (typeof toml.theme === "string") config.theme = toml.theme;
  else if (isTable(toml.theme) && typeof toml.theme.light === "string" && typeof toml.theme.dark === "string") {
    config.theme = { light: toml.theme.light, dark: toml.theme.dark } satisfies ThemeChoice;
  }

  const editor = isTable(toml.editor) ? toml.editor : {};
  if (typeof editor.cursorline === "boolean") config.cursorline = editor.cursorline;
  if (Array.isArray(editor.gutters)) config.lineNumbers = editor.gutters.includes("line-numbers");
  else if (isTable(editor.gutters) && Array.isArray(editor.gutters.layout)) {
    config.lineNumbers = editor.gutters.layout.includes("line-numbers");
  }
  if (typeof editor["text-width"] === "number") config.textWidth = editor["text-width"];
  const softWrap = editor["soft-wrap"];
  if (isTable(softWrap) && typeof softWrap.enable === "boolean") config.softWrap = softWrap.enable;
  const autoSave = editor["auto-save"];
  if (typeof autoSave === "boolean") config.autoSaveOnFocusLost = autoSave;
  else if (isTable(autoSave) && typeof autoSave["focus-lost"] === "boolean") {
    config.autoSaveOnFocusLost = autoSave["focus-lost"];
  }

  const keys = isTable(toml.keys) ? toml.keys : {};
  // Select mode shares the normal-mode table here, so [keys.select] has no place.
  for (const mode of ["normal", "insert"] as const) {
    if (!isTable(keys[mode])) continue;
    const usable = usableKeys(keys[mode], skipped);
    config.keys[mode] = mergeKeys(config.keys[mode], usable);
  }
  return skipped;
}
