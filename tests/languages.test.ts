import { describe, expect, it } from "vitest";
import { StringStream, type StreamParser } from "@codemirror/language";
import { toml } from "@codemirror/legacy-modes/mode/toml";
import { fixedToml } from "../src/languages.ts";

/** The style of each line's first token, the key. */
function keyStyles<S>(mode: StreamParser<S>, text: string): (string | null)[] {
  const state = mode.startState!(2);
  return text.split("\n").map((line) => {
    const stream = new StringStream(line, 2, 2);
    let first: string | null | undefined;
    while (!stream.eol()) {
      const style = mode.token(stream, state);
      if (first === undefined && stream.current().trim()) first = style;
      stream.start = stream.pos;
    }
    return first ?? null;
  });
}

describe("TOML highlighting", () => {
  const text = '# Surfaces\n"ui.statusline" = { fg = "blue" }\n"ui.selection" = { bg = "mint" }\nplain = "x"\n"quoted" = "y"';

  it("styles quoted keys as keys on every line, not only after a comment", () => {
    expect(keyStyles(fixedToml(toml as StreamParser<never>), text)).toEqual(["comment", "property", "property", "property", "property"]);
  });

  it("works around the mode's own bug, which styles them as values", () => {
    expect(keyStyles(toml as StreamParser<never>, text)[2]).toBe("string");
  });
});
