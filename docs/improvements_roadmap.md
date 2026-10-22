# Improvements roadmap

Ideas for taking Markmode from a personal tool to something other people
would choose. The ordering reflects priority: the first section is what would
make the app distinctive, the next ones are what people need before they trust
it, and the rest widens its reach.

## 1. Make the LLM workflow the main feature

*Done: see "Reviewing outside changes", "Comments" and "Version history" in
the README. The keys differ from the first idea: `space y` is Helix's yank to
clipboard, so changes are decided with `space g a` / `space g r`, and `]g` /
`[g` move between them, as between diff hunks in Helix: `g` for both. `]c` / `[c` move
between comments.*

The app does not need its own chat client. People already run Claude Code,
Codex, Aider and similar tools against files on disk, and the editor already
watches open files and detects conflicts. The useful step is making those
outside edits easy to review.

- **Outside changes as inline diffs.** When a file changes on disk, highlight
  inserted and deleted text over the rendered preview instead of reloading
  silently. Accept or reject each change with Helix-style keys, for example
  `]c`/`[c` to move between changes and `space y`/`space n` to accept or
  reject.
- **Comments that agents can read.** Store margin comments in the file itself,
  for example as CriticMarkup (`{>> ... <<}`) or HTML comments. Highlight them
  while editing and hide them in the preview. The loop becomes: leave notes,
  tell the agent "address the comments in draft.md", review its edits as
  diffs. Obsidian, Typora and iA Writer don't offer this.
- **Version history per file.** Keep local snapshots on each save and each
  outside change, with a picker that previews the diff against the current
  text. People only let an agent touch their writing when they can always go
  back.

## 2. Make it safe to trust with files

*Done: see "Files" and "Tests" in the README.*

People forgive missing features; they don't forgive losing text.

- Atomic writes: write to a temporary file in the same directory, then rename
  it over the original.
- A crash-recovery swap file for buffers with unsaved changes, offered back on
  the next start.
- Preserve line endings, encoding and the trailing newline exactly as found.
- Test with large files.
- Keep the headless browser checks in the repo, run them with `npm test`, and
  run them in CI.

## 3. Use the Helix ecosystem

*Done: see "Theme" and "Helix config" in the README.*

- Read the user's `~/.config/helix/config.toml` for key remaps.
- Load Helix theme TOML files, so the hundreds of existing Helix themes work.

The pitch becomes "your Helix setup, for prose."

## 4. Fill the main markdown gaps

*Done: see "Moving around prose", "Links, images, footnotes and math" and
"Export" in the README. Instead of pandoc, `:export-html` writes a page in the
export style, which prints to PDF from a browser. Links open with `gf` and
Cmd-click but not Enter, which Helix configs often remap (`goto_word` here).
In the docx, equations are typeset Word equations.*

Roughly in order of value:

- `space /` global search with ripgrep.
- `space s` heading/outline picker.
- `gf` or Enter on a link to open a linked `.md` file; wiki-links.
- Images rendered inline.
- Front matter, footnotes and math (KaTeX).
- PDF and HTML export through pandoc, next to the existing docx export.

## 5. Distribution

*Partly done: the `.md` file associations and "Open With" work.*

- Sign and notarize the macOS build; automatic updates with
  `tauri-plugin-updater`.
- Build a `.dmg`: `bundle.targets` is `["app"]` only, and both the download
  page and a Homebrew cask need a disk image.
- A Homebrew cask.
- A CLI launcher (`mde notes.md`) so it fits terminal habits.
- Ship macOS-only at first and say so: spell-check is stubbed on Linux and
  Windows, and paths and appearance handling are macOS-flavored too (see
  section 8 for the cross-platform plan).
- A LICENSE file, and a privacy note: the preview loads remote images, so
  opening a file can make network requests.

## 6. Onboarding

Modal editing loses most new users within five minutes.

- A searchable command palette, so features can be found without memorizing
  keys. It comes first: it gives every typable command a place where people can
  find it, and the tutor can point to it.
- A `:tutor` document, as Helix has.
- A visible hint on first launch ("you're in NOR mode, press `i` to type").
- A README with a GIF and a short page explaining what makes the app
  different.

## 7. Gaps before a first release

*Settings and images done: see "Settings" and "Links, images, footnotes and
math" in the README. The settings apply over the Helix config rather than
under it, since they are this editor's own; `read-helix-config = false` turns
the Helix one off.*

- **Settings users can edit.** Spell-check, theme, `readHelixConfig`, text
  width and autosave live in `src/config.ts`, so they are fixed at build time.
  Read them from `~/.config/markmode/config.toml`, which already holds
  `[export]`.
- **Paste and drop images.** Save a pasted or dropped image next to the
  document (in `assets/`) and insert the link, as Typora and Obsidian do.
- **Non-markdown files.** Keep the file picker listing every file and opening
  any text file, as Helix does: users edit `config.toml`, export styles and
  the odd JSON file here, already highlighted. No form view for the TOML
  settings; the commented template `:config-open` writes serves this audience
  better. Still to do: open images and PDFs chosen in the picker with the
  system's app (`open_external`) instead of refusing them as binary.
- **Apply settings without a restart**, as Helix's `:config-reload` does. The
  editor states are built from the settings, so this means rebuilding them
  while keeping each buffer's text, selection and undo history.

## 8. After the first release

- **Mermaid diagrams.** LLMs write Mermaid all the time, so it fits the
  pitch.
  - Preview: render ` ```mermaid ` blocks as an SVG widget, like math, with
    the source shown while the cursor is inside. Load the library with a
    dynamic `import()` only when a diagram appears: it is several MB.
  - HTML export: inline the SVG.
  - docx export, the hard part: Word needs a raster image (or SVG with a PNG
    fallback). Render with `htmlLabels: false`, so the SVG can be drawn to a
    canvas, and embed the PNG.
- **Spell-check on Linux and Windows.** Keep the macOS checker: it follows the
  system languages, detects them automatically and shares the words taught in
  other apps. Add a second backend behind the same three commands:
  - spellbook, the Helix project's pure-Rust, Hunspell-compatible checker,
    which avoids building the C Hunspell library (painful on Windows).
  - On Linux, the dictionaries already installed in `/usr/share/hunspell`.
  - On Windows, bundled dictionaries (licenses vary by language) or the
    Windows spell-checking API.
