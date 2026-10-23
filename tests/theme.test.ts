import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { baseThemeCss } from "../src/theme/baseTheme.ts";
import { builtinTheme, builtinThemeNames } from "../src/theme/builtinThemes.ts";
import { parseTheme, themeVariableNames, themeVariables } from "../src/theme/helixTheme.ts";
import { fromOklch, shade, toOklch } from "../src/theme/color.ts";

const read = (path: string) => readFileSync(new URL(`../src/${path}`, import.meta.url), "utf8");

describe("the base theme", () => {
  const css = baseThemeCss(read("theme/themes/entre-deux.toml"), read("theme/themes/entre-deux-light.toml"));

  it("is Entre-Deux, dark and light, setting every theme variable", () => {
    expect(css).toMatch(/^:root \{\n {2}--bg: #/);
    expect(css).toContain(':root[data-theme="light"] {');
    for (const v of themeVariableNames) expect(css.match(new RegExp(`  ${v}: `, "g"))?.length, v).toBe(2);
  });

  it("refuses a theme leaving variables unset", () => {
    expect(() => baseThemeCss('"ui.background" = { bg = "#101018" }', "")).toThrow(/entre-deux sets no color for --fg, /);
  });

  it("defines every variable the styles use", () => {
    const defined = new Set([...themeVariableNames, ...[...read("style.css").matchAll(/(--[\w-]+):/g)].map((m) => m[1])]);
    // Set from code: the zoom, review.ts's gutters, the export style's (exportLook.ts).
    const fromCode = (v: string) => ["--zoom", "--review-gutters"].includes(v) || v.startsWith("--x-");
    for (const file of ["style.css", "theme/editorTheme.ts"]) {
      for (const [, v] of read(file).matchAll(/var\((--[\w-]+)/g)) if (!fromCode(v)) expect(defined, `${v} in ${file}`).toContain(v);
    }
  });
});

describe("shipped themes", () => {
  it("each sets every theme variable", () => {
    for (const name of builtinThemeNames) {
      const vars = themeVariables(parseTheme(builtinTheme(name)!));
      expect(themeVariableNames.filter((v) => !vars[v]), name).toEqual([]);
    }
  });

  it("include Kanagawa, light and dark", () => {
    expect(parseTheme(builtinTheme("kanagawa-lotus")!).light).toBe(true);
    expect(parseTheme(builtinTheme("kanagawa-wave")!).light).toBe(false);
  });
});

describe("surfaces", () => {
  it("are shades of the background, keeping its hue", () => {
    expect(fromOklch(toOklch("#f2ecbc"))).toBe("#f2ecbc");
    const line = shade("#f2ecbc", true, 0.05, 1.25);
    expect(line).toBe("#e4dca0");
    expect(Math.abs(toOklch(line)[2] - toOklch("#f2ecbc")[2])).toBeLessThan(1);
    expect(toOklch(shade("#1f1f28", false, 0.05, 1.25))[0]).toBeGreaterThan(toOklch("#1f1f28")[0]);
  });

  it("are a theme's own when it sets markmode.line and markmode.raised", () => {
    const vars = themeVariables(parseTheme(builtinTheme("kanagawa-lotus")!));
    expect([vars["--bg-line"], vars["--bg-raised"]]).toEqual(["#e7dba0", "#d5cea3"]);
    const derived = themeVariables(parseTheme({ "ui.background": { bg: "#f2ecbc" } }));
    expect(derived["--bg-line"]).toBe("#e4dca0");
  });
});
