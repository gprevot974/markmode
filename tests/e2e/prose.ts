// Moving around prose: gh/gl/gs by the rows on screen, markdown-aware o/O,
// the heading pickers (space s, space S) and the jumplist (C-o, C-i).

import type { Harness } from "./run.ts";

const LONG =
  "This paragraph is a single line in the file, written the way agents and many people write markdown, " +
  "so that it wraps over several rows on the screen. Moving to the start or end of a row should stay on " +
  "the row the cursor is on, while edits keep to the line in the file, whatever the width of the window.";

const TEXT = `# Guide

${LONG}

## Setup

- item one
  continued
- item two

\`\`\`sh
echo hi
\`\`\`

### Config

Last paragraph.
`;

export default async function (t: Harness) {
  await moving(t);
  await tables(t);
  await fences(t);
  await directives(t);
}

async function directives({ page, type, press, ev, check }: Harness) {
  await ev(async () => {
    await backend.writeText(
      "/notes/props.md",
      "<!-- footer: Draft for discussion -->\n<!-- no-subtitle -->\n\n# Doc\n\n| Name | Notes |\n| --- | --- |\n| a | b |\n\nEnd.\n",
    );
    await app.openPath("/notes/props.md");
  });
  await type("ge");
  const labels = () => ev(() => [...document.querySelectorAll(".cm-content .md-directive")].map((e) => e.textContent!));
  check("directives show as labels", (await labels()).join("|") === "Footer: Draft for discussion|No subtitle: the first ## is a section", await labels());
  await type("gg");
  check("on the cursor's line, a directive shows its source", (await labels()).length === 1, await labels());

  const widths = () =>
    ev(() => {
      const row = document.querySelector<HTMLTableElement>(".cm-content table.md-table:not(.md-table-head)")!;
      const total = row.getBoundingClientRect().width;
      return [...row.rows[0].cells].map((c) => Math.round((c.getBoundingClientRect().width / total) * 100));
    });
  const text = () => ev(() => app.view.state.doc.toString() as string);

  // :table-widths writes a directive above the table, which the rows follow.
  await type("6G");
  await type(":");
  await type("table-widths 25 75");
  await press("Enter");
  await type("ge");
  check(":table-widths writes a widths directive", (await text()).includes("# Doc\n\n<!-- widths: 25 75 -->\n| Name"), await text());
  check("the rows take the widths", (await widths()).join() === "25,75", await widths());
  check("the directive shows as a label", (await labels()).includes("Column widths 25% · 75%"), await labels());

  // Dragging the border between columns rewrites it.
  const handle = await ev(() => {
    const r = document.querySelector(".cm-content table.md-table:not(.md-table-head) .md-col-handle")!.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  const tableWidth = await ev(() => document.querySelector(".cm-content table.md-table")!.getBoundingClientRect().width);
  await page.mouse.move(handle.x, handle.y);
  await page.mouse.down();
  await page.mouse.move(handle.x + tableWidth * 0.25, handle.y, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(100);
  check("dragging a column border rewrites the widths", (await text()).includes("<!-- widths: 50 50 -->"), await text());
  check("the rows follow the drag", (await widths()).join() === "50,50", await widths());
  await type("u");
  check("a drag undoes in one step", (await text()).includes("<!-- widths: 25 75 -->"), await text());

  await type("8G");
  await type(":");
  await type("table-widths reset");
  await press("Enter");
  check(":table-widths reset removes the directive", !(await text()).includes("widths"), await text());
}

async function fences({ type, ev, check }: Harness) {
  await ev(async () => {
    await backend.writeText("/notes/code.md", "On the server:\n\n```bash\nsudo apt install jq\n```\n\nAfter.\n");
    await app.openPath("/notes/code.md");
  });
  await type("gg");
  const fence = () =>
    ev(() => {
      const line = [...document.querySelectorAll<HTMLElement>(".cm-line")][2];
      return { text: line.textContent!, align: getComputedStyle(line).textAlign };
    });
  let f = await fence();
  check("away from the cursor, a fence shows its language, at the right", f.text === "bash" && f.align === "right", f);
  await type("jj");
  f = await fence();
  check("on the cursor's line, the fence shows its source", f.text === "```bash" && f.align !== "right", f);
}

async function moving({ page, type, press, ev, check }: Harness) {
  const cursor = () =>
    ev(() => {
      const { state } = app.view;
      const head = state.selection.main.head;
      const line = state.doc.lineAt(head);
      return { line: line.number as number, col: (head - line.from) as number, text: state.doc.toString() as string };
    });
  const charAt = (offset: number) =>
    ev((o) => {
      const { state } = app.view;
      const r = state.selection.main;
      const at = (r.head > r.anchor ? r.head - 1 : r.head) + o;
      return state.doc.sliceString(at, at + 1) as string;
    }, offset);

  await ev(async (text) => {
    await backend.writeText("/notes/guide.md", text);
    await backend.writeText("/notes/other.md", "# Other\n\n## Deep section\n\nText.\n");
    await app.openPath("/notes/guide.md");
  }, TEXT);

  // ── Rows ──
  await type("3Gjj");
  const row = await cursor();
  check("j moves by row within the paragraph", row.line === 3 && row.col > 0, row);
  await type("gh");
  const start = await cursor();
  check("gh goes to the start of the row, not of the line", start.line === 3 && start.col > 0 && start.col <= row.col, start);
  await type("gl");
  const end = await cursor();
  check(
    "gl goes to the last character of the row",
    end.line === 3 && end.col > row.col && end.col < LONG.length - 1 && (await charAt(0)) !== " " && (await charAt(1)) === " ",
    { end, here: await charAt(0) },
  );
  await type("gs");
  check("gs stays on the row", (await cursor()).col === start.col, await cursor());
  await type("3Ggl");
  check("gl on the last row is the line end", (await cursor()).col < LONG.length && (await type("G"), true));
  await type("3GA");
  const appended = await cursor();
  await press("Escape");
  check("A appends at the end of the line in the file", appended.col === LONG.length, appended);

  // ── o and O ──
  await type("3Go");
  await type("New one.");
  await press("Escape");
  let text = (await cursor()).text;
  check("o after a paragraph starts a new paragraph", text.includes(`${LONG}\n\nNew one.\n\n## Setup`), text.slice(LONG.length, LONG.length + 40));
  await type("u3GO");
  await type("Before.");
  await press("Escape");
  text = (await cursor()).text;
  check("O before a paragraph starts a new paragraph", text.startsWith(`# Guide\n\nBefore.\n\n${LONG}`), text.slice(0, 30));
  await type("u1Go");
  await type("Intro.");
  await press("Escape");
  text = (await cursor()).text;
  check("o under a heading starts a paragraph", text.startsWith(`# Guide\n\nIntro.\n\n${LONG}`), text.slice(0, 30));
  await type("u8Go");
  await type("item three");
  await press("Escape");
  text = (await cursor()).text;
  check("o in a list item's continuation adds an item after it", text.includes("- item one\n  continued\n- item three\n- item two"), text.slice(text.indexOf("- item one"), text.indexOf("- item one") + 60));
  await type("u12Go");
  await type("echo bye");
  await press("Escape");
  text = (await cursor()).text;
  check("o in code opens a line", text.includes("echo hi\necho bye\n```"), text.slice(text.indexOf("echo"), text.indexOf("echo") + 20));
  await type("u");
  check("undo brings the text back", (await cursor()).text === TEXT);

  // ── Headings ──
  await type("gg");
  await type(" s");
  const pickerRows = () =>
    ev(() =>
      [...document.querySelectorAll<HTMLElement>(".pk-row")].map((r) => ({
        text: r.textContent!,
        indent: parseFloat(getComputedStyle(r).paddingLeft),
        context: r.classList.contains("pk-context"),
        selected: r.classList.contains("selected"),
      })),
    );
  const rows = await pickerRows();
  check(
    "space s lists the headings as an indented tree",
    rows.map((r) => r.text).join() === "Guide,Setup,Config" && rows[0].indent < rows[1].indent && rows[1].indent < rows[2].indent,
    rows,
  );
  await type("conf");
  const found = await pickerRows();
  check(
    "filtering keeps the headings a match is under, dimmed",
    found.map((r) => `${r.text}${r.context ? "?" : ""}${r.selected ? "*" : ""}`).join() === "Guide?,Setup?,Config*",
    found,
  );
  await press("Enter");
  check("Enter goes to the heading", (await cursor()).line === 15, await cursor());

  // ── Jumplist ──
  await press("Control+o");
  check("C-o goes back to before the jump", (await cursor()).line === 1, await cursor());
  await press("Control+i");
  check("C-i goes forward again", (await cursor()).line === 15, await cursor());
  await type("ge");
  await type("gg");
  await press("Control+o");
  check("gg and ge are jumps", (await cursor()).line >= 17, await cursor());
  await press("Control+o");
  check("C-o twice goes further back", (await cursor()).line === 15, await cursor());

  // Across files: space S, then back.
  await type(" S");
  await page.waitForTimeout(200);
  const all = (await pickerRows()).map((r) => r.text);
  const at = all.indexOf("notes/other.md");
  check("space S lists each markdown file around, then its headings", at >= 0 && all.slice(at + 1, at + 3).join() === "Other,Deep section", all);
  await type("other deep");
  const deep = (await pickerRows()).map((r) => `${r.text}${r.context ? "?" : ""}`);
  check("a pattern can match the file or headings a heading is under", deep.join() === "notes/other.md?,Other?,Deep section", deep);
  await press("Enter");
  await page.waitForTimeout(200);
  const there = await ev(() => ({ file: app.active.doc.path, line: app.view.state.doc.lineAt(app.view.state.selection.main.head).number }));
  check("Enter opens the file at the heading", there.file === "/notes/other.md" && there.line === 3, there);
  await press("Control+o");
  const back = await ev(() => ({ file: app.active.doc.path, line: app.view.state.doc.lineAt(app.view.state.selection.main.head).number }));
  check("C-o goes back to the other file", back.file === "/notes/guide.md" && back.line === 15, back);

  // Places move with edits above them. (gg is a new jump, so the jump to
  // other.md, ahead in the list, is dropped, as in Helix.)
  await type("ggO");
  await type("Added.");
  await press("Escape");
  await press("Control+i");
  await press("Control+o");
  check("a place in the jumplist moves with the text", (await cursor()).line === 17, await cursor());

  await type(" j");
  const jumps = await ev(() => [...document.querySelectorAll(".pk-row")].map((r) => r.textContent!));
  check("space j lists the jumps", jumps.some((r) => r.startsWith("guide.md:17  ### Config")) && !jumps.some((r) => r.startsWith("other.md")), jumps);
  await press("Escape");
  await press("Control+s");
  check("C-s saves the selection", (await ev(() => document.getElementById("message")!.textContent)) === "selection saved to the jumplist");
}

const TABLE = `Above.

| Component | Where | Notes |
| --- | --- | --- |
| Reverse proxy / TLS | Host nginx | Owned by the other platform's admin. Only public listener besides SSH |
| Frontend + routing | \`caddy\` container, \`127.0.0.1:8090\` | Serves the bundle |
| Auth | Auth0 | Unchanged |

Below.
`;

async function tables({ type, ev, check }: Harness) {
  await ev(async (text) => {
    await backend.writeText("/notes/table.md", text);
    await app.openPath("/notes/table.md");
  }, TABLE);
  const shown = () =>
    ev(() => ({
      line: app.view.state.doc.lineAt(app.view.state.selection.main.head).number as number,
      rows: document.querySelectorAll(".cm-content .md-table").length,
      raw: [...document.querySelectorAll(".cm-content .md-table-line")].filter((l) => !l.querySelector(".md-table, .md-table-rule")).map((l) => l.textContent!),
    }));
  await type("gg");
  let s = await shown();
  check("a table renders row by row", s.rows === 4 && s.raw.length === 0, s);
  const widths = await ev(() => [...document.querySelectorAll(".cm-content .md-table")].map((t) => [...(t as HTMLTableElement).rows[0].cells].map((c) => Math.round(c.getBoundingClientRect().left)).join()));
  check("rows share their column widths", new Set(widths).size === 1, widths);
  await type("gg");
  await type("jj");
  s = await shown();
  check("j goes onto the table's first line, which alone shows its source", s.line === 3 && s.rows === 3 && s.raw.length === 1 && s.raw[0].startsWith("| Component"), s);
  await type("jj");
  s = await shown();
  check("j goes through the table line by line", s.line === 5 && s.rows === 3 && s.raw[0].startsWith("| Reverse"), s);
  const col = () => ev(() => app.view.state.selection.main.from - app.view.state.doc.lineAt(app.view.state.selection.main.from).from);
  check("a move onto a row lands at the start of its line", (await col()) === 0, await col());
  await type("jjjk");
  s = await shown();
  check("k goes back up into the table", s.line === 6 && s.raw[0].startsWith("| Frontend") && (await col()) === 0, s);

  // gw labels the words in rendered rows too.
  await type("gg");
  await type("gw");
  const label = await ev(() => {
    const el = [...document.querySelectorAll<HTMLElement>(".md-table .hx-jump")].find((e) => e.closest("td") && e.parentElement!.textContent!.includes("Auth0"));
    return el ? { label: el.dataset.label!, text: el.textContent! } : null;
  });
  check("gw labels words in a rendered table", label?.text === "Au", label);
  if (label) await type(label.label);
  const picked = await ev(() => {
    const r = app.view.state.selection.main;
    return app.view.state.sliceDoc(r.from, r.to);
  });
  check("typing a table word's label selects it", picked === "Auth0", picked);
}
