// Turns key presses into commands: counts, multi-key sequences (`gg`, `mi(`),
// commands that read a character (`f`, `r`), and insert-mode sequences such
// as `jk`, which type their keys out when the sequence does not complete.

import { Prec, type Extension } from "@codemirror/state";
import { EditorView, ViewPlugin } from "@codemirror/view";
import { modeField } from "./state.ts";
import { type Binding, type KeyTrie, isTrie, keyName } from "./keymap.ts";
import { type Ctx, type Host, type Info, commands, pasteText } from "./commands.ts";
import { commandDocs, minorModeNames } from "./docs.ts";

export interface Keymaps {
  normal: KeyTrie;
  insert: KeyTrie;
}

interface CharReader {
  cb: (ch: string) => void;
  onCancel?: () => void;
}

/** What a binding does, as the which-key popup says it. */
export function describe(binding: Binding): string {
  if (isTrie(binding)) return "…";
  const names = Array.isArray(binding) ? binding : [binding];
  return names.map((n) => (n.startsWith(":") ? n : (commandDocs[n] ?? n))).join(", ");
}

/** The which-key popup for a minor mode: keys bound to the same thing share a row. */
function trieInfo(path: string[], trie: KeyTrie): Info {
  const rows = new Map<string, string[]>();
  for (const [key, binding] of Object.entries(trie)) {
    const desc = isTrie(binding) ? (minorModeNames[[...path, key].join("")] ?? "…") : describe(binding);
    rows.set(desc, [...(rows.get(desc) ?? []), key]);
  }
  return {
    title: minorModeNames[path.join("")] ?? path.join(""),
    rows: [...rows].map(([desc, keys]) => [keys.join(", "), desc]),
  };
}

/** Each editor's key handler, for keys pressed by other means than the keyboard (the command palette). */
const handlers = new WeakMap<EditorView, (key: string) => void>();

/** Presses `keys` (Helix notation) in `view`'s normal mode, as if typed. */
export function pressKeys(view: EditorView, keys: string[]) {
  const handler = handlers.get(view);
  for (const key of keys) handler?.(key);
}

/** The character a key types, for keys that type one. */
function charOf(key: string): string | null {
  if (key === "space") return " ";
  if (key === "ret") return "\n";
  if (key === "tab") return "\t";
  return [...key].length === 1 ? key : null;
}

export function helixKeys(
  host: Host,
  keys: Keymaps,
  onPending: (keys: string) => void,
  onInfo: (info: Info | null) => void,
): Extension {
  let pending: KeyTrie | null = null;
  let pendingKeys: string[] = [];
  let count = 0;
  let reader: CharReader | null = null;

  const reset = () => {
    pending = null;
    pendingKeys = [];
    count = 0;
    onPending("");
    onInfo(null);
  };

  async function run(binding: Binding, view: EditorView, n: number) {
    const ctx: Ctx = {
      view,
      host,
      count: Math.max(1, n),
      hasCount: n > 0,
      readChar(label, cb, onCancel, info) {
        reader = { cb, onCancel };
        onPending(label);
        onInfo(info ?? null);
      },
    };
    const names = Array.isArray(binding) ? binding : [binding as string];
    for (const name of names) {
      try {
        if (name.startsWith(":")) await host.runTypable(name.slice(1));
        else if (commands[name]) await commands[name](ctx);
        else host.message(`no such command: ${name}`, "error");
      } catch (err) {
        host.message(String(err), "error");
      }
    }
  }

  function readChar(key: string): void {
    const r = reader!;
    reader = null;
    onPending("");
    onInfo(null);
    const ch = charOf(key);
    if (key === "esc" || ch === null) r.onCancel?.();
    else r.cb(ch);
  }

  function normal(view: EditorView, key: string): void {
    if (!pending && /^[0-9]$/.test(key) && (key !== "0" || count > 0)) {
      count = count * 10 + Number(key);
      onPending(String(count));
      return;
    }
    const binding = (pending ?? keys.normal)[key];
    if (binding === undefined) {
      // A key that does nothing on its own: likely text typed in normal mode.
      const typed = !pending && charOf(key) !== null;
      reset();
      if (typed) host.unboundKey(key);
      return;
    }
    if (isTrie(binding)) {
      pending = binding;
      pendingKeys.push(key);
      onPending(`${count || ""}${pendingKeys.join("")}`);
      onInfo(trieInfo(pendingKeys, binding));
      return;
    }
    const n = count;
    reset();
    void run(binding, view, n);
  }

  // Returns whether the key was consumed; unconsumed keys type normally.
  function insert(view: EditorView, key: string): boolean {
    const binding = (pending ?? keys.insert)[key];
    if (binding === undefined) {
      if (!pending) return false;
      // The sequence broke off (`j` then not `k`): type what was held back,
      // then handle this key from the top.
      const held = pendingKeys.map(charOf).join("");
      reset();
      if (held) view.dispatch(view.state.replaceSelection(held), { userEvent: "input.type" });
      return insert(view, key);
    }
    if (isTrie(binding)) {
      pending = binding;
      pendingKeys.push(key);
      onPending(pendingKeys.join(""));
      return true;
    }
    reset();
    void run(binding, view, 0);
    return true;
  }

  return Prec.highest([
    ViewPlugin.define((view) => {
      const handler = (key: string) => (reader ? readChar(key) : normal(view, key));
      handlers.set(view, handler);
      return {
        destroy() {
          if (handlers.get(view) === handler) handlers.delete(view);
        },
      };
    }),
    EditorView.domEventHandlers({
      keydown(e, view) {
        if (e.isComposing || e.keyCode === 229) return false;
        // Cmd shortcuts belong to the app and the system (copy, quit, ...).
        if (e.metaKey) return false;
        const key = keyName(e);
        if (!key) return false;
        const mode = view.state.field(modeField);
        let handled = true;
        if (reader) readChar(key);
        else if (mode === "insert") handled = insert(view, key);
        else normal(view, key);
        if (handled) e.preventDefault();
        return handled;
      },
      // Outside insert mode, Cmd-V pastes after the selection instead of typing over it.
      paste(e, view) {
        if (view.state.field(modeField) === "insert") return false;
        const text = e.clipboardData?.getData("text/plain");
        e.preventDefault();
        if (text) pasteText(view, text);
        return true;
      },
    }),
  ]);
}
