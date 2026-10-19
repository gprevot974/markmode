# md-editor

A markdown editor with Helix keybindings, live preview and export to styled `.docx`.

The idea: LLMs write markdown, people expect Word. Open the file an LLM is
working on, read it rendered, edit it the Helix way, and export a formatted
`.docx` when it goes to other humans.

- **Helix editing**: selection-first motions ported from helix-core, plus multiple
  cursors, text objects, surround, jump labels, registers and counts. Bindings come
  from your `~/.config/helix/config.toml` (`jk` to leave insert mode, Enter for
  `goto_word`).
- **Live preview**: markdown renders in place. Lines holding a selection show their
  raw source, so every character stays reachable.
- **Collaboration-friendly**: when another program (an LLM, a script, git) changes
  the open file, it reloads in place, and `u` undoes the outside change. If you have
  unsaved edits, it warns instead of overwriting them.
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
| `:export-docx [path]` | export to Word |
| `:<n>` | go to line *n* |

macOS shortcuts also work: ⌘S save, ⌘O open, ⌘⇧E export.

## Key bindings

Normal and select mode (`v`) follow Helix: `hjkl`, `w b e W B E`, `f t F T`, `A-.`,
`gg ge gh gl gs gt gc gb gw`, `x X`, `%`, `s S A-s`, `; A-; , A-,`, `C A-C`, `( )`,
`_`, `/ ? n N *`, `y p P R`, `d c A-d A-c`, `r ~ \` A-\``, `> <`, `J`, `u U`,
`mi ma mm ms mr md`, `zz zt zb zj zk`, `C-u C-d C-b C-f`, `[space ]space`,
`space y/p/P/R/e`. Counts work (`3w`, `5j`, `12G`).

## Theme

Kanagawa, as in your Helix config: wave when macOS is in dark mode, lotus when
it is light. `:theme light`, `:theme dark` or `:theme auto` switches, and the
choice is remembered; the default is `theme` in `src/config.ts`.

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

Pressing `g`, `m`, `z`, `space`, `C-w`, `mi` or `ma` shows Helix's which-key popup.
`:` completes command names, showing each one's doc; Tab and Shift-Tab cycle,
and `:o`, `:w` and `:export-docx` complete file paths. `/`, `?`, `s` and `S`
preview their result as you type, and Esc restores the selection.

Insert mode keeps CodeMirror's editing (with the macOS Emacs keys) and adds
`C-w`, `C-u` and `jk`. Pressing Enter in a list continues it.

Change bindings in `src/config.ts`. It uses config.toml's shape and Helix's
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
src/preview/      live preview decorations and table rendering
src/export/       markdown → docx
src/theme/        Kanagawa
src/backend.ts    files, dialogs, clipboard (Tauri, or an in-memory stand-in in a browser)
src-tauri/        the Rust shell: file I/O and the file watcher
```

## Tests

```bash
npm test
```

Covers the ported Helix motions and text objects, and checks the docx output.
