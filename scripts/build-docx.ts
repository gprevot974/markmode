// Command-line export, same output as `:export-docx` in the editor:
//
//   node scripts/build-docx.ts input.md [output.docx]
//
// The output defaults to the input path with a .docx extension.

import { readFileSync, writeFileSync } from "node:fs";
import { Packer } from "docx";
import { buildDocument } from "../src/export/docx.ts";

const [input, output = input?.replace(/\.(md|markdown)$/i, "") + ".docx"] = process.argv.slice(2);
if (!input) {
  console.error("usage: node scripts/build-docx.ts input.md [output.docx]");
  process.exit(1);
}

const buf = await Packer.toBuffer(buildDocument(readFileSync(input, "utf8")));
writeFileSync(output, buf);
console.log(`wrote ${output} (${(buf.length / 1024).toFixed(0)} KB)`);
