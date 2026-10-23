// Live preview, line numbers, jump labels, windows, buffers and pickers.

import type { Harness } from "./run.ts";

export default async function ({ page, type, press, ev, check, restart }: Harness) {
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

  // Line numbers are off unless config.toml's gutters has them.
  check("no line numbers by default", !(await ev(() => document.querySelector(".cm-lineNumbers"))));
  await ev(() => sessionStorage.setItem("markmode.helix-config", JSON.stringify({ editor: { gutters: ["line-numbers"] } })));
  await restart();
  await type("9Gx");
  const gutter = await ev(() => ({
    numbers: document.querySelectorAll(".cm-lineNumbers .cm-gutterElement").length,
    active: [...document.querySelectorAll(".cm-activeLineGutter")].map((e) => e.textContent),
  }));
  check("line numbers, the active one at the cursor after x", gutter.numbers > 5 && gutter.active.includes("9") && !gutter.active.includes("10"), gutter);
  await type(";");
  const offsets = await ev(() =>
    [7, 9, 11].map((n) => {
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

  // Markdown previews are rendered, the highlighted line too.
  await type(" s");
  await page.waitForTimeout(200);
  const symbols = await ev(() => ({
    editor: !!document.querySelector(".pk-preview .cm-editor"),
    current: document.querySelector(".pk-preview .pk-current")?.textContent,
  }));
  check("symbol picker preview is rendered, # hidden", symbols.editor && symbols.current === "Markmode Sample", symbols);
  await press("Escape");

  // File picker
  await type(" f");
  await page.waitForTimeout(200);
  const listed = await ev(() => [...document.querySelectorAll(".pk-row")].map((r) => r.textContent));
  check("file picker lists files", listed.includes("sample.md") && listed.includes("notes/ideas.md"), listed);
  await type("chart");
  await page.waitForTimeout(300);
  const highlighted = await ev(() => document.querySelectorAll(".pk-preview .cm-line span[class]").length);
  check("other files preview highlighted, as opened", highlighted > 0, highlighted);
  await page.fill(".pk-input", "");
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

  // Path completion, as in Helix: Enter on a folder lists its files, Enter on
  // a file opens it.
  const prompt = () =>
    ev(() => ({
      open: !document.getElementById("prompt")!.hidden,
      value: (document.getElementById("prompt-input") as HTMLInputElement).value,
      items: [...document.querySelectorAll("#completion .item")].map((e) => e.textContent),
    }));
  await type(":");
  await type("o no");
  await press("Tab");
  await press("Enter");
  await page.waitForTimeout(100);
  const inFolder = await prompt();
  check("Enter on a folder lists its files", inFolder.open && inFolder.value === "o notes/" && inFolder.items.includes("ideas.md"), inFolder);
  await press("Tab");
  await press("Enter");
  check("Enter on a file opens it", !(await prompt()).open && (await files()).includes("/notes/ideas.md"), await files());
  await type(":");
  await type("o dea");
  await page.waitForTimeout(100);
  const fuzzy = await prompt();
  await press("Escape");
  check("path completion is fuzzy", fuzzy.items.includes("ideas.md"), fuzzy);
  await type(":");
  await type("rfl");
  const command = await prompt();
  await press("Escape");
  check("command completion is fuzzy", command.items[0]?.startsWith("reflow"), command);

  // ge on a last line that wraps over several rows shows all of it.
  await ev(() => {
    const long = Array(25).fill("A long paragraph that wraps.").join(" ");
    app.view.dispatch({ changes: { from: 0, to: app.view.state.doc.length, insert: "# Top\n\n" + "Line\n\n".repeat(60) + long } });
  });
  await type("gg");
  await type("ge");
  const end = await ev(() => {
    const scroller = app.view.scrollDOM;
    const cursor = app.view.coordsAtPos(app.view.state.selection.main.head);
    const box = scroller.getBoundingClientRect();
    const last = app.view.coordsAtPos(app.view.state.doc.length);
    return {
      rows: Math.round((last.bottom - cursor.top) / 20),
      endShown: !!last && last.bottom <= box.bottom,
      cursorShown: !!cursor && cursor.top >= box.top && cursor.bottom <= box.bottom,
    };
  });
  check("ge shows a wrapped last line down to its end, cursor still in view", end.rows > 3 && end.endShown && end.cursorShown, end);

  // Getting started: the welcome on the first start only, the hint in an
  // empty buffer and after a key doing nothing, the command palette, :tutor and :keys.
  const message = () => ev(() => document.getElementById("message")!.textContent!);
  const pickerTitle = () => ev(() => document.querySelector("#picker .pk-title")?.textContent ?? null);
  await ev(() => localStorage.removeItem("markmode.welcomed"));
  await restart();
  check("a welcome on the first start", (await message()).startsWith("Welcome to Markmode"), await message());
  await restart();
  check("no welcome after it", !(await message()).startsWith("Welcome"), await message());
  await type("Q");
  check("a key doing nothing in normal mode says how to type", (await message()).startsWith("Q does nothing in normal mode"), await message());
  await type(":new");
  await press("Enter");
  const hint = () => ev(() => [...document.querySelectorAll(".window.active .empty-hint > span")].filter((e) => (e as HTMLElement).offsetParent).map((e) => e.className));
  check("an empty buffer shows the normal mode hint", (await hint()).join() === "hint-normal", await hint());
  await type("i");
  check("and the insert mode one in insert mode", (await hint()).join() === "hint-insert", await hint());
  await type("x");
  check("typing hides it", (await hint()).length === 0, await hint());
  await press("Escape");

  await type(":new");
  await press("Enter");
  await type(":hints off");
  await press("Enter");
  const settingsFile = () => ev(() => Object.entries(sessionStorage).find(([k]) => k.endsWith("markmode/config.toml"))?.[1] ?? "");
  check(":hints off hides the hint, in the settings", (await hint()).length === 0 && /^hints = false$/m.test(await settingsFile()), await settingsFile());
  await type(":hints");
  await press("Enter");
  check(":hints toggles them back on", (await hint()).join() === "hint-normal" && /^hints = true$/m.test(await settingsFile()));
  await type(" ?");
  check("space ? opens the command palette", (await pickerTitle()) === "commands");
  await type("file pick");
  const found = await ev(() => [...document.querySelectorAll("#picker .pk-row")].slice(0, 1).map((r) => [r.querySelector(".pk-text")!.textContent, r.querySelector(".pk-detail")!.textContent]));
  check("the palette finds a command by what it does, with its keys", found[0]?.[0] === "Open file picker" && found[0]?.[1] === "Space f", found);
  await press("Enter");
  await page.waitForTimeout(200);
  check("Enter runs it", (await pickerTitle()) !== "commands" && (await pickerTitle()) !== null, await pickerTitle());
  await press("Escape");
  await type("i");
  await press("Meta+Shift+KeyP");
  check("Cmd-Shift-P opens it in insert mode too", (await pickerTitle()) === "commands");
  await type("next occurrence of char");
  await press("Enter");
  check("a command reading a character waits for it, in normal mode", (await ev(() => document.getElementById("pending")!.textContent)) === "f" && (await ev(() => document.querySelector(".window.active .sl-mode")!.textContent)) === "NOR");
  await press("Escape");
  await type(":help");
  await press("Enter");
  await type("export style default");
  await press("Enter");
  check("a command taking an argument goes to the command line", (await ev(() => (document.getElementById("prompt-input") as HTMLInputElement).value)) === "export-style-default ");
  await press("Escape");

  await type(":tutor");
  await press("Enter");
  check(":tutor opens the tutorial", (await ev(() => app.view.state.doc.line(1).text)) === "# Markmode tutor");
  await type(":keys");
  await press("Enter");
  const keysDoc = await ev(() => app.view.state.doc.toString());
  check(":keys lists the bindings", keysDoc.startsWith("# Keys") && keysDoc.includes("### Space\n") && keysDoc.includes("### Space w, Ctrl-w: Window") && keysDoc.includes("Open command palette"));

  // A heading's preview paints rendered, though far past the part of the
  // document parsed when its state was made (the rest comes in the background).
  await type(" s");
  await page.waitForTimeout(200);
  await page.keyboard.press("PageDown");
  const rendered = await ev(
    () =>
      new Promise<number | null>((resolve) => {
        const start = performance.now();
        const tick = () => {
          const lines = [...document.querySelectorAll(".pk-preview .cm-line")];
          const raw = lines.some((l) => !l.classList.contains("pk-current") && /^(#{1,6} |\|)/.test(l.textContent!));
          if (lines.length && !raw) return resolve(performance.now() - start);
          if (performance.now() - start > 2000) return resolve(null);
          requestAnimationFrame(tick);
        };
        tick();
      }),
  );
  check("a heading's preview far down the document is rendered at once", rendered !== null && rendered < 60, rendered);
  await press("Escape");
}
