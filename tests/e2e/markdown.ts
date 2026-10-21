// What a markdown editor is expected to have: global search, links between
// files, images, footnotes and math.

import type { Harness } from "./run.ts";

export default async function ({ page, type, press, ev, check }: Harness) {
  const files = () => ev(() => [...document.querySelectorAll(".sl-file")].map((e) => e.textContent));
  const selected = () => ev(() => app.view.state.sliceDoc(app.view.state.selection.main.from, app.view.state.selection.main.to) as string);
  await ev(async () => {
    await backend.writeText("/notes/plan.md", "# Plan\n\nSee [the ideas](ideas.md) and [[ideas]].\n\n  Second Buffer mention.\n");
    await backend.writeText(
      "/notes/links.md",
      "# Links\n\n[Plan](plan.md#plan) [[Ideas|my ideas]] [[deep/new note]] [site](https://example.com) [down](#later) ![chart](chart.png)\n\nfiller\n\n## Later\n\nEnd.\n",
    );
  });

  // space /: a regex search of the workspace, as the pattern is typed.
  await type(" /");
  await type("buff");
  await page.waitForTimeout(400);
  const rows = () =>
    ev(() => [...document.querySelectorAll(".pk-row")].map((r) => [r.querySelector(".pk-prefix")?.textContent, r.querySelector(".pk-hl") && r.querySelector(".pk-text")!.textContent]));
  const found = await rows();
  check(
    "space / lists the matching lines of every file, smart case",
    found.some(([p]) => p === "notes/ideas.md:3") && found.some(([p, t]) => p === "notes/plan.md:5" && t === "Second Buffer mention."),
    found,
  );
  const highlight = await ev(() => [...document.querySelectorAll(".pk-row")].map((r) => [...r.querySelectorAll(".pk-hl")].map((e) => e.textContent).join("")));
  const count = await ev(() => document.querySelector(".pk-count")!.textContent);
  check("the count says how many lines matched", /^\d+ match(es)?$/.test(count!), count);
  check("the match is highlighted", highlight.every((h) => /^buff$/i.test(h)), highlight);
  await type("x(");
  await page.waitForTimeout(400);
  check("an invalid pattern says so", /invalid|unterminated/i.test(await ev(() => document.querySelector(".pk-count")!.textContent!)), await ev(() => document.querySelector(".pk-count")!.textContent));
  await press("Backspace");
  await press("Backspace");
  await type("er m");
  await page.waitForTimeout(400);
  await press("Enter");
  check("Enter opens the file and selects the match", (await files())[0] === "/notes/plan.md" && (await selected()) === "Buffer m", [await files(), await selected()]);
  await type("ggn");
  check("n then searches for the same pattern", (await selected()) === "Buffer m", await selected());

  // An unsaved buffer is searched as it is here.
  await type("ggiZebra ");
  await press("Escape");
  await type(" /");
  await type("zebra");
  await page.waitForTimeout(400);
  check("unsaved text is found", (await rows()).some(([p]) => p === "notes/plan.md:1"), await rows());
  await press("Escape");
  await type("u");

  // Links: gf follows them; wiki-links show their text.
  await ev(() => app.openPath("/notes/links.md"));
  const lineHtml = () => ev(() => document.querySelectorAll(".window.active .cm-line")[2].textContent);
  await type("ge");
  check("a wiki-link shows its text, without brackets", (await lineHtml())!.includes("my ideas") && !(await lineHtml())!.includes("[["), await lineHtml());
  const gotoText = async (s: string) => {
    await ev((s) => {
      const at = app.view.state.doc.toString().indexOf(s);
      app.view.dispatch({ selection: { anchor: at, head: at + 1 } });
    }, s);
  };
  const where = () => ev(() => ({ file: app.active.doc.path, line: app.view.state.doc.lineAt(app.view.state.selection.main.head).number }));
  await gotoText("Plan](");
  await type("gf");
  check("gf opens a linked file, at the heading its anchor names", JSON.stringify(await where()) === JSON.stringify({ file: "/notes/plan.md", line: 1 }), await where());
  await press("Control+o");
  check("C-o comes back", (await where()).file === "/notes/links.md", await where());
  await gotoText("Ideas|");
  await type("gf");
  check("gf follows a wiki-link, found by name", (await where()).file === "/notes/ideas.md", await where());
  await press("Control+o");
  await gotoText("deep/");
  await type("gf");
  check("a wiki-link to no note opens a new one beside", (await where()).file === "/notes/deep/new note.md", await where());
  await type("ga");
  await gotoText("down](");
  await type("gf");
  check("an anchor alone moves to the heading", JSON.stringify(await where()) === JSON.stringify({ file: "/notes/links.md", line: 7 }), await where());
  await gotoText("site](");
  await type("gf");
  await gotoText("chart](");
  await type("gf");
  check(
    "an address, or an image, opens in its own app",
    JSON.stringify(await ev(() => (window as unknown as { openedExternally: string[] }).openedExternally)) === JSON.stringify(["https://example.com", "/notes/chart.png"]),
    await ev(() => (window as unknown as { openedExternally: string[] }).openedExternally),
  );

  // Images show in place; on the cursor's line, under their source.
  await ev(async () => {
    await backend.writeText("/notes/dot.svg", '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="30"><rect width="40" height="30" fill="red"/></svg>');
    await backend.writeText("/notes/pics.md", "# Pics\n\n![A dot](dot.svg)\n\n![Gone](missing.png)\n\nText.\n");
    await app.openPath("/notes/pics.md");
  });
  await type("ge");
  await page.waitForTimeout(300);
  const image = () =>
    ev(() => {
      const img = document.querySelector<HTMLImageElement>(".window.active .md-image img");
      return {
        loaded: !!img && img.complete && img.naturalWidth === 40,
        source: document.querySelectorAll(".window.active .cm-line")[2].textContent,
        missing: document.querySelector(".window.active .md-image-missing")?.textContent,
      };
    });
  let pic = await image();
  check("an image shows in place of its source", pic.loaded && pic.source === "", pic);
  check("a missing image says so", pic.missing === "Gone (missing.png not found)", pic);
  await type("3G");
  await page.waitForTimeout(200);
  pic = await image();
  check("on the cursor's line, the source shows above the image", pic.loaded && pic.source === "![A dot](dot.svg)", pic);
  // The docx gets the SVG and a PNG of it, for programs without SVG.
  await type(":");
  await type("export-docx");
  await press("Enter");
  await page.waitForFunction(() => /export|error|fail/i.test(document.getElementById("message")!.textContent!), null, { timeout: 15000 }).catch(() => {});
  const exported = await ev(() => document.getElementById("message")!.textContent!);
  const media = await ev(() => {
    const bytes = (window as unknown as { written?: Record<string, Uint8Array> }).written?.["/notes/pics.docx"];
    return bytes ? [...new TextDecoder("latin1").decode(bytes).matchAll(/word\/media\/[\w-]+\.(svg|png)/g)].map((m) => m[1]) : [];
  });
  check(":export-docx places an SVG with a PNG beside it", media.includes("svg") && media.includes("png"), { media, exported });
  await type("ga");

  // Footnotes: references show as numbers; gf goes to the note and back.
  await ev(async () => {
    await backend.writeText("/notes/notes.md", "# Notes\n\nA claim.[^src] More.[^b]\n\nfiller\n\n[^b]: Second.\n[^src]: The source.\n");
    await app.openPath("/notes/notes.md");
  });
  await type("gg");
  const refs = await ev(() => [...document.querySelectorAll(".window.active .md-footnote-ref")].map((e) => [e.textContent, (e as HTMLElement).title]));
  check("footnote references show as numbers, their note as a tooltip", JSON.stringify(refs) === JSON.stringify([["1", "The source."], ["2", "Second."]]), refs);
  check("notes are set smaller", (await ev(() => document.querySelectorAll(".window.active .md-footnote").length)) === 2);
  await gotoText("^src]");
  await type("gf");
  check("gf on a reference goes to its note", JSON.stringify(await where()) === JSON.stringify({ file: "/notes/notes.md", line: 8 }), await where());
  await type("gf");
  check("and from the note back to the reference", (await where()).line === 3, await where());
  // The word count: what a reader sees, footnotes apart; a selection's of the whole.
  const words = () => ev(() => document.querySelector(".window.active .sl-words")!.textContent);
  check("the statusline counts the document's words", (await words()) === "5 words", await words());
  await type("ggx");
  check("and a selection's", (await words()) === "1 of 5 words", await words());
  await type(";");
  await type(":");
  await type("word-count");
  await press("Enter");
  const counted = await ev(() => document.getElementById("message")!.textContent!);
  check(":word-count gives characters and the footnotes' words", counted.startsWith("5 words, ") && counted.includes("3 more in 2 footnotes"), counted);
  await type("ga");

  // Math: typeset by KaTeX, the source on the cursor's line.
  await ev(async () => {
    await backend.writeText("/notes/math.md", "# Math\n\nArea $\\pi r^2$, price $5 and $10.\n\n$$\n\\frac{a}{b}\n$$\n\nBad $\\frac{$ here.\n\nEnd.\n");
    await app.openPath("/notes/math.md");
  });
  await type("ge");
  await page.waitForTimeout(800);
  const math = () =>
    ev(() => {
      const win = document.querySelector(".window.active")!;
      return {
        inline: win.querySelectorAll(".md-math:not(.md-math-block) .katex").length,
        block: win.querySelectorAll(".md-math-block .katex-display").length,
        error: win.querySelector(".md-math-error")?.textContent,
        source: [...win.querySelectorAll(".md-math-source")].map((e) => e.textContent).join("|"),
        prices: win.textContent!.includes("price $5 and $10"),
      };
    });
  let m = await math();
  check("math is typeset, prices are not", m.inline === 1 && m.block === 1 && m.prices && !m.source, m);
  check("TeX that does not parse shows marked", m.error === "\\frac{", m);
  await type("6G");
  await page.waitForTimeout(200);
  m = await math();
  check("a block under the cursor shows its source, typeset under it", m.block === 1 && m.source === "$$|\\frac{a}{b}|$$", m);
  // :export-html writes a page beside the document.
  await type(":");
  await type("export-html");
  await press("Enter");
  await page.waitForTimeout(500);
  const html = await ev(() => backend.readText("/notes/math.html").then((f: { text: string }) => f.text).catch(() => ""));
  check(":export-html writes the page, math as MathML", html.startsWith("<!doctype html>") && html.includes("<math"), html.slice(0, 80));

  await type("ga");

  // C-x after [[ lists the notes.
  await type("geo[[ide");
  await press("Control+x");
  const menu = await ev(() => [...document.querySelectorAll("#menu .menu-item")].map((e) => e.textContent!));
  check("C-x after [[ lists notes by name", menu.some((m) => m.endsWith("ideas")), menu);
  await type("1");
  check("choosing one closes the link", (await ev(() => app.view.state.doc.lineAt(app.view.state.selection.main.head).text)) === "[[ideas]]");
  await type("](pl");
  await press("Control+x");
  await type("1");
  const line = await ev(() => app.view.state.doc.lineAt(app.view.state.selection.main.head).text);
  check("C-x after ]( lists files by path", line === "[[ideas]]](plan.md)", line);
  await press("Escape");
}
