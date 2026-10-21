// The export, as configured from the editor: front matter, export styles
// (picked, started, edited with C-x completion), the export preview and the
// reference.

import type { Harness } from "./run.ts";

const DOC = `---
author: Jane Doe
footer: Draft
---

# Proposal

## For the board

**Lead.** A labeled paragraph, with **mid** bold.

| Item | Cost |
| --- | ---: |
| A | 1 |
| B | 2 |
| **Total** | 3 |
`;

export default async function ({ type, press, ev, check }: Harness) {
  await ev(async (doc) => {
    await backend.writeText("/notes/proposal.md", doc);
    await app.openPath("/notes/proposal.md");
  }, DOC);
  const text = () => ev(() => app.view.state.doc.toString() as string);
  const command = async (line: string) => {
    await type(":");
    await type(line);
    await press("Enter");
    await new Promise((r) => setTimeout(r, 250));
  };

  // Front matter shows as properties, not as a rule and a heading.
  await type("ge");
  const properties = () =>
    ev(() => [...document.querySelectorAll(".window.active .md-property")].map((e) => e.textContent!.replace(/\s+/g, " ")));
  check("front matter shows as properties", (await properties()).join("|") === "AuthorJane Doe|FooterDraft", await properties());
  check(
    "front matter is not a heading",
    await ev(() => ![...document.querySelectorAll(".window.active .md-h")].some((e) => e.textContent!.includes("Draft"))),
  );
  await type("2G");
  check("on the cursor's line, a property shows its source", (await properties()).length === 1, await properties());

  // C-x in normal mode: a key fixed, keeping its value; then a new key, typed in insert mode.
  await press("Control+x");
  const menu = () => ev(() => [...document.querySelectorAll("#menu .menu-item")].map((e) => e.textContent!));
  check("C-x in normal mode lists the property names", (await menu()).some((m) => m.includes("description")), await menu());
  await press("Escape");
  await type("3Go");
  await press("Escape");
  await press("Control+x");
  await type("8");
  await type("plain");
  await press("Escape");
  check("a key chosen on an empty line waits for its value", (await text()).includes("footer: Draft\nstyle: plain\n---"), await text());
  await press("Control+x");
  const values = await menu();
  check("C-x in normal mode on a property lists its values", values.join("|") === "1default|2plain", values);
  await press("Escape");
  await type("xd");

  // :export-style writes the style into the front matter.
  await command("export-style plain");
  check(":export-style names the style in the front matter", (await text()).startsWith("---\nauthor: Jane Doe\nfooter: Draft\nstyle: plain\n---"), await text());
  await command("export-style nowhere");
  check("an unknown style is refused", !(await text()).includes("nowhere"));

  // :export-style-new starts a style from the document's, beside it.
  await command("export-style-new acme");
  const toml = await ev(() => ({ path: app.active.doc.path, text: app.view.state.doc.toString(), windows: document.querySelectorAll(".window").length }));
  check(
    ":export-style-new writes a starter style from the document's and opens it beside",
    toml.path === "/config/md-editor/styles/acme.toml" && toml.text.includes('inherits = "plain"') && toml.windows === 2,
    toml,
  );
  check("a style file is plain text, not previewed markdown", await ev(() => !document.querySelector(".window.active .md-h")));

  // C-x completes keys, then values.
  await type("geo");
  await type("table-b");
  await press("Control+x");
  check("C-x lists the keys of the section", (await menu())[0]?.includes("table-bands"), await menu());
  await type("1");
  await press("Control+x");
  check("C-x lists a key's values", (await menu()).length === 2, await menu());
  await type("2");
  await press("Escape");
  check("completions fill the line", (await text()).includes("\ntable-bands = false"), (await text()).slice(-80));
  await command("w");

  // The export preview, in the document's window.
  await press("Control+w");
  await type("h");
  await command("export-style acme");
  await command("export-preview");
  const look = () =>
    ev(() => {
      const win = document.querySelector(".window.active")!;
      const title = win.querySelector(".md-h1")!;
      const lead = win.querySelector(".md-lead");
      return {
        on: win.classList.contains("export-preview"),
        bands: win.classList.contains("x-table-bands"),
        title: getComputedStyle(title).color,
        lead: lead && getComputedStyle(lead).color,
        subtitle: !!win.querySelector(".md-subtitle"),
        total: !!win.querySelector(".md-table-total"),
      };
    });
  let l = await look();
  check("the export preview shows the style", l.on && !l.bands && l.title === "rgb(0, 0, 0)" && l.subtitle && l.total, l);
  await command("export-style default");
  l = await look();
  check("it follows the style the front matter names", l.bands && l.title === "rgb(30, 41, 59)" && l.lead === "rgb(30, 41, 59)", l);
  await command("export-preview");
  check("and goes off again", !(await look()).on);

  // The style picker shows each style as the selection reaches it, then puts the window back.
  await type(":");
  await type("export-style");
  await press("Enter");
  await new Promise((r) => setTimeout(r, 300));
  l = await look();
  check("the style picker shows the current style", l.on && l.title === "rgb(30, 41, 59)", l);
  await press("ArrowDown");
  await new Promise((r) => setTimeout(r, 300));
  l = await look();
  check("moving in the style picker shows the next style", l.on && l.title === "rgb(0, 0, 0)", l);
  await press("Escape");
  await new Promise((r) => setTimeout(r, 300));
  check("closing the picker puts the window back", !(await look()).on && (await text()).includes("style: default"));

  await command("export-style-default plain");
  const config = await ev(() => backend.readText("/config/md-editor/config.toml").then((f: { text: string }) => f.text));
  check(":export-style-default writes config.toml", config.includes('[export]\nstyle = "plain"'), config);

  await command("export-help");
  const help = await text();
  check(":export-help opens the reference", help.startsWith("# Export reference") && help.includes("`table-bands`"), help.slice(0, 80));
}
