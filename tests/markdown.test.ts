import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { ensureSyntaxTree } from "@codemirror/language";
import { Packer } from "docx";
import JSZip from "jszip";
import { searchRegex, searchText } from "../src/search.ts";
import { anchorLine, linkAt, resolveWiki, slug } from "../src/links.ts";
import { wikiLinkSyntax } from "../src/preview/wikiLinkSyntax.ts";
import { imageInfo, imagePath, imageSources } from "../src/images.ts";
import { buildDocument } from "../src/export/docx.ts";
import { markdownToHtml } from "../src/export/html.ts";
import { defaultStyle } from "../src/export/style.ts";
import { footnoteSyntax, footnoteNumbers } from "../src/preview/footnoteSyntax.ts";
import { syntaxTree } from "@codemirror/language";
import { mathSyntax, texOf } from "../src/preview/math.ts";

function stateOf(text: string) {
  const state = EditorState.create({ doc: text, extensions: markdown({ base: markdownLanguage, extensions: [wikiLinkSyntax, footnoteSyntax, mathSyntax] }) });
  ensureSyntaxTree(state, state.doc.length, 5000);
  return state;
}
const at = (text: string, marker: string) => linkAt(stateOf(text), text.indexOf(marker));

async function documentXml(md: string, images?: Map<string, Uint8Array>) {
  const zip = await JSZip.loadAsync(await Packer.toBuffer(buildDocument(md, undefined, images)));
  return { xml: await zip.file("word/document.xml")!.async("string"), media: Object.keys(zip.files).filter((f) => f.startsWith("word/media/") && !f.endsWith("/")) };
}

// A PNG's signature and header: enough for its size.
const png = (w: number, h: number) => {
  const b = new Uint8Array(33);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  new DataView(b.buffer).setUint32(16, w);
  new DataView(b.buffer).setUint32(20, h);
  return b;
};

describe("global search", () => {
  it("finds the first match of each line, smart case, indentation trimmed", () => {
    expect(searchText("a.md", "x\n   Cost here\ncost and cost\n", searchRegex("cost"))).toEqual([
      { path: "a.md", line: 2, text: "Cost here", from: 0, to: 4 },
      { path: "a.md", line: 3, text: "cost and cost", from: 0, to: 4 },
    ]);
    expect(searchText("a.md", "cost\nCost\n", searchRegex("Cost")).map((m) => m.line)).toEqual([2]);
    expect(() => searchRegex("(")).toThrow();
  });

  it("cuts long lines around the match", () => {
    const [m] = searchText("a.md", "a".repeat(500) + "needle" + "b".repeat(500), searchRegex("needle"));
    expect(m.text.length).toBeLessThanOrEqual(306);
    expect(m.text.slice(m.from, m.to)).toBe("needle");
  });
});

describe("links", () => {
  it("finds what the link under the cursor points to", () => {
    expect(at("See [it](notes/a%20b.md#Part-2) here", "it]")).toEqual({ kind: "path", path: "notes/a b.md", anchor: "Part-2" });
    expect(at("A [[Some note#Intro|shown]] b", "shown")).toEqual({ kind: "wiki", name: "Some note", anchor: "Intro" });
    expect(at("Go to <https://example.com/x> now", "example")).toEqual({ kind: "url", url: "https://example.com/x" });
    expect(at("![chart](img/c.png)", "chart")).toEqual({ kind: "path", path: "img/c.png", anchor: "" });
    expect(at("[ref][r]\n\n[r]: other.md\n", "ref")).toEqual({ kind: "path", path: "other.md", anchor: "" });
    expect(at("Just a ./file.md word", "file")).toEqual({ kind: "path", path: "./file.md", anchor: "" });
    expect(at("No link here", "link")).toBeNull();
  });

  it("names headings as GitHub does", () => {
    expect(slug("Part 2: **Costs** & risks")).toBe("part-2-costs--risks");
    const text = "# Top\n\n## Part 2: Costs & risks\n";
    expect(anchorLine(text, "part-2-costs--risks")).toBe(3);
    expect(anchorLine(text, "Part 2: Costs & risks")).toBe(3);
    expect(anchorLine(text, "nope")).toBeNull();
  });

  it("finds a wiki-link's note by name, nearest first", () => {
    const files = ["ideas.md", "work/ideas.md", "work/plan.md", "work/deep/plan.md", "readme.txt"];
    expect(resolveWiki("plan", files, "work")).toBe("work/plan.md");
    expect(resolveWiki("Ideas", files, "work")).toBe("work/ideas.md");
    expect(resolveWiki("ideas", files, "")).toBe("ideas.md");
    expect(resolveWiki("deep/plan", files, "")).toBe("work/deep/plan.md");
    expect(resolveWiki("readme", files, "")).toBeNull();
  });

  it("export as their text, and a web address as a link", async () => {
    const { xml } = await documentXml("See [the site](https://example.com), [a file](a.md) and [[Note|that note]] or [[Other#Part]].\n");
    expect(xml).toContain("the site");
    expect(xml).toContain("w:hyperlink");
    expect(xml).not.toContain("](");
    expect(xml).toContain("that note");
    expect(xml).toContain("Other › Part");
  });
});

