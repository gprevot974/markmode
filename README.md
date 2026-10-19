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
| `:w [path]`, `:wq`, `:q`, `:q!` | write, write and close, close |
| `:o [path]`, `:new` | open (a dialog when no path is given), new scratch buffer |
| `:reload` | take the version on disk |
| `:export-docx [path]` | export to Word |
| `:<n>` | go to line *n* |

macOS shortcuts also work: ⌘S save, ⌘O open, ⌘⇧E export.

## Key bindings

Normal and select mode (`v`) follow Helix: `hjkl`, `w b e W B E`, `f t F T`, `A-.`,
`gg ge gh gl gs gt gc gb gw`, `x X`, `%`, `s S A-s`, `; A-; , A-,`, `C A-C`, `( )`,
`_`, `/ ? n N *`, `y p P R`, `d c A-d A-c`, `r ~ \` A-\``, `> <`, `J`, `u U`,
`mi ma mm ms mr md`, `zz zt zb zj zk`, `C-u C-d C-b C-f`, `[space ]space`,
`space f/y/p/P/R/e`. Counts work (`3w`, `5j`, `12G`).

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
