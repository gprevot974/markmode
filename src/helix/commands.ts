// Helix commands, named as in Helix so the keymap reads like config.toml.
// Each command gets a context with the view and the typed count.

import {
  EditorSelection,
  type EditorState,
  type SelectionRange,
  type ChangeSpec,
  type Text,
  Transaction,
  type StateEffect,
} from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";
import type { SyntaxNode } from "@lezer/common";
import { isolateHistory, undo as cmUndo, redo as cmRedo } from "@codemirror/commands";
import { type Mode, modeField, setMode } from "./state.ts";
import {
  type Range,
  range,
  cursor,
  point,
  putCursor,
  rangeFrom,
  rangeTo,
  nextBoundary,
  prevBoundary,
  lineRange,
} from "./range.ts";
import {
  type WordTarget,
  type FindKind,
  wordMove,
  extendWord,
  findChar,
  extendLine,
  extendToLineBounds,
  firstNonWhitespace,
  lastCharOfLine,
} from "./motions.ts";
import { wordObject, paragraphObject, pairObject, pairFor, findEnclosingPair, matchBracket } from "./textobjects.ts";
import { startJump } from "./jumplabels.ts";
import { textObjectInfo } from "./docs.ts";
import { spellCommands } from "../spell.ts";
import { reviewCommands } from "../review.ts";
import { commentCommands } from "../comments.ts";
import type { PromptOptions } from "../ui/prompt.ts";

export const windowCommands = [
  "rotate_view",
  "hsplit",
  "vsplit",
  "hsplit_new",
  "vsplit_new",
  "transpose_view",
  "wclose",
  "wonly",
  "jump_view_left",
  "jump_view_down",
  "jump_view_up",
  "jump_view_right",
  "swap_view_left",
  "swap_view_down",
  "swap_view_up",
  "swap_view_right",
] as const;
export type WindowCommand = (typeof windowCommands)[number];

/** What commands need from the surrounding app. */
export interface Host {
  message(text: string, kind?: "info" | "error"): void;
  prompt(label: string, opts: Omit<PromptOptions, "label">): void;
  runTypable(cmdline: string): Promise<void>;
  commandLine(): void;
  /** `space ?`: every command and key binding, searchable, to run one. */
  commandPalette(): void;
  /** A key bound to nothing was pressed in normal mode: text typed in the wrong mode, likely. */
  unboundKey(key: string): void;
  clipboardRead(): Promise<string>;
  clipboardWrite(text: string): Promise<void>;
  filePicker(inCurrentDir: boolean): void;
  bufferPicker(): void;
  historyPicker(): void;
  /** `space d`: the changes under review, to jump to one or decide on it. */
  changesPicker(): void;
  /** `space s`: the headings of the document; `space S`: of the markdown files around it. */
  headingPicker(workspace: boolean): void;
  /** `gf`: opens what the link under the cursor points to. */
  followLink(view: EditorView): void;
  /** `space /`: a regex search of the files under the workspace root. */
  globalSearch(): void;
  /** Keeps `before`, the selection a jump in `view` left, in its jumplist. */
  pushJump(view: EditorView, before: EditorSelection): void;
  jumpBackward(count: number): void;
  jumpForward(count: number): void;
  saveSelection(): void;
  jumplistPicker(): void;
  /** `C-x` in insert mode: the keys and values that fit at the cursor, where there are any. */
  complete(view: EditorView): void;
  gotoBuffer(which: "next" | "previous" | "last"): void;
  windowCommand(cmd: WindowCommand): void;
}

/** A which-key popup: a title and (keys, description) rows. */
export interface Info {
  title: string;
  rows: [string, string][];
}

export interface Ctx {
  view: EditorView;
  host: Host;
  count: number;
  hasCount: boolean;
  /** Waits for the next key as a character (for `f`, `r`, `mi`, ...). */
  readChar(label: string, cb: (ch: string) => void, onCancel?: () => void, info?: Info): void;
}

export type Command = (ctx: Ctx) => void | Promise<void>;

// ── Helpers ──────────────────────────────────────────────────────────────────

const textCache = new WeakMap<Text, string>();
function textOf(doc: Text): string {
  let s = textCache.get(doc);
  if (s === undefined) textCache.set(doc, (s = doc.toString()));
  return s;
}

const modeOf = (view: EditorView): Mode => view.state.field(modeField);
const extending = (view: EditorView) => modeOf(view) === "select";
const toRange = (r: SelectionRange): Range => range(r.anchor, r.head);
const toSel = (r: Range, goal?: number) => EditorSelection.range(r.anchor, r.head, goal);

function setSelection(
  view: EditorView,
  ranges: SelectionRange[],
  mainIndex = view.state.selection.mainIndex,
  effects: StateEffect<unknown>[] = [],
) {
  view.dispatch({
    selection: EditorSelection.create(ranges, Math.min(mainIndex, ranges.length - 1)),
    effects,
    scrollIntoView: true,
    userEvent: "select",
  });
}

/** Applies a pure motion to every selection. */
function transform(view: EditorView, fn: (r: Range, text: string, doc: Text) => Range) {
  const { doc, selection } = view.state;
  const text = textOf(doc);
  setSelection(
    view,
    selection.ranges.map((r) => toSel(fn(toRange(r), text, doc))),
  );
}