describe("images", () => {
  it("resolve from the document's folder, and read their size", () => {
    expect(imagePath("../img/a%20b.png", "/docs/notes/x.md")).toBe("/docs/img/a b.png");
    expect(imagePath("https://x.org/a.png", "/d/x.md")).toBeNull();
    expect(imageSources("![a](one.png) and ![b](<two words.png> \"t\")")).toEqual(["one.png", "<two words.png>"]);
    expect(imageInfo(png(640, 480))).toEqual({ type: "png", width: 640, height: 480 });
    expect(imageInfo(new Uint8Array([1, 2, 3]))).toBeNull();
  });

  it("are placed in the export, scaled to the text's width", async () => {
    const { xml, media } = await documentXml("# T\n\n![Wide chart](wide.png)\n\n![Gone](gone.png)\n", new Map([["wide.png", png(2000, 1000)]]));
    expect(media).toHaveLength(1);
    // 6.9 inches of text at 96 pixels to the inch, in EMUs (9525 to the pixel).
    const cx = Number(/<wp:extent cx="(\d+)"/.exec(xml)![1]);
    expect(Math.round(cx / 9525)).toBe(Math.round(((12240 - 2 * 1080) / 1440) * 96));
    expect(xml).toContain("[Gone]");
  });
});

describe("footnotes", () => {
  const md = "# T\n\nA claim.[^src] Another.[^1] Again.[^src]\n\n[^1]: The second note,\n  on two lines.\n[^src]: The *first* note.\n[^unused]: Never referred to.\n\nAfter.\n";

  it("parse as references and notes, numbered by first reference", () => {
    const state = stateOf(md);
    const names: string[] = [];
    syntaxTree(state).iterate({ enter: (n) => void (n.name.startsWith("Footnote") && names.push(`${n.name}:${state.sliceDoc(n.from, n.to).split("\n")[0]}`)) });
    expect(names).toEqual([
      "FootnoteRef:[^src]",
      "FootnoteRef:[^1]",
      "FootnoteRef:[^src]",
      "FootnoteDefinition:[^1]: The second note,",
      "FootnoteLabel:[^1]:",
      "FootnoteDefinition:[^src]: The *first* note.",
      "FootnoteLabel:[^src]:",
      "FootnoteDefinition:[^unused]: Never referred to.",
      "FootnoteLabel:[^unused]:",
    ]);
    expect([...footnoteNumbers(md)]).toEqual([["src", 1], ["1", 2]]);
    expect(at(md, "^1]")).toEqual({ kind: "footnote", label: "1", note: false });
    expect(at(md, "^1]:")).toEqual({ kind: "footnote", label: "1", note: true });
  });

  it("export as Word footnotes", async () => {
    const zip = await JSZip.loadAsync(await Packer.toBuffer(buildDocument(md)));
    const body = await zip.file("word/document.xml")!.async("string");
    const notes = await zip.file("word/footnotes.xml")!.async("string");
    expect(body.match(/<w:footnoteReference w:id="(\d+)"\/>/g)).toEqual(['<w:footnoteReference w:id="1"/>', '<w:footnoteReference w:id="2"/>', '<w:footnoteReference w:id="1"/>']);
    expect(body).not.toContain("second note");
    expect(body).not.toContain("Never referred");
    expect(body).toContain("After.");
    expect(notes).toContain("The second note, on two lines.");
    expect(notes).toContain("first");
  });
});

describe("math", () => {
  const nodes = (md: string) => {
    const state = stateOf(md);
    const found: string[] = [];
    syntaxTree(state).iterate({ enter: (n) => void ((n.name === "InlineMath" || n.name === "BlockMath") && found.push(`${n.name}:${texOf(state.sliceDoc(n.from, n.to))}`)) });
    return found;
  };

  it("parses $...$ in text and $$ blocks, not prices", () => {
    expect(nodes("Area $\\pi r^2$ and $$E=mc^2$$ here.")).toEqual(["InlineMath:\\pi r^2", "InlineMath:E=mc^2"]);
    expect(nodes("It costs $5 and $10, or $ 3 $.")).toEqual([]);
    expect(nodes("A \\$5 bill, $x$.")).toEqual(["InlineMath:x"]);
    expect(nodes("Before\n\n$$\na + b\n= c\n$$\n\nAfter")).toEqual(["BlockMath:a + b\n= c"]);
    expect(nodes("$$ x^2 $$\n")).toEqual(["BlockMath:x^2"]);
  });

  it("exports as Word equations, typeset", async () => {
    const { xml } = await documentXml("Inline $\\pi r^2$ here.\n\n$$\n\\int_0^1 x\\,dx = \\frac{a}{b}\n$$\n\nCosts $5 and $10.\n");
    expect(xml.match(/<m:oMath>/g)).toHaveLength(2);
    expect(xml).toContain("<m:t>π</m:t>");
    expect(xml).toContain("<m:sSup>");
    expect(xml).toContain('<m:chr m:val="∫"/>');
    expect(xml).toContain("<m:f>");
    expect(xml).not.toContain("\\frac");
    expect(xml).toContain("Costs $5 and $10.");
  });
});

