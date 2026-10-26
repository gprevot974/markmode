// A large file: about 5 MB of markdown in 120,000 lines. Opening, typing and
// saving must stay usable. The limits are generous, to hold on a slow CI
// machine; the timings are printed to compare runs. CI's macOS runners take
// about three times as long as a recent Mac, so the typing limit is three
// times as high there (GitHub Actions sets CI).

import type { Harness } from "./run.ts";

const LINES = 120_000;
const TYPING_LIMIT = process.env.CI ? 120 : 40;

export default async function ({ page, type, press, ev, check, restart }: Harness) {
  // With line numbers, which are off by default, to time them too.
  await ev(() => sessionStorage.setItem("markmode.helix-config", JSON.stringify({ editor: { gutters: ["line-numbers"] } })));
  await restart();
  const opened = await ev(async (lines) => {
    const block = [
      "## Section heading",
      "",
      "Some prose with **bold**, *italic*, `code` and a [link](https://example.com) in it, long enough to wrap once or twice in the window.",
      "",
      "- a list item",
      "- another one",
      "",
      "```js",
      "const x = 1;",
      "```",
    ];
    const text = Array.from({ length: lines / block.length }, () => block.join("\n")).join("\n") + "\n";
    await backend.writeText("/large.md", text);
    const t0 = performance.now();
    await app.openPath("/large.md");
    await new Promise((r) => requestAnimationFrame(() => setTimeout(r)));
    return { ms: Math.round(performance.now() - t0), bytes: text.length, lines: app.view.state.doc.lines as number };
  }, LINES);
  console.log(`      opened ${(opened.bytes / 1e6).toFixed(1)} MB, ${opened.lines} lines in ${opened.ms} ms`);
  check("opens in under 3 s", opened.lines > LINES - 10 && opened.ms < 3000, opened);

  // Jump to the middle, then time each key press until it is painted. The
  // presses come 100 ms apart, as from a fast typist, so work the editor
  // leaves for after the paint is done before the next one.
  await type("60000G");
  await type("i");
  const keys = await ev(async () => {
    const view = app.view;
    const times: number[] = [];
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 100));
      const t0 = performance.now();
      const pos = view.state.selection.main.head;
      view.dispatch({ changes: { from: pos, insert: "x" }, selection: { anchor: pos + 1 }, userEvent: "input.type" });
      await new Promise((r) => requestAnimationFrame(() => r(null)));
      times.push(performance.now() - t0);
    }
    times.sort((a, b) => a - b);
    return { median: Math.round(times[15]), worst: Math.round(times[29]) };
  });
  console.log(`      key press to paint: median ${keys.median} ms, worst ${keys.worst} ms`);
  check(`typing stays under a few frames (median < ${TYPING_LIMIT} ms)`, keys.median < TYPING_LIMIT, keys);
  await press("Escape");

  const saved = await ev(async () => {
    const t0 = performance.now();
    await app.save(app.active.doc);
    return Math.round(performance.now() - t0);
  });
  console.log(`      saved in ${saved} ms`);
  check("saves in under 1 s", saved < 1000, saved);

  // Another program changes one line in the middle: the change is taken in
  // and offered for review quickly.
  const reviewed = await ev(async () => {
    const before = app.view.state.doc.toString() as string;
    const mid = before.indexOf("const x = 1;", before.length / 2);
    const t0 = performance.now();
    await backend.writeText("/large.md", before.slice(0, mid) + "const y = 2;" + before.slice(mid + 12));
    while (!document.getElementById("message")!.textContent!.includes("to review")) await new Promise((r) => setTimeout(r, 5));
    return { ms: Math.round(performance.now() - t0), message: document.getElementById("message")!.textContent };
  });
  console.log(`      outside change reviewed in ${reviewed.ms} ms (with the 120 ms the watcher waits)`);
  check("an outside change is up for review in under 1 s", reviewed.ms < 1000 && reviewed.message!.includes("1 change to review"), reviewed);
  await ev(() => app.runTypable("accept-all-changes"));

  await type("ge");
  await page.waitForTimeout(100);
  check("ge reaches the end", (await ev(() => app.view.state.doc.lineAt(app.view.state.selection.main.head).number)) >= LINES);
  // The parser reaches the end in the background, which takes a while on a
  // slow machine.
  const styled = await ev(async () => {
    const count = () => document.querySelectorAll(".cm-gutterElement.gutter-h2").length;
    for (const t0 = performance.now(); !count() && performance.now() - t0 < 10_000; ) await new Promise((r) => setTimeout(r, 100));
    return count();
  });
  check("line numbers of headings at the end get their size once parsed", styled > 0, styled);
}