/** Applies an edit to every selection; each returns its new range in post-edit coordinates. */
function edit(
  view: EditorView,
  fn: (r: SelectionRange, text: string, doc: Text) => { changes: ChangeSpec; range: SelectionRange },
  opts: { mode?: Mode; isolate?: "full" | "before" | "none"; userEvent?: string } = {},
) {
  const { state } = view;
  const text = textOf(state.doc);
  const spec = state.changeByRange((r) => fn(r, text, state.doc));
  const isolate = opts.isolate ?? "full";
  view.dispatch(
    state.update(spec, {
      effects: opts.mode ? setMode.of(opts.mode) : [],
      annotations: [
        ...(isolate === "none" ? [] : [isolateHistory.of(isolate)]),
        Transaction.userEvent.of(opts.userEvent ?? "input"),
      ],
      scrollIntoView: true,
    }),
  );
}

/** Plain changes (selections are mapped through them by CodeMirror). */
function applyChanges(view: EditorView, changes: ChangeSpec[], userEvent = "input") {
  view.dispatch({
    changes,
    annotations: isolateHistory.of("full"),
    userEvent,
    scrollIntoView: true,
  });
}

function selectedTexts(view: EditorView): string[] {
  return view.state.selection.ranges.map((r) => view.state.sliceDoc(r.from, r.to));
}

/** Sorted, deduplicated zero-based line numbers touched by any selection. */
function selectedLines(view: EditorView): number[] {
  const lines = new Set<number>();
  for (const r of view.state.selection.ranges) {
    const [a, b] = lineRange(view.state.doc, toRange(r));
    for (let l = a; l <= b; l++) lines.add(l);
  }
  return [...lines].sort((x, y) => x - y);
}

// ── Registers ────────────────────────────────────────────────────────────────

const registers = new Map<string, string[]>();

/** Makes `pattern` the one `n` and `N` search for, as `/` does. */
export function setSearchPattern(pattern: string) {
  registers.set("/", [pattern]);
}
let lastMotion: Command | null = null;

function remember(motion: Command): Command {
  return (ctx) => {
    lastMotion = motion;
    return motion(ctx);
  };
}

// ── Movement ─────────────────────────────────────────────────────────────────

function moveChar(dir: -1 | 1): Command {
  return ({ view, count }) => {
    const ext = extending(view);
    transform(view, (r, text) => {
      let pos = cursor(text, r);
      for (let i = 0; i < count; i++) pos = dir < 0 ? prevBoundary(text, pos) : nextBoundary(text, pos);
      return putCursor(text, r, pos, ext);
    });
  };
}

function moveVisualLine(forward: boolean): Command {
  return ({ view, count }) => {
    const ext = extending(view);
    const text = textOf(view.state.doc);
    const ranges = view.state.selection.ranges.map((sr) => {
      const r = toRange(sr);
      let c = EditorSelection.cursor(cursor(text, r), 0, undefined, sr.goalColumn);
      for (let i = 0; i < count; i++) c = view.moveVertically(c, forward);
      return toSel(putCursor(text, r, ontoTableRow(view.state, cursor(text, r), c.head), ext), c.goalColumn);
    });
    setSelection(view, ranges);
  };
}

/**
 * A move onto another line of a table lands somewhere in the rendered row
 * that stood for it, often the end; the start of the line is where to be.
 */
function ontoTableRow(state: EditorState, from: number, to: number): number {
  const line = state.doc.lineAt(to);
  if (state.doc.lineAt(from).number === line.number) return to;
  for (let node: SyntaxNode | null = syntaxTree(state).resolveInner(line.from, 1); node; node = node.parent) {
    if (node.name === "Table") return line.from;
  }
  return to;
}

function moveWord(target: WordTarget): Command {
  return ({ view, count }) => {
    const ext = extending(view);
    transform(view, (r, text) => (ext ? extendWord(text, r, count, target) : wordMove(text, r, count, target)));
  };
}

function findCharCmd(kind: FindKind): Command {
  return (ctx) =>
    ctx.readChar(kind, (ch) => {
      const motion: Command = ({ view, count }) => {
        const ext = extending(view);
        transform(view, (r, text) => findChar(text, r, kind, ch, count, ext));
      };
      lastMotion = motion;
      motion(ctx);
    });
}

function gotoPos(view: EditorView, pos: (r: Range, text: string, doc: Text) => number) {
  const ext = extending(view);
  transform(view, (r, text, doc) => putCursor(text, r, pos(r, text, doc), ext));
}

// Screen rows. With soft wrap a paragraph is one line over several rows, so
// `gh`, `gl` and `gs` go to the start and end of the row the cursor is on, as
// it shows. Edits keep to the file's lines: rows change with the window width.

/** Where the row holding the character at `pos` starts and ends (the end is before its line break or wrap). */
function rowAt(view: EditorView, pos: number): { from: number; to: number } {
  const at = EditorSelection.cursor(pos, 1);
  return {
    from: view.moveToLineBoundary(at, false, true).head,
    to: view.moveToLineBoundary(at, true, true).head,
  };
}

function rowStart(view: EditorView, pos: number): number {
  return rowAt(view, pos).from;
}

/** The last character of the row; on a wrapped row, the last one before the spaces it wraps at. */
function rowEnd(view: EditorView, text: string, doc: Text, pos: number): number {
  const row = rowAt(view, pos);
  if (row.to >= doc.lineAt(pos).to) return Math.max(row.from, lastCharOfLine(text, doc, pos));
  let end = row.to;
  while (end > row.from + 1 && /\s/.test(text[end - 1])) end--;
  return end > row.from ? prevBoundary(text, end) : row.from;
}

