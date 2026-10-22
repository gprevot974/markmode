import { describe, expect, it } from "vitest";
import { loadTheme, parseTheme, themeVariables } from "../src/theme/helixTheme.ts";
import { applyHelixConfig, usableKeys } from "../src/helixConfig.ts";
import { config } from "../src/config.ts";

const themes: Record<string, Record<string, unknown>> = {
  base: {
    "ui.background": { fg: "white", bg: "ink" },
    "ui.selection": { bg: "#334455" },
    "markup.heading": { fg: "gold", modifiers: ["bold"] },
    keyword: { fg: "violet", modifiers: ["italic"] },
    palette: { ink: "#101018", gold: "#E0B040", violet: "#9070C0" },
  },
  child: {
    inherits: "base",
    "markup.heading.1": "rose",
    // Unquoted dotted keys come out of TOML nested.
    ui: { linenr: { fg: "gold" } },
    palette: { rose: "#d07080", ink: "#fafaf0" },
  },
};
const read = async (name: string) => {
  if (!themes[name]) throw new Error(`no Helix theme named ${name}`);
  return themes[name];
};

describe("Helix themes", () => {
  it("applies inheritance, palettes and scope fallbacks", async () => {
    const theme = parseTheme(await loadTheme("child", read));
    expect(theme.light).toBe(true);
    const vars = themeVariables(theme);
    expect(vars["--bg"]).toBe("#fafaf0");
    expect(vars["--fg"]).toBe("#ffffff");
    expect(vars["--h1"]).toBe("#d07080");
    expect(vars["--h2"]).toBe("#e0b040");
    expect(vars["--violet"]).toBe("#9070c0");
    expect(vars["--gutter"]).toBe("#e0b040");
    expect(vars["--sel-primary"]).toBe("#334455");
    expect(vars["--green"]).toBeUndefined();
  });

  it("is dark when the background is", async () => {
    expect(parseTheme(await loadTheme("base", read)).light).toBe(false);
  });

  it("reports a missing parent", async () => {
    await expect(loadTheme("orphan", async (n) => (n === "orphan" ? { inherits: "gone" } : read(n)))).rejects.toThrow("gone");
  });
});

describe("Helix config", () => {
  it("keeps bindings it can run and lists the others", () => {
    const skipped: string[] = [];
    const keys = usableKeys(
      {
        ret: "goto_word",
        "C-g": [":write-all", ":insert-output lazygit >/dev/tty", ":redraw", ":reload-all"],
        space: { x: "no_such_command", w: ":w" },
      },
      skipped,
    );
    expect(keys).toEqual({ ret: "goto_word", space: { w: ":w" } });
    expect(skipped).toEqual(["C-g: :insert-output lazygit >/dev/tty, :redraw", "space x: no_such_command"]);
  });

  it("applies the theme, editor options and keys", () => {
    applyHelixConfig({
      theme: { light: "a", dark: "b" },
      editor: { cursorline: false, "soft-wrap": { enable: false }, "auto-save": true, gutters: ["diagnostics"] },
      keys: { insert: { j: { j: "normal_mode" } } },
    });
    expect(config.theme).toEqual({ light: "a", dark: "b" });
    expect(config.cursorline).toBe(false);
    expect(config.softWrap).toBe(false);
    expect(config.lineNumbers).toBe(false);
    expect(config.keys.insert.j).toEqual({ j: "normal_mode" });
  });
});
