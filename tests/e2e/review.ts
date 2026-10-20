// Working with agents: reviewing their changes to a file as inline diffs,
// comments in the file, the version history. And zoom.

import type { Harness } from "./run.ts";

const ORIGINAL = `# Draft

First paragraph stays.

Second paragraph will change.

Third paragraph stays too.

Fourth paragraph goes away.

Fifth paragraph stays.

Last line.
`;

const AGENT = `# Draft

First paragraph stays.

Second paragraph has changed.

Third paragraph stays too.

Fifth paragraph stays.

Last line.

A new closing paragraph.
`;

export default async function ({ page, type, press, ev, check, restart }: Harness) {
  const run = async (cmd: string) => {
    await type(":");
    await type(cmd);
    await press("Enter");
  };
  const text = () => ev(() => app.view.state.doc.toString() as string);
  const message = () => ev(() => document.getElementById("message")!.textContent!);
  const count = (sel: string) => ev((sel) => document.querySelectorAll(sel).length, sel);
  const selected = () =>
    ev(() => {
      const { state } = app.view;
      return state.sliceDoc(state.selection.main.from, state.selection.main.to) as string;
    });
  const outside = async (contents: string) => {
    await ev((contents) => backend.writeText("/draft.md", contents), contents);
    await page.waitForTimeout(400);
  };

  // ── Outside changes ──
  await ev((t) => backend.writeText("/draft.md", t), ORIGINAL);
  await run("o /draft.md");
  await outside(AGENT);
  check("an outside change is taken in", (await text()) === AGENT, await text());
  check("and offered for review", (await message()).includes("3 changes to review"), await message());
  check("a removed paragraph shows above", (await count(".cm-deletedChunk .cm-deletedLine")) === 2, await count(".cm-deletedChunk .cm-deletedLine"));
  check("words changed in a paragraph show in place", (await count(".cm-inlineChangedLine del.cm-deletedText")) === 1, await count(".cm-inlineChangedLine del"));
  check("added text is highlighted", (await count(".cm-changedLine")) >= 1 && (await count(".cm-changedText")) >= 2, await count(".cm-changedLine"));
  check("the buffer matches the file", (await count(".sl-file.dirty")) === 0);

  await type("gg]g");
  check("]g selects the first change", (await selected()) === "Second paragraph has changed.", await selected());
  check("and says where it is", (await message()) === "change 1 of 3", await message());
  await type(" dr");
  check("space d r brings back the text from before", (await text()).includes("Second paragraph will change."), await text());
  check("which leaves the buffer modified", (await count(".sl-file.dirty")) === 1);

  await type("]g");
  // A deletion: the cursor goes on the line after it.
  check("]g goes on to the next change", (await selected()) === "F" && (await message()) === "change 1 of 2", await selected());
  await type(" da");
  check("space d a keeps it", !(await text()).includes("Fourth paragraph") && (await message()).includes("1 left"), await message());

  // Typing during a review is not taken for a change.
  await type("ggA");
  await type(" More.");
  await press("Escape");
  check("edits typed during a review are not changes to review", (await count(".cm-deletedChunk")) === 1, await count(".cm-deletedChunk"));

  // The buttons beside a change.
  await page.click(".review-accept");
  await page.waitForTimeout(100);
  check("the Accept button accepts", (await count(".cm-deletedChunk")) === 0 && (await count(".cm-merge-b")) === 0, await count(".cm-deletedChunk"));
  await run("w");
  await outside((await text()).replace("Last line.", "Last line, edited."));
  await page.click(".review-reject");
  await page.waitForTimeout(100);
  check("the Reject button rejects", (await text()).includes("Last line.\n") && (await count(".cm-merge-b")) === 0, await text());
  await run("w");
  await outside((await text()).replace("Fifth", "5th"));

  // In a narrow window the buttons get a row above the change instead of the margin.
  await page.setViewportSize({ width: 800, height: 860 });
  await page.waitForTimeout(200);
  const button = await ev(() => {
    const r = document.querySelector(".review-accept")!.getBoundingClientRect();
    const scroller = document.querySelector(".cm-scroller")!;
    return { left: r.left, narrow: scroller.classList.contains("review-narrow"), scroll: scroller.scrollWidth - scroller.clientWidth };
  });
  check("narrow windows keep the buttons in view, without scrolling sideways", button.narrow && button.left > 0 && button.scroll === 0, button);
  await page.setViewportSize({ width: 1300, height: 860 });
  await page.waitForTimeout(200);
  check("and wide ones put them back in the margin", !(await ev(() => document.querySelector(".cm-scroller")!.classList.contains("review-narrow"))));

  await run("accept-all-changes");
  check(":accept-all-changes ends the review", (await count(".cm-merge-b")) === 0 && (await count(".cm-deletedChunk")) === 0);
  check("keeping both choices and edits", (await text()).startsWith("# Draft More.") && (await text()).includes("Second paragraph will change.") && (await text()).endsWith("A new closing paragraph.\n"), await text());
  await run("w");

  // Two windows on the file both review; deciding in one decides in both.
  await run("vsplit");
  const saved = await text();
  await outside(saved.replace("Last line.", "Last line, edited."));
  check("each window shows the review", (await count(".cm-merge-b")) === 2, await count(".cm-merge-b"));
  await type("u");
  check("u undoes the outside change, which ends the review everywhere", (await count(".cm-merge-b")) === 0 && (await text()) === saved, await count(".cm-merge-b"));
  await type("U");
  await run("w");
  await run("q");

  // ── Comments ──
  await type("gg3G");
  await type(" c");
  await type("Say why.");
  await press("Enter");
  const line3 = await ev(() => app.view.state.doc.line(3).text as string);
  check("space c adds a note at the end of the line", line3 === "First paragraph stays. {>>Say why.<<}", line3);
  await type("ggwe");
  await type(" c");
  await type("Too vague?");
  await press("Enter");
  const line1 = await ev(() => app.view.state.doc.line(1).text as string);
  check("with text selected, the note is about it", line1 === "# {==Draft==}{>>Too vague?<<} More.", line1);
  await type("ge");
  check("away from the cursor, notes read as asides", (await count(".md-note")) === 2 && (await count(".md-note-mark")) === 2, await count(".md-note"));
  check("and highlighted text is marked", (await count(".md-highlight")) === 1);
  await type("gg]c");
  check("]c selects the next comment", (await selected()) === "{==Draft==}{>>Too vague?<<}", await selected());
  await type("]c");
  check("]c again, the one after", (await selected()) === "{>>Say why.<<}", await selected());
  await type("[c");
  check("[c the previous one", (await selected()) === "{==Draft==}{>>Too vague?<<}", await selected());
  await type(" C");
  check("space C removes it and keeps the text", (await ev(() => app.view.state.doc.line(1).text)) === "# Draft More.");

  // ── Version history ──
  await run("w");
  await type(" h");
  await page.waitForSelector(".pk-row");
  const rows = await ev(() => [...document.querySelectorAll(".pk-row")].map((r) => r.textContent!));
  check("space h lists the versions kept, newest first", rows.length >= 4 && rows[0].includes("saved") && rows.at(-1)!.includes("opened"), rows);
  await type("opened");
  await page.waitForTimeout(200);
  check(
    "the preview shows what changed since",
    (await count(".pk-line.pk-del")) > 0 && (await count(".pk-line.pk-add")) > 0 && (await ev(() => document.querySelector(".pk-head")!.textContent!)).startsWith("changes since"),
  );
  await press("Enter");
  check("Enter brings that version back", (await text()) === ORIGINAL, await text());
  check("as changes to review", (await count(".cm-merge-b")) === 1 && (await message()).includes("brought back"), await message());
  await run("reject-all-changes");
  check(":reject-all-changes goes back to the current text", (await count(".cm-merge-b")) === 0 && !(await text()).includes("Fourth"), await text());

  // Changed by another program while the file was not open: reviewed on opening.
  await run("w");
  await run("bc");
  const before = (await ev(async () => (await backend.readText("/draft.md")).text)) as string;
  await ev((t) => backend.writeText("/draft.md", t), before.replace("Third", "The third"));
  await run("o /draft.md");
  check(
    "changes made while the file was closed are up for review on opening",
    (await count(".cm-merge-b")) === 1 && (await message()).includes("changed since it was last open here: 1 change"),
    await message(),
  );
  await run("accept-all-changes");
  await run("bc");
  await run("o /draft.md");
  check("once seen, they are not up for review again", (await count(".cm-merge-b")) === 0);

  // Changes still pending when the app goes stay pending.
  await outside((await text()).replace("First paragraph", "The first paragraph"));
  await page.waitForTimeout(1300);
  await restart();
  await run("o /draft.md");
  check("changes pending at quitting are still up for review after a restart", (await count(".cm-merge-b")) === 1 && (await message()).includes("1 change to review"), await message());
  await run("accept-all-changes");
  await page.waitForTimeout(1300);
  await restart();
  await run("o /draft.md");
  check("and not once accepted", (await count(".cm-merge-b")) === 0, await message());

  // ── Reflow ──
  await type("geo");
  await type("- a list item long enough to need wrapping at twenty");
  await press("Escape");
  await run("reflow 20");
  const wrapped = await ev(() => app.view.state.doc.toString().split("\n").slice(-3));
  check(":reflow wraps the paragraph under the cursor", JSON.stringify(wrapped) === JSON.stringify(["- a list item long", "  enough to need", "  wrapping at twenty"]), wrapped);
  await type("u");

  // ── Zoom ──
  const size = () => ev(() => parseFloat(getComputedStyle(document.querySelector(".cm-scroller")!).fontSize));
  const base = await size();
  await press("Meta+Equal");
  check("Cmd-= makes the text bigger", (await size()) > base && (await message()) === "zoom 110%", [await size(), await message()]);
  await press("Meta+Minus");
  await press("Meta+Minus");
  check("Cmd-- smaller", (await size()) < base, await size());
  await run("zoom 150");
  await restart();
  check("the zoom is kept for the next start", Math.abs((await size()) - base * 1.5) < 0.5, [await size(), base]);
  await press("Meta+0");
  check("Cmd-0 resets it", (await size()) === base, await size());
}
