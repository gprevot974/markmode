# md-editor

A markdown editor with Helix keybindings, live preview and export to styled `.docx`.

The idea: LLMs write markdown, people expect Word. Open the file an LLM is
working on, read it rendered, edit it the Helix way, and export a formatted
`.docx` when it goes to other humans.

- **Helix editing**: selection-first motions ported from helix-core, plus multiple
  cursors, text objects, surround, jump labels, registers and counts. Your
  `~/.config/helix/config.toml` applies: key remaps, theme and editor options
  (see [Helix config](#helix-config)).
- **Live preview**: markdown renders in place, images, footnotes and math
  (KaTeX) included. Lines holding a selection show their raw source, so every
  character stays reachable. Links and wiki-links open with `gf` (see
  [Links, images, footnotes and math](#links-images-footnotes-and-math)).
- **Made for working with agents**: when another program (an LLM agent, a script,
  git) changes the open file, its changes show inline, to accept or reject one by
  one (see [Reviewing outside changes](#reviewing-outside-changes)). Comments
  live in the file, where the agent reads them (see [Comments](#comments)), and
  every version is kept (see [Version history](#version-history)).
- **Safe with your files**: saves are atomic, encodings and line endings are
  kept as found, and unsaved changes survive a crash (see [Files](#files)).
- **Export**: `:export-docx` (or `space e`) writes `name.docx` next to `name.md`,
  in an export style: built in, your own or the project's, as TOML files you
  can edit here, with the document shown in it as you do (see [Export](#export)).

## Running

```bash
npm install
npm run tauri dev        # development, with hot reload
npm run tauri build      # builds release/bundle/macos/md-editor.app in your Cargo target dir
```

Open a file from the terminal with the built app (your `CARGO_TARGET_DIR` is
`~/Code/cargo-target`; without it the bundle lands in `src-tauri/target/`):

```bash
open -a ~/Code/cargo-target/release/bundle/macos/md-editor.app notes.md
```

Copy `md-editor.app` to `/Applications` to get "Open With → md-editor" in Finder.

`npm run dev` runs the editor alone in a browser, with an in-memory sample file.
That's useful when working on the editor itself.

Export without the app:

```bash
node scripts/build-docx.ts input.md [output.docx] [--style name]
```

## Commands

| Command | |
|---|---|
| `:w [path]`, `:wa`, `:wq`, `:wqa` | write the buffer, all buffers; and close |
| `:q`, `:q!`, `:qa`, `:qa!` | close the window (the last one closes the app), close the app |
| `:o [path]`, `:new` | open a file (a dialog when no path is given), new scratch buffer |
| `:vs [path]`, `:sp [path]`, `:vnew`, `:hnew` | open in a vertical / horizontal split |
| `:bc`, `:bco`, `:bca`, `:bn`, `:bp` | close buffer, others, all; next / previous buffer |
| `:reload`, `:reload-all` | take the version on disk |
| `:encoding [name]`, `:line-ending [lf\|crlf]` | show or change how the file is saved |
| `:accept-all-changes`, `:reject-all-changes`, `:reset-diff-change` | decide on outside changes under review |
| `:history` | earlier versions of the file (`space h`) |
| `:theme [name]` | show or change the theme |
| `:zoom [in\|out\|reset\|percent]` | text size |
| `:table-widths [widths\|reset]` | set the column widths of the table at the cursor (see [Export](#export)) |
| `:reflow [width]` | hard-wrap the selected lines, or the paragraph at the cursor, to `text-width` (80) |
| `:images-clean`, `:images-clean!` | list the images in `assets/` no markdown file uses; move them to the Trash |
| `:word-count` (`:wc`) | words, characters, footnote words and reading time, of the selection or the document |
| `:config-open`, `:config-open-helix` | open your settings (see [Settings](#settings)), your Helix config.toml |
| `:export-docx [path]` | export to Word |
| `:export-style [name\|reset]`, `:export-style-default [name]` | pick the document's export style; the one for documents naming none |
| `:export-style-new <name> [project]`, `:export-style-open [name]` | start an export style, edit one |
| `:export-preview`, `:export-help` | show documents in their export style; the export reference |
| `:<n>` | go to line *n* |

macOS shortcuts also work: ⌘S save, ⌘O open, ⌘⇧E export, ⌘= and ⌘- zoom in and
out, ⌘0 back to 100%. The zoom sizes the text and its column, not the
statusline, and is kept for the next start.

## Key bindings

Normal and select mode (`v`) follow Helix: `hjkl`, `w b e W B E`, `f t F T`, `A-.`,
`gg ge gh gl gs gt gc gb gw`, `x X`, `%`, `s S A-s`, `; A-; , A-,`, `C A-C`, `( )`,
`_`, `/ ? n N *`, `y p P R`, `d c A-d A-c`, `r ~ \` A-\``, `> <`, `J`, `u U`,
`mi ma mm ms mr md`, `zz zt zb zj zk`, `C-u C-d C-b C-f`, `[space ]space`,
`space y/p/P/R/e`, `]g [g ]G [G` (changes under review). Counts work (`3w`,
`5j`, `12G`). Additions for this editor: `space g` (deciding on changes),
`space c`, `space C`, `]c`, `[c` (comments), `space h` (version history) and
`gf` on links (Helix's goto file).

### Moving around prose

With soft wrap, a paragraph written as one line in the file shows as several
rows. Moves follow the rows and edits follow the file's lines, since rows
change with the window width:

- `j` `k` move a row up or down, and `gh` `gl` `gs` (and Home, End) go to the
  start, end and first non-blank of the row the cursor is on.
- `I` `A`, `x` `X`, `J`, `> <`, `C` and counts on `G` keep to the file's lines,
  so `A` appends at the end of the paragraph.
- `j` `k` step through a table line by line: each line renders as a row of
  the table, and only the line the cursor is on shows its source.
- `o` and `O` know markdown: in a paragraph or under a heading they start a new
  paragraph (with a blank line on each side); in a list item, a new item after
  it (after its continuation lines and sublists too); in code, tables and
  quotes, a line, as in Helix.

There are no line numbers in the margin; the statusline shows the cursor's
`line:column`. `gutters = ["line-numbers"]` in config.toml brings them back.
Beside it is the word count: the document's, or with a selection, "12 of
1,234 words". It counts what a reader sees, as the export does: markup, link
targets, front matter, comments, math and footnotes are left out (`:word-count`
gives the footnotes' words, characters and reading time).
To find your way in a long file:

- `space s` lists the headings of the file as an indented outline, to type a
  few letters of and jump to. A match keeps the headings it is under, dimmed,
  and each space-separated word may match one of them (`setup conf`).
  `space S` does the same for every markdown file in the workspace (where
  `space f` looks), each file with its headings under it.
- `space /` searches every file in the workspace for a regex as you type it,
  as Helix's global search does: smart case, hidden and git-ignored files left
  out, and unsaved buffers searched as they are here. Enter opens the file at
  the match, selected, and the pattern becomes the one `n` and `N` look for.
- The jumplist works as in Helix: `gg`, `ge`, `G`, searches, `n`/`N`, `gw`,
  `]g`/`[g`, `]c`/`[c`, the pickers and switching files are jumps; `C-o` goes
  back to where you jumped from and `C-i` (or Tab) forward again. `C-s` saves
  the current place, and `space j` lists the places. Each window has its own
  list, and the places move with the text as it is edited.

### Links, images, footnotes and math

- **Links**: `gf` (or Cmd-click) on a link opens what it points to: a markdown
  file here, at the heading its `#anchor` names (GitHub's anchors, or the
  heading's text); `#anchor` alone moves within the file; a web address, an
  image or a PDF opens in its own app. The bare path under the cursor works
  too, as in Helix. `C-o` comes back.
- **Wiki-links**: `[[note]]`, `[[note#Heading]]` and `[[note|shown text]]`
  show as links. `gf` finds the note by name anywhere under the workspace
  root, nearest first; a note not written yet opens as a new file beside the
  document. In insert mode, `C-x` after `[[` lists the notes, and after `](`
  the files, by path from the document.
- **Images**: `![description](path)` shows the image in its place, from a
  path relative to the document or a web address. On the cursor's line the
  source shows above it.
- **Pasting and dropping images**: ⌘V with an image on the clipboard (a
  screenshot, an image copied in another app) saves it in `assets/` next to
  the document and links it after the selection (at the cursor in insert
  mode). Dropping image files from Finder links them where they land: one
  from the document's folder, or a folder below it, is linked where it is;
  any other is copied into `assets/`. Pasted images are named by the time
  (`pasted-2026-10-22-143005.png`) and get an empty description to fill in;
  dropped ones keep their name, with spaces and the like made dashes and a
  number added when it is taken. `[images] folder` in your
  [settings](#settings) changes the folder (`""` for the document's own). The
  document needs to be saved first, so the image has somewhere to go. Other
  files dropped on the window open. While files are dragged over the window,
  a caret shows where the link will go and a label says what dropping does.
- **Unused images**: an image stays in `assets/` after its link is deleted, as
  undo, the version history and other documents may still need it.
  `:images-clean` lists the images in the document's `assets/` that no
  markdown file in the workspace mentions (open buffers count with their
  unsaved changes), and `:images-clean!` moves them to the Trash, where they
  can be put back from; a folder that would be left empty goes as a whole. An
  image counts as used when its file name appears anywhere in a markdown file,
  so one is never trashed by mistake; hidden and git-ignored files are not
  searched. A copy of each is kept for 90 days (in the app's data, next to the
  version history), and an image comes back to its folder on its own when a
  link to it does: a version picked in `:history`, an undo, an outside change.
- **Footnotes**: `[^label]` shows as the note's number (numbered in the order
  they are first referred to) with the note as a tooltip, and the note,
  `[^label]: text`, in smaller type. `gf` goes from one to the other.
- **Math**: `$x^2$` in a line and `$$ ... $$` blocks are typeset with KaTeX.
  A dollar followed by a space, or a closing one followed by a digit, is not
  math, so prices stay prices. TeX that does not parse shows underlined, with
  KaTeX's error as its tooltip.

The exports carry them over. In the docx, links keep their text (a web address stays a
link), images are placed at their size up to the page's width (an SVG with a
PNG copy, for programs that cannot show SVG), footnotes become Word footnotes,
and math becomes typeset Word equations. The web page keeps links as links,
holds its images, sets footnotes at the end and typesets math. Both read the
markdown with the editor's parser, so quotes, code blocks, strikethrough and
nested lists come through too; raw HTML is left out of the docx.

## Reviewing outside changes

When another program changes an open file that has no unsaved edits here, the
new text comes in and each change shows inline: added text is highlighted, the
text it replaced shows dimmed above it with the removed words struck out, and
a bar in the gutter marks each one. A paragraph with only a few words changed
shows them in place.
Then, as with Helix's diff gutter:

- `]g` / `[g` go to the next / previous change and select it, `]G` / `[G` to
  the last / first; the message line says "change 2 of 5".
- `space g a` accepts the changes under the selections (they stay and lose
  their highlight), `space g r` rejects them (the text from before comes back),
  `space g A` / `space g R` decide on all of them. The Accept and Reject buttons
  in the margin beside each change do the same, and so do `:accept-all-changes`,
  `:reject-all-changes` and Helix's `:reset-diff-change` (`:diffget`).
- `u` undoes the whole outside change at once.

What you type during a review is taken as it is: it does not show as a change.
A rejection changes the buffer, so `:w` writes it back for the agent to see. If
the other program writes again before the review is done (and the buffer has
no unsaved edits), its new changes join the review, still compared with the
text from before the first. The review
ends when no change is left. The diff compares lines first and then the words
within changed lines, so a change stays within its own paragraph.

The changes stay pending until you decide on them, even across restarts: on
opening, a file is reviewed against the text from before the changes still
pending, or else the text it had when last seen here. So changes another
program made while the app was closed are up for review too.

When the window is too narrow for the buttons in the margin, they get a row
above each change.

If you have unsaved edits when the file changes on disk, nothing is taken in:
the message line offers `:reload`, which takes the file and shows how it
differs from your edits, so you can reject the changes that undo yours.

## Comments

Comments are kept in the file as [CriticMarkup](https://fletcher.github.io/MultiMarkdown-6/syntax/critic.html),
so an agent working on the file reads them. The loop: leave notes, ask the
agent to "address the comments in draft.md", then review its changes.

- `space c` asks for a note. With text selected (`w`, `x`, `v`...), the note is
  about that text, which is highlighted: `{==this text==}{>>the note<<}`. With
  only the cursor, the note goes at the end of the line: `{>>the note<<}`.
- `]c` / `[c` select the next / previous comment, and `space C` removes the
  comments under the selections, keeping the highlighted text.
- Away from the cursor, the markup is hidden: notes read as asides after a ✎,
  highlighted text has a background. On the cursor's line the source shows.
- The docx export leaves comments out.

## Version history

Each time a file is opened, saved or changed by another program, its text is
kept as a version in `~/Library/Application Support/dev.gprevot.md-editor/history/`
(the latest 100 per file; text equal to the latest version is not kept twice).
`space h` (or `:history`) opens the versions, newest first, with a preview of
what changed since each one. Enter brings a version back as changes to review
against the current text: accept the ones you want back, reject the others,
`:w` to keep the result. `C-s` / `C-v` open it as a scratch buffer in a split
instead.

## Theme

The built-in theme is Kanagawa: wave when macOS is in dark mode, lotus when it
is light. `:theme light`, `:theme dark` or `:theme auto` switches, and the
choice is remembered.

Any Helix theme works too: `:theme gruvbox`. As in Helix, the theme shows as
you type or tab to its name, and Esc puts the previous one back. Completion
lists every theme found in `~/.config/helix/themes` and in the Helix
installation's runtime (Homebrew, Linux packages, a source checkout, or
`$HELIX_RUNTIME`). Its UI
colors and its `markup.*` scopes color the editor and the preview. The name
`kanagawa` means the built-in theme, which has a light half that Helix's lacks.

## Settings

Your settings are in `~/.config/md-editor/config.toml`
(`$XDG_CONFIG_HOME/md-editor` if set). `:config-open` opens it, writing every
setting, commented out, when there is none yet. It has the shape of Helix's
config.toml, and applies over it:

```toml
read-helix-config = true   # read ~/.config/helix/config.toml (below)
theme = "auto"             # or { light = "...", dark = "..." }, or a Helix theme

[editor]
spellcheck = true          # underline misspelled words
cursorline = true
gutters = []               # ["line-numbers"] for line numbers
soft-wrap = { enable = true }
text-width = 80            # where :reflow wraps
auto-save = { focus-lost = true }

[images]
folder = "assets"          # where pasted and dropped images go

[keys.normal]              # as in Helix; [keys.insert] too
ret = "goto_word"          # no remaps by default; this is an example

[export]
style = "default"          # see :export-style-default
```

Changes apply on the next start. A file that does not parse is reported at
startup, and the defaults are used. The project's `.md-editor/config.toml`
holds only `[export]` (see [Export](#export)).

## Helix config

At startup, `~/.config/helix/config.toml` is read (`$XDG_CONFIG_HOME/helix`
if set) and applied over the defaults in `src/config.ts`, and your
[settings](#settings) over it:

- `theme`, including `theme = { light = "...", dark = "..." }`, which follows
  the macOS appearance. A theme picked with `:theme` wins over it.
- `[editor]`: `cursorline`, `soft-wrap.enable`, `text-width`, `auto-save` (focus lost), and
  whether `gutters` has line numbers (off unless it lists `line-numbers`).
- `[keys.normal]` and `[keys.insert]`. A binding that uses a command this
  editor lacks is skipped whole (a sequence run halfway would do something
  else), and a message lists the skipped ones the first time, and again when
  the list changes. `[keys.select]` is ignored: select mode shares the normal
  mode bindings. `:config-open` lists them again; `:config-open-helix` opens
  the Helix config.toml.

Set `read-helix-config = false` in your settings to ignore it.

## Files

- **Atomic saves.** A save writes a temporary file next to the original and
  renames it over it, so a crash or a full disk never leaves half a file.
  Symbolic links stay links (the file they point to is replaced) and
  permissions are kept.
- **Encodings and line endings.** UTF-8 (with or without BOM), UTF-16 with a
  BOM, and anything else as Windows-1252 are read and written back the same
  way; files containing NUL bytes are refused as binary. `\r\n` files keep
  `\r\n`; a file mixing both gets the more common one. The statusline shows
  the encoding and line endings when they are not UTF-8 and `\n`.
  `:encoding` and `:line-ending` change them.
- **Crash recovery.** A second after you stop typing, each buffer with unsaved
  changes is copied to `~/Library/Application Support/dev.gprevot.md-editor/recovery/`.
  The copies go away on saving and on a clean exit. After a crash, the next
  start reopens them as modified buffers over the file as it is on disk: `:w`
  keeps the changes, `:reload` drops them, and `u` shows what they changed.

## Spelling

Misspelled words get a wavy underline, checked by the macOS spell checker, so
it uses the languages set in System Settings (with automatic detection) and the
words you taught it in other apps. Code, URLs and comments are skipped, and so
is the word you're typing. `]s` / `[s` jump to the next / previous misspelling;
`space a` lists suggestions at the cursor (a number picks one, `a` adds the word
to the dictionary, `i` ignores it until the app quits). Turn it off with
`spellcheck = false` under `[editor]` in your [settings](#settings).

## Buffers and windows

As in Helix, every file you open stays open as a buffer. `space f` opens the
file picker on the workspace, `space F` on the current file's folder, and `space b` the buffer
picker. The workspace is the nearest folder at or above the current file that
holds `.git` or `.helix`, or else the file's own folder; with no file open, the
folder the app was started in, or your home folder when started from the Finder.
`space S` and `space /` search the same place, which their title shows. In a picker, type to fuzzy-filter, Enter opens, `C-s` / `C-v` open in a
horizontal / vertical split. `ga` goes back to the last buffer, `gn` / `gp`
cycle through them.

`space w` or `C-w` is window mode: `v` / `s` split, `w` next window, `h j k l`
move between windows, `H J K L` swap them, `t` transposes, `q` closes, `o`
keeps only the current one, `n v` / `n s` split with a scratch buffer.

Closing the window, ⌘W or ⌘Q with unsaved buffers asks whether to save them.
`:q` and `:qa` refuse instead, like Helix; `:q!` discards. Windows
on the same buffer edit the same text, but undo is per window: `u` undoes the
edits made in that window.

Pressing `g`, `m`, `z`, `[`, `]`, `space`, `space g`, `C-w`, `mi` or `ma` shows Helix's which-key popup.
`:` completes command names, showing each one's doc; Tab and Shift-Tab cycle,
and `:o`, `:w` and `:export-docx` complete file paths: Enter on a folder lists
what is inside it, Enter on a file runs the command. `/`, `?`, `s` and `S`
preview their result as you type, and Esc restores the selection.

Insert mode keeps CodeMirror's editing (with the macOS Emacs keys) and adds
`C-w` and `C-u`, and `C-x`, which completes link targets after `[[` and
`](`, and keys and values in front matter and export styles (in normal mode
too, where Helix has decrement, which this editor lacks). Pressing Enter in a list continues it.

Files other than markdown (an export style, config.toml) open as plain text,
highlighted, without the preview.

Change bindings in your [settings](#settings) or your Helix config.toml. They use Helix's
command names; see `src/helix/keymap.ts` for the defaults and `src/helix/commands.ts`
for every command.

## Export

`:export-docx` writes a Word document, and `:export-html` a web page in the
same style: one file, images included, math as MathML. Printing the page from
a browser gives a PDF on the style's paper, with its margins and its footer and
page numbers, a second way to a PDF besides saving one from Word. Turn off
the browser's own headers and footers in its print dialog (Chrome: More
settings → Headers and footers; Safari: Print headers and footers): a page
cannot turn them off itself, and the browser remembers the choice. What both look like comes from an **export style**; what it says about itself (title, author, footer) comes from
the document's front matter. `:export-preview` shows each document as its
style looks, on a page of its width, and keeps up as you edit the document or
the style. `:export-help` opens this reference in the editor.

Your own styles live in `~/.config/md-editor/styles/`. `:export-style-new acme`
starts one from the document's current style, with every key written out and
commented. It opens beside the document, so with the preview on, each change
shows as you type it. `:export-style acme` uses it for the document, and
`:export-style-default acme` for every document that names none.

Column widths stay a directive, on the line above their table, since they
belong to it. The older `footer`, `author`, `description` and `no-subtitle`
directives still work, but front matter replaces them.

The README's copy of the reference is generated: after changing a key, run
`npm run docs` (a unit test fails until then).

<!-- export-reference -->

### Document properties

Front matter at the top of the file sets the document's properties. Other keys are left alone, for other tools.

```yaml
---
title: Project proposal
author: Jane Doe
footer: Commercially confidential
style: acme
---
```

| Key | What it sets |
| --- | --- |
| `title` | The document's title property; without it, the `#` heading's text |
| `subtitle` | false: the first `##` is a section, not a subtitle under the title |
| `author` | The document's author property |
| `description` | The document's description property (Comments, in Word) |
| `subject` | The document's subject property |
| `keywords` | The document's keywords property, separated by commas |
| `footer` | Footer text, left of the page number |
| `style` | The export style (:export-style picks one) |

A table's column widths are set by a directive on the line above it, `<!-- widths: 20 30 50 -->`. Dragging the column borders in the preview writes one, as does `:table-widths`.

### Export styles

An export style sets how the docx export looks. It's a TOML file named after the style, in one of these places, most specific first:

- `.md-editor/styles/` at the root of the project (the folder holding `.git`), to share it with the project
- `~/.config/md-editor/styles/`, for your own
- built in:

| Style | Looks |
| --- | --- |
| `default` | Slate headings and tables, blue accents |
| `plain` | Black and gray, no fills: for printing, or for restyling in Word |

A document uses the style named by `style:` in its front matter. Without one, it uses `[export] style` in the `config.toml` next to `styles/` (the project's first), and otherwise `default`.

| Command | What it does |
| --- | --- |
| `:export-docx` | Write the Word document, next to the file or to the path given |
| `:export-html` | Write a standalone web page in the same style, images included; print it from a browser for a PDF on the style's page |
| `:export-style` | Pick the document's style, seeing each in the window as you move through them, or name it (`reset` removes it) |
| `:export-style-default` | Show or set the style for documents without one, in `~/.config/md-editor/config.toml` |
| `:export-style-new <name>` | Start a style from the document's style, with every key commented out; `project` after the name puts it in the project |
| `:export-style-open` | Edit the style's file, here |
| `:export-preview` | Show the document as the style exports it: its fonts, colors and page width |
| `:export-help` | This reference |

Every key is optional. A style starts from the one named by `inherits` (`default` if it has none), and a style inheriting its own name extends the one it hides. In a style file or the front matter, `C-x` lists the keys and values that fit where the cursor is: in insert mode, for what is typed before it; in normal mode, for the line's value, or else its key.

```toml
inherits = "default"
description = "Our letterhead colors"

[colors]
heading = "#203864"
accent = "#DE5220"

[rules]
table-bands = false
```

#### [page]

Paper and margins.

| Key | Default | What it sets |
| --- | --- | --- |
| `size` | `"letter"` | Paper size (letter, a4) |
| `margin-top` | `0.85` | Top margin, in inches |
| `margin-bottom` | `0.8` | Bottom margin, in inches |
| `margin-left` | `0.75` | Left margin, in inches |
| `margin-right` | `0.75` | Right margin, in inches |

#### [fonts]

Font families; a font missing on the reader's computer falls back to one Word picks.

| Key | Default | What it sets |
| --- | --- | --- |
| `body` | `"Calibri"` | Paragraphs, lists and tables |
| `headings` | `"Calibri"` | The title, subtitle and headings |
| `code` | `"Consolas"` | `Inline code` |

#### [sizes]

Font sizes, in points.

| Key | Default | What it sets |
| --- | --- | --- |
| `body` | `10.5` | Paragraphs and lists |
| `title` | `23` | The `#` title |
| `subtitle` | `13` | The subtitle (see rules.subtitle) |
| `heading` | `13.5` | `##` headings |
| `subheading` | `11.5` | `###` headings and below |
| `table` | `9.5` | Table text |
| `metadata` | `10` | Metadata blocks (see rules.metadata-blocks) |
| `footnote` | `8.5` | Footnotes |
| `footer` | `8` | The footer |

#### [colors]

Colors, as "#RRGGBB".

| Key | Default | What it sets |
| --- | --- | --- |
| `text` | `"#1F2328"` | Body text, and bold in the middle of a sentence |
| `title` | `"#1E293B"` | The `#` title |
| `subtitle` | `"#475569"` | The subtitle |
| `subtitle-rule` | `"#2563EB"` | The line under the subtitle |
| `heading` | `"#1E293B"` | `##` headings |
| `subheading` | `"#475569"` | `###` headings and below |
| `label` | `"#1E293B"` | Bold opening a paragraph, list item or table row (see rules.bold-labels) |
| `accent` | `"#2563EB"` | Bullets and list numbers |
| `muted` | `"#64748B"` | Metadata blocks and the footer |
| `rule` | `"#CBD5E1"` | Lines under headings, table borders and the line over the footer |
| `table-header` | `"#1E293B"` | Background of a table's header row |
| `table-header-text` | `"#FFFFFF"` | Text of a table's header row |
| `table-band` | `"#F1F5F9"` | Background of every other body row (see rules.table-bands) |
| `table-total` | `"#E2E8F0"` | Background of total rows (see rules.total-rows) |
| `table-total-text` | `"#1E293B"` | Text of total rows |

#### [rules]

How markdown turns into styled Word elements.

| Key | Default | What it sets |
| --- | --- | --- |
| `subtitle` | `true` | The first `##` after the title is a subtitle under it, not a section. A document turns it off with `subtitle: false` in its front matter |
| `bold-labels` | `true` | Bold opening a paragraph, list item or table row is a label, in colors.label; bold elsewhere stays colors.text |
| `metadata-blocks` | `true` | A paragraph whose every line is `**Label:** value` keeps its lines, smaller and in colors.muted |
| `total-rows` | `"Total"` | Table rows holding bold text that starts with this word are total rows; empty for none |
| `table-bands` | `true` | Every other body row of a table gets colors.table-band |
| `heading-rules` | `true` | A line under `##` headings, in colors.rule |

<!-- /export-reference -->

## Layout

```
src/helix/        modal editing: state, motions, text objects, commands, keymap, dispatcher
src/review.ts     reviewing outside changes inline (with the prose diff of src/diff.ts)
src/comments.ts   comments in CriticMarkup (parsing in src/criticmarkup.ts)
src/history.ts    the version history picker
src/outline.ts    headings, for the heading pickers
src/search.ts     space /: global search (the files on disk are searched by src-tauri/src/search.rs)
src/links.ts      following links and wiki-links (gf)
src/images.ts     images: paths, loading, sizes
src/imageInput.ts pasting and dropping images: file names and links
src/jumplist.ts   the jumplist (C-o, C-i)
src/reflow.ts     :reflow
src/wordCount.ts  word counts: the text a reader sees
src/frontmatter.ts  front matter: the document's properties
src/directives.ts directives: table widths (and the older footer, author...)
src/preview/      live preview decorations, table rendering, and the syntax added to markdown:
                  front matter, wiki-links, footnotes, math (math.ts, with KaTeX)
src/export/       markdown → docx and → html, export styles (style.ts: every key), their files and reference
src/theme/        Kanagawa, Helix themes, light and dark
src/settings.ts   your settings: ~/.config/md-editor/config.toml, and its template
src/helixConfig.ts  reading ~/.config/helix/config.toml
src/fileformat.ts line endings and encodings
src/backend.ts    files, dialogs, clipboard (Tauri, or an in-memory stand-in in a browser)
src-tauri/        the Rust shell: file I/O, the file watcher, crash recovery, version history, spelling
tests/            unit tests (vitest), and tests/e2e: the editor in Chrome
scripts/          the command-line export; docs.ts writes the export reference into this README
docs/             the roadmap
```

## Tests

```bash
npm test                          # unit tests, then the browser tests
npm run test:e2e -- spelling      # browser suites whose name matches
cargo test --manifest-path src-tauri/Cargo.toml
```

The unit tests cover the ported Helix motions and text objects, the docx
output, export styles, front matter, line endings, Helix themes and config, the prose diff, CriticMarkup,
the history preview, reflow, headings, the jumplist, global search, links,
images, footnotes, math and the HTML export. The browser tests run the
editor in Chrome against the in-memory backend with real key presses: live
preview, windows, buffers, pickers, spelling, themes, line endings, crash
recovery (a page reload stands in for a restart), reviewing outside changes
(across two windows too), comments, version history, zoom, moving by rows,
`o`/`O`, the heading pickers, the jumplist, export styles and the export
preview, the HTML export, global search, following links, images, footnotes, math, and a
120,000-line file, with timings. They use the installed Chrome, or
`CHROME_PATH`. The Rust tests cover encodings, atomic writes, the version
history and global search. CI runs all three on macOS.
