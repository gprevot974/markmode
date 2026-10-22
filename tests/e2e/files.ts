// Line endings, crash recovery.

import type { Harness } from "./run.ts";

export default async function ({ page, type, press, ev, check, restart }: Harness) {
  const run = async (cmd: string) => {
    await type(":");
    await type(cmd);
    await press("Enter");
  };
  const disk = (path: string) => ev(async (path) => (await backend.readText(path)).text as string, path);
  const status = () => ev(() => [...document.querySelectorAll(".statusline")][0].textContent);

  // A file with Windows line endings keeps them.
  await ev(() => backend.writeText("/windows.md", "# Title\r\n\r\nFirst line\r\n"));
  await run("o /windows.md");
  check("\\r\\n is read as one line break", (await ev(() => app.view.state.doc.lines)) === 4);
  check("the statusline says crlf", (await status())!.includes("crlf"), await status());
  await type("3Gi");
  await type("New ");
  await press("Escape");
  await run("w");
  check("saving keeps \\r\\n", (await disk("/windows.md")) === "# Title\r\n\r\nNew First line\r\n", await disk("/windows.md"));
  await run("line-ending lf");
  check(":line-ending marks the buffer modified", (await ev(() => document.querySelectorAll(".sl-file.dirty").length)) === 1);
  await run("w");
  check(":line-ending lf converts on saving", (await disk("/windows.md")) === "# Title\n\nNew First line\n", await disk("/windows.md"));

  // Unsaved changes come back after a crash (here, reloading the page).
  await type("gei");
  await type("Unsaved words.");
  await press("Escape");
  await page.waitForTimeout(1300);
  await restart();
  const restored = await ev(() => {
    const doc = app.docs.find((d: { path: string }) => d.path === "/windows.md");
    return {
      dirty: doc && app.isDirty(doc),
      text: doc && (app.stateOf(doc).doc.toString() as string),
      message: document.getElementById("message")!.textContent,
    };
  });
  check(
    "a crash keeps unsaved changes, restored as a modified buffer",
    restored.dirty && restored.text?.endsWith("Unsaved words.") && restored.message!.includes("restored"),
    restored,
  );
  await run("o /windows.md");
  await type("u");
  check("u takes the restored buffer back to the file on disk", (await ev(() => app.view.state.doc.toString())) === "# Title\n\nNew First line\n");
  await type("U");
  await run("w");
  await page.waitForTimeout(1300);
  await restart();
  check("nothing to restore once saved", !(await ev(() => document.getElementById("message")!.textContent))!.includes("restored"));

  // :config-open writes the settings template when there is none.
  await run("config-open");
  const template = await disk("/config/markmode/config.toml");
  check(":config-open writes a commented settings file", template.includes("[images]") && template.includes("# spellcheck = true"), template);

  // Settings apply at the next start: here, where pasted images go.
  await ev(() => backend.writeText("/config/markmode/config.toml", '[images]\nfolder = "pics"\n'));
  await restart();
  await run("o /notes/ideas.md");
  const pasted = await ev(async () => {
    const data = new DataTransfer();
    data.items.add(new File([new Uint8Array([137, 80, 78, 71])], "image.png", { type: "image/png" }));
    app.view.contentDOM.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
    await new Promise((r) => setTimeout(r, 200));
    const written = Object.keys((window as unknown as { written?: Record<string, unknown> }).written ?? {});
    return { written, text: app.view.state.doc.toString() as string };
  });
  const file = pasted.written.find((p) => /^\/notes\/pics\/pasted-[\d-]+\.png$/.test(p));
  check("a pasted image is saved in the folder the settings name", !!file, pasted.written);
  check(
    "and linked in the document",
    !!file && pasted.text.includes(`![](pics/${file.split("/").pop()})`),
    pasted.text,
  );

  // A dropped image is saved under its own name and linked where it lands.
  const dropped = await ev(async () => {
    const data = new DataTransfer();
    data.items.add(new File(["<svg/>"], "My chart.svg", { type: "image/svg+xml" }));
    const line = app.view.contentDOM.querySelector(".cm-line")!.getBoundingClientRect();
    app.view.contentDOM.dispatchEvent(
      new DragEvent("drop", { dataTransfer: data, clientX: line.left + 1, clientY: line.top + line.height / 2, bubbles: true, cancelable: true }),
    );
    await new Promise((r) => setTimeout(r, 200));
    return app.view.state.doc.toString() as string;
  });
  check("a dropped image is linked on the line it lands on", dropped.split("\n")[0].includes("![My chart](pics/My-chart.svg)"), dropped);

  // An untitled buffer has nowhere to put an image.
  await run("new");
  await ev(() => {
    const data = new DataTransfer();
    data.items.add(new File([new Uint8Array([1])], "image.png", { type: "image/png" }));
    app.view.contentDOM.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
  });
  await page.waitForTimeout(100);
  check("pasting an image in an untitled buffer asks to save it first", (await ev(() => document.getElementById("message")!.textContent))!.includes("save the document first"));

  // Dragging files from Finder (played here by calling the app's handler):
  // a hint says what dropping does, then the drop links the image.
  await run("o /sample.md");
  const hint = await ev(() => {
    const line = app.view.contentDOM.querySelectorAll(".cm-line")[2].getBoundingClientRect();
    const at = { x: line.left + 2, y: line.top + line.height / 2 };
    app.onDragDrop({ type: "enter", paths: ["/chart.svg", "/notes/ideas.md"], ...at });
    const box = document.querySelector<HTMLElement>(".drop-hint")!;
    const caret = document.querySelector<HTMLElement>(".drop-caret")!;
    const shown = { label: box.textContent, caret: caret.style.display !== "none", at };
    app.onDragDrop({ type: "leave", paths: [], x: 0, y: 0 });
    return { ...shown, hidden: box.style.display === "none" };
  });
  check("dragging over the window says what dropping does", hint.label === "Insert image, open ideas.md" && hint.caret, hint);
  check("the hint goes when the drag leaves", hint.hidden);
  await ev((at) => app.onDragDrop({ type: "drop", paths: ["/chart.svg"], ...at }), hint.at);
  await page.waitForTimeout(200);
  const linked = await ev(() => app.view.state.doc.toString() as string);
  check("an image dropped from the document's folder is linked where it is", linked.includes("![chart](chart.svg)"), linked.slice(0, 300));

  // :images-clean lists the images no markdown file uses, and with ! trashes them.
  await ev(async () => {
    await backend.writeText("/proj/doc.md", "# Doc\n\n![](pics/used%20one.png)\n");
    await backend.writeText("/proj/other.md", "See pics/shared.png.\n");
    for (const name of ["used one.png", "shared.png", "stale.png", "notes.txt"]) await backend.writeText(`/proj/pics/${name}`, "x");
  });
  await run("o /proj/doc.md");
  await run("images-clean");
  const listed = await ev(() => document.getElementById("message")!.textContent!);
  check(":images-clean lists the unused image only", listed.includes("1 image in pics/") && listed.includes("stale.png") && !listed.includes("shared"), listed);
  await run("images-clean!");
  const left = await ev(async () => (await backend.listDir("/proj/pics")).map((e: { name: string }) => e.name).sort());
  check(":images-clean! moves it to the Trash", JSON.stringify(left) === JSON.stringify(["notes.txt", "shared.png", "used one.png"]), left);

  // A link that comes back (here, typed again) brings its cleaned-up image back.
  await ev(() => app.view.dispatch({ changes: { from: app.view.state.doc.length, insert: "\n![](pics/stale.png)\n" } }));
  await page.waitForTimeout(400);
  const back = await ev(async () => ({
    files: (await backend.listDir("/proj/pics")).map((e: { name: string }) => e.name),
    message: document.getElementById("message")!.textContent!,
  }));
  check("a cleaned-up image comes back when a link to it does", back.files.includes("stale.png") && back.message.includes("brought back pics/stale.png"), back);

  // A folder the cleanup would leave empty goes to the Trash whole.
  await ev(async () => {
    await backend.writeText("/solo/doc.md", "# Solo\n");
    for (const name of ["a.png", "b.png", ".DS_Store"]) await backend.writeText(`/solo/pics/${name}`, "x");
  });
  await run("o /solo/doc.md");
  await run("images-clean!");
  const solo = await ev(async () => ({
    left: await backend.listDir("/solo").then((l: { name: string }[]) => l.map((e) => e.name)),
    message: document.getElementById("message")!.textContent!,
  }));
  check("a folder left empty goes to the Trash whole", JSON.stringify(solo.left) === JSON.stringify(["doc.md"]) && solo.message.includes("pics/, with 2 images,"), solo);
}

