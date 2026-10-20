import { describe, expect, it } from "vitest";
import { Text } from "@codemirror/state";
import { Chunk } from "@codemirror/merge";
import { lineMatches, proseDiff } from "../src/diff.ts";
import { findMarkup, noteMarkup, stripComments } from "../src/criticmarkup.ts";
import { diffPreview } from "../src/history.ts";

/** Applies a diff to `a`, checking that the text between changes is equal on both sides. */
function apply(a: string, b: string): string {
  let out = "";
  let posA = 0;
  let posB = 0;
  for (const c of proseDiff(a, b)) {
    expect(a.slice(posA, c.fromA)).toBe(b.slice(posB, c.fromB));
    out += a.slice(posA, c.fromA) + b.slice(c.fromB, c.toB);
    posA = c.toA;
    posB = c.toB;
  }
  expect(a.slice(posA)).toBe(b.slice(posB));
  return out + a.slice(posA);
}

describe("proseDiff", () => {
  it("turns one text into the other", () => {
    const words = ["alpha", "beta", "gamma", "", "delta\n", "x"];
    let seed = 7;
    const rand = () => (seed = (seed * 48271) % 2147483647) / 2147483647;
    const text = () => Array.from({ length: Math.floor(rand() * 12) }, () => words[Math.floor(rand() * words.length)]).join("\n");
    for (let i = 0; i < 300; i++) {
      const a = text();
      const b = text();
      expect(apply(a, b)).toBe(b);
    }
    expect(apply("x", "x\ny")).toBe("x\ny");
    expect(apply("x\ny\n", "")).toBe("");
  });

  it("keeps changes to the paragraphs they are in", () => {
    const a = "# T\n\nOne stays.\n\nTwo changes here.\n\nThree stays.\n\nFour goes.\n\nFive stays.\n\nLast.\n";
    const b = "# T\n\nOne stays.\n\nTwo has changed here.\n\nThree stays.\n\nFive stays.\n\nLast.\n\nA new end.\n";
    const chunks = Chunk.build(Text.of(a.split("\n")), Text.of(b.split("\n")), { override: proseDiff });
    expect(chunks.length).toBe(3);
  });

  it("finds a shortest edit script of lines", () => {
    expect(lineMatches([1, 2, 3, 4], [1, 3, 4, 5], 10)).toEqual([[0, 0], [2, 1], [3, 2]]);
    expect(lineMatches([1, 2], [3, 4], 1)).toBeNull();
  });
});

describe("CriticMarkup", () => {
  it("finds notes and highlights", () => {
    const text = "A {==word==}{>>why?<<} and {>>a note<<} and {==just this==}.";
    expect(findMarkup(text).map((m) => text.slice(m.from, m.to))).toEqual(["{==word==}{>>why?<<}", "{>>a note<<}", "{==just this==}"]);
    expect(findMarkup("no {>>note\n\nacross paragraphs<<}")).toEqual([]);
    expect(noteMarkup(" a <<} b ")).toBe("{>>a << } b<<}");
  });

  it("leaves comments out of exports, but not code", () => {
    const src = "Text {==kept==}{>>note<<} here. {>>end note<<}\n{>>alone<<}\nNext line.\n\n```\n{>>code<<}\n```\n";
    expect(stripComments(src)).toBe("Text kept here.\nNext line.\n\n```\n{>>code<<}\n```\n");
  });
});

describe("history preview", () => {
  it("shows removed and added lines with context", () => {
    const p = diffPreview("a\nb\nc\nd\ne\nf\ng\n", "a\nb\nc\nD\ne\nf\ng\n");
    expect(p.text.split("\n").slice(1)).toEqual(["⋯", "b", "c", "d", "D", "e", "f", "⋯"]);
    expect(p.classes!.slice(1)).toEqual(["pk-skip", "", "", "pk-del", "pk-add", "", "", "pk-skip"]);
    expect(diffPreview("same", "same").text).toBe("same as the current text");
  });
});

describe("reflow", async () => {
  const { reflow } = await import("../src/reflow.ts");
  it("wraps paragraphs, keeping list and quote markers", () => {
    expect(reflow("one two three four five six", 13)).toBe("one two three\nfour five six");
    expect(reflow("- one two three four", 12)).toBe("- one two\n  three four");
    expect(reflow("> one two three four", 12)).toBe("> one two\n> three four");
    expect(reflow("1. one\n   two three four five", 14)).toBe("1. one two\n   three four\n   five");
  });

  it("leaves headings, code and tables alone", () => {
    const src = "# A long heading here\n\n```\na long code line here\n```\n\n| a | b |\n\n    indented code line";
    expect(reflow(src, 8)).toBe(src);
  });

  it("joins short lines and keeps paragraphs and hard breaks apart", () => {
    expect(reflow("a\nb\n\nc  \nd", 80)).toBe("a b\n\nc  \nd");
  });
});
