// The command line at the bottom: `:`, `/`, `s`, ... with a completion menu
// above it (Tab / Shift-Tab to cycle, like Helix) and per-prompt history
// (Up / Down).

export interface Completion {
  /** Replaces the input from `from` to the end. */
  insert: string;
  from: number;
  /** Shown in the menu. */
  label: string;
  /** Shown in the doc box while this item is selected. */
  doc?: string;
}

export interface PromptOptions {
  label: string;
  initial?: string;
  onSubmit(value: string): void;
  onCancel?(): void;
  onChange?(value: string): void;
  complete?(value: string): Completion[] | Promise<Completion[]>;
  /** Doc for the current input when no menu item is selected. */
  docFor?(value: string): string | undefined;
}

const histories = new Map<string, string[]>();
const $ = (id: string) => document.getElementById(id)!;

export function openPrompt(opts: PromptOptions, refocus: () => void) {
  const box = $("prompt");
  const input = $("prompt-input") as HTMLInputElement;
  const menu = $("completion");
  const docBox = $("completion-doc");
  const history = histories.get(opts.label) ?? [];
  histories.set(opts.label, history);
  let historyIndex = history.length;
  let items: Completion[] = [];
  let selected = -1;
  // Tab cycles through the items computed for the input as it was typed.
  let completionBase: string | null = null;
  let generation = 0;

  $("prompt-label").textContent = opts.label;
  input.value = opts.initial ?? "";
  box.hidden = false;
  input.focus();

  const renderMenu = () => {
    menu.replaceChildren(
      ...items.map((item, i) => {
        const row = document.createElement("div");
        row.className = i === selected ? "item selected" : "item";
        row.textContent = item.label;
        return row;
      }),
    );
    menu.hidden = items.length === 0;
    const doc = selected >= 0 ? items[selected].doc : opts.docFor?.(input.value);
    docBox.textContent = doc ?? "";
    docBox.hidden = !doc;
    menu.querySelector(".selected")?.scrollIntoView({ block: "nearest" });
  };

  const refresh = async () => {
    const gen = ++generation;
    const result = opts.complete ? await opts.complete(input.value) : [];
    if (gen !== generation) return; // A newer keystroke won.
    items = result;
    selected = -1;
    renderMenu();
  };

  const finish = (submit: boolean) => {
    box.hidden = true;
    menu.hidden = true;
    docBox.hidden = true;
    input.oninput = null;
    input.onkeydown = null;
    input.onblur = null;
    refocus();
    if (submit) {
      if (input.value && history[history.length - 1] !== input.value) history.push(input.value);
      opts.onSubmit(input.value);
    } else opts.onCancel?.();
  };

  input.oninput = () => {
    completionBase = null;
    opts.onChange?.(input.value);
    void refresh();
  };
  input.onblur = () => finish(false);
  input.onkeydown = (e) => {
    if (e.key === "Enter") finish(true);
    else if (e.key === "Escape" || (e.key === "c" && e.ctrlKey)) finish(false);
    else if (e.key === "Tab") {
      if (!items.length) return e.preventDefault();
      if (completionBase === null) completionBase = input.value;
      selected = (selected + (e.shiftKey ? -1 : 1) + items.length) % items.length;
      const item = items[selected];
      input.value = completionBase.slice(0, item.from) + item.insert;
      opts.onChange?.(input.value);
      renderMenu();
    } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      historyIndex = Math.max(0, Math.min(history.length, historyIndex + (e.key === "ArrowUp" ? -1 : 1)));
      input.value = history[historyIndex] ?? "";
      opts.onChange?.(input.value);
      void refresh();
    } else return;
    e.preventDefault();
  };

  opts.onChange?.(input.value);
  void refresh();
}
