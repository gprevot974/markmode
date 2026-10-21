// Writes the export reference (src/export/reference.ts) into the README,
// between its export-reference markers:
//
//   npm run docs

import { readFileSync, writeFileSync } from "node:fs";
import { exportReference } from "../src/export/reference.ts";

const path = new URL("../README.md", import.meta.url);
const readme = readFileSync(path, "utf8");
const block = /(<!-- export-reference -->\n)[\s\S]*?(<!-- \/export-reference -->)/;
if (!block.test(readme)) throw new Error("README.md: no export-reference markers");
writeFileSync(path, readme.replace(block, (_, open, close) => `${open}\n${exportReference(3)}\n${close}`));
console.log("wrote the export reference into README.md");
