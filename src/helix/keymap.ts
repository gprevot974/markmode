// Key bindings in Helix's config.toml shape: a key maps to a command name, a
// list of commands, or a nested table (a minor mode like `g` or `space`).
// Command names starting with ":" run typable commands, as in Helix.

export type Binding = string | string[] | KeyTrie;
export interface KeyTrie {
  [key: string]: Binding;
}

// A subset of Helix's default normal-mode keymap: the parts that make sense
// for prose. Select mode uses the same table; motions extend instead of move.
export const normalKeys: KeyTrie = {
  h: "move_char_left",
  left: "move_char_left",
  l: "move_char_right",
  right: "move_char_right",
  j: "move_visual_line_down",
  down: "move_visual_line_down",
  k: "move_visual_line_up",
  up: "move_visual_line_up",
  w: "move_next_word_start",
  b: "move_prev_word_start",
  e: "move_next_word_end",
  W: "move_next_long_word_start",
  B: "move_prev_long_word_start",
  E: "move_next_long_word_end",
  f: "find_next_char",
  t: "find_till_char",
  F: "find_prev_char",
  T: "till_prev_char",
  "A-.": "repeat_last_motion",
  home: "goto_line_start",
  end: "goto_line_end",
  G: "goto_line",

  v: "select_mode",
  i: "insert_mode",
  a: "append_mode",
  I: "insert_at_line_start",
  A: "insert_at_line_end",
  o: "open_below",
  O: "open_above",
  ":": "command_mode",

  x: "extend_line_below",
  X: "extend_to_line_bounds",
  "A-x": "extend_line_above",
  "%": "select_all",
  s: "select_regex",
  S: "split_selection",
  "A-s": "split_selection_on_newline",
  ";": "collapse_selection",
  "A-;": "flip_selections",
  "A-:": "ensure_selections_forward",
  ",": "keep_primary_selection",
  "A-,": "remove_primary_selection",
  C: "copy_selection_on_next_line",
  "A-C": "copy_selection_on_prev_line",
  "(": "rotate_selections_backward",
  ")": "rotate_selections_forward",
  _: "trim_selections",

  "/": "search",
  "?": "rsearch",
  n: "search_next",
  N: "search_prev",
  "*": "search_selection",

  y: "yank",
  p: "paste_after",
  P: "paste_before",
  R: "replace_with_yanked",
  d: "delete_selection",
  "A-d": "delete_selection_noyank",
  c: "change_selection",
  "A-c": "change_selection_noyank",
  r: "replace",
  "~": "switch_case",
  "`": "switch_to_lowercase",
  "A-`": "switch_to_uppercase",
  ">": "indent",
  "<": "unindent",
  J: "join_selections",
  u: "undo",
  U: "redo",

  pageup: "page_up",
  pagedown: "page_down",
  "C-b": "page_up",
  "C-f": "page_down",
  "C-u": "page_cursor_half_up",
  "C-d": "page_cursor_half_down",
  "C-e": "scroll_down",
  "C-y": "scroll_up",
  esc: "exit_select_mode",

  g: {
    g: "goto_file_start",
    e: "goto_last_line",
    h: "goto_line_start",
    l: "goto_line_end",
    s: "goto_first_nonwhitespace",
    t: "goto_window_top",
    c: "goto_window_center",
    b: "goto_window_bottom",
    w: "goto_word",
  },
  m: {
    m: "match_brackets",
    i: "select_textobject_inner",
    a: "select_textobject_around",
    s: "surround_add",
    r: "surround_replace",
    d: "surround_delete",
  },
  z: {
    z: "align_view_center",
    c: "align_view_center",
    t: "align_view_top",
    b: "align_view_bottom",
    j: "scroll_down",
    k: "scroll_up",
  },
  "[": { space: "add_newline_above" },
  "]": { space: "add_newline_below" },
  space: {
    f: "file_picker",
    y: "yank_to_clipboard",
    p: "paste_clipboard_after",
    P: "paste_clipboard_before",
    R: "replace_selections_with_clipboard",
    e: ":export-docx",
  },
};

// Insert mode keeps CodeMirror's own text editing (including the macOS
// Emacs-style C-a, C-e, C-k, C-d, C-h); these are the additions.
export const insertKeys: KeyTrie = {
  esc: "normal_mode",
  "C-w": "delete_word_backward",
  "A-backspace": "delete_word_backward",
  "C-u": "kill_to_line_start",
};

/** Deep-merges user bindings over defaults, like Helix does with config.toml. */
export function mergeKeys(base: KeyTrie, overrides: KeyTrie): KeyTrie {
  const out: KeyTrie = { ...base };
  for (const [key, value] of Object.entries(overrides)) {
    const existing = out[key];
    out[key] =
      isTrie(value) && isTrie(existing) ? mergeKeys(existing, value) : value;
  }
  return out;
}

export const isTrie = (b: Binding | undefined): b is KeyTrie =>
  typeof b === "object" && b !== null && !Array.isArray(b);

// Physical key codes, for Alt combinations: on macOS, Alt turns "." into "≥",
// so the key itself is useless there.
const CODE_KEYS: Record<string, [string, string]> = {
  Period: [".", ">"],
  Comma: [",", "<"],
  Semicolon: [";", ":"],
  Quote: ["'", '"'],
  Backquote: ["`", "~"],
  Slash: ["/", "?"],
  Backslash: ["\\", "|"],
  Minus: ["-", "_"],
  Equal: ["=", "+"],
  BracketLeft: ["[", "{"],
  BracketRight: ["]", "}"],
};

const NAMED: Record<string, string> = {
  Enter: "ret",
  Escape: "esc",
  Backspace: "backspace",
  Delete: "del",
  Tab: "tab",
  ArrowLeft: "left",
  ArrowRight: "right",
  ArrowUp: "up",
  ArrowDown: "down",
  Home: "home",
  End: "end",
  PageUp: "pageup",
  PageDown: "pagedown",
  " ": "space",
};

/** Converts a key event to Helix notation ("x", "X", "C-d", "A-.", "ret"), or null for bare modifiers. */
export function keyName(e: KeyboardEvent): string | null {
  if (["Shift", "Control", "Alt", "Meta", "CapsLock", "Fn"].includes(e.key)) return null;
  let base = NAMED[e.key];
  const named = base !== undefined;
  if (!named) {
    if (e.altKey || e.ctrlKey) base = fromCode(e) ?? e.key;
    else base = e.key;
  }
  let mods = "";
  if (e.ctrlKey) mods += "C-";
  if (e.altKey) mods += "A-";
  // Shift is part of the character for printable keys ("X", "?"); only named keys spell it out.
  if (e.shiftKey && named) mods += "S-";
  return mods + base;
}

function fromCode(e: KeyboardEvent): string | null {
  const letter = /^Key([A-Z])$/.exec(e.code);
  if (letter) return e.shiftKey ? letter[1] : letter[1].toLowerCase();
  const digit = /^Digit(\d)$/.exec(e.code);
  if (digit) return digit[1];
  const pair = CODE_KEYS[e.code];
  return pair ? pair[e.shiftKey ? 1 : 0] : null;
}
