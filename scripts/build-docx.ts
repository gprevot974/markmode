// Command-line export, same output as `:export-docx` in the editor:
//
//   node scripts/build-docx.ts input.md [output.docx] [--style name]
//
// The output defaults to the input path with a .docx extension. The style
// is found as in the editor (src/export/styles.ts): --style, else the
// document's front matter, else config.toml, else "default".

import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { Packer } from "docx";
import { buildDocument } from "../src/export/docx.ts";
import { configuredStyle, resolveStyle, type StyleFs } from "../src/export/styles.ts";
import { frontMatter } from "../src/frontmatter.ts";

const args = process.argv.slice(2);
const flag = args.indexOf("--style");
const styleArg = flag === -1 ? null : args.splice(flag, 2)[1];
const [input, output = input?.replace(/\.(md|markdown)$/i, "") + ".docx"] = args;
if (!input || (flag !== -1 && !styleArg)) {
  console.error("usage: node scripts/build-docx.ts input.md [output.docx] [--style name]");
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

const buf = await Packer.toBuffer(buildDocument(markdown, style));
writeFileSync(output, buf);
console.log(`wrote ${output} (${(buf.length / 1024).toFixed(0)} KB) in the ${name} style`);
