import { describe, expect, it } from "vitest";
import { countNotes, countText, readable } from "../src/wordCount.ts";

const count = (md: string, ranges?: [number, number][]) => countText(md, readable(md), ranges);

describe("word count", () => {
  it("counts what a reader sees", () => {
    expect(count("# A title\n\nSome **bold**text and a [link](https://example.com/a/b \"Title\").\n").words).toBe(7);
    expect(count("---\ntitle: Not counted here\n---\n\nTwo words\n").words).toBe(2);
    expect(count("Kept.{>>a note for the agent<<} {==Highlighted==} text.\n").words).toBe(3);
    expect(count("<!-- widths: 20 80 -->\n<div>raw</div>\n\nOne\n").words).toBe(1);
    expect(count("A well-known word — and $x^2$ math ![alt](a.png).\n").words).toBe(5);
    expect(count("[[Some note#Part]] and [[note|shown text]]\n").words).toBe(6);
    expect(count("| Item | Cost |\n| --- | ---: |\n| Build | $5 |\n").words).toBe(4);
    expect(count("- [x] Done task\n> quoted line\n\n```\ncode here\n```\n").words).toBe(6);
    expect(count("A \\*star\\* here\n").words).toBe(3);
  });

  it("counts characters, with and without spaces", () => {
    expect(count("Hi **there**,\nyou.\n")).toEqual({ words: 3, characters: 14, charactersNoSpaces: 12 });
  });

  it("counts footnotes apart, and a selection with its notes", () => {
    const md = "Body text.[^1] More.\n\n[^1]: The note has five words.\n";
    const r = readable(md);
    expect(countText(md, r).words).toBe(3);
    expect(countNotes(md, r).words).toBe(5);
    expect(r.noteCount).toBe(1);
    expect(count(md, [[0, md.indexOf(" More")]]).words).toBe(2);
    expect(count(md, [[0, 4], [md.indexOf("note has"), md.length]]).words).toBe(5);
  });
});
