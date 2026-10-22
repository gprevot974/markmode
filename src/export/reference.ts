// The export reference, as markdown: what `:export-help` opens and the
// README's "Export styles" section holds (`npm run docs` writes it there).
// It comes from the same lists the export reads, so it cannot drift.

import { PROPERTIES } from "../frontmatter.ts";
import { BUILT_IN, styleReference } from "./style.ts";

/** `depth`: the level of its top headings. */
export function exportReference(depth = 2): string {
  const properties = PROPERTIES.map((p) => `| \`${p.key}\` | ${p.doc} |`);
  const builtIn = Object.entries(BUILT_IN).map(([name, { doc }]) => `| \`${name}\` | ${doc} |`);
  return [
    "## Document properties",
    "",
    "Front matter at the top of the file sets the document's properties. Other keys are left alone, for other tools.",
    "",
    "```yaml",
    "---",
    "title: Project proposal",
    "author: Jane Doe",
    "footer: Commercially confidential",
    "style: acme",
    "---",
    "```",
    "",
    "| Key | What it sets |",
    "| --- | --- |",
    ...properties,
    "",
    "A table's column widths are set by a directive on the line above it, `<!-- widths: 20 30 50 -->`. Dragging the column borders in the preview writes one, as does `:table-widths`.",
    "",
    "## Export styles",
    "",
    "An export style sets how the docx export looks. It's a TOML file named after the style, in one of these places, most specific first:",
    "",
    "- `.markmode/styles/` at the root of the project (the folder holding `.git`), to share it with the project",
    "- `~/.config/markmode/styles/`, for your own",
    "- built in:",
    "",
    "| Style | Looks |",
    "| --- | --- |",
    ...builtIn,
    "",
    "A document uses the style named by `style:` in its front matter. Without one, it uses `[export] style` in the `config.toml` next to `styles/` (the project's first), and otherwise `default`.",
    "",
    "| Command | What it does |",
    "| --- | --- |",
    "| `:export-docx` | Write the Word document, next to the file or to the path given |",
    "| `:export-html` | Write a standalone web page in the same style, images included; print it from a browser for a PDF on the style's page |",
    "| `:export-style` | Pick the document's style, seeing each in the window as you move through them, or name it (`reset` removes it) |",
    "| `:export-style-default` | Show or set the style for documents without one, in `~/.config/markmode/config.toml` |",
    "| `:export-style-new <name>` | Start a style from the document's style, with every key commented out; `project` after the name puts it in the project |",
    "| `:export-style-open` | Edit the style's file, here |",
    "| `:export-preview` | Show the document as the style exports it: its fonts, colors and page width |",
    "| `:export-help` | This reference |",
    "",
    "Every key is optional. A style starts from the one named by `inherits` (`default` if it has none), and a style inheriting its own name extends the one it hides. In a style file or the front matter, `C-x` lists the keys and values that fit where the cursor is: in insert mode, for what is typed before it; in normal mode, for the line's value, or else its key.",
    "",
    "```toml",
    'inherits = "default"',
    'description = "Our letterhead colors"',
    "",
    "[colors]",
    'heading = "#203864"',
    'accent = "#DE5220"',
    "",
    "[rules]",
    "table-bands = false",
    "```",
    "",
    styleReference(),
  ]
    .join("\n")
    .replace(/^(#+) /gm, (_, marks: string) => `${"#".repeat(marks.length + depth - 2)} `);
}