describe("docx blocks", () => {
  it("keeps strikethrough, quotes, code and nested lists", async () => {
    const md = "A ~~gone~~ word.\n\n> Quoted **text**.\n\n```js\nlet a = 1;\n  indented();\n```\n\n- One\n  - Inner\n    1. Deep\n- Two\n";
    const { xml } = await documentXml(md);
    expect(xml).toContain("<w:strike/>");
    expect(xml).not.toContain("~~");
    expect(xml).not.toContain("&gt; Quoted");
    expect(xml).toMatch(/<w:pBdr><w:left [^>]*\/><\/w:pBdr>.*Quoted/);
    expect(xml).not.toContain("```");
    expect(xml).toContain("let a = 1;");
    expect(xml).toContain('<w:t xml:space="preserve">  indented();</w:t>');
    const levels = [...xml.matchAll(/<w:ilvl w:val="(\d)"\/>/g)].map((m) => Number(m[1]));
    expect(levels).toEqual([0, 1, 2, 0]);
  });

  it("places an SVG with its PNG, or its description without one", async () => {
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 200"><rect width="400" height="200"/></svg>');
    expect(imageInfo(svg)).toEqual({ type: "svg", width: 400, height: 200 });
    const md = "![Chart](c.svg)\n";
    const zip = await JSZip.loadAsync(await Packer.toBuffer(buildDocument(md, undefined, new Map([["c.svg", svg]]), new Map([["c.svg", png(800, 400)]]))));
    expect(Object.keys(zip.files).filter((f) => f.startsWith("word/media/") && !f.endsWith("/"))).toHaveLength(2);
    expect((await documentXml(md, new Map([["c.svg", svg]]))).xml).toContain("[Chart]");
  });

  it("puts a space after a footnote's number", async () => {
    const zip = await JSZip.loadAsync(await Packer.toBuffer(buildDocument("Text.[^a]\n\n[^a]: The note.\n")));
    expect(await zip.file("word/footnotes.xml")!.async("string")).toMatch(/<w:footnoteRef\/><\/w:r><w:r>.*?<w:t xml:space="preserve"> <\/w:t>/);
  });
});

describe("tasks", () => {
  it("export as boxes in the accent color", async () => {
    const { xml } = await documentXml("- [ ] Open\n- [x] Done\n");
    expect(xml).toContain("☐</w:t><w:tab/>");
    expect(xml).toContain("☑</w:t><w:tab/>");
    expect(xml).not.toContain("<w:numPr>");
    expect(xml).not.toContain("[x]");
    const html = markdownToHtml("- [ ] Open\n- [x] Done\n");
    expect(html).toContain('<li class="task done"><span class="box" role="img" aria-label="done"></span>Done</li>');
    expect(html).toContain(`li.done .box { background: #${defaultStyle()["colors.accent"]}; }`);
  });
});

describe("HTML export", () => {
  const md = `---
title: The title
author: Jane
footer: Draft
---

# Report

## The subtitle

**Lead.** Text with [a link](https://example.com), [[Note#Part|a note]], \`code\` and $x^2$.[^n]

<!-- widths: 20 80 -->
| Item | Cost |
|---|---:|
| A | 1 |
| B | |
| **Total** | 3 |

![Chart](c.png)

A [bad](javascript:alert(1)) link.

[^n]: The note.
`;

  it("writes a standalone page in the style", () => {
    const html = markdownToHtml(md, { ...defaultStyle(), "colors.heading": "123456", "page.size": "a4" }, new Map([["c.png", png(10, 10)]]));
    expect(html).toContain("<title>The title</title>");
    expect(html).toContain('<meta name="author" content="Jane">');
    expect(html).toContain("size: A4;");
    expect(html).toContain("#123456");
    expect(html).toContain('content: "Draft"');
    expect(html).toContain('<p class="subtitle" id="the-subtitle">The subtitle</p>');
    expect(html).toContain('<strong class="lead">Lead.</strong>');
    expect(html).toContain('<a href="https://example.com">a link</a>');
    expect(html).toContain('<a class="wiki" href="Note.md#part">a note</a>');
    expect(html).toContain("<math");
    expect(html).toContain('<sup class="footnote-ref"><a href="#fn-1" id="fnref-1">1</a></sup>');
    expect(html).toContain('<li id="fn-1">The note.');
    expect(html).toContain('<col style="width:20.0%"><col style="width:80.0%">');
    expect(html).toContain('<tr class="even"><td>B</td><td style="text-align:right"></td></tr>');
    expect(html).toContain('<tr class="total">');
    expect(html).toContain('src="data:image/png;base64,');
    expect(html).toContain('href="#"');
    expect(html).not.toContain("javascript:");
    // Front matter and directives are not text.
    expect(html).not.toContain("author: Jane");
    expect(html).not.toContain("widths:");
  });
});
