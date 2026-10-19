// Spell-check, against the planted typos of the in-memory backend, and the
// prompt for unsaved changes on quitting.

import type { Harness } from "./run.ts";

export default async function ({ page, type, press, ev, check }: Harness) {
  const flagged = () => ev(() => [...document.querySelectorAll(".hx-misspelled")].map((e) => e.textContent));
  const dialogs: string[] = [];
  page.on("dialog", (d) => dialogs.push(d.message()));

  await type("9Go");
  await type("I recieve teh mail and `teh` code wrold");
  await page.waitForTimeout(700);
  const typing = await flagged();
  check(
    "flags typos while typing, but not the word being typed or code",
    typing.includes("recieve") && !typing.includes("wrold") && typing.filter((w) => w === "teh").length === 1,
    typing,
  );
  await press("Escape");
  await page.waitForTimeout(300);
  check("the last word is flagged once out of insert mode", (await flagged()).includes("wrold"), await flagged());

  await type("gh]s");
  const selected = await ev(() => {
    const { state } = app.view;
    return state.sliceDoc(state.selection.main.from, state.selection.main.to);
  });
  check("]s selects the next misspelling", selected === "recieve", selected);
  await type(" a");
  const menu = await ev(() => [...document.querySelectorAll(".menu-item")].map((e) => e.textContent!));
  check("space a lists suggestions, add and ignore", menu[0] === "1receive" && menu.some((m) => m.includes("Ignore")), menu);
  await press("Enter");
  const line = await ev(() => app.view.state.doc.lineAt(app.view.state.selection.main.head).text);
  check("Enter applies the suggestion", line.startsWith("I receive teh"), line);
  await type("]s");
  await type(" a");
  await type("i");
  check("ignoring a word clears all its marks", !(await flagged()).includes("teh"), await flagged());

  await ev(() => app.requestQuit());
  await page.waitForTimeout(200);
  check("quitting with unsaved buffers asks", dialogs.length === 1 && dialogs[0].includes("sample.md"), dialogs);
}
