import { describe, expect, it } from "vitest";
import { normalKeys, insertKeys, mergeKeys } from "../src/helix/keymap.ts";
import { commands } from "../src/helix/commands.ts";
import { entryDetail, keyLabel, keysReference, paletteEntries } from "../src/palette.ts";
import { fuzzyFilter } from "../src/ui/fuzzy.ts";
import { findTypable, typables } from "../src/typable.ts";
import tutor from "../src/tutor.md?raw";

describe("command palette", () => {
  const entries = paletteEntries(normalKeys);
  const find = (label: string) => entries.find((e) => e.label === label);

  it("lists every typable command once, with the keys and shortcut running it", () => {
    expect(entries.filter((e) => e.typable).length).toBe(typables.length);
    const exportDocx = entries.find((e) => e.typable?.name === "export-docx")!;
    expect(exportDocx.label).toBe("Export a styled .docx next to the file");
    expect(exportDocx.keys).toEqual([["space", "e"]]);
    expect(entryDetail(exportDocx)).toBe("Space e  ⌘⇧E  :export-docx");
  });

  it("lists key bindings by what they do, keys doing the same in one entry", () => {
    expect(find("Move left")!.keys).toEqual([["h"], ["left"]]);
    expect(entryDetail(find("Open command palette")!)).toBe("Space ?  ⌘⇧P");
    // Every binding runs a command that exists.
    for (const e of entries) if (typeof e.binding === "string") expect(commands[e.binding], e.binding).toBeDefined();
  });

  it("shows remaps", () => {
    const remapped = paletteEntries(mergeKeys(normalKeys, { ret: "goto_word" }));
    expect(remapped.find((e) => e.binding === "goto_word")!.keys).toContainEqual(["ret"]);
  });

  it("finds commands by words in order", () => {
    const first = (pattern: string) => fuzzyFilter(pattern, entries, (e) => `${e.label}  ${entryDetail(e)}`)[0].label;
    expect(first("file pick")).toBe("Open file picker");
    expect(first("word count")).toBe("Count the words a reader sees");
    expect(first(":tutor")).toBe(typables.find((t) => t.name === "tutor")!.doc.split(":")[0]);
  });

  it("spells keys out", () => {
    expect(keyLabel("C-w")).toBe("Ctrl-w");
    expect(keyLabel("A-.")).toBe("Alt-.");
    expect(keyLabel("space")).toBe("Space");
    expect(keyLabel("S-tab")).toBe("Shift-Tab");
    expect(keyLabel("C-A-x")).toBe("Ctrl-Alt-x");
  });
});

describe(":keys and :tutor", () => {
  it("the key reference has a table for every minor mode, escaping pipes and backticks", () => {
    const md = keysReference(mergeKeys(normalKeys, { "|": "goto_word" }), insertKeys);
    expect(md).toContain("### Space w, Ctrl-w: Window");
    expect(md).toContain("### Space w n, Ctrl-w n: New split scratch buffer");
    expect(md.match(/Goto next window/g)?.length).toBe(1);
    expect(md).toContain("### Space\n");
    expect(md).toContain("### g: Goto");
    expect(md).toContain("| `\\|` | Jump to a two-character label |");
    expect(md).toContain("| `` ` `` | Switch to lowercase |");
    expect(md).toContain("Export a styled .docx next to the file");
  });

  it("the tutor names only commands and keys that exist", () => {
    for (const [, name] of tutor.matchAll(/`:([\w-]+)!?`/g)) expect(findTypable(name), name).toBeDefined();
    for (const [, keys] of tutor.matchAll(/`Space ([^`\s]+)`/g)) expect(normalKeys.space, keys).toHaveProperty(keys.split(" ")[0]);
  });
});