function rowFirstNonWhitespace(view: EditorView, text: string, doc: Text, pos: number): number {
  const row = rowAt(view, pos);
  if (row.from === doc.lineAt(pos).from) return firstNonWhitespace(doc, pos);
  let at = row.from;
  while (at < row.to && /\s/.test(text[at])) at++;
  return at;
}

const lineStart = (doc: Text, line: number) => doc.line(Math.max(1, Math.min(doc.lines, line))).from;

/**
 * After jumping to the start of a line: scrolls so the whole line shows when
 * it fits, not just its first row. With soft wrap a paragraph is one line, so
 * `ge` would otherwise leave the end of the document below the window.
 */
function showWholeLine(view: EditorView) {
  const line = view.state.doc.lineAt(view.state.selection.main.head);
  view.dispatch({ effects: EditorView.scrollIntoView(EditorSelection.range(line.to, line.from), { y: "nearest" }) });
}

function pageMove(fraction: number): Command {
  return ({ view, count }) => {
    const ext = extending(view);
    const text = textOf(view.state.doc);
    const distance = view.scrollDOM.clientHeight * Math.abs(fraction) * count;
    const ranges = view.state.selection.ranges.map((sr) => {
      const r = toRange(sr);
      const c = view.moveVertically(EditorSelection.cursor(cursor(text, r)), fraction > 0, distance);
      return toSel(putCursor(text, r, c.head, ext));
    });
    view.dispatch({
      selection: EditorSelection.create(ranges, view.state.selection.mainIndex),
      effects: EditorView.scrollIntoView(ranges[view.state.selection.mainIndex].head, { y: "center" }),
    });
  };
}

function windowPos(where: "top" | "center" | "bottom"): Command {
  return ({ view }) => {
    const box = view.scrollDOM.getBoundingClientRect();
    const x = view.contentDOM.getBoundingClientRect().left + 2;
    const y = where === "top" ? box.top + 8 : where === "bottom" ? box.bottom - 8 : (box.top + box.bottom) / 2;
    const pos = view.posAtCoords({ x, y }, false);
    gotoPos(view, (_r, _t, doc) => doc.lineAt(pos).from);
  };
}

function alignView(y: "center" | "start" | "end"): Command {
  return ({ view }) => {
    const text = textOf(view.state.doc);
    const pos = cursor(text, toRange(view.state.selection.main));
    view.dispatch({ effects: EditorView.scrollIntoView(pos, { y, yMargin: 40 }) });
  };
}

function scrollLines(dir: 1 | -1): Command {
  return ({ view, count }) => {
    view.scrollDOM.scrollTop += dir * view.defaultLineHeight * count;
  };
}

// ── Selection manipulation ───────────────────────────────────────────────────

function textObject(around: boolean): Command {
  return (ctx) =>
    ctx.readChar(
      around ? "ma" : "mi",
      (ch) => {
        transform(ctx.view, (r, text, doc) => {
          if (ch === "w") return wordObject(text, r, around, false);
          if (ch === "W") return wordObject(text, r, around, true);
          if (ch === "p") return paragraphObject(doc, r, around);
          return pairObject(text, r, ch, around);
        });
      },
      undefined,
      { title: around ? "Match around" : "Match inside", rows: textObjectInfo },
    );
}

function regexFrom(pattern: string): RegExp | null {
  // Smart case, like Helix's default: case-insensitive unless the pattern has a capital.
  const flags = /[A-Z]/.test(pattern) ? "gu" : "giu";
  try {
    return new RegExp(pattern, flags);
  } catch {
    return null;
  }
}

function regexMatches(view: EditorView, base: EditorSelection, pattern: string, split: boolean): SelectionRange[] | null {
  const re = regexFrom(pattern);
  if (!re) return null;
  const out: SelectionRange[] = [];
  for (const r of base.ranges) {
    const slice = view.state.sliceDoc(r.from, r.to);
    let last = 0;
    for (const m of slice.matchAll(re)) {
      if (split) {
        if (m.index > last) out.push(EditorSelection.range(r.from + last, r.from + m.index));
      } else if (m[0].length) {
        out.push(EditorSelection.range(r.from + m.index, r.from + m.index + m[0].length));
      }
      last = m.index + m[0].length;
    }
    if (split && last < slice.length) out.push(EditorSelection.range(r.from + last, r.to));
  }
  return out;
}

// `s` and `S`, previewing the resulting selections while the regex is typed.
function selectRegex(split: boolean): Command {
  return ({ view, host }) => {
    const original = view.state.selection;
    const show = (sel: EditorSelection) => view.dispatch({ selection: sel, userEvent: "select" });
    host.prompt(split ? "split:" : "select:", {
      onChange(pattern) {
        const out = pattern ? regexMatches(view, original, pattern, split) : null;
        show(out?.length ? EditorSelection.create(out, out.length - 1) : original);
      },
      onSubmit(pattern) {
        const out = regexMatches(view, original, pattern, split);
        if (!out) return show(original), host.message(`invalid regex: ${pattern}`, "error");
        if (!out.length) return show(original), host.message("nothing selected", "error");
        setSelection(view, out, out.length - 1);
      },
      onCancel: () => show(original),
    });
  };
}

const splitOnNewline: Command = ({ view }) => {
  const doc = view.state.doc;
  const out: SelectionRange[] = [];
  for (const r of view.state.selection.ranges) {
    for (let pos = r.from; pos < r.to; ) {
      const line = doc.lineAt(pos);
      const end = Math.min(line.to, r.to);
      if (end > pos) out.push(EditorSelection.range(pos, end));
      pos = line.to + 1;
    }
  }
  if (out.length) setSelection(view, out, out.length - 1);
};

