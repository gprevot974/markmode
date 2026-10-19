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
}
