import { describe, expect, it } from "vitest";
import { Text } from "@codemirror/state";
import { range, point, putCursor, cursor } from "../src/helix/range.ts";
import { wordMove, findChar, extendLine } from "../src/helix/motions.ts";
import { wordObject, pairObject, paragraphObject, matchBracket } from "../src/helix/textobjects.ts";
import { continuationPrefix } from "../src/helix/commands.ts";

const sel = (text: string, r: { anchor: number; head: number }) => text.slice(Math.min(r.anchor, r.head), Math.max(r.anchor, r.head));

describe("word motions (Helix semantics)", () => {
  const text = "hello world, foo_bar baz";

  it("w selects the word and its trailing space", () => {
    const r = wordMove(text, point(text, 0), 1, "nextWordStart");
    expect(sel(text, r)).toBe("hello ");
  });

  it("w from inside a word selects to the next word start", () => {
    const r = wordMove(text, point(text, 2), 1, "nextWordStart");
    expect(sel(text, r)).toBe("llo ");
  });

  it("w stops at punctuation, W does not", () => {
    const at = text.indexOf("world");
    expect(sel(text, wordMove(text, point(text, at), 1, "nextWordStart"))).toBe("world");
    expect(sel(text, wordMove(text, point(text, at), 1, "nextLongWordStart"))).toBe("world, ");
  });

  it("e selects to the end of the word", () => {
    expect(sel(text, wordMove(text, point(text, 0), 1, "nextWordEnd"))).toBe("hello");
  });

  it("b selects back to the word start, with the head first", () => {
    const at = text.indexOf("world") + 3;
    const r = wordMove(text, point(text, at), 1, "prevWordStart");
    expect(sel(text, r)).toBe("worl");
    expect(r.head).toBeLessThan(r.anchor);
  });

  it("counts repeat the motion", () => {
    expect(sel(text, wordMove(text, point(text, 0), 2, "nextWordStart"))).toBe("world");
  });

  it("w crosses line breaks onto the next word", () => {
    const t = "end\nnext line";
    const r = wordMove(t, point(t, 0), 2, "nextWordStart");
    expect(sel(t, r)).toBe("next ");
  });
});

describe("find char", () => {
  const text = "a(b, c) d";
  it("f selects through the character", () => {
    expect(sel(text, findChar(text, point(text, 0), "f", ",", 1, false))).toBe("a(b,");
  });
  it("t selects up to the character", () => {
    expect(sel(text, findChar(text, point(text, 0), "t", ",", 1, false))).toBe("a(b");
  });
  it("F searches backwards", () => {
    const r = findChar(text, point(text, 8), "F", "(", 1, false);
    expect(sel(text, r)).toBe("(b, c) d");
  });
  it("leaves the selection alone when not found", () => {
    const r = point(text, 0);
    expect(findChar(text, r, "f", "z", 1, false)).toEqual(r);
  });
});

describe("put_cursor", () => {
  it("extends forward and backward across the anchor like Helix", () => {
    const text = "abcdef";
    const r = range(2, 3); // on "c"
    expect(putCursor(text, r, 4, true)).toEqual(range(2, 5));
    expect(putCursor(text, r, 0, true)).toEqual(range(3, 0));
    expect(cursor(text, range(2, 5))).toBe(4);
  });
});

describe("x (extend_line_below)", () => {
  const doc = Text.of(["one", "two", "three"]);
  it("selects the current line, then grows", () => {
    const first = extendLine(doc, point(doc.toString(), 1), 1, "below");
    expect(first).toEqual(range(0, 4));
    expect(extendLine(doc, first, 1, "below")).toEqual(range(0, 8));
  });
});

describe("text objects", () => {
  it("miw / maw", () => {
    const text = "say hello there";
    const r = point(text, 6);
    expect(sel(text, wordObject(text, r, false, false))).toBe("hello");
    expect(sel(text, wordObject(text, r, true, false))).toBe("hello ");
  });

  it("mi( and ma( around nested brackets", () => {
    const text = "f(a, (b), c)";
    const r = point(text, 3);
    expect(sel(text, pairObject(text, r, "(", false))).toBe("a, (b), c");
    expect(sel(text, pairObject(text, r, ")", true))).toBe("(a, (b), c)");
    expect(sel(text, pairObject(text, point(text, 6), "(", false))).toBe("b");
  });

  it('mi" within a line', () => {
    const text = 'say "hi there" now';
    expect(sel(text, pairObject(text, point(text, 7), '"', false))).toBe("hi there");
  });

  it("mi* for markdown emphasis", () => {
    const text = "some *emphasized* words";
    expect(sel(text, pairObject(text, point(text, 8), "*", false))).toBe("emphasized");
  });

  it("mim picks the closest pair of any kind", () => {
    const text = '[x "y z" w]';
    expect(sel(text, pairObject(text, point(text, 5), "m", false))).toBe("y z");
  });

  it("mip selects the paragraph, map adds the blank lines after it", () => {
    const doc = Text.of(["a", "b", "", "", "c"]);
    const text = doc.toString();
    expect(sel(text, paragraphObject(doc, point(text, 0), false))).toBe("a\nb\n");
    expect(sel(text, paragraphObject(doc, point(text, 0), true))).toBe("a\nb\n\n\n");
  });

  it("mm jumps between brackets", () => {
    const text = "(a [b] c)";
    expect(matchBracket(text, 0)).toBe(8);
    expect(matchBracket(text, 8)).toBe(0);
    expect(matchBracket(text, 3)).toBe(5);
  });
});

describe("o / O continuation", () => {
  it("continues bullets, numbers, tasks and quotes", () => {
    expect(continuationPrefix("- item", true)).toBe("- ");
    expect(continuationPrefix("  * item", true)).toBe("  * ");
    expect(continuationPrefix("3. item", true)).toBe("4. ");
    expect(continuationPrefix("- [x] done", true)).toBe("- [ ] ");
    expect(continuationPrefix("> quote", true)).toBe("> ");
    expect(continuationPrefix("    code", true)).toBe("    ");
  });
});
