# Improvements roadmap

Ideas for taking md-editor from a personal tool to something other people
would choose. The ordering reflects priority: the first section is what would
make the app distinctive, the next ones are what people need before they trust
it, and the rest widens its reach.

## 1. Make the LLM workflow the main feature

*Done: see "Reviewing outside changes", "Comments" and "Version history" in
the README. The keys differ from the first idea: `space y` is Helix's yank to
clipboard, so changes are decided with `space d a` / `space d r`, and `]g` /
`[g` move between them, as between diff hunks in Helix. `]c` / `[c` move
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

Roughly in order of value:

- `space /` global search with ripgrep.
- `space s` heading/outline picker.
- `gf` or Enter on a link to open a linked `.md` file; wiki-links.
- Images rendered inline.
- Front matter, footnotes and math (KaTeX).
- PDF and HTML export through pandoc, next to the existing docx export.

## 5. Distribution

- Sign and notarize the macOS build; automatic updates with
  `tauri-plugin-updater`.
- A Homebrew cask.
- File associations so "Open With" works, and a CLI launcher (`mde notes.md`)
  so it fits terminal habits.
- Spell-check is stubbed on Linux and Windows: use Hunspell there, or ship
  macOS-only at first and say so.

## 6. Onboarding

Modal editing loses most new users within five minutes.

- A `:tutor` document, as Helix has.
- A visible hint on first launch ("you're in NOR mode, press `i` to type").
- A searchable command palette, so features can be found without memorizing
  keys.
- A README with a GIF, a license, and a short page explaining what makes the
  app different.
