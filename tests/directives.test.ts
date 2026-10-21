import { describe, expect, it } from "vitest";
import { describeDirective, fitWidths, parseDirective, parseWidths, widthsDirective, widthsLineAbove } from "../src/directives.ts";

describe("directives", () => {
  it("reads the known ones only", () => {
    expect(parseDirective("<!-- footer: Draft for discussion -->")).toEqual({ key: "footer", value: "Draft for discussion" });
    expect(parseDirective("  <!--no-subtitle-->")).toEqual({ key: "no-subtitle", value: null });
    expect(parseDirective("<!-- TODO: later -->")).toBeNull();
    expect(parseDirective("<!-- footer: x --> trailing")).toBeNull();
    expect(describeDirective({ key: "author", value: "Ada" })).toBe("Author: Ada");
    expect(describeDirective({ key: "widths", value: "1 3" })).toBe("Column widths 25% · 75%");
  });

  it("reads, fits and writes widths", () => {
    expect(parseWidths("20 30 50")).toEqual([0.2, 0.3, 0.5]);
    expect(parseWidths("20%, 80%")).toEqual([0.2, 0.8]);
    expect(parseWidths("20 x")).toBeNull();
    expect(fitWidths([0.5, 0.5], 3).map((w) => w.toFixed(3))).toEqual(["0.333", "0.333", "0.333"]);
    expect(fitWidths([0.2, 0.3, 0.5], 2)).toEqual([0.4, 0.6]);
    expect(widthsDirective([1, 1, 1])).toBe("<!-- widths: 34 33 33 -->");
    expect(widthsDirective([0.123, 0.877])).toBe("<!-- widths: 12 88 -->");
  });

  it("finds the widths directive above a table, past blank lines only", () => {
    const lines = ["Text", "<!-- widths: 1 2 -->", "", "| a | b |"];
    expect(widthsLineAbove((n) => lines[n - 1], 4)).toBe(2);
    const other = ["<!-- widths: 1 2 -->", "Text", "| a | b |"];
    expect(widthsLineAbove((n) => other[n - 1], 3)).toBeNull();
  });
});
