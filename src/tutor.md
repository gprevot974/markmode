# Markmode tutor

Welcome. Markmode edits text the way Helix does: with keys that act on what is selected, instead of a mouse and menus. It takes ten minutes to learn the basics, and this page teaches them. It is a scratch copy: practice on it as you read, nothing you do here is saved.

Lines marked with `-->` are for practice. Scroll with `Ctrl-d` (down) and `Ctrl-u` (up), or with the mouse.

## 1. Two modes

The statusline, at the bottom left, says which mode you are in:

- **NOR**, normal mode: keys are commands. `w` moves to the next word, `d` deletes. This is where you start, and where you spend most of your time.
- **INS**, insert mode: keys type text, as in any other editor.

`i` goes to insert mode, before the selection. `Esc` comes back to normal mode. When typing does strange things, you are in normal mode: press `Esc`, then `i`, and type again.

--> Put the cursor at the start of "brown", press `i`, type "quick ", press `Esc`.

--> The brown fox jumps over the lazy dog.

Other ways into insert mode: `a` types after the selection, `A` at the end of the line, `I` at its start, `o` on a new paragraph below, `O` above.

## 2. Moving

- `h` `j` `k` `l` move left, down, up and right; the arrow keys do too.
- `w` goes to the next word, `b` back a word, `e` to the end of the word.
- `gg` goes to the top of the file, `ge` to the end.
- A click puts the cursor where you click.
- A number before a key repeats it: `3w` moves three words, `5j` five lines.

--> Move through this line with w and b, then try 3w: one two three four five six.

## 3. Select, then act

In most editors you pick an action, then what it applies to. Here it is the other way round: you select first, see the selection, then act on it.

- `w` and `b` select the word they move over, so `w` then `d` deletes a word.
- `x` selects the whole line; press it again to add the next line.
- `v` starts select mode (**SEL**): moves then extend the selection, until you press `v` or `Esc` again.
- `;` shrinks the selection back to the cursor.

Then act on it:

- `d` deletes the selection.
- `c` deletes it and goes to insert mode, to type its replacement.
- `y` copies it (yanks), and `p` pastes after the selection, `P` before.
- `Space y` and `Space p` copy to and paste from the system clipboard, to share text with other apps. `⌘V` pastes from it too.

--> Delete the extra word: The fox fox jumps.

--> Change "slow" to "fast": put the cursor on its "s", press e (it selects to the end of the word), then c: The slow fox jumps.

--> Delete this whole line with x then d.

## 4. Undo

`u` undoes, `U` redoes (`⌘Z` and `⌘⇧Z` work too). Undo whatever you did above and do it again, as often as you like.

## 5. Finding commands

You don't need to remember everything:

- `Space` opens a menu of commands, each with its key. Many keys do the same: `g` (go to), `m` (match and surround), `z` (view), `[` and `]` (previous and next). Press one and wait: a popup lists what comes next. `Esc` closes it.
- `Space ?` (or `⌘⇧P`, or `:help`) opens the command palette: type what you want to do ("export", "split", "comment"), and Enter runs it. It shows the keys of each command, to learn them as you go.
- `:keys` lists every key, and `:` alone starts a command, completing its name as you type (Tab cycles through them).

--> Press Space, read the popup, press Esc. Then press Space ? and type "word count".

## 6. Searching

- `/` searches forward as you type, `?` backward. Enter keeps the match selected; `n` and `N` go to the next and previous ones.
- `Space /` searches every file in the folder.
- `Space s` lists the headings of the file, to jump to one.

--> Search for "fox" with /, then press n a few times.

## 7. Files

- `⌘O` (or `:o`) opens a file; `Space f` finds one in the folder by name.
- `⌘S` (or `:w`) saves. A star in the statusline (`[+]`) means unsaved changes.
- `Space b` switches between the files you have open.
- `:q` closes the window, and refuses when there are unsaved changes; `:q!` closes anyway. `⌘Q` asks what to do with them.

## 8. Markdown

Markdown shows as it will look: headings, **bold**, *italic*, links, images, tables and math. The line the cursor is on shows its markup, so you can edit every character of it.

--> Move the cursor onto this line with **bold text** and a [link](https://helix-editor.com), then away again.

`gf` on a link (or `⌘`-click) opens it. `:reflow` wraps long lines, and `:word-count` counts words.

## 9. Export

`Space e` (or `⌘⇧E`, or `:export-docx`) writes a Word document next to the file, and `:export-html` a web page. `:export-style` picks how it looks, and `:export-preview` shows the document in that style as you edit.

### Document properties

What the document says about itself (its title, author, the footer on each page, its export style) goes in front matter: lines between two `---` at the very top of the file. The export writes them into the Word document's properties and its footer. It shows as a box of properties, and its lines show their source when the cursor is on them:

```yaml
---
title: Project proposal
author: Jane Doe
footer: Draft for discussion
style: plain
---
```

In front matter, `Ctrl-x` lists the keys it takes and, after a key, its values: in insert mode for what is typed before the cursor. `:export-help` lists them all, with the export styles.

### Table column widths

Without being told, the export gives a table's columns widths of its own, mostly equal ones. To set them yourself, drag the borders between the columns of a table in the preview, or put the cursor in the table and type `:table-widths 20 30 50`, in percent. Either writes a line above the table, `<!-- widths: 20 30 50 -->`, which the export follows; `:table-widths reset` removes it.

--> Drag the border between these two columns, then move the cursor onto the line above the table.

| Command | What it does |
| --- | --- |
| `:w` | Save |
| `:export-docx` | Export to Word |

## 10. Working with an agent

When another program (an AI agent, a script, git) changes the open file, its changes show inline, highlighted:

- `]g` and `[g` go to the next and previous change.
- `Space g a` accepts the change under the cursor, `Space g r` rejects it; the buttons in the margin do the same. `Space d` lists them all.

`Space c` leaves a comment on the selection, in the file, for the agent to read: ask it to "address the comments".

## What's next

| To | Press |
| --- | --- |
| Type | `i`, then `Esc` |
| Move | `h` `j` `k` `l`, `w` `b`, `gg` `ge` |
| Select | `w`, `x`, `v` |
| Delete, change | `d`, `c` |
| Copy, paste | `y`, `p` (`Space y`, `Space p` for the clipboard) |
| Undo, redo | `u`, `U` |
| Find a command | `Space`, `Space ?` |
| Save, open | `⌘S`, `⌘O` |
| Export | `Space e`, `⌘⇧E` |

Your settings are in `:config-open`, where keys can be remapped too. `:hints off` turns off the hints for getting started. If you know Helix, your `~/.config/helix/config.toml` applies here. `:tutor` opens this page again.