function copySelectionOnLine(dir: 1 | -1): Command {
  return ({ view, count }) => {
    const { doc, selection } = view.state;
    const ranges = [...selection.ranges];
    let main = selection.mainIndex;
    for (const r of selection.ranges) {
      const a = doc.lineAt(r.anchor);
      const h = doc.lineAt(r.head);
      let added = 0;
      for (let offset = dir; Math.abs(offset) <= 100 && added < count; offset += dir) {
        const an = a.number + offset;
        const hn = h.number + offset;
        if (an < 1 || hn < 1 || an > doc.lines || hn > doc.lines) break;
        const la = doc.line(an);
        const lh = doc.line(hn);
        // Skip lines too short to hold the selection, like Helix.
        if (r.anchor - a.from > la.length || r.head - h.from > lh.length) continue;
        ranges.push(EditorSelection.range(la.from + (r.anchor - a.from), lh.from + (r.head - h.from)));
        if (r === selection.main) main = ranges.length - 1;
        added++;
      }
    }
    setSelection(view, ranges, main);
  };
}

function rotate(dir: 1 | -1): Command {
  return ({ view }) => {
    const { ranges, mainIndex } = view.state.selection;
    setSelection(view, [...ranges], (mainIndex + dir + ranges.length) % ranges.length);
  };
}

// ── Search ───────────────────────────────────────────────────────────────────

/** The next match after (or before) `from`, wrapping around the document. */
function findMatch(text: string, re: RegExp, from: SelectionRange, forward: boolean) {
  const matches = [...text.matchAll(re)].filter((m) => m[0].length);
  if (!matches.length) return null;
  let m = forward
    ? matches.find((m) => m.index >= from.to)
    : [...matches].reverse().find((m) => m.index + m[0].length <= from.from);
  const wrapped = !m;
  m ??= forward ? matches[0] : matches[matches.length - 1];
  return { range: EditorSelection.range(m.index, m.index + m[0].length), wrapped };
}

function searchFrom(view: EditorView, host: Host, forward: boolean, add: boolean) {
  const pattern = registers.get("/")?.[0];
  if (!pattern) return host.message("no search pattern", "error");
  const re = regexFrom(pattern);
  if (!re) return host.message(`invalid regex: ${pattern}`, "error");
  const found = findMatch(textOf(view.state.doc), re, view.state.selection.main, forward);
  if (!found) return host.message(`no matches for ${pattern}`, "error");
  if (found.wrapped) host.message("search wrapped around");
  if (add) {
    const ranges = [...view.state.selection.ranges, found.range];
    setSelection(view, ranges, ranges.length - 1);
  } else setSelection(view, [found.range], 0);
}

// `/` and `?`, jumping to the first match while the pattern is typed.
function search(forward: boolean): Command {
  return ({ view, host }) => {
    const original = view.state.selection;
    const restore = () => view.dispatch({ selection: original, scrollIntoView: true });
    host.prompt(forward ? "search:" : "rsearch:", {
      onChange(pattern) {
        const re = pattern ? regexFrom(pattern) : null;
        const found = re && findMatch(textOf(view.state.doc), re, original.main, forward);
        if (found) view.dispatch({ selection: EditorSelection.create([found.range]), scrollIntoView: true });
        else restore();
      },
      onSubmit(pattern) {
        if (!pattern) return restore();
        registers.set("/", [pattern]);
        view.dispatch({ selection: original });
        searchFrom(view, host, forward, false);
        if (!view.state.selection.eq(original)) host.pushJump(view, original);
      },
      onCancel: restore,
    });
  };
}

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// ── Editing ──────────────────────────────────────────────────────────────────

function yankTo(view: EditorView, host: Host, reg: string) {
  const values = selectedTexts(view);
  registers.set(reg, values);
  host.message(`yanked ${values.length} selection${values.length > 1 ? "s" : ""}`);
}

function deleteSelection(yank: boolean): Command {
  return ({ view }) => {
    if (yank) registers.set('"', selectedTexts(view));
    edit(view, (r) => ({ changes: { from: r.from, to: r.to }, range: EditorSelection.cursor(r.from) }), {
      mode: "normal",
      userEvent: "delete.selection",
    });
  };
}

function changeSelection(yank: boolean): Command {
  return ({ view }) => {
    if (yank) registers.set('"', selectedTexts(view));
    const doc = view.state.doc;
    edit(
      view,
      (r) => {
        // Changing whole lines keeps the line break, so you type the replacement line.
        const whole = r.to > r.from && doc.sliceString(r.to - 1, r.to) === "\n" && doc.lineAt(r.from).from === r.from;
        const to = whole ? r.to - 1 : r.to;
        return { changes: { from: r.from, to }, range: EditorSelection.cursor(r.from) };
      },
      { mode: "insert", isolate: "before", userEvent: "delete.selection" },
    );
  };
}

type PasteWhere = "before" | "after" | "replace";

function pasteValues(view: EditorView, values: string[], where: PasteWhere, count: number) {
  if (!values.length) return;
  const linewise = values.some((v) => v.endsWith("\n"));
  const doc = view.state.doc;
  let i = 0;
  edit(view, (r) => {
    const value = (values[i] ?? values[values.length - 1]).repeat(count);
    i++;
    if (where === "replace") {
      return {
        changes: { from: r.from, to: r.to, insert: value },
        range: EditorSelection.range(r.from, r.from + value.length),
      };
    }
    let pos: number;
    if (where === "before") pos = linewise ? doc.lineAt(r.from).from : r.from;
    else if (linewise) {
      const last = doc.lineAt(r.to > r.from ? r.to - 1 : r.to);
      pos = last.number < doc.lines ? doc.line(last.number + 1).from : doc.length;
    } else pos = r.to;
    // A line-wise paste after the last line needs a line break first.
    const insert = linewise && where === "after" && pos === doc.length && !textOf(doc).endsWith("\n") ? "\n" + value : value;
    const start = pos + (insert.length - value.length);
    return { changes: { from: pos, insert }, range: EditorSelection.range(start, start + value.length) };
  }, { userEvent: "input.paste" });
}

