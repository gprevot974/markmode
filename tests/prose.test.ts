import { describe, expect, it } from "vitest";
import { ChangeSet, EditorSelection } from "@codemirror/state";
import { headings } from "../src/outline.ts";
import { JumpList } from "../src/jumplist.ts";

describe("headings", () => {
  it("lists ATX and setext headings with the ones they are under", () => {
    const text = [
      "---",
      "title: # not a heading",
      "---",
      "# Guide",
      "",
      "Intro",
      "",
      "## Setup *quickly*",
      "",
      "```sh",
      "# a comment, not a heading",
      "```",
      "",
      "### Config ###",
      "",
      "Usage",
      "-----",
      "",
      "- item",
      "---",
      "",
      "# [Appendix](x.md)",
    ].join("\n");
    expect(headings(text).map((h) => [h.level, h.line, h.path.join(" › ")])).toEqual([
      [1, 4, "Guide"],
      [2, 8, "Guide › Setup quickly"],
      [3, 14, "Guide › Setup quickly › Config"],
      [2, 16, "Guide › Usage"],
      [1, 22, "Appendix"],
    ]);
    expect(headings(text)[2].parent?.title).toBe("Setup quickly");
  });
});

describe("jumplist", () => {
  const at = (n: number) => ({ doc: "a", selection: EditorSelection.single(n) });
  const pos = (j: { selection: EditorSelection } | null) => j?.selection.main.head;

  it("goes back and forth like Helix's", () => {
    const list = new JumpList<string>();
    list.push(at(1));
    list.push(at(2));
    expect(pos(list.backward(at(3), 1))).toBe(2);
    expect(pos(list.backward(at(2), 1))).toBe(1);
    expect(list.backward(at(1), 1)).toBeNull();
    expect(pos(list.forward(1))).toBe(2);
    expect(pos(list.forward(1))).toBe(3);
    expect(list.forward(1)).toBeNull();
  });

  it("drops the places gone back past on a new jump", () => {
    const list = new JumpList<string>();
    list.push(at(1));
    list.push(at(2));
    list.backward(at(3), 2);
    list.push(at(1));
    list.push(at(7));
    expect(list.jumps.map(pos)).toEqual([1, 7]);
  });

  it("skips the place it is at, keeps places through edits and forgets closed documents", () => {
    const list = new JumpList<string>();
    list.push(at(5));
    list.push({ doc: "b", selection: EditorSelection.single(0) });
    list.push(at(9));
    expect(pos(list.backward(at(9), 1))).toBe(0);
    list.map("a", ChangeSet.of({ from: 0, insert: "xx" }, 20));
    expect(list.jumps.map(pos)).toEqual([7, 0, 11]);
    list.remove("b");
    expect(list.jumps.map(pos)).toEqual([7, 11]);
    expect(pos(list.backward(at(11), 1))).toBe(7);
  });
});
