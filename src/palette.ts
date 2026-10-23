// The command palette (`space ?`, Cmd-Shift-P) and the key reference
// (`:keys`): every typable command and key binding, described in words, so
// features can be found without knowing their keys.

import { type Binding, type KeyTrie, isTrie } from "./helix/keymap.ts";
import { describe } from "./helix/dispatcher.ts";
import { minorModeNames } from "./helix/docs.ts";
import { findTypable, type Typable, typables } from "./typable.ts";

export interface PaletteEntry {
  /** What it does, in words. */
  label: string;
  /** The key sequences bound to it in normal mode, in Helix notation (["space", "f"]). */
  keys: string[][];
  /** The typable command it is, if it is one. */
  typable?: Typable;
  /** The key binding it runs, when it is not a typable command. */
  binding?: Binding;
  /** Its macOS shortcuts. */
  shortcuts: string[];
}

/** The app's Cmd shortcuts (main.ts, appShortcut), by the typable or key command they run. */
const SHORTCUTS: Record<string, string[]> = {
  write: ["⌘S"],
  open: ["⌘O"],
  "export-docx": ["⌘⇧E"],
  zoom: ["⌘=", "⌘-", "⌘0"],
  command_palette: ["⌘⇧P"],
};

const NAMED_KEYS: Record<string, string> = {
  space: "Space",
  ret: "Enter",
  esc: "Esc",
  tab: "Tab",
  backspace: "Backspace",
  del: "Delete",
  left: "←",
  right: "→",
  up: "↑",
  down: "↓",
  home: "Home",
  end: "End",
  pageup: "Page Up",
  pagedown: "Page Down",
};

/** A key in words: "C-w" is "Ctrl-w", "space" is "Space". */
export function keyLabel(key: string): string {
  const mods: string[] = [];
  let rest = key;
  for (;;) {
    const m = /^([CAS])-(.+)$/.exec(rest);
    if (!m) break;
    mods.push({ C: "Ctrl", A: "Alt", S: "Shift" }[m[1]]!);
    rest = m[2];
  }
  return [...mods, NAMED_KEYS[rest] ?? rest].join("-");
}

/** A key sequence in words: "space f" is "Space f". */
export const sequenceLabel = (keys: string[]) => keys.map(keyLabel).join(" ");