function paste(where: PasteWhere, reg = '"'): Command {
  return ({ view, count }) => pasteValues(view, registers.get(reg) ?? [], where, count);
}

function pasteClipboard(where: PasteWhere): Command {
  return async ({ view, host, count }) => {
    const text = await host.clipboardRead();
    pasteValues(view, [text], where, count);
  };
}

// Like Helix's `restore_cursor`: leaving insert mode entered with `a` puts the
// cursor back on the last character typed rather than the one after it.
let restoreCursor = false;

function enterInsert(
  view: EditorView,
  at: (r: SelectionRange, text: string, doc: Text) => number,
  restore = false,
) {
  restoreCursor = restore;
  const { doc } = view.state;
  const text = textOf(doc);
  const ranges = view.state.selection.ranges.map((r) => EditorSelection.cursor(at(r, text, doc)));
  view.dispatch({
    selection: EditorSelection.create(ranges, view.state.selection.mainIndex),
    effects: setMode.of("insert"),
    annotations: isolateHistory.of("before"),
    scrollIntoView: true,
  });
}

/** Indentation plus any list or quote marker to continue on a new line. */
export function continuationPrefix(lineText: string, below: boolean): string {
  const list = /^(\s*)(?:([-*+])|(\d+)([.)]))(\s+)(\[[ xX]\]\s+)?/.exec(lineText);
  if (list) {
    const marker = list[2] ?? `${below ? Number(list[3]) + 1 : Number(list[3])}${list[4]}`;
    return list[1] + marker + list[5] + (list[6] ? "[ ] " : "");
  }
  const quote = /^\s*(?:>\s?)+/.exec(lineText);
  if (quote) return quote[0];
  return /^\s*/.exec(lineText)![0];
}

/**
 * What `o` and `O` open next to, found from the markdown syntax: a paragraph or
 * heading gets a new paragraph after (or before) it, a list item a new item
 * after its continuation lines and sublists. Code, tables, quotes and blank
 * lines get a line, as in Helix.
 */
function openTarget(state: EditorState, pos: number): { kind: "block" | "item"; from: number; to: number } | null {
  const line = state.doc.lineAt(pos);
  if (!line.text.trim()) return null;
  let found: { kind: "block" | "item"; from: number; to: number } | null = null;
  for (let node: SyntaxNode | null = syntaxTree(state).resolveInner(firstNonWhitespace(state.doc, pos), 1); node; node = node.parent) {
    if (/^(?:FencedCode|CodeBlock|HTMLBlock|Table|Blockquote|CommentBlock)$/.test(node.name)) return null;
    if (node.name === "ListItem") {
      if (!found || found.kind === "block") found = { kind: "item", from: node.from, to: node.to };
    } else if (!found && /^(?:Paragraph|ATXHeading\d|SetextHeading\d)$/.test(node.name)) {
      found = { kind: "block", from: node.from, to: node.to };
    }
  }
  // The innermost list item, with any blank lines at its end left out.
  if (found?.kind === "item") {
    let last = state.doc.lineAt(found.to);
    while (last.from > found.from && !last.text.trim()) last = state.doc.line(last.number - 1);
    found.to = last.to;
  }
  return found;
}

function openLine(below: boolean): Command {
  return ({ view }) => {
    const { state } = view;
    const doc = state.doc;
    const blank = (n: number) => n < 1 || n > doc.lines || !doc.line(n).text.trim();
    edit(
      view,
      (r) => {
        const at = below ? (r.to > r.from ? r.to - 1 : r.to) : r.from;
        const target = openTarget(state, at);
        if (target?.kind === "block") {
          // A blank line on either side of the new paragraph.
          if (below) {
            const end = doc.lineAt(target.to);
            const after = blank(end.number + 1) ? "" : "\n";
            return {
              changes: { from: end.to, insert: "\n\n" + after },
              range: EditorSelection.cursor(end.to + 2),
            };
          }
          const start = doc.lineAt(target.from);
          const before = blank(start.number - 1) ? "" : "\n";
          return {
            changes: { from: start.from, insert: before + "\n\n" },
            range: EditorSelection.cursor(start.from + before.length),
          };
        }
        const line = target ? doc.lineAt(below ? target.to : target.from) : doc.lineAt(at);
        const prefix = continuationPrefix(target ? doc.lineAt(target.from).text : line.text, below);
        if (below) {
          return {
            changes: { from: line.to, insert: "\n" + prefix },
            range: EditorSelection.cursor(line.to + 1 + prefix.length),
          };
        }
        return {
          changes: { from: line.from, insert: prefix + "\n" },
          range: EditorSelection.cursor(line.from + prefix.length),
        };
      },
      { mode: "insert", isolate: "before" },
    );
  };
}

function addNewline(below: boolean): Command {
  return ({ view, count }) => {
    const doc = view.state.doc;
    const lines = selectedLines(view);
    const at = below ? doc.line(lines[lines.length - 1] + 1).to : doc.line(lines[0] + 1).from;
    applyChanges(view, [{ from: at, insert: "\n".repeat(count) }]);
  };
}

