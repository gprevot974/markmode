// Live preview, line numbers, jump labels, windows, buffers and pickers.

import type { Harness } from "./run.ts";

export default async function ({ page, type, press, ev, check }: Harness) {
  const lineText = (n: number) =>
    ev((n) => {
      const v = app.view;
      const { node } = v.domAtPos(v.state.doc.line(n).from);
      return (node.nodeType === 3 ? node.parentElement : node).closest(".cm-line")?.textContent as string | undefined;
    }, n);
  const files = () => ev(() => [...document.querySelectorAll(".sl-file")].map((e) => e.textContent));
  const windows = () => ev(() => document.querySelectorAll(".window").length);

  // The cursor on an empty line must not reveal the heading below it.
  await type("5G");
  check("heading below an empty cursor line stays rendered", !(await lineText(6))?.startsWith("#"), await lineText(6));
  await type("4Gx");
  check("x keeps the next line rendered", !(await lineText(6))?.startsWith("#"), await lineText(6));
  await type(";");

  await type("8Gx");
  const gutter = await ev(() => ({
    numbers: document.querySelectorAll(".cm-lineNumbers .cm-gutterElement").length,
    active: [...document.querySelectorAll(".cm-activeLineGutter")].map((e) => e.textContent),
  }));
  check("line numbers, the active one at the cursor after x", gutter.numbers > 5 && gutter.active.includes("8") && !gutter.active.includes("9"), gutter);
  await type(";");
  const offsets = await ev(() =>
    [4, 6, 8].map((n) => {
      const v = app.view;
      const g = [...document.querySelectorAll(".cm-lineNumbers .cm-gutterElement")].find((e) => e.textContent === String(n))!;
      const { node } = v.domAtPos(v.state.doc.line(n).from + 1);
      const line = (node.nodeType === 3 ? node.parentElement : node).closest(".cm-line");
      const r = document.createRange();
      r.selectNodeContents(line);
      const text = r.getClientRects()[0];
      const gs = getComputedStyle(g);
      const numberCenter = g.getBoundingClientRect().top + parseFloat(gs.paddingTop) + parseFloat(gs.lineHeight) / 2;
      return Math.round(text.top + text.height / 2 - numberCenter);
    }),
  );
  check("line numbers line up with headings and text (±4px)", offsets.every((d) => Math.abs(d) <= 4), offsets);

  // Jump labels cover letters without moving anything.
  await type("gg");
  const geometry = () =>
    ev(() => ({
      lines: [...document.querySelectorAll(".cm-line")].slice(0, 12).map((l) => `${Math.round(l.getBoundingClientRect().height)}:${l.getClientRects().length}`),
      height: document.querySelector(".cm-content")!.getBoundingClientRect().height,
    }));
  const before = await geometry();
  await type("gw");
  const labels = await ev(() =>
    [...document.querySelectorAll<HTMLElement>(".hx-jump")].slice(0, 4).map((e) => [e.dataset.label, getComputedStyle(e, "::after").content]),
  );
  check("gw shows labels over the words", labels.length === 4 && labels[0][1]!.includes(labels[0][0]!), labels);
  check("gw keeps line heights", JSON.stringify(before) === JSON.stringify(await geometry()), { before, after: await geometry() });
  await press("Escape");

  // Windows
  await type(" w");
  const info = await ev(() => document.getElementById("infobox")!.innerText);
  check("space w shows the window menu", info.startsWith("Window") && info.includes("Vertical right split"), info.slice(0, 80));
  await type("v");
  check("vsplit makes two windows", (await windows()) === 2);
  await type("ggi");
  await type("XYZ");
  await press("Escape");
  const both = await ev(() => [...document.querySelectorAll(".window")].map((w) => w.querySelector(".cm-content")!.textContent!.includes("XYZ")));
  check("an edit shows in both windows", both.every(Boolean), both);
  check("both statuslines show the buffer modified", (await ev(() => document.querySelectorAll(".sl-file.dirty").length)) === 2);
  await type("u");
  check("undo in the window that edited", !(await ev(() => document.body.textContent!.includes("XYZ"))));
  await press("Control+w");
  await type("h");
  check("C-w h moves to the left window", (await ev(() => [...document.querySelectorAll(".window")].findIndex((w) => w.classList.contains("active")))) === 0);
  await type(":");
  await type("o /notes/ideas.md");
  await press("Enter");
  check(":o opens in the current window only", JSON.stringify(await files()) === '["/notes/ideas.md","/sample.md"]', await files());
  await type(" ws");
  check("hsplit makes three windows", (await windows()) === 3);
  await type(":");
  await type("q");
  await press("Enter");
  check(":q closes the window", (await windows()) === 2);
  await press("Control+w");
  await type("o");
  check("C-w o keeps one window", (await windows()) === 1);

  // Buffers
  await type("ga");
  check("ga returns to the previous buffer", (await files())[0] === "/sample.md", await files());
  await type(" b");
  const rows = await ev(() => [...document.querySelectorAll(".pk-row")].map((r) => r.textContent!));
  check("buffer picker lists both, current first", rows.length === 2 && rows[0].includes("*") && rows[0].includes("sample.md"), rows);
  await type("idea");
  await press("Enter");
  check("buffer picker switches", (await files())[0] === "/notes/ideas.md");
  await type("gn");
  check("gn cycles buffers", (await files())[0] === "/sample.md");

  // File picker
  await type(" f");
  await page.waitForTimeout(200);
  const listed = await ev(() => [...document.querySelectorAll(".pk-row")].map((r) => r.textContent));
  check("file picker lists files", listed.includes("sample.md") && listed.includes("notes/ideas.md"), listed);
  await type("nid");
  const filtered = await ev(() => ({
    rows: [...document.querySelectorAll(".pk-row")].map((r) => r.innerHTML),
    preview: document.querySelector(".pk-preview")!.textContent!.slice(0, 30),
  }));
  check("fuzzy filter, highlight and preview", filtered.rows.length === 1 && filtered.rows[0].includes("pk-hl") && filtered.preview.includes("Ideas"), filtered);
  await press("Control+v");
  check("C-v opens in a vertical split", (await files()).join("|") === "/sample.md|/notes/ideas.md", await files());
  await type(":");
  await type("bc");
  await press("Enter");
  const after = await ev(() => ({ files: [...document.querySelectorAll(".sl-file")].map((e) => e.textContent), docs: app.docs.length }));
  check(":bc closes the buffer, its window falls back", after.docs === 1 && after.files.every((f) => f === "/sample.md"), after);
}

