// Helix's picker: a fuzzy-filtered list with a preview beside it. Enter opens
// the selected item, C-s in a horizontal split, C-v in a vertical one.

import { fuzzyMatch } from "./fuzzy.ts";

export type OpenHow = "replace" | "hsplit" | "vsplit";

export interface Preview {
  text: string;
  /** One-based line to highlight and scroll to. */
  line?: number;
  /** A class for each line, by index (a diff's added and removed lines). */
  classes?: string[];
}

export interface PickerOptions<T> {
  /** Shown in the input row, before the counts. */
  title: string;
  items: T[] | Promise<T[]>;
  /** What the pattern matches against, and what the list shows. */
  text(item: T): string;
  /** Unmatched columns shown before the text (buffer ids, flags). */
  prefix?(item: T): string;
  preview?(item: T): Preview | null | Promise<Preview | null>;
  /**
   * Items that form a tree, listed depth-first: rows are indented by depth and
   * stay in order when filtered, under the items they belong to, and each
   * space-separated pattern may match an item or the items it is under.
   */
  tree?: { depth(item: T): number; parent(item: T): T | null };
  /** A class for an item's row. */
  rowClass?(item: T): string;
  onSelect(item: T, how: OpenHow): void;
}

const PREVIEW_LINES = 1000;

interface Row<T> {
  item: T;
  text: string;
  indices: number[];
  /** In a tree, shown only because a match is under it. */
  context?: boolean;
}

