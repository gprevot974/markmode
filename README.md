# md-editor

A markdown editor with Helix keybindings, live preview and export to styled `.docx`.

The idea: LLMs write markdown, people expect Word. Open the file an LLM is
working on, read it rendered, edit it the Helix way, and export a formatted
`.docx` when it goes to other humans.

- **Helix editing**: selection-first motions ported from helix-core, plus multiple
  cursors, text objects, surround, jump labels, registers and counts. Your
  `~/.config/helix/config.toml` applies: key remaps, theme and editor options
  (see [Helix config](#helix-config)).
- **Live preview**: markdown renders in place. Lines holding a selection show their
  raw source, so every character stays reachable.
- **Made for working with agents**: when another program (an LLM agent, a script,
  git) changes the open file, its changes show inline, to accept or reject one by
  one (see [Reviewing outside changes](#reviewing-outside-changes)). Comments
  live in the file, where the agent reads them (see [Comments](#comments)), and
  every version is kept (see [Version history](#version-history)).
- **Safe with your files**: saves are atomic, encodings and line endings are
  kept as found, and unsaved changes survive a crash (see [Files](#files)).
- **Export**: `:export-docx` (or `space e`) writes `name.docx` next to `name.md`,
  styled by the same code as the old `build-docx.js`.

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
node scripts/build-docx.ts input.md [output.docx]
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
| `:reflow [width]` | hard-wrap the selected lines, or the paragraph at the cursor, to `text-width` (80) |
| `:config-open` | open your Helix config.toml |
| `:export-docx [path]` | export to Word |
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
`5j`, `12G`). Additions for this editor: `space d` (deciding on changes),
`space c`, `space C`, `]c`, `[c` (comments) and `space h` (version history).

## Reviewing outside changes

When another program changes an open file that has no unsaved edits here, the
new text comes in and each change shows inline: added text is highlighted, the
text it replaced shows dimmed above it with the removed words struck out, and
a bar in the gutter marks each one. A paragraph with only a few words changed
shows them in place.
Then, as with Helix's diff gutter:

- `]g` / `[g` go to the next / previous change and select it, `]G` / `[G` to
  the last / first; the message line says "change 2 of 5".
- `space d a` accepts the changes under the selections (they stay and lose
  their highlight), `space d r` rejects them (the text from before comes back),
  `space d A` / `space d R` decide on all of them. The Accept and Reject buttons
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

## Helix config

At startup, `~/.config/helix/config.toml` is read (`$XDG_CONFIG_HOME/helix`
if set) and applied over the defaults in `src/config.ts`:

- `theme`, including `theme = { light = "...", dark = "..." }`, which follows
  the macOS appearance. A theme picked with `:theme` wins over it.
- `[editor]`: `cursorline`, `soft-wrap.enable`, `text-width`, `auto-save` (focus lost), and
  whether `gutters` has line numbers.
- `[keys.normal]` and `[keys.insert]`. A binding that uses a command this
  editor lacks is skipped whole (a sequence run halfway would do something
  else), and a message lists the skipped ones the first time, and again when
  the list changes. `[keys.select]` is ignored: select mode shares the normal
  mode bindings. `:config-open` opens config.toml and lists them again.

Set `readHelixConfig: false` in `src/config.ts` to ignore it.

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
`spellcheck` in `src/config.ts`.

## Buffers and windows

As in Helix, every file you open stays open as a buffer. `space f` opens the
file picker on the workspace (the nearest folder above the current file that
holds `.git`), `space F` on the current file's folder, and `space b` the buffer
picker. In a picker, type to fuzzy-filter, Enter opens, `C-s` / `C-v` open in a
horizontal / vertical split. `ga` goes back to the last buffer, `gn` / `gp`
cycle through them.

`space w` or `C-w` is window mode: `v` / `s` split, `w` next window, `h j k l`
move between windows, `H J K L` swap them, `t` transposes, `q` closes, `o`
keeps only the current one, `n v` / `n s` split with a scratch buffer.

Closing the window, ⌘W or ⌘Q with unsaved buffers asks whether to save them.
`:q` and `:qa` refuse instead, like Helix; `:q!` discards. Windows
on the same buffer edit the same text, but undo is per window: `u` undoes the
edits made in that window.

Pressing `g`, `m`, `z`, `[`, `]`, `space`, `space d`, `C-w`, `mi` or `ma` shows Helix's which-key popup.
`:` completes command names, showing each one's doc; Tab and Shift-Tab cycle,
and `:o`, `:w` and `:export-docx` complete file paths: Enter on a folder lists
what is inside it, Enter on a file runs the command. `/`, `?`, `s` and `S`
preview their result as you type, and Esc restores the selection.

Insert mode keeps CodeMirror's editing (with the macOS Emacs keys) and adds
`C-w`, `C-u` and `jk`. Pressing Enter in a list continues it.

Change bindings in your Helix config.toml, or in `src/config.ts`. It uses config.toml's shape and Helix's
command names; see `src/helix/keymap.ts` for the defaults and `src/helix/commands.ts`
for every command.

## Docx directives

Single-line HTML comments in the markdown control the export:

```markdown
<!-- footer: Commercially confidential -->
<!-- author: Your Name -->
<!-- description: Project proposal -->
<!-- no-subtitle -->
```

By default the first `##` after the `#` title is styled as a subtitle;
`no-subtitle` turns that off. Bold text that opens a paragraph, list item or table
row is colored as a label. A table row starting with `**Total` gets the total-row
style.

## Layout

```
src/helix/        modal editing: state, motions, text objects, commands, keymap, dispatcher
src/review.ts     reviewing outside changes inline (with the prose diff of src/diff.ts)
src/comments.ts   comments in CriticMarkup (parsing in src/criticmarkup.ts)
src/history.ts    the version history picker
src/preview/      live preview decorations and table rendering
src/export/       markdown → docx
src/theme/        Kanagawa, Helix themes, light and dark
src/helixConfig.ts  reading ~/.config/helix/config.toml
src/fileformat.ts line endings and encodings
src/backend.ts    files, dialogs, clipboard (Tauri, or an in-memory stand-in in a browser)
src-tauri/        the Rust shell: file I/O, the file watcher, crash recovery, version history, spelling
tests/            unit tests (vitest), and tests/e2e: the editor in Chrome
docs/             the roadmap
```

## Tests

```bash
npm test                          # unit tests, then the browser tests
npm run test:e2e -- spelling      # browser suites whose name matches
cargo test --manifest-path src-tauri/Cargo.toml
```

The unit tests cover the ported Helix motions and text objects, the docx
output, line endings, Helix themes and config, the prose diff, CriticMarkup
and the history preview. The browser tests run the
editor in Chrome against the in-memory backend with real key presses: live
preview, windows, buffers, pickers, spelling, themes, line endings, crash
recovery (a page reload stands in for a restart), reviewing outside changes
(across two windows too), comments, version history, zoom, and a
120,000-line file, with timings. They use the installed Chrome, or
`CHROME_PATH`. The Rust tests cover encodings, atomic writes and the version
history. CI runs all three on macOS.
