import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { Packer } from "docx";
import JSZip from "jszip";
import { buildDocument } from "../src/export/docx.ts";
import { FIELDS, defaultStyle, fieldKey, parseStyleFile, starterStyle } from "../src/export/style.ts";
import { configuredStyle, listStyles, resolveStyle, setConfiguredStyle, type StyleFs } from "../src/export/styles.ts";
import { exportReference } from "../src/export/reference.ts";
import { propertyCompletions, styleCompletions } from "../src/export/complete.ts";
import { frontMatter, setProperty } from "../src/frontmatter.ts";

const memoryFs = (files: Record<string, string>): StyleFs => ({
  read: async (path) => files[path] ?? null,
  list: async (dir) =>
    Object.keys(files)
      .filter((p) => p.startsWith(dir + "/") && !p.slice(dir.length + 1).includes("/"))
      .map((p) => p.slice(dir.length + 1)),
});

async function parts(md: string, style = defaultStyle()) {
  const zip = await JSZip.loadAsync(await Packer.toBuffer(buildDocument(md, style)));
  const read = (name: string) => zip.file(name)!.async("string");
  return { document: await read("word/document.xml"), core: await read("docProps/core.xml"), footer: await read("word/footer1.xml") };
}

const apply = (text: string, change: ReturnType<typeof setProperty>) =>
  change ? text.slice(0, change.from) + change.insert + text.slice(change.to) : text;

describe("front matter", () => {
  it("reads flat keys, quoted or not, and booleans", () => {
    const fm = frontMatter('---\ntitle: "A: B"\nauthor: Jane # note\nsubtitle: false\ntags:\n  - x\n---\n\n# Doc\n');
    expect(fm?.fields).toEqual({ title: "A: B", author: "Jane", subtitle: false });
    expect(fm?.endLine).toBe(7);
    expect(frontMatter("---\nnot closed\n")).toBeNull();
    expect(frontMatter("# Doc\n---\n")).toBeNull();
  });

  it("sets, replaces and removes a property", () => {
    const added = apply("# Doc\n", setProperty("# Doc\n", "style", "acme"));
    expect(added).toBe("---\nstyle: acme\n---\n\n# Doc\n");
    const replaced = apply(added, setProperty(added, "style", "plain"));
    expect(replaced).toBe("---\nstyle: plain\n---\n\n# Doc\n");
    const two = apply(replaced, setProperty(replaced, "footer", "Draft: v2"));
    expect(two).toBe('---\nstyle: plain\nfooter: "Draft: v2"\n---\n\n# Doc\n');
    expect(apply(two, setProperty(two, "style", null))).toBe('---\nfooter: "Draft: v2"\n---\n\n# Doc\n');
    expect(apply(replaced, setProperty(replaced, "style", null))).toBe("# Doc\n");
  });
});

