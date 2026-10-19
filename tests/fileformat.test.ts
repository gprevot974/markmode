import { describe, expect, it } from "vitest";
import { defaultFormat, fromDisk, toDisk } from "../src/fileformat.ts";

const utf8 = { encoding: "utf-8", bom: false } as const;

describe("line endings", () => {
  it.each([
    ["lf", "# Title\n\nText\n"],
    ["crlf", "# Title\r\n\r\nText\r\n"],
    ["no trailing newline", "one\r\ntwo"],
    ["empty", ""],
    ["lone carriage return", "a\rb\n"],
  ])("%s survives a round trip", (_, disk) => {
    const { text, format } = fromDisk(disk, utf8);
    expect(text).not.toContain("\r\n");
    expect(toDisk(text, format)).toBe(disk);
  });

  it("keeps the encoding it was given", () => {
    expect(fromDisk("x", { encoding: "utf-16le", bom: true }).format).toEqual({ encoding: "utf-16le", bom: true, lineEnding: "lf" });
  });

  it("unifies mixed endings to the more common one", () => {
    const { text, format } = fromDisk("a\r\nb\r\nc\nd", utf8);
    expect(format.lineEnding).toBe("crlf");
    expect(toDisk(text, format)).toBe("a\r\nb\r\nc\r\nd");
  });

  it("writes new files with \\n", () => {
    expect(toDisk("a\nb\n", defaultFormat)).toBe("a\nb\n");
  });
});
