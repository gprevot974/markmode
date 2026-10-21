// Command-line export, same output as `:export-docx` and `:export-html` in
// the editor:
//
//   node scripts/build-docx.ts input.md [output.docx | output.html] [--style name]
//
// The output defaults to the input path with a .docx extension; one ending in
// .html is a web page. The style is found as in the editor
// (src/export/styles.ts): --style, else the document's front matter, else
// config.toml, else "default". Without a browser to draw their PNG copies,
// SVG images show in the docx as their description (the editor places them).

import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { Packer } from "docx";
import { buildDocument } from "../src/export/docx.ts";
import { markdownToHtml } from "../src/export/html.ts";
import { configuredStyle, resolveStyle, type StyleFs } from "../src/export/styles.ts";
import { frontMatter } from "../src/frontmatter.ts";
import { loadImages } from "../src/images.ts";

const args = process.argv.slice(2);
const flag = args.indexOf("--style");
const styleArg = flag === -1 ? null : args.splice(flag, 2)[1];
const [input, output = input?.replace(/\.(md|markdown)$/i, "") + ".docx"] = args;
if (!input || (flag !== -1 && !styleArg)) {
  console.error("usage: node scripts/build-docx.ts input.md [output.docx | output.html] [--style name]");
  process.exit(1);
}

const fs: StyleFs = {
  read: async (path) => (existsSync(path) ? readFileSync(path, "utf8") : null),
  list: async (dir) => (existsSync(dir) ? readdirSync(dir) : []),
};
// The project is the nearest directory above the file holding .git or .helix, as in the editor.
let root = dirname(resolve(input));
while (!existsSync(join(root, ".git")) && !existsSync(join(root, ".helix")) && dirname(root) !== root) root = dirname(root);
if (!existsSync(join(root, ".git")) && !existsSync(join(root, ".helix"))) root = dirname(resolve(input));
const dirs = {
  project: join(root, ".md-editor"),
  user: join(process.env.XDG_CONFIG_HOME || join(homedir(), ".config"), "md-editor"),
};

const markdown = readFileSync(input, "utf8");
const named = frontMatter(markdown)?.fields.style;
const name = styleArg ?? (typeof named === "string" && named ? named : await configuredStyle(fs, dirs));
const { style, errors, found } = await resolveStyle(name, fs, dirs);
if (!found) {
  console.error(`no export style named ${name}`);
  process.exit(1);
}
for (const e of errors) console.error(`skipping: ${e}`);

const images = await loadImages(markdown, resolve(input), async (path) => readFileSync(path));
const buf = /\.html?$/i.test(output) ? Buffer.from(markdownToHtml(markdown, style, images)) : await Packer.toBuffer(buildDocument(markdown, style, images));
writeFileSync(output, buf);
console.log(`wrote ${output} (${(buf.length / 1024).toFixed(0)} KB) in the ${name} style`);