describe("export style files", () => {
  it("checks keys and values, keeping the good ones", () => {
    const file = parseStyleFile(
      'inherits = "plain"\ndescription = "Ours"\n[colors]\nheading = "#abcdef"\naccent = "red"\nnope = "#000000"\n[sizes]\nbody = 11\n[bogus]\nx = 1\n',
    );
    expect(file.inherits).toBe("plain");
    expect(file.description).toBe("Ours");
    expect(file.keys).toEqual({ "colors.heading": "ABCDEF", "sizes.body": 11 });
    expect(file.errors).toEqual(['colors.accent: a color like "#203864"', "unknown key colors.nope", "unknown section [bogus]"]);
    expect(parseStyleFile("[colors\n").errors).toHaveLength(1);
  });

  it("documents every key, and starter files read back as their parent", () => {
    for (const field of FIELDS) expect(defaultStyle()[fieldKey(field)], fieldKey(field)).not.toBeUndefined();
    expect(Object.keys(defaultStyle())).toHaveLength(FIELDS.length);
    const starter = parseStyleFile(starterStyle("plain", defaultStyle()));
    expect(starter).toEqual({ inherits: "plain", description: "", keys: {}, errors: [] });
    // Uncommenting a line gives a valid key.
    const uncommented = parseStyleFile(starterStyle("default", defaultStyle()).replace(/^# (\w[\w-]* = .*?)  # .*$/gm, "$1"));
    expect(uncommented.errors).toEqual([]);
    expect(Object.keys(uncommented.keys)).toHaveLength(FIELDS.length);
  });

  it("finds styles in the project, then the user's, then built in", async () => {
    const fs = memoryFs({
      "/p/.markmode/styles/acme.toml": '[colors]\nheading = "#111111"',
      "/p/.markmode/styles/plain.toml": 'inherits = "plain"\n[colors]\naccent = "#222222"',
      "/u/styles/acme.toml": 'description = "mine"\n[colors]\nheading = "#999999"',
      "/u/styles/mine.toml": 'inherits = "acme"\n[sizes]\nbody = 12',
      "/u/styles/loop.toml": 'inherits = "loop2"',
      "/u/styles/loop2.toml": 'inherits = "loop"',
      "/u/styles/orphan.toml": 'inherits = "nowhere"',
    });
    const dirs = { project: "/p/.markmode", user: "/u" };
    const names = (await listStyles(fs, dirs)).map((e) => `${e.name}:${e.scope}`);
    expect(names).toEqual(["acme:project", "plain:project", "loop:user", "loop2:user", "mine:user", "orphan:user", "default:built-in"]);

    const mine = await resolveStyle("mine", fs, dirs);
    // `acme` is the project's: the more specific one hides the user's.
    expect(mine.style["colors.heading"]).toBe("111111");
    expect(mine.style["sizes.body"]).toBe(12);
    expect(mine.path).toBe("/u/styles/mine.toml");
    // Inheriting its own name extends the built-in one.
    const plain = await resolveStyle("plain", fs, dirs);
    expect(plain.style["colors.accent"]).toBe("222222");
    expect(plain.style["colors.heading"]).toBe("000000");

    expect((await resolveStyle("loop", fs, dirs)).errors.join()).toContain("inherits in a loop");
    expect((await resolveStyle("orphan", fs, dirs)).errors).toEqual(["orphan.toml: no style named nowhere to inherit"]);
    expect((await resolveStyle("missing", fs, dirs)).found).toBe(false);
  });

  it("reads and sets the configured style, project first", async () => {
    const dirs = { project: "/p", user: "/u" };
    expect(await configuredStyle(memoryFs({}), dirs)).toBe("default");
    expect(await configuredStyle(memoryFs({ "/u/config.toml": '[export]\nstyle = "acme"' }), dirs)).toBe("acme");
    expect(await configuredStyle(memoryFs({ "/u/config.toml": '[export]\nstyle = "acme"', "/p/config.toml": '[export]\nstyle = "p"' }), dirs)).toBe("p");
    expect(setConfiguredStyle("", "acme")).toBe('[export]\nstyle = "acme"\n');
    expect(setConfiguredStyle("# mine\n[other]\nx = 1\n", "acme")).toBe('# mine\n[other]\nx = 1\n\n[export]\nstyle = "acme"\n');
    expect(setConfiguredStyle('[export]  # here\nstyle = "old"\n[next]\n', "new")).toBe('[export]  # here\nstyle = "new"\n[next]\n');
    expect(setConfiguredStyle("[export]\n[next]\n", "new")).toBe('[export]\nstyle = "new"\n[next]\n');
  });
});

describe("docx export with a style", () => {
  const table = "| Item | Cost |\n|---|---:|\n| A | 1 |\n| B | 2 |\n| C | 3 |\n| **Sum** | **6** |\n";

  it("takes its properties from front matter, before directives", async () => {
    const md = "---\ntitle: Real title\nfooter: From front matter\nsubject: Bids\nauthor: Jane\n---\n\n<!-- footer: From a directive -->\n# Heading title\n\nText.\n";
    const { document, core, footer } = await parts(md);
    expect(core).toContain("Real title");
    expect(core).toContain("Bids");
    expect(core).toContain("Jane");
    expect(footer).toContain("From front matter");
    // The front matter is not body text.
    expect(document).not.toContain("subject");
  });

  it("uses the style's colors, fonts, page and rules", async () => {
    const style = {
      ...defaultStyle(),
      "colors.heading": "123456",
      "fonts.body": "Georgia",
      "page.size": "a4",
      "rules.table-bands": false,
      "rules.total-rows": "Sum",
    };
    const { document } = await parts(`# T\n\n## Sub\n\n## Section\n\n${table}`, style);
    expect(document).toContain('w:color w:val="123456"');
    expect(document).toContain("Georgia");
    expect(document).not.toContain(defaultStyle()["colors.table-band"] as string);
    expect(document).toContain(`w:fill="${defaultStyle()["colors.table-total"]}"`);

    const banded = await parts(table);
    expect(banded.document).toContain(`w:fill="${defaultStyle()["colors.table-band"]}"`);
    expect(banded.document).not.toContain(`w:fill="${defaultStyle()["colors.table-total"]}"`);
  });

  it("turns the subtitle off from front matter or the style", async () => {
    const subtitle = defaultStyle()["colors.subtitle-rule"] as string;
    expect((await parts("# T\n\n## Sub\n")).document).toContain(subtitle);
    expect((await parts("---\nsubtitle: false\n---\n# T\n\n## Sub\n")).document).not.toContain(subtitle);
    expect((await parts("# T\n\n## Sub\n", { ...defaultStyle(), "rules.subtitle": false })).document).not.toContain(subtitle);
  });
});

describe("export completions", () => {
  const styles = ["acme", "default", "plain"];
  const at = (text: string, styles: string[] = []) => {
    const lines = text.split("\n");
    const index = lines.findIndex((l) => l.includes("|"));
    const col = lines[index].indexOf("|");
    lines[index] = lines[index].replace("|", "");
    return styleCompletions(lines.join("\n"), index, col, styles, (key) => (key === "colors.heading" ? "#203864" : null));
  };

  it("completes sections, keys and values in a style file", () => {
    expect(at("[co|").map((c) => c.insert)).toEqual(["colors]"]);
    expect(at("[colors]\nhead|")[0]).toMatchObject({ label: "heading", insert: "heading = ", from: 0 });
    expect(at("in|", styles)[0].insert).toBe("inherits = ");
    expect(at('inherits = "pl|', styles).map((c) => c.insert)).toEqual(['"plain"']);
    expect(at('[page]\nsize = |').map((c) => c.insert)).toEqual(['"letter"', '"a4"']);
    // The colors in the file come up, after the inherited one.
    const colors = at('[colors]\naccent = "#de5220"\nheading = |');
    expect(colors.map((c) => c.label)).toEqual(["#203864", "#DE5220"]);
    expect(colors[0].detail).toBe("inherited");
  });

  it("completes properties and their values in front matter", () => {
    expect(propertyCompletions("sty", 3, styles).map((c) => c.insert)).toEqual(["style: "]);
    expect(propertyCompletions("style: pl", 9, styles).map((c) => c.insert)).toEqual(["plain"]);
    expect(propertyCompletions("subtitle: ", 10, styles).map((c) => c.insert)).toEqual(["false", "true"]);
    expect(propertyCompletions("author: J", 9, styles)).toEqual([]);
  });
});

describe("the export reference", () => {
  it("is up to date in the README (npm run docs)", () => {
    const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");
    expect(readme).toContain(`<!-- export-reference -->\n\n${exportReference(3)}\n<!-- /export-reference -->`);
  });
});