function mapSelectedText(fn: (s: string) => string): Command {
  return ({ view }) =>
    edit(view, (r) => {
      const out = fn(view.state.sliceDoc(r.from, r.to));
      return {
        changes: { from: r.from, to: r.to, insert: out },
        range: EditorSelection.range(r.anchor === r.from ? r.from : r.from + out.length, r.anchor === r.from ? r.from + out.length : r.from),
      };
    });
}

const switchCase = mapSelectedText((s) =>
  Array.from(s, (c) => (c === c.toUpperCase() ? c.toLowerCase() : c.toUpperCase())).join(""),
);

const replaceChar: Command = (ctx) =>
  ctx.readChar("r", (ch) => mapSelectedText((s) => s.replace(/[^\n]/gu, ch))(ctx));

const INDENT = "  ";

function indent(dir: 1 | -1): Command {
  return ({ view, count }) => {
    const doc = view.state.doc;
    const changes: ChangeSpec[] = [];
    for (const l of selectedLines(view)) {
      const line = doc.line(l + 1);
      if (dir > 0) {
        if (line.length) changes.push({ from: line.from, insert: INDENT.repeat(count) });
      } else {
        const lead = /^ */.exec(line.text)![0].length;
        const remove = line.text.startsWith("\t") ? 1 : Math.min(lead, INDENT.length * count);
        if (remove) changes.push({ from: line.from, to: line.from + remove });
      }
    }
    applyChanges(view, changes);
  };
}

const joinSelections: Command = ({ view }) => {
  const doc = view.state.doc;
  const changes: ChangeSpec[] = [];
  const seen = new Set<number>();
  for (const r of view.state.selection.ranges) {
    const [a, b] = lineRange(doc, toRange(r));
    const last = b > a ? b : a + 1;
    for (let l = a; l < last && l + 1 < doc.lines; l++) {
      if (seen.has(l)) continue;
      seen.add(l);
      const line = doc.line(l + 1);
      const next = doc.line(l + 2);
      const trailing = /\s*$/.exec(line.text)![0].length;
      const leading = /^\s*/.exec(next.text)![0].length;
      changes.push({ from: line.to - trailing, to: next.from + leading, insert: next.length > leading ? " " : "" });
    }
  }
  applyChanges(view, changes);
};

const trimSelections: Command = ({ view }) => {
  const ranges: SelectionRange[] = [];
  for (const r of view.state.selection.ranges) {
    const s = view.state.sliceDoc(r.from, r.to);
    const lead = /^\s*/.exec(s)![0].length;
    const trail = /\s*$/.exec(s)![0].length;
    if (lead === s.length) continue;
    const from = r.from + lead;
    const to = r.to - trail;
    ranges.push(r.anchor <= r.head ? EditorSelection.range(from, to) : EditorSelection.range(to, from));
  }
  if (ranges.length) setSelection(view, ranges, ranges.length - 1);
};

// ── Surround ─────────────────────────────────────────────────────────────────

const surroundAdd: Command = (ctx) =>
  ctx.readChar("ms", (ch) => {
    const [open, close] = pairFor(ch);
    edit(ctx.view, (r) => ({
      changes: [
        { from: r.from, insert: open },
        { from: r.to, insert: close },
      ],
      range: EditorSelection.range(r.from, r.to + open.length + close.length),
    }));
  });

const surroundDelete: Command = (ctx) =>
  ctx.readChar("md", (ch) => {
    const { view, host } = ctx;
    const text = textOf(view.state.doc);
    const changes: ChangeSpec[] = [];
    for (const r of view.state.selection.ranges) {
      const pair = findEnclosingPair(text, cursor(text, toRange(r)), ch);
      if (!pair) return host.message(`no surrounding ${ch}`, "error");
      changes.push({ from: pair[0], to: pair[0] + 1 }, { from: pair[1], to: pair[1] + 1 });
    }
    applyChanges(view, changes);
  });

const surroundReplace: Command = (ctx) =>
  ctx.readChar("mr", (from) =>
    ctx.readChar(`mr${from}`, (to) => {
      const { view, host } = ctx;
      const text = textOf(view.state.doc);
      const [open, close] = pairFor(to);
      const changes: ChangeSpec[] = [];
      for (const r of view.state.selection.ranges) {
        const pair = findEnclosingPair(text, cursor(text, toRange(r)), from);
        if (!pair) return host.message(`no surrounding ${from}`, "error");
        changes.push(
          { from: pair[0], to: pair[0] + 1, insert: open },
          { from: pair[1], to: pair[1] + 1, insert: close },
        );
      }
      applyChanges(view, changes);
    }),
  );

const matchBrackets: Command = ({ view }) => {
  const ext = extending(view);
  transform(view, (r, text) => {
    const target = matchBracket(text, cursor(text, r));
    return target === null ? r : putCursor(text, r, target, ext);
  });
};

// ── Insert mode ──────────────────────────────────────────────────────────────

const exitInsert: Command = ({ view }) => {
  const mode = modeOf(view);
  if (mode === "normal") return;
  const { doc } = view.state;
  const text = textOf(doc);
  const ranges = view.state.selection.ranges.map((r) => {
    if (mode !== "insert") return toSel(point(text, cursor(text, toRange(r))));
    const back = restoreCursor && r.head > doc.lineAt(r.head).from;
    return toSel(point(text, back ? prevBoundary(text, r.head) : r.head));
  });
  restoreCursor = false;
  view.dispatch({
    selection: EditorSelection.create(ranges, view.state.selection.mainIndex),
    effects: setMode.of("normal"),
    annotations: isolateHistory.of("after"),
  });
};

