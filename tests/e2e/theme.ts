// Light and dark Kanagawa, `:theme`, and Helix themes.

import type { Harness } from "./run.ts";

export const options = { colorScheme: "light" as const };

export default async function ({ page, type, press, ev, check, restart }: Harness) {
  const theme = () =>
    ev(() => ({
      mode: document.documentElement.dataset.theme,
      bg: getComputedStyle(document.body).backgroundColor,
      h1: getComputedStyle(document.documentElement).getPropertyValue("--h1").trim(),
    }));
  const run = async (cmd: string) => {
    await type(":");
    await type(cmd);
    await press("Enter");
    await page.waitForTimeout(100);
  };

  check("auto follows a light system", (await theme()).mode === "light", await theme());

  await type(":");
  await type("theme d");
  const completion = await ev(() => [...document.querySelectorAll("#completion .item")].map((e) => e.textContent));
  check(":theme completes names", completion.includes("dark"), completion);
  await press("Tab");
  check("tabbing to a theme previews it", (await theme()).mode === "dark");
  await press("Enter");
  check(":theme dark switches", (await theme()).mode === "dark");
  await restart();
  check("the choice survives a restart", (await theme()).mode === "dark");

  // A Helix theme, through a stand-in for the theme files.
  await ev(() => {
    const files: Record<string, object> = {
      paper: { inherits: "ink", "ui.background": { bg: "#fbf8ef" }, "ui.text": "#333333", palette: {} },
      ink: { "markup.heading.1": { fg: "red", modifiers: ["bold"] }, string: "green" },
    };
    backend.helixTheme = async (name: string) => {
      if (!files[name]) throw new Error(`no Helix theme named ${name}`);
      return files[name];
    };
  });
  await type(":");
  await type("theme paper");
  const previewed = await theme();
  check("typing a theme name previews it", previewed.bg === "rgb(251, 248, 239)", previewed);
  await press("Escape");
  check("Esc puts the theme back", (await theme()).mode === "dark", await theme());
  await run("theme paper");
  const paper = await theme();
  check("a Helix theme sets the colors", paper.mode === "light" && paper.bg === "rgb(251, 248, 239)" && paper.h1 === "#cd0000", paper);
  await run("theme nonexistent");
  const message = await ev(() => document.getElementById("message")!.textContent);
  check("an unknown theme is an error and changes nothing", message!.includes("nonexistent") && (await theme()).bg === paper.bg, message);
  await run("theme auto");
  const auto = await theme();
  check("back to the built-in theme, without leftovers", auto.mode === "light" && auto.bg === "rgb(242, 236, 188)" && auto.h1 === "#4d699b", auto);
}