/** A typable command's doc, to its first clause: what the palette lists it as (the preview has the rest). */
export function typableLabel(t: Typable): string {
  return t.doc.split(/\.(?:\s|$)|[,;:] | \(/)[0];
}

/** What a binding does, in words; a typable command by its doc. */
function bindingLabel(binding: Binding): string {
  if (typeof binding === "string" && binding.startsWith(":")) {
    const typable = findTypable(binding.slice(1).split(/\s+/)[0]);
    if (typable && !binding.includes(" ")) return typableLabel(typable);
  }
  return describe(binding);
}

/** Every binding of a keymap, depth-first: its key sequence and what it runs. */
function leaves(trie: KeyTrie, path: string[] = []): [string[], Binding][] {
  return Object.entries(trie).flatMap(([key, binding]) =>
    isTrie(binding) ? leaves(binding, [...path, key]) : [[[...path, key], binding] as [string[], Binding]],
  );
}

/** The palette's entries: the typable commands, then the key bindings not running one of them. */
export function paletteEntries(normal: KeyTrie): PaletteEntry[] {
  const byTypable = new Map<Typable, PaletteEntry>();
  const entries: PaletteEntry[] = typables.map((typable) => {
    const entry: PaletteEntry = { label: typableLabel(typable), keys: [], typable, shortcuts: SHORTCUTS[typable.name] ?? [] };
    byTypable.set(typable, entry);
    return entry;
  });
  const byBinding = new Map<string, PaletteEntry>();
  for (const [keys, binding] of leaves(normal)) {
    const typable = typeof binding === "string" && /^:\S+$/.test(binding) ? findTypable(binding.slice(1)) : undefined;
    if (typable) {
      byTypable.get(typable)!.keys.push(keys);
      continue;
    }
    const id = JSON.stringify(binding);
    let entry = byBinding.get(id);
    if (!entry) {
      const shortcuts = typeof binding === "string" ? (SHORTCUTS[binding] ?? []) : [];
      entry = { label: bindingLabel(binding), keys: [], binding, shortcuts };
      byBinding.set(id, entry);
      entries.push(entry);
    }
    entry.keys.push(keys);
  }
  return entries;
}

/** How to run an entry, as the palette shows it beside the label: its keys, shortcuts and command name. */
export function entryDetail(entry: PaletteEntry): string {
  return [
    ...entry.keys.map(sequenceLabel),
    ...entry.shortcuts,
    ...(entry.typable ? [`:${entry.typable.name}`] : []),
  ].join("  ");
}

/** The palette's preview of an entry: everything about it. */
export function entryPreview(entry: PaletteEntry): string {
  const lines = [entry.typable ? entry.typable.doc : entry.label, ""];
  if (entry.keys.length) lines.push(`Keys: ${entry.keys.map(sequenceLabel).join(", ")}`);
  if (entry.shortcuts.length) lines.push(`Shortcut: ${entry.shortcuts.join(", ")}`);
  if (entry.typable) {
    lines.push(`Command: ${[entry.typable.name, ...entry.typable.aliases].map((n) => `:${n}`).join(", ")}`);
    if (entry.typable.args) lines.push("", "Enter puts it in the command line, to add what it takes.");
  }
  return lines.join("\n");
}

/** A key (or keys) as inline code in a markdown table cell. */
function code(key: string): string {
  const quoted = key.includes("`") ? `\`\` ${key} \`\`` : `\`${key}\``;
  return quoted.replaceAll("|", "\\|");
}

/** A table of a keymap level's direct bindings, keys doing the same thing sharing a row. */
function keyTable(trie: KeyTrie): string[] {
  const rows = new Map<string, string[]>();
  for (const [key, binding] of Object.entries(trie)) {
    if (isTrie(binding)) continue;
    const label = bindingLabel(binding);
    rows.set(label, [...(rows.get(label) ?? []), key]);
  }
  if (!rows.size) return [];
  return [
    "| Key | What it does |",
    "| --- | --- |",
    ...[...rows].map(([label, keys]) => `| ${keys.map((k) => code(keyLabel(k))).join(" ")} | ${label.replaceAll("|", "\\|")} |`),
    "",
  ];
}

/**
 * The sections for a keymap's minor modes (`space`, `space w`, `g`...), nested
 * ones after their parent; one reached by several keys (`space w` and `C-w`)
 * is listed once, under all of them.
 */
function minorModes(normal: KeyTrie): string[] {
  const sections = new Map<string, { paths: string[][]; trie: KeyTrie }>();
  const visit = (trie: KeyTrie, path: string[]) => {
    // The space menu first: it holds the most, and its keys are the ones shown.
    const entries = Object.entries(trie).sort(([a], [b]) => Number(b === "space") - Number(a === "space"));
    for (const [key, binding] of entries) {
      if (!isTrie(binding)) continue;
      const keys = [...path, key];
      const id = JSON.stringify(binding);
      const section = sections.get(id);
      if (section) section.paths.push(keys);
      else sections.set(id, { paths: [keys], trie: binding });
      visit(binding, keys);
    }
  };
  visit(normal, []);
  return [...sections.values()].flatMap(({ paths, trie }) => {
    const keys = paths.map(sequenceLabel).join(", ");
    const name = paths.map((p) => minorModeNames[p.join("")]).find(Boolean);
    return [`### ${keys}${name && name !== keys ? `: ${name}` : ""}`, "", ...keyTable(trie)];
  });
}

/** `:keys`: every key binding, as a markdown document, with your remaps. */
export function keysReference(normal: KeyTrie, insert: KeyTrie): string {
  return [
    "# Keys",
    "",
    "In normal mode (`NOR` in the statusline) keys are commands: they move, select and act on the selection. " +
      "`i` goes to insert mode (`INS`), where keys type, and `Esc` comes back. " +
      "`Space ?` or `⌘⇧P` searches the commands by what they do, and `:tutor` teaches the basics.",
    "",
    "A count before a key repeats it: `3w` moves three words. Select mode (`v`) uses the normal mode keys, extending the selection instead of moving it.",
    "",
    "## Normal mode",
    "",
    ...keyTable(normal),
    "Keys that open a menu of more keys, shown in a popup as you press them:",
    "",
    ...minorModes(normal),
    "## Insert mode",
    "",
    "Keys type text. Arrow keys, Backspace and the macOS text shortcuts work as in other apps (`Ctrl-a`, `Ctrl-e`, `Ctrl-k`...). Besides them:",
    "",
    ...keyTable(insert),
    "## macOS shortcuts",
    "",
    "| Key | What it does |",
    "| --- | --- |",
    "| `⌘S` | Save |",
    "| `⌘O` | Open a file |",
    "| `⌘⇧E` | Export to Word |",
    "| `⌘⇧P` | Command palette |",
    "| `⌘Z` `⌘⇧Z` | Undo, redo |",
    "| `⌘V` | Paste (an image, too) |",
    "| `⌘=` `⌘-` `⌘0` | Zoom in, out, back to 100% |",
    "| `⌘W` `⌘Q` | Close the window, quit (asking about unsaved changes) |",
    "",
  ].join("\n");
}