function deleteBackwardTo(target: (pos: number, text: string, doc: Text) => number): Command {
  return ({ view }) =>
    edit(
      view,
      (r, text, doc) => {
        const from = Math.min(target(r.head, text, doc), r.from);
        return { changes: { from, to: r.to }, range: EditorSelection.cursor(from) };
      },
      { isolate: "none", userEvent: "delete.backward" },
    );
}

const deleteWordBackward = deleteBackwardTo((pos, text) => {
  let p = pos;
  while (p > 0 && /[ \t]/.test(text[p - 1])) p--;
  const word = /[\p{L}\p{N}\p{M}_]/u;
  if (p > 0 && word.test(text[p - 1])) while (p > 0 && word.test(text[p - 1])) p--;
  else if (p > 0 && text[p - 1] !== "\n") p--;
  return p;
});

const killToLineStart = deleteBackwardTo((pos, _t, doc) => {
  const line = doc.lineAt(pos);
  return pos === line.from ? Math.max(0, pos - 1) : line.from;
});

/** A motion that jumps: the selection before it goes in the jumplist, as in Helix. */
function jumping(cmd: Command): Command {
  return (ctx) => {
    const before = ctx.view.state.selection;
    const done = cmd(ctx);
    if (!ctx.view.state.selection.eq(before)) ctx.host.pushJump(ctx.view, before);
    return done;
  };
}

// ── Registry ─────────────────────────────────────────────────────────────────

