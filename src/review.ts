// Reviewing outside changes. When another program (an agent, git, a sync
// tool) rewrites an open file, its new text is taken in and each change is
// shown inline against the text from before: added text is highlighted, and
// removed text is struck out above it. Accepting a change keeps it and drops
// its highlight. Rejecting it brings the old text back, which `:w` then writes
// to the file. Edits typed during a review are taken as they are, without
// being shown as changes. The review ends once no change is left.
//
// The view is @codemirror/merge's unified merge view (with the prose diff of
// diff.ts), comparing the document with the "original", the text from before
// the outside change.
// Accepting a change copies it into the original. Edits typed outside the
// changes are copied there too, so they never show as changes.

import { Annotation, ChangeSet, Compartment, EditorSelection, EditorState, StateEffect, type Extension, type Text, type Transaction } from "@codemirror/state";
import { EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import { invertedEffects, isolateHistory } from "@codemirror/commands";
import { type Chunk, getChunks, getOriginalDoc, unifiedMergeView, updateOriginalDoc } from "@codemirror/merge";
import type { Command } from "./helix/commands.ts";
import { proseDiff } from "./diff.ts";

/** Marks an edit replayed from another window showing the same document. */
export const replayed = Annotation.define<boolean>();

/**
 * Marks an edit that is to show as a change rather than be copied into the
 * original: an outside change, a restored version, a rejection, and their undo
 * and redo.
 */
export const asChange = StateEffect.define<null>();

const compartment = new Compartment();

/** Starts empty; filled while a review is open. */
export const reviewSlot = (original: Text | null): Extension => compartment.of(original ? reviewExtension(original) : []);

export const startReview = (original: Text) => compartment.reconfigure(reviewExtension(original));
export const endReview = () => compartment.reconfigure([]);

export const reviewing = (state: EditorState) => getChunks(state) !== null;

/** The changes still to review; empty when there is no review. */
export const changesOf = (state: EditorState): readonly Chunk[] => getChunks(state)?.chunks ?? [];

export { getOriginalDoc as originalOf };

/** The parts of a transaction that other windows on the document must also get. */
export const reviewEffects = (tr: Transaction) => tr.effects.filter((e) => e.is(updateOriginalDoc) || e.is(asChange));

function reviewExtension(original: Text): Extension {
  return [
    unifiedMergeView({
      original,
      gutter: true,
      syntaxHighlightDeletions: false,
      // A paragraph with a few words changed shows them in place.
      allowInlineDiffs: true,
      diffConfig: { override: proseDiff },
      mergeControls: (type) => {
        const button = document.createElement("button");
        button.className = `review-${type}`;
        button.textContent = type === "accept" ? "Accept" : "Reject";
        button.title = type === "accept" ? "space g a" : "space g r";
        button.onmousedown = (e) => {
          e.preventDefault();
          const view = EditorView.findFromDOM(button.closest<HTMLElement>(".cm-editor")!);
          if (!view) return;
          const at = view.posAtDOM(button);
          const chunks = changesOf(view.state).filter((c) => c.fromB === at);
          (type === "accept" ? accept : reject)(view, chunks);
        };
        return button;
      },
    }),
    copyTypedEdits,
    buttonPlacement,
    invertedEffects.of((tr) => (tr.effects.some((e) => e.is(asChange)) ? [asChange.of(null)] : [])),
  ];
}

/** Room the Accept and Reject buttons take in the margin, in pixels. */
const BUTTONS_WIDTH = 140;

// The buttons sit in the margin left of the line numbers. When the window is
// too narrow for that, they get a row of their own above the change.
const buttonPlacement = ViewPlugin.fromClass(
  class {
    readonly view: EditorView;
    constructor(view: EditorView) {
      this.view = view;
      this.measure();
    }
    update(u: ViewUpdate) {
      if (u.geometryChanged) this.measure();
    }
    measure() {
      this.view.requestMeasure({
        read: (view) => {
          const gutters = view.dom.querySelector<HTMLElement>(".cm-gutters");
          const content = view.contentDOM.getBoundingClientRect().left;
          const left = gutters?.getBoundingClientRect().left ?? content;
          return { narrow: left - view.scrollDOM.getBoundingClientRect().left < BUTTONS_WIDTH, gutters: content - left };
        },
        write: ({ narrow, gutters }, view) => {
          // How far left of the text the buttons go: past the gutters, whichever are shown.
          view.scrollDOM.style.setProperty("--review-gutters", `${gutters}px`);
          if (view.scrollDOM.classList.contains("review-narrow") === narrow) return;
          view.scrollDOM.classList.toggle("review-narrow", narrow);
          view.requestMeasure();
        },
      });
    }
    destroy() {
      this.view.scrollDOM.classList.remove("review-narrow");
    }
  },
);

const touches = (c: Chunk, from: number, to: number) => from < c.toB && to > c.fromB;

/** A position in the document as a position in the original, outside any change. */
function toOriginal(chunks: readonly Chunk[], pos: number) {
  let delta = 0;
  for (const c of chunks) {
    if (c.toB > pos) break;
    delta = c.toA - c.toB;
  }
  return pos + delta;
}

// Edits outside the changes go into the original as well. Edits within a
// change become part of it.
const copyTypedEdits = EditorState.transactionExtender.of((tr) => {
  if (!tr.docChanged || tr.annotation(replayed) || tr.effects.some((e) => e.is(asChange) || e.is(updateOriginalDoc))) {
    return null;
  }
  const chunks = changesOf(tr.startState);
  const original = getOriginalDoc(tr.startState);
  const specs: { from: number; to: number; insert: Text }[] = [];
  tr.changes.iterChanges((from, to, _fromB, _toB, insert) => {
    if (chunks.some((c) => touches(c, from, to))) return;
    const a = Math.min(original.length, toOriginal(chunks, from));
    specs.push({ from: a, to: Math.min(original.length, a + (to - from)), insert });
  });
  if (!specs.length) return null;
  const changes = ChangeSet.of(specs, original.length);
  return { effects: updateOriginalDoc.of({ doc: changes.apply(original), changes }) };
});

// ── Accepting and rejecting ──────────────────────────────────────────────────

/** Keeps changes as they are: they become part of the original. */
function accept(view: EditorView, chunks: readonly Chunk[]) {
  if (!chunks.length) return;
  const { state } = view;
  const original = getOriginalDoc(state);
  const changes = ChangeSet.of(
    chunks.map((c) => {
      let insert = state.sliceDoc(c.fromB, Math.max(c.fromB, c.toB - 1));
      if (c.fromB !== c.toB && c.toA <= original.length) insert += state.lineBreak;
      return { from: c.fromA, to: Math.min(original.length, c.toA), insert };
    }),
    original.length,
  );
  view.dispatch({ effects: updateOriginalDoc.of({ doc: changes.apply(original), changes }), userEvent: "accept" });
}

/** Brings back the original text of changes. */
function reject(view: EditorView, chunks: readonly Chunk[]) {
  if (!chunks.length) return;
  const { state } = view;
  const original = getOriginalDoc(state);
  view.dispatch({
    changes: chunks.map((c) => {
      let insert = original.sliceString(c.fromA, Math.max(c.fromA, c.toA - 1));
      if (c.fromA !== c.toA && c.toB <= state.doc.length) insert += state.lineBreak;
      return { from: c.fromB, to: Math.min(state.doc.length, c.toB), insert };
    }),
    effects: asChange.of(null),
    annotations: isolateHistory.of("full"),
    userEvent: "revert",
  });
}

/** The changes touching a selection; a one-character selection is the cursor. */
function changesAtSelection(state: EditorState): Chunk[] {
  return changesOf(state).filter((c) =>
    state.selection.ranges.some((r) => c.fromB <= Math.max(r.from, r.to - 1) && c.endB >= r.from),
  );
}

// ── Commands ─────────────────────────────────────────────────────────────────

const NO_REVIEW = "no outside changes to review";

function gotoChange(which: "next" | "prev" | "first" | "last"): Command {
  return ({ view, host, count }) => {
    const chunks = changesOf(view.state);
    if (!chunks.length) return host.message(NO_REVIEW);
    const main = view.state.selection.main;
    let target: Chunk | undefined;
    if (which === "first") target = chunks[0];
    else if (which === "last") target = chunks[chunks.length - 1];
    else if (which === "next") {
      const at = main.head > main.anchor ? main.head - 1 : main.head;
      target = chunks.filter((c) => c.fromB > at)[count - 1];
    } else target = chunks.filter((c) => c.fromB < main.from).reverse()[count - 1];
    if (!target) return host.message(`no ${which === "next" ? "next" : "previous"} change`);
    const end = target.endB > target.fromB ? target.endB : Math.min(target.fromB + 1, view.state.doc.length);
    const n = chunks.indexOf(target) + 1;
    view.dispatch({
      selection: EditorSelection.single(target.fromB, end),
      effects: EditorView.scrollIntoView(target.fromB, { y: "center" }),
      userEvent: "select",
    });
    host.message(`change ${n} of ${chunks.length}`);
  };
}

function decide(how: "accept" | "reject", all: boolean): Command {
  return ({ view, host }) => {
    const chunks = all ? changesOf(view.state) : changesAtSelection(view.state);
    if (!chunks.length) return host.message(all || !reviewing(view.state) ? NO_REVIEW : "no change under the cursor");
    (how === "accept" ? accept : reject)(view, chunks);
    const left = changesOf(view.state).length;
    const done = `${how === "accept" ? "accepted" : "rejected"} ${chunks.length} change${chunks.length > 1 ? "s" : ""}`;
    host.message(left ? `${done}, ${left} left` : `${done}, review done${how === "reject" ? " (:w to write it)" : ""}`);
  };
}

export const reviewCommands: Record<string, Command> = {
  goto_next_change: gotoChange("next"),
  goto_prev_change: gotoChange("prev"),
  goto_first_change: gotoChange("first"),
  goto_last_change: gotoChange("last"),
  accept_change: decide("accept", false),
  reject_change: decide("reject", false),
  accept_all_changes: decide("accept", true),
  reject_all_changes: decide("reject", true),
};