export function openPicker<T>(opts: PickerOptions<T>, refocus: () => void) {
  const root = document.createElement("div");
  root.id = "picker";
  root.innerHTML = `
    <div class="pk-main">
      <div class="pk-input-row">
        <span class="pk-title"></span>
        <input class="pk-input" spellcheck="false" autocomplete="off" />
        <span class="pk-count"></span>
      </div>
      <div class="pk-list"></div>
    </div>
    <div class="pk-preview"></div>`;
  document.body.appendChild(root);
  const q = <E extends HTMLElement>(sel: string) => root.querySelector(sel) as E;
  const input = q<HTMLInputElement>(".pk-input");
  const list = q<HTMLElement>(".pk-list");
  const count = q<HTMLElement>(".pk-count");
  const previewBox = q<HTMLElement>(".pk-preview");
  q<HTMLElement>(".pk-title").textContent = opts.title;

  let all: Row<T>[] = [];
  let rows: Row<T>[] = [];
  let selected = 0;
  let top = 0;
  let loading = true;
  let previewGen = 0;
  const previewCache = new Map<T, Preview | null>();

  const rowHeight = () => (list.firstElementChild as HTMLElement | null)?.offsetHeight || 22;
  const pageSize = () => Math.max(1, Math.floor(list.clientHeight / rowHeight()));

  function filter() {
    const pattern = input.value;
    if (!pattern.trim()) rows = all;
    else if (opts.tree) return filterTree(opts.tree, pattern);
    else {
      const scored: [Row<T>, number][] = [];
      for (const row of all) {
        const m = fuzzyMatch(pattern, row.text);
        if (m) scored.push([{ ...row, indices: m.indices }, m.score]);
      }
      // Higher score first, then shorter text.
      scored.sort((a, b) => b[1] - a[1] || a[0].text.length - b[0].text.length);
      rows = scored.map(([row]) => row);
    }
    selected = 0;
    top = 0;
    render();
  }

  function filterTree(tree: NonNullable<PickerOptions<T>["tree"]>, pattern: string) {
    const terms = pattern.split(/\s+/).filter(Boolean);
    const texts = new Map(all.map((r) => [r.item, r.text]));
    const ancestors = (item: T) => {
      const out: T[] = [];
      for (let p = tree.parent(item); p; p = tree.parent(p)) out.push(p);
      return out;
    };
    const hits = new Map<T, { score: number; indices: number[] }>();
    const shown = new Set<T>();
    for (const row of all) {
      // Every term matches the item or one it is under, and at least one the item itself.
      let score = 0;
      let own = false;
      const indices = new Set<number>();
      const ok = terms.every((term) => {
        const m = fuzzyMatch(term, row.text);
        if (m) {
          own = true;
          score += m.score;
          m.indices.forEach((i) => indices.add(i));
          return true;
        }
        return ancestors(row.item).some((a) => fuzzyMatch(term, texts.get(a) ?? ""));
      });
      if (!ok || !own) continue;
      hits.set(row.item, { score, indices: [...indices].sort((a, b) => a - b) });
      shown.add(row.item);
      ancestors(row.item).forEach((a) => shown.add(a));
    }
    rows = all
      .filter((r) => shown.has(r.item))
      .map((r) => {
        const hit = hits.get(r.item);
        return hit ? { ...r, indices: hit.indices } : { ...r, context: true };
      });
    // Start on the best match.
    let best = -1;
    rows.forEach((r, i) => {
      const score = hits.get(r.item)?.score;
      if (score !== undefined && (best < 0 || score > hits.get(rows[best].item)!.score)) best = i;
    });
    selected = Math.max(0, best);
    top = 0;
    render();
  }

  function render() {
    count.textContent = loading ? "…" : `${rows.length}/${all.length}`;
    const page = pageSize();
    if (selected < top) top = selected;
    if (selected >= top + page) top = selected - page + 1;
    const children = rows.slice(top, top + page).map((row, i) => {
      const el = document.createElement("div");
      el.className = ["pk-row", top + i === selected && "selected", row.context && "pk-context", opts.rowClass?.(row.item)]
        .filter(Boolean)
        .join(" ");
      if (opts.tree) el.style.paddingLeft = `calc(0.8rem + ${opts.tree.depth(row.item) * 2}ch)`;
      const prefix = opts.prefix?.(row.item);
      if (prefix) {
        const p = document.createElement("span");
        p.className = "pk-prefix";
        p.textContent = prefix;
        el.appendChild(p);
      }
      el.appendChild(highlighted(row.text, row.indices));
      el.onmousedown = (e) => {
        e.preventDefault();
        selected = top + i;
        render();
      };
      el.ondblclick = () => choose("replace");
      return el;
    });
    list.replaceChildren(...children);
    void showPreview();
  }

  async function showPreview() {
    const row = rows[selected];
    const gen = ++previewGen;
    if (!row || !opts.preview) return previewBox.replaceChildren();
    let preview = previewCache.get(row.item);
    if (preview === undefined) {
      preview = await opts.preview(row.item);
      previewCache.set(row.item, preview);
    }
    if (gen !== previewGen) return;
    if (!preview) return previewBox.replaceChildren();
    const lines = preview.text.split("\n");
    const focus = preview.line ?? 1;
    // Long files: show a window around the line of interest.
    const first = Math.max(0, Math.min(focus - 1 - PREVIEW_LINES / 2, lines.length - PREVIEW_LINES));
    const els = lines.slice(first, first + PREVIEW_LINES).map((text, i) => {
      const el = document.createElement("div");
      el.className = ["pk-line", preview.classes?.[first + i], preview.line === first + i + 1 && "current"].filter(Boolean).join(" ");
      el.textContent = text || " ";
      return el;
    });
    previewBox.replaceChildren(...els);
    previewBox.scrollTop = 0;
    previewBox.querySelector(".current")?.scrollIntoView({ block: "center" });
  }

  function move(delta: number) {
    if (!rows.length) return;
    selected = Math.max(0, Math.min(rows.length - 1, selected + delta));
    render();
  }

  function close() {
    input.onblur = null;
    root.remove();
    window.removeEventListener("resize", render);
    refocus();
  }

  function choose(how: OpenHow) {
    const row = rows[selected];
    close();
    if (row) opts.onSelect(row.item, how);
  }

  input.oninput = filter;
  input.onblur = close;
  root.onmousedown = (e) => {
    if (e.target !== input) e.preventDefault();
  };
  window.addEventListener("resize", render);
  input.onkeydown = (e) => {
    const key = (e.ctrlKey ? "C-" : "") + (e.shiftKey && e.key === "Tab" ? "S-Tab" : e.key);
    switch (key) {
      case "Escape":
      case "C-c":
        close();
        break;
      case "Enter":
        choose("replace");
        break;
      case "C-s":
        choose("hsplit");
        break;
      case "C-v":
        choose("vsplit");
        break;
      case "ArrowDown":
      case "C-n":
      case "Tab":
        move(1);
        break;
      case "ArrowUp":
      case "C-p":
      case "S-Tab":
        move(-1);
        break;
      case "PageDown":
      case "C-d":
        move(pageSize());
        break;
      case "PageUp":
      case "C-u":
        move(-pageSize());
        break;
      default:
        return;
    }
    e.preventDefault();
  };

  input.focus();
  render();
  void Promise.resolve(opts.items).then(
    (items) => {
      loading = false;
      all = items.map((item) => ({ item, text: opts.text(item), indices: [] }));
      filter();
    },
    (err) => {
      loading = false;
      count.textContent = String(err);
    },
  );
}

function highlighted(text: string, indices: number[]): HTMLElement {
  const span = document.createElement("span");
  span.className = "pk-text";
  let last = 0;
  for (const i of indices) {
    if (i > last) span.append(text.slice(last, i));
    const m = document.createElement("span");
    m.className = "pk-hl";
    m.textContent = text[i];
    span.append(m);
    last = i + 1;
  }
  span.append(text.slice(last));
  return span;
}