export const commands: Record<string, Command> = {
  // Modes
  normal_mode: exitInsert,
  select_mode: ({ view }) => {
    view.dispatch({ effects: setMode.of(extending(view) ? "normal" : "select") });
  },
  exit_select_mode: ({ view }) => {
    if (extending(view)) view.dispatch({ effects: setMode.of("normal") });
  },
  insert_mode: ({ view }) => enterInsert(view, (r) => r.from),
  append_mode: ({ view }) => enterInsert(view, (r) => r.to, true),
  insert_at_line_start: ({ view }) => enterInsert(view, (r, _t, doc) => firstNonWhitespace(doc, r.from)),
  insert_at_line_end: ({ view }) => enterInsert(view, (r, _t, doc) => doc.lineAt(r.to > r.from ? r.to - 1 : r.to).to),
  open_below: openLine(true),
  open_above: openLine(false),
  command_mode: ({ host }) => host.commandLine(),
  command_palette: ({ host }) => host.commandPalette(),

  // Motions
  move_char_left: remember(moveChar(-1)),
  move_char_right: remember(moveChar(1)),
  move_visual_line_down: moveVisualLine(true),
  move_visual_line_up: moveVisualLine(false),
  move_next_word_start: remember(moveWord("nextWordStart")),
  move_prev_word_start: remember(moveWord("prevWordStart")),
  move_next_word_end: remember(moveWord("nextWordEnd")),
  move_prev_word_end: remember(moveWord("prevWordEnd")),
  move_next_long_word_start: remember(moveWord("nextLongWordStart")),
  move_prev_long_word_start: remember(moveWord("prevLongWordStart")),
  move_next_long_word_end: remember(moveWord("nextLongWordEnd")),
  find_next_char: findCharCmd("f"),
  find_till_char: findCharCmd("t"),
  find_prev_char: findCharCmd("F"),
  till_prev_char: findCharCmd("T"),
  repeat_last_motion: (ctx) => lastMotion?.(ctx),
  goto_line_start: ({ view }) => gotoPos(view, (r) => rowStart(view, cursorOf(r, view))),
  goto_line_end: ({ view }) => gotoPos(view, (r, text, doc) => rowEnd(view, text, doc, cursorOf(r, view))),
  goto_first_nonwhitespace: ({ view }) => gotoPos(view, (r, text, doc) => rowFirstNonWhitespace(view, text, doc, cursorOf(r, view))),
  goto_file_start: ({ view, count, hasCount }) =>
    gotoPos(view, (_r, _t, doc) => (hasCount ? lineStart(doc, count) : 0)),
  goto_last_line: ({ view }) => {
    gotoPos(view, (_r, _t, doc) => lineStart(doc, doc.lines));
    showWholeLine(view);
  },
  goto_line: ({ view, count, hasCount }) => {
    gotoPos(view, (_r, _t, doc) => lineStart(doc, hasCount ? count : doc.lines));
    showWholeLine(view);
  },
  goto_window_top: windowPos("top"),
  goto_window_center: windowPos("center"),
  goto_window_bottom: windowPos("bottom"),
  goto_word: (ctx) => startJump(ctx.view, extending(ctx.view), ctx.readChar, ctx.host),
  match_brackets: matchBrackets,
  page_up: pageMove(-1),
  page_down: pageMove(1),
  page_cursor_half_up: pageMove(-0.5),
  page_cursor_half_down: pageMove(0.5),
  align_view_center: alignView("center"),
  align_view_top: alignView("start"),
  align_view_bottom: alignView("end"),
  scroll_down: scrollLines(1),
  scroll_up: scrollLines(-1),

  // Selections
  extend_line_below: ({ view, count }) => transform(view, (r, _t, doc) => extendLine(doc, r, count, "below")),
  extend_line_above: ({ view, count }) => transform(view, (r, _t, doc) => extendLine(doc, r, count, "above")),
  extend_to_line_bounds: ({ view }) => transform(view, (r, _t, doc) => extendToLineBounds(doc, r)),
  select_all: ({ view }) => setSelection(view, [EditorSelection.range(0, view.state.doc.length)], 0),
  select_regex: selectRegex(false),
  split_selection: selectRegex(true),
  split_selection_on_newline: splitOnNewline,
  collapse_selection: ({ view }) => transform(view, (r, text) => point(text, cursor(text, r))),
  flip_selections: ({ view }) => transform(view, (r) => range(r.head, r.anchor)),
  ensure_selections_forward: ({ view }) => transform(view, (r) => range(rangeFrom(r), rangeTo(r))),
  keep_primary_selection: ({ view }) => setSelection(view, [view.state.selection.main], 0),
  remove_primary_selection: ({ view }) => {
    const { ranges, mainIndex } = view.state.selection;
    if (ranges.length < 2) return;
    setSelection(view, ranges.filter((_, i) => i !== mainIndex), Math.max(0, mainIndex - 1));
  },
  copy_selection_on_next_line: copySelectionOnLine(1),
  copy_selection_on_prev_line: copySelectionOnLine(-1),
  rotate_selections_forward: rotate(1),
  rotate_selections_backward: rotate(-1),
  trim_selections: trimSelections,
  select_textobject_inner: textObject(false),
  select_textobject_around: textObject(true),

  // Search
  search: search(true),
  rsearch: search(false),
  search_next: ({ view, host }) => searchFrom(view, host, true, extending(view)),
  search_prev: ({ view, host }) => searchFrom(view, host, false, extending(view)),
  search_selection: ({ view, host }) => {
    const s = view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to);
    const word = /^\w.*\w$|^\w$/su.test(s);
    const pattern = word ? `\\b${escapeRegex(s)}\\b` : escapeRegex(s);
    registers.set("/", [pattern]);
    host.message(`register '/' set to '${pattern}'`);
  },

  // Editing
  yank: ({ view, host }) => yankTo(view, host, '"'),
  paste_after: paste("after"),
  paste_before: paste("before"),
  replace_with_yanked: paste("replace"),
  delete_selection: deleteSelection(true),
  delete_selection_noyank: deleteSelection(false),
  change_selection: changeSelection(true),
  change_selection_noyank: changeSelection(false),
  replace: replaceChar,
  switch_case: switchCase,
  switch_to_lowercase: mapSelectedText((s) => s.toLowerCase()),
  switch_to_uppercase: mapSelectedText((s) => s.toUpperCase()),
  indent: indent(1),
  unindent: indent(-1),
  join_selections: joinSelections,
  add_newline_below: addNewline(true),
  add_newline_above: addNewline(false),
  surround_add: surroundAdd,
  surround_replace: surroundReplace,
  surround_delete: surroundDelete,
  undo: ({ view, count }) => {
    for (let i = 0; i < count; i++) cmUndo(view);
  },
  redo: ({ view, count }) => {
    for (let i = 0; i < count; i++) cmRedo(view);
  },

  // Clipboard (Helix's space-mode bindings)
  yank_to_clipboard: async ({ view, host }) => {
    await host.clipboardWrite(selectedTexts(view).join("\n"));
    host.message("yanked to clipboard");
  },
  paste_clipboard_after: pasteClipboard("after"),
  paste_clipboard_before: pasteClipboard("before"),
  replace_selections_with_clipboard: pasteClipboard("replace"),

  ...spellCommands,
  ...reviewCommands,
  ...commentCommands,

  // Files, buffers and windows
  history_picker: ({ host }) => host.historyPicker(),
  changes_picker: ({ host }) => host.changesPicker(),
  symbol_picker: ({ host }) => host.headingPicker(false),
  workspace_symbol_picker: ({ host }) => host.headingPicker(true),
  jump_backward: ({ host, count }) => host.jumpBackward(count),
  jump_forward: ({ host, count }) => host.jumpForward(count),
  save_selection: ({ host }) => host.saveSelection(),
  jumplist_picker: ({ host }) => host.jumplistPicker(),
  completion: ({ host, view }) => host.complete(view),

  global_search: ({ host }) => host.globalSearch(),
  goto_file: ({ view, host }) => host.followLink(view),
  file_picker: ({ host }) => host.filePicker(false),
  file_picker_in_current_directory: ({ host }) => host.filePicker(true),
  buffer_picker: ({ host }) => host.bufferPicker(),
  goto_next_buffer: ({ host }) => host.gotoBuffer("next"),
  goto_previous_buffer: ({ host }) => host.gotoBuffer("previous"),
  goto_last_accessed_file: ({ host }) => host.gotoBuffer("last"),
  ...Object.fromEntries(windowCommands.map((name): [string, Command] => [name, ({ host }) => host.windowCommand(name)])),

  // Insert mode
  delete_word_backward: deleteWordBackward,
  kill_to_line_start: killToLineStart,
};

for (const name of [
  "goto_file_start",
  "goto_last_line",
  "goto_line",
  "search_next",
  "search_prev",
  "goto_next_change",
  "goto_prev_change",
  "goto_first_change",
  "goto_last_change",
  "goto_next_comment",
  "goto_prev_comment",
]) {
  commands[name] = jumping(commands[name]);
}

function cursorOf(r: Range, view: EditorView): number {
  return cursor(textOf(view.state.doc), r);
}

/** Pastes text into every selection as if typed in normal mode (used for drops and Cmd-V). */
export function pasteText(view: EditorView, text: string) {
  pasteValues(view, [text], "after", 1);
}
