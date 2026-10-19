import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { Packer } from "docx";
import JSZip from "jszip";
import { buildDocument } from "../src/export/docx.ts";

const sample = readFileSync(new URL("../examples/sample.md", import.meta.url), "utf8");

async function documentXml(md: string): Promise<string> {
  const buf = await Packer.toBuffer(buildDocument(md));
  const zip = await JSZip.loadAsync(buf);
  return zip.file("word/document.xml")!.async("string");
}

describe("docx export", () => {
  it("renders headings, emphasis, lists and tables from the sample", async () => {
    const xml = await documentXml(sample);
    expect(xml).toContain("Markdown Editor Sample");
    expect(xml).toContain("<w:tbl>");
    expect(xml).toContain("$25,000");
    // Markdown syntax does not leak into the document.
    expect(xml).not.toContain("**");
    expect(xml).not.toContain("<!--");
  });

  it("uses the footer and author directives", async () => {
    const buf = await Packer.toBuffer(buildDocument(sample));
    const zip = await JSZip.loadAsync(buf);
    const footer = await zip.file("word/footer1.xml")!.async("string");
    const core = await zip.file("docProps/core.xml")!.async("string");
    expect(footer).toContain("Draft for discussion");
    expect(core).toContain("md-editor");
  });
});
